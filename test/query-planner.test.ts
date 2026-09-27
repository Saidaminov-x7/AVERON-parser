import test from "node:test";
import assert from "node:assert/strict";
import { QueryPlanner } from "../src/query-planner.js";

test("heuristic planner translates common product terms", () => {
  const intent = new QueryPlanner().planHeuristically({ query: "мужская черная хлопковая худи XL", limit: 24 });
  assert.match(intent.chineseQuery, /男/);
  assert.match(intent.chineseQuery, /黑色/);
  assert.match(intent.chineseQuery, /纯棉/);
  assert.match(intent.chineseQuery, /连帽卫衣/);
  assert.deepEqual(intent.sizes, ["XL"]);
  assert.equal(intent.planner, "heuristic");
});

test("heuristic planner preserves price limits", () => {
  const intent = new QueryPlanner().planHeuristically({ query: "женская сумка", minPriceCny: 12, maxPriceCny: 50, limit: 10 });
  assert.equal(intent.minPriceCny, 12);
  assert.equal(intent.maxPriceCny, 50);
});
