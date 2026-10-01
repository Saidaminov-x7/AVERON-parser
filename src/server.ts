import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { config } from "./config.js";
import { SearchRequestSchema } from "./domain.js";
import { Adapter1688 } from "./adapter-1688.js";
import { getSavedSearchResult, SearchService } from "./search-service.js";
import { ProductSourceAccessError, ProductSourceProviderRegistry } from "./product-source-provider.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const providerRegistry = new ProductSourceProviderRegistry(config.productSourceFeatureFlags, {
  "1688": () => new Adapter1688(),
});
let service: SearchService | undefined;

function getSearchService(): SearchService {
  service ??= new SearchService(providerRegistry.getProvider("1688"));
  return service;
}

function sourceAccessError(error: unknown, reply: import("fastify").FastifyReply) {
  if (!(error instanceof ProductSourceAccessError)) return undefined;
  const message = error.code === "SOURCE_DISABLED"
    ? `Парсер ${error.source} отключен. Включите соответствующий FEATURE_${error.source === "1688" ? "1688" : "PINDUODUO"}_PARSER для доступа.`
    : `Для источника ${error.source} пока нет доступного провайдера.`;
  return reply.code(503).send({ error: error.code, source: error.source, message });
}

const staticFiles: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};
for (const [route, asset] of Object.entries(staticFiles)) {
  app.get(route, async (_request, reply) => reply.type(asset.type).send(await readFile(path.join(config.publicDir, asset.file))));
}

app.get("/api/health", async () => ({
  status: "ok",
  source: "1688",
  aiConfigured: Boolean(config.aiBaseUrl),
  providers: providerRegistry.getAvailability(),
}));

app.post("/api/session/open", async (_request, reply) => {
  try {
    const provider = providerRegistry.getProvider("1688");
    if (!provider.openSession) throw new ProductSourceAccessError("1688", "SOURCE_UNAVAILABLE");
    return { url: await provider.openSession(), message: "Войдите в 1688 в открывшемся окне, затем повторите поиск." };
  } catch (error) {
    const accessError = sourceAccessError(error, reply);
    if (accessError) return accessError;
    return reply.code(502).send({ error: "BROWSER_SESSION_FAILED", message: error instanceof Error ? error.message : "Не удалось открыть браузер" });
  }
});

app.post("/api/search", async (request, reply) => {
  try { return await getSearchService().search(SearchRequestSchema.parse(request.body)); }
  catch (error) {
    const accessError = sourceAccessError(error, reply);
    if (accessError) return accessError;
    if (error instanceof ZodError) return reply.code(400).send({ error: "INVALID_REQUEST", message: error.issues[0]?.message, issues: error.issues });
    if (error instanceof Error && error.message === "1688_REQUESTS_LOGIN") return reply.code(409).send({ error: "AUTH_REQUIRED", message: "1688 запросил вход или проверку. Запустите сервис с HEADLESS=false, нажмите «Открыть 1688» и войдите один раз." });
    if (error instanceof Error && error.message === "1688_UNAVAILABLE") return reply.code(502).send({ error: "SOURCE_UNAVAILABLE", message: "1688 не открылся из текущей сети. Проверьте доступ к сайту в обычном Chrome, затем повторите поиск." });
    request.log.error(error);
    return reply.code(502).send({ error: "SEARCH_FAILED", message: error instanceof Error ? error.message : "Поиск не выполнен" });
  }
});

app.post("/api/product", async (request, reply) => {
  try {
    const body = request.body as { url?: string };
    if (!body?.url) return reply.code(400).send({ error: "INVALID_REQUEST", message: "Укажите URL товара 1688" });
    return await getSearchService().importUrl(body.url);
  } catch (error) {
    const accessError = sourceAccessError(error, reply);
    if (accessError) return accessError;
    if (error instanceof Error && error.message === "UNSUPPORTED_SOURCE_URL") return reply.code(400).send({ error: "UNSUPPORTED_SOURCE", message: "Сейчас поддерживаются ссылки 1688.com" });
    if (error instanceof Error && error.message === "1688_REQUESTS_LOGIN") return reply.code(409).send({ error: "AUTH_REQUIRED", message: "1688 запросил вход. Установите HEADLESS=false, откройте сессию и войдите вручную." });
    if (error instanceof Error && error.message === "1688_UNAVAILABLE") return reply.code(502).send({ error: "SOURCE_UNAVAILABLE", message: "1688 недоступен из текущей сети." });
    return reply.code(502).send({ error: "IMPORT_FAILED", message: error instanceof Error ? error.message : "Карточка не импортирована" });
  }
});

app.get<{ Params: { id: string } }>("/api/search/:id", async (request, reply) => {
  const result = await getSavedSearchResult(request.params.id);
  return result ?? reply.code(404).send({ error: "NOT_FOUND", message: "Результат поиска не найден" });
});

app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")
  ? reply.code(404).send({ error: "NOT_FOUND" })
  : reply.code(404).type("text/plain; charset=utf-8").send("Страница не найдена"));

const shutdown = async () => { await providerRegistry.close(); await app.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
