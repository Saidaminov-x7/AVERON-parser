import test from "node:test";
import assert from "node:assert/strict";
import { BrowserRequestLimiter } from "../src/browser-request-limiter.js";

test("limits concurrent browser requests and releases capacity once", () => {
  const limiter = new BrowserRequestLimiter(2);
  const releaseFirst = limiter.acquire();
  const releaseSecond = limiter.acquire();

  assert.equal(typeof releaseFirst, "function");
  assert.equal(typeof releaseSecond, "function");
  assert.equal(limiter.acquire(), null);

  releaseFirst?.();
  releaseFirst?.();
  const releaseThird = limiter.acquire();
  assert.equal(typeof releaseThird, "function");
  releaseThird?.();
  releaseSecond?.();
});

test("rejects an invalid browser request limit", () => {
  assert.throws(() => new BrowserRequestLimiter(0), RangeError);
});
