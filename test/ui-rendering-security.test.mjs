import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function createBrowserContext() {
  const nodes = new Map();
  const createNode = () => ({
    value: "",
    className: "",
    disabled: false,
    addEventListener() {},
    querySelector() { return createNode(); },
  });
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, createNode());
      return nodes.get(selector);
    },
    createElement() {
      let text = "";
      return {
        set textContent(value) { text = String(value ?? ""); },
        get innerHTML() {
          return text.replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[character]);
        },
      };
    },
  };
  return { document, window: { location: { origin: "https://parser.example.test" } }, URL };
}

function renderCard(product) {
  const context = createBrowserContext();
  runInNewContext(appSource, context);
  return context.card(product);
}

test("product card treats parser output as untrusted HTML and URL data", () => {
  const html = renderCard({
    titleOriginal: '<img src=x onerror="alert(1)">',
    imageUrl: "data:text/html,<script>alert(1)</script>",
    sourceUrl: "javascript:alert(1)",
    priceMinCny: '<svg onload="alert(1)">',
    relevanceScore: '<svg onload="alert(1)">',
  });

  assert.match(html, /<h3>&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;<\/h3>/);
  assert.match(html, /class="price">[^<]*<\/div>/);
  assert.match(html, /<span>[^<]*<\/span>/);
  assert.doesNotMatch(html, /href=/);
  assert.doesNotMatch(html, /<(?:img|svg)\b|javascript:|data:text\/html/i);
});

test("product card preserves valid HTTPS product and image URLs", () => {
  const html = renderCard({
    titleOriginal: "Cotton jacket",
    imageUrl: "https://images.example.test/jacket.jpg?size=medium&lang=en",
    sourceUrl: "https://detail.1688.com/offer/123.html",
    priceMinCny: 42,
    relevanceScore: 91,
  });

  assert.match(html, /src="https:\/\/images\.example\.test\/jacket\.jpg\?size=medium&amp;lang=en"/);
  assert.match(html, /href="https:\/\/detail\.1688\.com\/offer\/123\.html"/);
  assert.match(html, /class="price">[^<]*42<\/div>/);
  assert.match(html, /<span>[^<]*91%<\/span>/);
});
