import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { ProductSourceAdapter, SearchRequest, SearchResult } from "./domain.js";
import { QueryPlanner } from "./query-planner.js";

export class SearchService {
  constructor(private readonly adapter: ProductSourceAdapter, private readonly planner = new QueryPlanner()) {}

  async search(request: SearchRequest): Promise<SearchResult> {
    const intent = await this.planner.plan(request);
    const found = await this.adapter.search(intent, Math.min(request.limit, config.maxResults));
    const result: SearchResult = {
      id: randomUUID(), intent, products: found.products, sourceUrl: found.sourceUrl,
      createdAt: new Date().toISOString(), warnings: found.warnings,
    };
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(path.join(config.dataDir, `${result.id}.json`), JSON.stringify(result, null, 2), "utf8");
    return result;
  }

  async get(id: string): Promise<SearchResult | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    try { return JSON.parse(await readFile(path.join(config.dataDir, `${id}.json`), "utf8")) as SearchResult; }
    catch { return null; }
  }

  async importUrl(url: string): Promise<SearchResult> {
    const product = await this.adapter.getProduct(url);
    const result: SearchResult = { id: randomUUID(), intent: { originalQuery: url, chineseQuery: "", colors: [], sizes: [], materials: [], keywords: [], negativeKeywords: [], explanation: "Импорт конкретной карточки 1688", planner: "heuristic" }, products: [product], sourceUrl: product.sourceUrl, createdAt: new Date().toISOString(), warnings: product.warnings };
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(path.join(config.dataDir, `${result.id}.json`), JSON.stringify(result, null, 2), "utf8");
    return result;
  }
}
