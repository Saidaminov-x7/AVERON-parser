import assert from "node:assert/strict";
import test from "node:test";
import type { ProductCandidate } from "../src/domain.js";
import { ParserBackendImportClient, toParserImportProductV1 } from "../src/backend-import.js";

const candidate: ProductCandidate<"1688"> = {
  source: "1688",
  sourceProductId: "offer-123",
  sourceUrl: "https://detail.1688.com/offer/123.html",
  titleOriginal: "棉夹克",
  imageUrl: "https://img.example/jacket.jpg",
  priceMinCny: 42,
  sellerName: "seller",
  relevanceScore: 91,
  warnings: [],
  status: "PENDING_REVIEW",
  collectedAt: "2026-10-01T08:00:00.000Z",
};

test("maps 1688 source identity and country into the versioned backend DTO", () => {
  const dto = toParserImportProductV1(candidate);
  assert.equal(dto.schemaVersion, 1);
  assert.equal(dto.provider, "SOURCE_1688");
  assert.equal(dto.sourceProductId, "offer-123");
  assert.equal(dto.deduplicationKey, "SOURCE_1688:offer-123");
  assert.equal(dto.country, "CN");
  assert.deepEqual(dto.sourcePrice, { amount: 42, currency: "CNY" });
  assert.deepEqual(dto.sourceImages, ["https://img.example/jacket.jpg"]);
});

test("sends only the server-side bearer credential and returns the review queue result", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = new ParserBackendImportClient({
    backendApiUrl: "https://api.example",
    parserImportToken: "test-parser-token-that-is-long-enough-012345",
    timeoutMs: 1000,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ result: "CREATED", item: { id: "import-1" } }), { status: 201 });
    },
  });
  const result = await client.submit(candidate);
  assert.equal(requestUrl, "https://api.example/api/v1/parser/imports");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer test-parser-token-that-is-long-enough-012345");
  assert.equal(result.result, "CREATED");
  assert.equal(result.itemId, "import-1");
});

test("fails closed when backend endpoint or service token is not configured", async () => {
  const client = new ParserBackendImportClient({ backendApiUrl: "https://api.example", timeoutMs: 1000 });
  await assert.rejects(client.submit(candidate), { message: "PARSER_IMPORT_NOT_CONFIGURED" });
});

test("surfaces backend errors without returning server response bodies", async () => {
  const client = new ParserBackendImportClient({
    backendApiUrl: "https://api.example",
    parserImportToken: "test-parser-token-that-is-long-enough-012345",
    timeoutMs: 1000,
    fetcher: async () => new Response(JSON.stringify({ code: "FEATURE_DISABLED", message: "secret details" }), { status: 403 }),
  });
  await assert.rejects(client.submit(candidate), { message: "FEATURE_DISABLED" });
});

test("maps an aborted backend call to a bounded timeout error", async () => {
  const client = new ParserBackendImportClient({
    backendApiUrl: "https://api.example",
    parserImportToken: "test-parser-token-that-is-long-enough-012345",
    timeoutMs: 1,
    fetcher: (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });
  await assert.rejects(client.submit(candidate), { message: "BACKEND_IMPORT_TIMEOUT" });
});
