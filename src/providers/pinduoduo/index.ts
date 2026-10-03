import { z } from "zod";
import type { ProductCandidate, ProductSourceProvider, SearchIntent } from "../../domain.js";

const sourceUrlSchema = z.string().url().max(2048).refine((value) => {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:"
    && (host === "pinduoduo.com" || host.endsWith(".pinduoduo.com")
      || host === "yangkeduo.com" || host.endsWith(".yangkeduo.com"));
}, "Unsupported Pinduoduo source URL");

const imageUrlSchema = z.string().url().max(2048).refine((value) => new URL(value).protocol === "https:");

export const PinduoduoSourceProductSchema = z.object({
  sourceProductId: z.string().trim().min(1).max(160),
  sourceUrl: sourceUrlSchema,
  title: z.string().trim().min(1).max(500),
  description: z.string().max(8000).optional(),
  images: z.array(imageUrlSchema).max(15).default([]),
  variants: z.array(z.object({
    sourceVariantId: z.string().max(160).optional(),
    color: z.string().max(80).optional(),
    size: z.string().max(80).optional(),
    sourcePriceCny: z.number().finite().nonnegative().optional(),
  }).strict()).max(100).default([]),
  sizes: z.array(z.string().max(80)).max(100).default([]),
  colors: z.array(z.string().max(80)).max(100).default([]),
  sourcePrice: z.object({
    amount: z.number().finite().nonnegative(),
    currency: z.literal("CNY"),
  }).strict().optional(),
  attributes: z.record(z.string().max(100), z.union([
    z.string().max(500),
    z.array(z.string().max(500)).max(30),
  ])).default({}),
  categoryHint: z.string().max(200).optional(),
  shippingMetadata: z.record(z.string().max(100), z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  if (value.shippingMetadata && Buffer.byteLength(JSON.stringify(value.shippingMetadata), "utf8") > 4 * 1024) {
    context.addIssue({ code: "custom", path: ["shippingMetadata"], message: "Shipping metadata exceeds the 4 KB limit" });
  }
});

const searchResponseSchema = z.object({
  sourceUrl: sourceUrlSchema,
  products: z.array(PinduoduoSourceProductSchema).max(60),
}).strict();

export interface PinduoduoTransport {
  search(query: string, limit: number): Promise<unknown>;
  getProduct(url: string): Promise<unknown>;
}

export class PinduoduoProviderError extends Error {
  constructor(readonly code:
    | "BLOCKED_BY_PROVIDER"
    | "PINDUODUO_AUTH_REQUIRED"
    | "PINDUODUO_CAPTCHA"
    | "PINDUODUO_RATE_LIMITED"
    | "PINDUODUO_TIMEOUT"
    | "PINDUODUO_NETWORK_ERROR"
    | "PINDUODUO_MARKUP_CHANGED"
    | "PINDUODUO_MALFORMED_RESPONSE") {
    super(code);
    this.name = "PinduoduoProviderError";
  }
}

function classifyProviderError(error: unknown): PinduoduoProviderError {
  if (error instanceof PinduoduoProviderError) return error;
  if (error instanceof Error && error.name === "AbortError") return new PinduoduoProviderError("PINDUODUO_TIMEOUT");
  if (error instanceof Error && /captcha|验证码/i.test(error.message)) return new PinduoduoProviderError("PINDUODUO_CAPTCHA");
  if (error instanceof Error && /401|unauthori[sz]ed/i.test(error.message)) return new PinduoduoProviderError("PINDUODUO_AUTH_REQUIRED");
  if (error instanceof Error && /429|rate.?limit/i.test(error.message)) return new PinduoduoProviderError("PINDUODUO_RATE_LIMITED");
  if (error instanceof Error && /markup|selector|layout changed/i.test(error.message)) return new PinduoduoProviderError("PINDUODUO_MARKUP_CHANGED");
  return new PinduoduoProviderError("PINDUODUO_NETWORK_ERROR");
}

function candidate(product: z.infer<typeof PinduoduoSourceProductSchema>): ProductCandidate<"pinduoduo"> {
  return {
    source: "pinduoduo",
    sourceProductId: product.sourceProductId,
    sourceUrl: product.sourceUrl,
    titleOriginal: product.title,
    ...(product.description !== undefined ? { sourceDescription: product.description } : {}),
    ...(product.images[0] ? { imageUrl: product.images[0] } : {}),
    ...(product.images.length ? { imageUrls: product.images } : {}),
    ...(product.sourcePrice ? { priceMinCny: product.sourcePrice.amount, priceMaxCny: product.sourcePrice.amount } : {}),
    ...(Object.keys(product.attributes).length ? { sourceAttributes: product.attributes } : {}),
    ...(product.variants.length ? { variants: product.variants } : {}),
    ...(product.sizes.length ? { sizes: product.sizes } : {}),
    ...(product.colors.length ? { colors: product.colors } : {}),
    ...(product.categoryHint ? { categoryHint: product.categoryHint } : {}),
    ...(product.shippingMetadata ? { shippingMetadata: product.shippingMetadata } : {}),
    relevanceScore: 0,
    warnings: [],
    status: "PENDING_REVIEW",
    collectedAt: new Date().toISOString(),
  };
}

export class PinduoduoProvider implements ProductSourceProvider<"pinduoduo"> {
  readonly source = "pinduoduo" as const;

  constructor(private readonly transport?: PinduoduoTransport) {}

  async search(intent: SearchIntent, limit: number) {
    const transport = this.requireTransport();
    try {
      const parsed = searchResponseSchema.safeParse(await transport.search(intent.chineseQuery, Math.min(60, Math.max(1, limit))));
      if (!parsed.success) throw new PinduoduoProviderError("PINDUODUO_MALFORMED_RESPONSE");
      return {
        products: parsed.data.products.slice(0, limit).map(candidate),
        sourceUrl: parsed.data.sourceUrl,
        warnings: [],
      };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }

  async getProduct(url: string): Promise<ProductCandidate<"pinduoduo">> {
    const transport = this.requireTransport();
    const validatedUrl = sourceUrlSchema.safeParse(url);
    if (!validatedUrl.success) throw new PinduoduoProviderError("PINDUODUO_MALFORMED_RESPONSE");
    try {
      const parsed = PinduoduoSourceProductSchema.safeParse(await transport.getProduct(validatedUrl.data));
      if (!parsed.success) throw new PinduoduoProviderError("PINDUODUO_MALFORMED_RESPONSE");
      return candidate(parsed.data);
    } catch (error) {
      throw classifyProviderError(error);
    }
  }

  private requireTransport(): PinduoduoTransport {
    if (!this.transport) throw new PinduoduoProviderError("BLOCKED_BY_PROVIDER");
    return this.transport;
  }
}
