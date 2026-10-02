import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { config } from "./config.js";
import type { ProductCandidate, ProductSourceProvider, SearchIntent } from "./domain.js";
import { isSafeMarketplaceRequestUrl, isSupported1688ProductUrl } from "./security/external-url.js";
import { BrowserRequestLimiter } from "./browser-request-limiter.js";

const CARD_SELECTORS = [
  "[data-offer-id]", ".offer-list-row .offer-item", ".space-offer-card-box", ".search-offer-wrapper",
  "a[href*='detail.1688.com/offer/']",
];

function numberFrom(text?: string | null): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function productIdFrom(url: string, fallback: string): string {
  return url.match(/offer\/(\d+)\.html/)?.[1] ?? fallback;
}

export class Adapter1688 implements ProductSourceProvider<"1688"> {
  readonly source = "1688" as const;
  private context?: BrowserContext;
  private contextHeadless?: boolean;
  private readonly requestLimiter = new BrowserRequestLimiter(2);

  async openSession(): Promise<string> {
    const context = await this.getContext(false);
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto("https://www.1688.com/", { waitUntil: "domcontentloaded", timeout: config.searchTimeoutMs });
    await page.bringToFront();
    return page.url();
  }

  async getProduct(url: string): Promise<ProductCandidate<"1688">> {
    if (!isSupported1688ProductUrl(url)) throw new Error("UNSUPPORTED_SOURCE_URL");
    const parsed = new URL(url);
    const requestPage = await this.openRequestPage(config.headless);
    const { page } = requestPage;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.searchTimeoutMs });
      await page.waitForTimeout(2000);
      if (page.url().startsWith("chrome-error://")) throw new Error("1688_UNAVAILABLE");
      const pageText = (await page.locator("body").innerText().catch(() => "")).slice(0, 5000);
      if (/验证码|滑动验证|captcha|访问受限|登录后查看/i.test(pageText)) throw new Error("1688_REQUESTS_LOGIN");
      const meta = async (selector: string, attribute = "content") => page.locator(selector).first().getAttribute(attribute).catch(() => null);
      const title = await meta("meta[property='og:title']") ?? await meta("meta[name='description']") ?? await page.title();
      const image = await meta("meta[property='og:image']");
      const priceText = await meta("meta[property='product:price:amount']") ?? await this.firstText(page.locator("body"), ["[class*='price']", "[class*='Price']"]);
      const id = productIdFrom(page.url(), parsed.pathname.replace(/\D/g, "") || "unknown");
      return { source: "1688", sourceProductId: id, sourceUrl: page.url(), titleOriginal: title.trim(), imageUrl: image ?? undefined, priceMinCny: numberFrom(priceText), relevanceScore: 100, warnings: numberFrom(priceText) === undefined ? ["Проверьте цену вручную"] : [], status: "PENDING_REVIEW", collectedAt: new Date().toISOString() };
    } finally { await requestPage.close(); }
  }

  async search(intent: SearchIntent, limit: number) {
    const params = new URLSearchParams({ keywords: intent.chineseQuery });
    const sourceUrl = `https://s.1688.com/selloffer/offer_search.htm?${params.toString()}`;
    const warnings: string[] = [];
    const requestPage = await this.openRequestPage(config.headless);
    const { page } = requestPage;
    try {
      await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: config.searchTimeoutMs });
      await page.waitForTimeout(2500);
      if (page.url().startsWith("chrome-error://")) {
        throw new Error("1688_UNAVAILABLE");
      }
      const pageText = (await page.locator("body").innerText().catch(() => "")).slice(0, 5000);
      if (/验证码|滑动验证|captcha|访问受限|登录后查看/i.test(pageText)) {
        throw new Error("1688_REQUESTS_LOGIN");
      }
      await this.autoScroll(page);
      const products = await this.extractProducts(page, intent, limit);
      if (!products.length) warnings.push("1688 не вернул карточки. Возможно, нужна авторизация или обновились селекторы сайта.");
      return { products, sourceUrl: page.url(), warnings };
    } finally {
      await requestPage.close();
    }
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
  }

  private async getContext(headless: boolean): Promise<BrowserContext> {
    if (this.context && this.contextHeadless !== headless) {
      await this.context.close();
      this.context = undefined;
    }
    if (this.context) return this.context;
    this.context = await chromium.launchPersistentContext(config.browserProfileDir, {
      headless,
      channel: config.browserChannel || undefined,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    });
    await this.context.route("**/*", async (route) => {
      const allowed = await isSafeMarketplaceRequestUrl(route.request().url());
      if (allowed) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    this.contextHeadless = headless;
    return this.context;
  }

  private async openRequestPage(headless: boolean): Promise<{ page: Page; close: () => Promise<void> }> {
    const release = this.requestLimiter.acquire();
    if (!release) throw new Error("1688_BUSY");
    try {
      const page = await (await this.getContext(headless)).newPage();
      return {
        page,
        close: async () => {
          try {
            await page.close();
          } finally {
            release();
          }
        },
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  private async autoScroll(page: Page): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(350);
    }
  }

  private async extractProducts(page: Page, intent: SearchIntent, limit: number): Promise<ProductCandidate<"1688">[]> {
    let cards: Locator | undefined;
    for (const selector of CARD_SELECTORS) {
      const candidate = page.locator(selector);
      if (await candidate.count()) { cards = candidate; break; }
    }
    if (!cards) return [];
    const seen = new Set<string>();
    const products: ProductCandidate<"1688">[] = [];
    const count = Math.min(await cards.count(), limit * 3);
    for (let i = 0; i < count && products.length < limit; i += 1) {
      const card = cards.nth(i);
      const link = card.locator("a[href*='detail.1688.com/offer/']").first();
      const ownHref = await card.getAttribute("href").catch(() => null);
      const href = ownHref?.includes("detail.1688.com/offer/") ? ownHref : await link.getAttribute("href").catch(() => null);
      if (!href) continue;
      const url = href.startsWith("//") ? `https:${href}` : new URL(href, "https://www.1688.com").toString();
      if (!isSupported1688ProductUrl(url)) continue;
      const id = productIdFrom(url, `item-${i}`);
      if (seen.has(id)) continue;
      const title = await this.firstText(card, ["[title]", ".title", ".offer-title", "img"]);
      if (!title) continue;
      const priceText = await this.firstText(card, [".price", "[class*='price']", "[class*='Price']"]);
      const image = card.locator("img").first();
      const imageUrl = await image.getAttribute("src").catch(() => null) ?? await image.getAttribute("data-lazy-src").catch(() => null);
      const price = numberFrom(priceText);
      if (intent.minPriceCny !== undefined && price !== undefined && price < intent.minPriceCny) continue;
      if (intent.maxPriceCny !== undefined && price !== undefined && price > intent.maxPriceCny) continue;
      seen.add(id);
      products.push({
        source: "1688", sourceProductId: id, sourceUrl: url, titleOriginal: title,
        imageUrl: imageUrl?.startsWith("//") ? `https:${imageUrl}` : imageUrl ?? undefined,
        priceMinCny: price, relevanceScore: this.score(title, intent), warnings: price === undefined ? ["Цена не распознана"] : [],
        status: "PENDING_REVIEW", collectedAt: new Date().toISOString(),
      });
    }
    return products.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private async firstText(card: Locator, selectors: string[]): Promise<string> {
    for (const selector of selectors) {
      const node = card.locator(selector).first();
      const value = await node.getAttribute("title").catch(() => null) ?? await node.getAttribute("alt").catch(() => null) ?? await node.textContent().catch(() => null);
      if (value?.trim()) return value.trim();
    }
    return (await card.textContent().catch(() => ""))?.trim().slice(0, 240) ?? "";
  }

  private score(title: string, intent: SearchIntent): number {
    const haystack = title.toLowerCase();
    const terms = [intent.chineseQuery, ...intent.keywords].flatMap((term) => term.toLowerCase().split(/\s+/)).filter(Boolean);
    return Math.min(100, 40 + terms.reduce((sum, term) => sum + (haystack.includes(term) ? 12 : 0), 0));
  }
}
