import type { ProductSource, ProductSourceProvider } from "./domain.js";
import type { ProductSourceFeatureFlags } from "./feature-flags.js";

export type ProductSourceAvailability = {
  source: ProductSource;
  enabled: boolean;
  available: boolean;
  state: "enabled" | "disabled" | "unavailable";
};

export class ProductSourceAccessError extends Error {
  constructor(
    readonly source: ProductSource,
    readonly code: "SOURCE_DISABLED" | "SOURCE_UNAVAILABLE",
  ) {
    super(`${source} product source is ${code === "SOURCE_DISABLED" ? "disabled" : "unavailable"}`);
    this.name = "ProductSourceAccessError";
  }
}

type ProviderFactory = () => ProductSourceProvider;

const sources: ProductSource[] = ["1688", "pinduoduo"];

export class ProductSourceProviderRegistry {
  private readonly providers = new Map<ProductSource, ProductSourceProvider>();

  constructor(
    private readonly featureFlags: ProductSourceFeatureFlags,
    private readonly factories: Partial<Record<ProductSource, ProviderFactory>>,
  ) {}

  getAvailability(): ProductSourceAvailability[] {
    return sources.map((source) => {
      const enabled = this.featureFlags[`FEATURE_${source === "1688" ? "1688" : "PINDUODUO"}_PARSER`];
      const available = this.factories[source] !== undefined;
      return {
        source,
        enabled,
        available,
        state: !enabled ? "disabled" : available ? "enabled" : "unavailable",
      };
    });
  }

  getProvider(source: ProductSource): ProductSourceProvider {
    const enabled = this.featureFlags[`FEATURE_${source === "1688" ? "1688" : "PINDUODUO"}_PARSER`];
    if (!enabled) throw new ProductSourceAccessError(source, "SOURCE_DISABLED");

    const factory = this.factories[source];
    if (!factory) throw new ProductSourceAccessError(source, "SOURCE_UNAVAILABLE");

    const cached = this.providers.get(source);
    if (cached) return cached;

    const provider = factory();
    if (provider.source !== source) {
      throw new Error(`Product source provider registered for ${source} declares ${provider.source}`);
    }
    this.providers.set(source, provider);
    return provider;
  }

  async close(): Promise<void> {
    await Promise.all([...this.providers.values()].map((provider) => provider.close?.()));
    this.providers.clear();
  }
}
