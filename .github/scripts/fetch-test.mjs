// Fetch test (2026-10-05): do Mercari Japan, Mercari US and Depop answer a server that is NOT on Cloudflare?
// Their sites refuse Prowl's Cloudflare Worker. If they answer here, a small fetcher outside Cloudflare would work.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const term = process.argv[2] || "noritake";
const b64u = b => Buffer.from(b).toString("base64url");
let key;
async function dpop(method, url) {
  if (!key) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const j = await crypto.subtle.exportKey("jwk", kp.publicKey);
    key = { priv: kp.privateKey, jwk: { crv: j.crv, kty: j.kty, x: j.x, y: j.y } };
  }
  const h = b64u(JSON.stringify({ typ: "dpop+jwt", alg: "ES256", jwk: key.jwk }));
  const p = b64u(JSON.stringify({ iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID(), htu: url, htm: method, uuid: crypto.randomUUID() }));
  const s = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.priv, new TextEncoder().encode(h + "." + p));
  return h + "." + p + "." + b64u(new Uint8Array(s));
}
const html = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
async function run(name, url, opts, count) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts));
    const body = await r.text();
    const blocked = /Attention Required|Forbidden - Depop|cf-chl|captcha|Access denied/i.test(body.slice(0, 5000));
    let n = null; try { n = count ? count(body) : null; } catch (e) {}
    console.log(`${String(r.status).padEnd(4)} ${name.padEnd(16)} ${String(Date.now() - t0).padStart(5)}ms ${String(body.length).padStart(8)}B  items:${n === null ? "-" : n}  ${blocked ? "BLOCK PAGE" : ""}`);
    if (r.status !== 200 || blocked || !n) console.log("     head: " + body.slice(0, 200).replace(/\s+/g, " "));
    else if (name === "mercarijp-api") { const it = JSON.parse(body).items[0]; console.log("     first: " + it.name + " | ¥" + it.price + " | " + it.id); }
  } catch (e) { console.log(`ERR  ${name.padEnd(16)} ${e.message}`); }
}
const api = "https://api.mercari.jp/v2/entities:search";
const payload = { userId: "", pageSize: 30, pageToken: "", searchSessionId: crypto.randomUUID().replace(/-/g, ""), indexRouting: "INDEX_ROUTING_UNSPECIFIED", thumbnailTypes: [],
  searchCondition: { keyword: term, excludeKeyword: "", sort: "SORT_CREATED_TIME", order: "ORDER_DESC", status: ["STATUS_ON_SALE"], sizeId: [], categoryId: [], brandId: [], sellerId: [], priceMin: 0, priceMax: 0,
    itemConditionId: [], shippingPayerId: [], shippingFromArea: [], shippingMethod: [], colorId: [], hasCoupon: false, attributes: [], itemTypes: [], skuIds: [] },
  defaultDatasets: ["DATASET_TYPE_MERCARI", "DATASET_TYPE_BEYOND"], serviceFrom: "suruga", withItemBrand: true, withItemSize: false, withItemPromotions: false, withItemSizes: false, withShopname: false };
const ip = await fetch("https://api.ipify.org").then(r => r.text()).catch(() => "?");
console.log(`From ${ip} (GitHub Actions, outside Cloudflare). Term: ${term}\n`);
await run("mercarijp-api", api, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", "Accept": "application/json", "DPoP": await dpop("POST", api), "X-Platform": "web", "User-Agent": UA, "Origin": "https://jp.mercari.com", "Referer": "https://jp.mercari.com/" }, body: JSON.stringify(payload) }, b => JSON.parse(b).items.length);
await run("mercarijp-page", "https://jp.mercari.com/search?keyword=" + encodeURIComponent(term), { headers: html }, b => (b.match(/\/item\/m\d+/g) || []).length);
await run("mercari-us-page", "https://www.mercari.com/search/?keyword=" + encodeURIComponent(term), { headers: html }, b => (b.match(/\/us\/item\/m\d+/g) || []).length);
await run("depop-page", "https://www.depop.com/search/?q=" + encodeURIComponent(term), { headers: html }, b => (b.match(/"slug":"/g) || []).length);
await run("depop-us-page", "https://www.depop.com/us/search/?q=" + encodeURIComponent(term), { headers: html }, b => (b.match(/"slug":"/g) || []).length);
