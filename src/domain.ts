import { z } from "zod";

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(300),
  minPriceCny: z.number().nonnegative().optional(),
  maxPriceCny: z.number().positive().optional(),
  limit: z.number().int().min(1).max(60).default(24),
}).refine(
  ({ minPriceCny, maxPriceCny }) => minPriceCny === undefined || maxPriceCny === undefined || minPriceCny <= maxPriceCny,
  { message: "Минимальная цена не может быть больше максимальной" },
);

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export interface SearchIntent {
  originalQuery: string;
  chineseQuery: string;
  category?: string;
  gender?: "male" | "female" | "unisex" | "kids";
  colors: string[];
  sizes: string[];
  materials: string[];
  keywords: string[];
  negativeKeywords: string[];
  minPriceCny?: number;
  maxPriceCny?: number;
  explanation: string;
  planner: "ai" | "heuristic";
}

export interface ProductCandidate {
  source: "1688";
  sourceProductId: string;
  sourceUrl: string;
  titleOriginal: string;
  titleRu?: string;
  imageUrl?: string;
  priceMinCny?: number;
  priceMaxCny?: number;
  sellerName?: string;
  soldText?: string;
  location?: string;
  relevanceScore: number;
  warnings: string[];
  status: "PENDING_REVIEW";
  collectedAt: string;
}

export interface SearchResult {
  id: string;
  intent: SearchIntent;
  products: ProductCandidate[];
  sourceUrl: string;
  createdAt: string;
  warnings: string[];
}

export interface ProductSourceAdapter {
  readonly source: "1688";
  search(intent: SearchIntent, limit: number): Promise<{ products: ProductCandidate[]; sourceUrl: string; warnings: string[] }>;
  getProduct(url: string): Promise<ProductCandidate>;
}
