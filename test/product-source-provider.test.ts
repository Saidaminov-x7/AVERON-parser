import test from "node:test";
import assert from "node:assert/strict";
import type { ProductSourceProvider } from "../src/domain.js";
import { parseProductSourceFeatureFlags } from "../src/feature-flags.js";
import { ProductSourceAccessError, ProductSourceProviderRegistry } from "../src/product-source-provider.js";

const provider: ProductSourceProvider<"1688"> = {
  source: "1688",
  async search() {
    return { products: [], sourceUrl: "https://s.1688.com/", warnings: [] };
  },
  async getProduct() {
    throw new Error("not used by registry tests");
  },
};

test("product source feature flags default to false", () => {
  assert.deepEqual(parseProductSourceFeatureFlags({}), {
    FEATURE_1688_PARSER: false,
    FEATURE_PINDUODUO_PARSER: false,
  });
});

test("disabled providers are reported and cannot be constructed or accessed", () => {
  let factoryCalls = 0;
  const registry = new ProductSourceProviderRegistry(parseProductSourceFeatureFlags({}), {
    "1688": () => {
      factoryCalls += 1;
      return provider;
    },
  });

  assert.deepEqual(registry.getAvailability(), [
    { source: "1688", enabled: false, available: true, state: "disabled" },
    { source: "pinduoduo", enabled: false, available: false, state: "disabled" },
  ]);
  assert.throws(() => registry.getProvider("1688"), (error: unknown) =>
    error instanceof ProductSourceAccessError && error.code === "SOURCE_DISABLED");
  assert.equal(factoryCalls, 0);
});

test("enabled providers are lazily created and cached", () => {
  let factoryCalls = 0;
  const flags = parseProductSourceFeatureFlags({ FEATURE_1688_PARSER: "true" });
  const registry = new ProductSourceProviderRegistry(flags, {
    "1688": () => {
      factoryCalls += 1;
      return provider;
    },
  });

  assert.equal(registry.getAvailability()[0]?.state, "enabled");
  assert.equal(registry.getProvider("1688"), provider);
  assert.equal(registry.getProvider("1688"), provider);
  assert.equal(factoryCalls, 1);
});

test("Pinduoduo cannot be accessed without an implemented provider", () => {
  const registry = new ProductSourceProviderRegistry(
    parseProductSourceFeatureFlags({ FEATURE_PINDUODUO_PARSER: "true" }),
    {},
  );

  assert.deepEqual(registry.getAvailability()[1], {
    source: "pinduoduo",
    enabled: true,
    available: false,
    state: "unavailable",
  });
  assert.throws(() => registry.getProvider("pinduoduo"), (error: unknown) =>
    error instanceof ProductSourceAccessError && error.code === "SOURCE_UNAVAILABLE");
});
