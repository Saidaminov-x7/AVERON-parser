const form = document.querySelector("#search-form");
const statusBox = document.querySelector("#status");
const intentBox = document.querySelector("#intent");
const results = document.querySelector("#results");
const submit = form.querySelector("button[type=submit]");

const showStatus = (message, error = false) => {
  statusBox.textContent = message;
  statusBox.className = `status${error ? " error" : ""}`;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault(); submit.disabled = true; results.innerHTML = ""; intentBox.className = "intent hidden";
  showStatus("Ищу предложения на 1688. Обычно это занимает 10–30 секунд…");
  const number = (id) => document.querySelector(id).value ? Number(document.querySelector(id).value) : undefined;
  try {
    const value = document.querySelector("#query").value.trim();
    const isUrl = /^https?:\/\//i.test(value);
    const response = await fetch(isUrl ? "/api/product" : "/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(isUrl ? { url: value } : { query: value, minPriceCny: number("#min-price"), maxPriceCny: number("#max-price"), limit: 24 }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "Поиск не выполнен");
    statusBox.className = "status hidden";
    intentBox.className = "intent";
    intentBox.innerHTML = data.intent.chineseQuery ? `<strong>Запрос для 1688:</strong> ${escapeHtml(data.intent.chineseQuery)} · <span>${data.intent.planner === "ai" ? "AI" : "встроенный словарь"}</span><br><small>${escapeHtml(data.intent.explanation)}</small>` : `<strong>Карточка 1688 передана в очередь проверки</strong> · ${escapeHtml(data.backendImport?.result || "")}`;
    if (!data.products.length) showStatus(data.warnings?.[0] || "Товары не найдены. Попробуйте другой запрос.");
    results.innerHTML = data.products.map(card).join("");
  } catch (error) { showStatus(error.message, true); }
  finally { submit.disabled = false; }
});

document.querySelector("#open-session").addEventListener("click", async () => {
  showStatus("Открываю 1688…");
  try { const response = await fetch("/api/session/open", { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.message); showStatus(data.message); }
  catch (error) { showStatus(error.message, true); }
});

function card(product) {
  const imageUrl = safeHttpUrl(product.imageUrl);
  const sourceUrl = safeHttpUrl(product.sourceUrl);
  const price = typeof product.priceMinCny === "number" && Number.isFinite(product.priceMinCny)
    ? `¥ ${product.priceMinCny}`
    : "Цена не указана";
  const relevanceScore = typeof product.relevanceScore === "number" && Number.isFinite(product.relevanceScore)
    ? product.relevanceScore
    : "—";
  const image = imageUrl
    ? `<img loading="lazy" src="${imageUrl}" alt="" referrerpolicy="no-referrer">`
    : "";
  const link = sourceUrl
    ? `<a href="${sourceUrl}" target="_blank" rel="noreferrer">Открыть товар</a>`
    : "<span>Ссылка недоступна</span>";
  return `<article class="card"><div class="image">${image}</div><div class="card-body"><h3>${escapeHtml(product.titleOriginal)}</h3><div class="price">${price}</div><div class="meta"><span>1688</span><span>Совпадение ${relevanceScore}%</span></div>${link}</div></article>`;
}
function escapeHtml(value) { const node = document.createElement("div"); node.textContent = value ?? ""; return node.innerHTML; }
function safeHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, window.location.origin);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
      ? escapeHtml(url.href).replaceAll('"', "&quot;")
      : "";
  } catch {
    return "";
  }
}
