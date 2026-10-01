import { z } from "zod";
import { config } from "./config.js";
import type { ProductCandidate } from "./domain.js";

export const ParserImportProductV1Schema = z.object({
  schemaVersion: z.literal(1),
  provider: z.enum(["SOURCE_1688", "PINDUODUO"]),
  sourceProductId: z.string().min(1).max(160),
  deduplicationKey: z.string().min(1).max(320),
  sourceUrl: z.string().url().max(2048).refine((value) => new URL(value).protocol === "https:"),
  sourceTitle: z.string().min(1).max(500),
  sourceDescription: z.string().max(8000).optional(),
  sourceImages: z.array(z.string().url().max(2048).refine((value) => new URL(value).protocol === "https:")).max(15),
  sourcePrice: z.object({ amount: z.number().nonnegative(), currency: z.literal("CNY") }).optional(),
  sourceCategory: z.string().max(200).optional(),
  country: z.enum(["CN", "US", "TR", "IT", "GB"]),
  sourceAttributes: z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(500)).max(30)])),
  variants: z.array(z.object({
    sourceVariantId: z.string().max(160).optional(),
    color: z.string().max(80).optional(),
    size: z.string().max(80).optional(),
    sourcePriceCny: z.number().nonnegative().optional(),
  })).max(100),
  sizes: z.array(z.string().max(80)).max(100),
  fetchedAt: z.string().datetime(),
  rawMetadata: z.record(z.string(), z.unknown()).optional(),
}).superRefine((value, context) => {
  if (value.deduplicationKey !== `${value.provider}:${value.sourceProductId}`) {
    context.addIssue({ code: "custom", path: ["deduplicationKey"], message: "Deduplication key does not match provider identity" });
  }
});

export type ParserImportProductV1 = z.infer<typeof ParserImportProductV1Schema>;
export type ParserImportResult = "CREATED" | "UPDATED_PENDING" | "ALREADY_EXISTS" | "UNCHANGED";

export function toParserImportProductV1(product: ProductCandidate): ParserImportProductV1 {
  const provider = product.source === "1688" ? "SOURCE_1688" : "PINDUODUO";
  return ParserImportProductV1Schema.parse({
    schemaVersion: 1,
    provider,
    sourceProductId: product.sourceProductId,
    deduplicationKey: `${provider}:${product.sourceProductId}`,
    sourceUrl: product.sourceUrl,
    sourceTitle: product.titleOriginal,
    sourceImages: product.imageUrl ? [product.imageUrl] : [],
    ...(product.priceMinCny !== undefined ? { sourcePrice: { amount: product.priceMinCny, currency: "CNY" as const } } : {}),
    country: "CN",
    sourceAttributes: {},
    variants: [],
    sizes: [],
    fetchedAt: product.collectedAt,
    rawMetadata: {
      ...(product.titleRu ? { titleRu: product.titleRu } : {}),
      ...(product.sellerName ? { sellerName: product.sellerName } : {}),
      ...(product.soldText ? { soldText: product.soldText } : {}),
      ...(product.location ? { location: product.location } : {}),
      relevanceScore: product.relevanceScore,
      warnings: product.warnings,
    },
  });
}

interface ParserImportClientConfig {
  backendApiUrl?: string;
  parserImportToken?: string;
  timeoutMs: number;
  fetcher?: typeof fetch;
}

export class ParserBackendImportClient {
  constructor(private readonly clientConfig: ParserImportClientConfig = {
    backendApiUrl: config.backendApiUrl,
    parserImportToken: config.parserImportToken,
    timeoutMs: config.backendImportTimeoutMs,
  }) {}

  async submit(product: ProductCandidate): Promise<{ result: ParserImportResult; itemId: string }> {
    const { backendApiUrl, parserImportToken } = this.clientConfig;
    if (!backendApiUrl || !parserImportToken) throw new Error("PARSER_IMPORT_NOT_CONFIGURED");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.clientConfig.timeoutMs);
    try {
      const response = await (this.clientConfig.fetcher ?? fetch)(
        new URL("/api/v1/parser/imports", backendApiUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${parserImportToken}`,
          },
          body: JSON.stringify(toParserImportProductV1(product)),
          signal: controller.signal,
        },
      );
      const body = await response.json().catch(() => null) as { code?: string; result?: ParserImportResult; item?: { id?: string } } | null;
      if (!response.ok) {
        const code = body?.code && /^[A-Z0-9_]{1,64}$/.test(body.code) ? body.code : "BACKEND_IMPORT_FAILED";
        throw new Error(code);
      }
      if (!body?.result || !body.item?.id) throw new Error("INVALID_BACKEND_IMPORT_RESPONSE");
      return { result: body.result, itemId: body.item.id };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("BACKEND_IMPORT_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
