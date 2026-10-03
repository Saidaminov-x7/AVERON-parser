import test from "node:test";
import assert from "node:assert/strict";
import { PinduoduoProvider, PinduoduoProviderError, type PinduoduoTransport } from "../src/providers/pinduoduo/index.js";
import { toParserImportProductV1 } from "../src/backend-import.js";
import type { SearchIntent } from "../src/domain.js";

const intent: SearchIntent = {
  originalQuery: "linen shirt",
  chineseQuery: "亚麻衬衫",
  colors: [],
  sizes: [],
  materials: [],
  keywords: [],
  negativeKeywords: [],
  explanation: "provider adapter test",
  planner: "heuristic",
};

const result = {
  sourceUrl: "https://yangkeduo.com/search_result.html",
  products: [{
    sourceProductId: "pdd-42",
    sourceUrl: "https://mobile.yangkeduo.com/goods.html?goods_id=42",
    title: "Linen shirt",
    description: "Product details",
    images: ["https://images.example/item.jpg"],
    variants: [{ sourceVariantId: "v-1", color: "blue", size: "M", sourcePriceCny: 32 }],
    sizes: ["M"],
    colors: ["blue"],
    sourcePrice: { amount: 32, currency: "CNY" },
    attributes: { material: "linen" },
    categoryHint: "tops",
    shippingMetadata: { handlingDays: "3-5" },
  }],
};

test("Pinduoduo adapter validates and maps source data without publishing", async () => {
  const sourceProduct = result.products[0]!;
  const transport: PinduoduoTransport = {
    async search() { return result; },
    async getProduct() { return sourceProduct; },
  };
  const provider = new PinduoduoProvider(transport);
  const searched = await provider.search(intent, 10);
  assert.equal(searched.products.length, 1);
  assert.equal(searched.products[0]?.status, "PENDING_REVIEW");
  assert.deepEqual(searched.products[0]?.imageUrls, sourceProduct.images);
  assert.deepEqual(searched.products[0]?.variants, sourceProduct.variants);

  const imported = toParserImportProductV1(searched.products[0]!);
  assert.equal(imported.provider, "PINDUODUO");
  assert.equal(imported.sourceDescription, "Product details");
  assert.deepEqual(imported.sourceAttributes, { material: "linen" });
  assert.equal(imported.rawMetadata?.colors instanceof Array, true);
  assert.equal(imported.rawMetadata?.shippingMetadata !== undefined, true);
});

test("Pinduoduo is explicitly blocked when no real provider transport is configured", async () => {
  await assert.rejects(
    () => new PinduoduoProvider().search(intent, 10),
    (error: unknown) => error instanceof PinduoduoProviderError && error.code === "BLOCKED_BY_PROVIDER",
  );
});

test("Pinduoduo rejects malformed data and unsupported source URLs", async () => {
  const malformed: PinduoduoTransport = {
    async search() { return { sourceUrl: "https://yangkeduo.com/search", products: [{ sourceProductId: "x" }] }; },
    async getProduct() { return {}; },
  };
  const provider = new PinduoduoProvider(malformed);
  await assert.rejects(() => provider.search(intent, 10), (error: unknown) =>
    error instanceof PinduoduoProviderError && error.code === "PINDUODUO_MALFORMED_RESPONSE");
  await assert.rejects(() => provider.getProduct("http://127.0.0.1/private"), (error: unknown) =>
    error instanceof PinduoduoProviderError && error.code === "PINDUODUO_MALFORMED_RESPONSE");
});

test("Pinduoduo provider failures are returned as controlled, explicit errors", async () => {
  const cases: Array<[Error, string]> = [
    [new Error("401 Unauthorized"), "PINDUODUO_AUTH_REQUIRED"],
    [new Error("captcha required"), "PINDUODUO_CAPTCHA"],
    [new Error("429 rate limit"), "PINDUODUO_RATE_LIMITED"],
    [Object.assign(new Error("timeout"), { name: "AbortError" }), "PINDUODUO_TIMEOUT"],
    [new Error("markup changed"), "PINDUODUO_MARKUP_CHANGED"],
    [new Error("network down"), "PINDUODUO_NETWORK_ERROR"],
  ];
  for (const [failure, code] of cases) {
    const transport: PinduoduoTransport = {
      async search() { throw failure; },
      async getProduct() { throw failure; },
    };
    await assert.rejects(() => new PinduoduoProvider(transport).search(intent, 10), (error: unknown) =>
      error instanceof PinduoduoProviderError && error.code === code);
  }
});
