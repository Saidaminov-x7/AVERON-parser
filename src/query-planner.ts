import { z } from "zod";
import type { SearchIntent, SearchRequest } from "./domain.js";
import { config } from "./config.js";

const AiIntentSchema = z.object({
  chineseQuery: z.string().min(1),
  category: z.string().optional(),
  gender: z.enum(["male", "female", "unisex", "kids"]).optional(),
  colors: z.array(z.string()).default([]),
  sizes: z.array(z.string()).default([]),
  materials: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  negativeKeywords: z.array(z.string()).default([]),
  explanation: z.string().default("Запрос подготовлен AI"),
});

const dictionary: Array<[RegExp, string]> = [
  [/мужск\w*/giu, "男"], [/женск\w*/giu, "女"], [/детск\w*/giu, "儿童"],
  [/худи|толстовк\w*/giu, "连帽卫衣"], [/футболк\w*/giu, "T恤"], [/рубашк\w*/giu, "衬衫"],
  [/джинс\w*/giu, "牛仔裤"], [/брюк\w*|штан\w*/giu, "裤子"], [/куртк\w*/giu, "夹克"],
  [/пальто/giu, "大衣"], [/плать\w*/giu, "连衣裙"], [/кроссовк\w*/giu, "运动鞋"],
  [/обув\w*|туфл\w*/giu, "鞋"], [/сумк\w*/giu, "包"], [/оптом|оптов\w*/giu, "批发"],
  [/черн\w*/giu, "黑色"], [/бел\w*/giu, "白色"], [/красн\w*/giu, "红色"],
  [/син\w*/giu, "蓝色"], [/зелен\w*/giu, "绿色"], [/хлоп\w*/giu, "纯棉"],
  [/кож\w*/giu, "皮革"], [/летн\w*/giu, "夏季"], [/зимн\w*/giu, "冬季"],
];

export class QueryPlanner {
  async plan(request: SearchRequest): Promise<SearchIntent> {
    if (config.aiBaseUrl) {
      try {
        return await this.planWithAi(request);
      } catch (error) {
        console.warn("AI planner unavailable, using heuristic planner:", error instanceof Error ? error.message : error);
      }
    }
    return this.planHeuristically(request);
  }

  planHeuristically(request: SearchRequest): SearchIntent {
    let translated = request.query.toLowerCase();
    const matched: string[] = [];
    for (const [pattern, chinese] of dictionary) {
      if (pattern.test(translated)) matched.push(chinese);
      pattern.lastIndex = 0;
      translated = translated.replace(pattern, ` ${chinese} `);
    }
    const sizes = request.query.match(/\b(?:xs|s|m|l|xl|xxl|\d{2,3})\b/giu)?.map((s) => s.toUpperCase()) ?? [];
    const chineseQuery = [...new Set(matched.length ? matched : [request.query]), "一件代发"].join(" ");
    return {
      originalQuery: request.query,
      chineseQuery,
      colors: [], sizes, materials: [], keywords: matched, negativeKeywords: [],
      minPriceCny: request.minPriceCny,
      maxPriceCny: request.maxPriceCny,
      explanation: matched.length ? "Ключевые слова переведены встроенным словарём" : "Запрос отправлен как есть; для лучшего перевода подключите AI",
      planner: "heuristic",
    };
  }

  private async planWithAi(request: SearchRequest): Promise<SearchIntent> {
    const response = await fetch(`${config.aiBaseUrl!.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.aiApiKey ?? "local"}` },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Ты закупщик AVERON. Преобразуй запрос на русском/узбекском в точный поисковый запрос для 1688 на китайском. Верни только JSON: chineseQuery, category, gender, colors, sizes, materials, keywords, negativeKeywords, explanation. Не выдумывай ограничения." },
          { role: "user", content: request.query },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI returned empty response");
    const parsed = AiIntentSchema.parse(JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")));
    return { originalQuery: request.query, ...parsed, minPriceCny: request.minPriceCny, maxPriceCny: request.maxPriceCny, planner: "ai" };
  }
}
