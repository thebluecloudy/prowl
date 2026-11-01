/* v214: a Shopify find opens the listing popup (Matt: "when i open a shopify shop, is it possible to do the pop up like
   the others? it currently goes directly to the shop."). GET /item?shop=<gid>&url=<card link> calls the Global Catalog's
   get_product (shopcat.js shopItem) with the same token / keyless handling and caps as the search, never caches
   (Shopify: no caching of catalog results), and turns the product into the popup's item, the card's store's offer first.
   The fixture's shape is what get_product answered live (keyless, our profile, 2026-11-01), trimmed and renamed.
   Run: node --test worker/__tests__/shop-product-v214.test.mjs */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as SC from "../shopcat.js";
import { paidKey } from "../spend.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const SHOPCAT = readFileSync(new URL("../shopcat.js", import.meta.url), "utf8");
const KEY = { SHOPIFY_CATALOG_CLIENT_ID: "0123456789abcdef0123456789abcdef", SHOPIFY_CATALOG_CLIENT_SECRET: "shpss_5ecretValueThatMustNeverLeak_42" };
const ORIGIN = "https://www.owlandtwigvintage.com";
const GID = "gid://shopify/p/3RDkVlpRCyfhbF73HTnfuu";
const CARD = "https://tarltonplace.com/products/pyrex-8210?variant=49541240258788&_gsid=7EZTiPA8cTkp&utm_source=shopify&utm_medium=catalog";
const json = (body, status, origin, extra) => ({ status: status || 200, body, headers: Object.assign({}, extra || {}) });
function res(status, body, headers = {}) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) };
}
const media = (n, host) => Array.from({ length: n }, (_, i) => ({ type: "image", url: "https://" + (host || "cdn.shopify.com") + "/s/files/1/0258/p" + i + ".jpg", alt_text: "x", width: 3264, height: 2448 }));
function variant(o = {}) {
  return { id: "gid://shopify/ProductVariant/" + (o.vid || "49541240258788"), title: "Pyrex", url: o.url || "https://tarltonplace.com/products/pyrex-8210?variant=49541240258788&_gsid=OTHER&utm_source=shopify",
    price: o.price || { amount: 2499, currency: "USD" }, list_price: o.list, availability: { available: o.available !== false }, media: o.media || [],
    seller: o.seller || { id: "gid://shopify/Shop/25833996362", name: "Tarlton Place", url: "https://tarltonplace.com", domain: "tarlton-place.myshopify.com" },
    checkout_url: "https://tarltonplace.com/cart/49541240258788:1", condition: o.condition || ["secondhand"], source: o.source || "shopify", options: o.options };
}
function product(o = {}) {
  return { id: GID, title: "PYREX Pro Deluxe 8210 Storage Dish & Blue Vent Cover",
    description: o.description || { plain: "<div><p><strong>Gently Used, Clean!</strong></p><script>alert(1)</script><ul><li>Dishwasher safe</li></ul></div>" },
    handle: "pyrex-8210", media: o.media || media(8), metadata: { tech_specs: ["Capacity: 2 cups"] },
    variants: o.variants || [variant()], price_range: { min: { amount: 2499, currency: "USD" }, max: { amount: 2499, currency: "USD" } },
    options: o.options, selected: [] };
}
const ok = (p) => res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { ucp: { version: "2026-08-25", status: "success" }, product: p } } });
const notFound = () => res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { ucp: { version: "2026-08-25", status: "error" },
  messages: [{ type: "error", code: "not_found", content: "Product not found: " + GID, severity: "unrecoverable" }] } } });
function fake(catalog, token) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: (() => { try { return JSON.parse(init.body); } catch (e) { return init.body; } })() });
    if (String(url) === SC.SHOPCAT_TOKEN_URL) { if (!token) throw new Error("no token exchange expected"); return token(init); }
    if (String(url) === SC.SHOPCAT_MCP_URL) return catalog(init, calls.filter((c) => c.url === SC.SHOPCAT_MCP_URL).length);
    throw new Error("unexpected fetch " + url);
  };
  return { f, calls, mcp: () => calls.filter((c) => c.url === SC.SHOPCAT_MCP_URL), tokens: () => calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL) };
}
/* itemDesc stand-in: index.js's own strips seller HTML; here it marks what it was given */
const D = (f, counts, cap) => ({ vCount: async (n) => { if (counts) counts[n] = (counts[n] || 0) + 1; return !(cap && cap(n)); }, ipKey: (x) => String(x || "anon"), json,
  sgwExact: (items) => items, itemDesc: (h) => "{" + h.replace(/<script>[\s\S]*?<\/script>/g, "") + "}", fetch: f });
function ask(f, env, q, d) {
  const url = new URL("https://prowl.example.workers.dev/item?" + (q != null ? q : "shop=" + encodeURIComponent(GID) + "&url=" + encodeURIComponent(CARD)));
  return SC.shopItem(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), env || { SHOPIFY_CATALOG_ID: "none" }, url, ORIGIN, d || D(f));
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

beforeEach(() => SC.shopcatReset());

test("search cards carry the product's catalog id (pid), only a well-formed gid", () => {
  const p = { id: GID, title: "Pyrex", media: media(1), variants: [variant()] };
  assert.equal(SC.shopcatItem(p, {}).pid, GID);
  assert.equal(SC.shopcatItem(Object.assign({}, p, { id: "gid://shopify/ProductVariant/123" }), {}).pid, "gid://shopify/ProductVariant/123");
  assert.equal(SC.shopcatItem(Object.assign({}, p, { id: "p1" }), {}).pid, undefined);
  assert.equal(SC.shopcatItem(Object.assign({}, p, { id: "javascript:alert(1)//gid://shopify/p/abcdefgh" }), {}).pid, undefined);
});

test("get_product: the request (keyless, our profile, the id), counted like a search, no-store; the popup's item", async () => {
  const counts = {};
  const s = fake(() => ok(product({ media: media(15).concat(media(2)), options: [
    { name: "Color", values: [{ label: "Clear", available: true, exists: true }, { label: "Blue", available: true, exists: true }, { label: "Green", available: false, exists: true }, { label: "Pink", available: false, exists: false }] },
    { name: "Title", values: [{ label: "Default Title", available: true, exists: true }] }],
    variants: [variant({ list: { amount: 3999, currency: "USD" }, options: [{ name: "Color", label: "Blue" }] })] })));
  const r = await ask(s.f, null, null, D(s.f, counts));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.headers["Cache-Control"], "no-store", "Shopify: no caching of catalog results");
  const q = s.mcp()[0];
  assert.equal(s.mcp().length, 1);
  assert.equal(q.init.method, "POST");
  assert.equal(q.init.headers.Authorization, undefined, "keyless without the secrets");
  assert.equal(q.init.headers["User-Agent"], SC.SHOPCAT_UA);
  assert.deepEqual(q.body, { jsonrpc: "2.0", method: "tools/call", id: 1, params: { name: "get_product", arguments: {
    meta: { "ucp-agent": { profile: "https://prowl.example.workers.dev/ucp/profile.json" } },
    catalog: { id: GID, context: { address_country: "US", language: "en", currency: "USD" } } } } }, "nothing about the visitor is sent");
  assert.ok(counts["shopcat:203.0.113.9"] && counts["shopcat:all"], "the per-IP and the site's daily caps, as a search");
  assert.equal(paidKey(SC.SHOPCAT_MCP_URL), "shopcat", "counted in spend.js as a Shopify catalog call");
  const b = r.body;
  assert.equal(b.src, "shopify"); assert.equal(b.id, GID); assert.equal(b.mode, "keyless");
  assert.equal(b.title, "PYREX Pro Deluxe 8210 Storage Dish & Blue Vent Cover");
  assert.equal(b.price, "$24.99"); assert.equal(b.was, "$39.99");
  assert.equal(b.condition, "Used");
  assert.equal(b.images.length, 12, "at most 12 photos");
  assert.equal(new Set(b.images).size, 12, "no repeats");
  assert.ok(b.images.every((u) => /^https:\/\/cdn\.shopify\.com\//.test(u)), "straight from their host, never proxied");
  assert.equal(b.description, "{<div><p><strong>Gently Used, Clean!</strong></p><ul><li>Dishwasher safe</li></ul></div>}", "the seller's HTML in \"plain\" goes through itemDesc");
  assert.deepEqual(b.aspects, [{ n: "Color", v: "Clear, Blue (Green sold out)" }, { n: "This one", v: "Color Blue" }, { n: "Shop", v: "Tarlton Place" }, { n: "Website", v: "tarltonplace.com" }],
    "options with what is sold out (no Default Title, no value that does not exist), the shop and its domain");
  assert.equal(b.shop, "Tarlton Place"); assert.equal(b.domain, "tarltonplace.com");
  assert.equal(b.url, undefined, "the page keeps the card's own link");
  assert.equal(b.gone, undefined);
});

test("a cluster: the card's store's offer, matched by host and path; plain text escaped; off-Shopify names the host", async () => {
  const other = variant({ vid: "7", url: "https://othershop.example/products/pyrex?_gsid=1", price: { amount: 1500, currency: "USD" }, condition: ["new"],
    seller: { name: "Other Shop", url: "https://othershop.example", domain: "othershop.myshopify.com" } });
  const etsy = variant({ vid: "8", url: "https://www.etsy.com/listing/1234567890/pyrex", price: { amount: 3000, currency: "USD" }, source: "external",
    seller: { name: "Unchecked Seller Name", url: "https://scam.example", domain: "scam.example" } });
  const P = product({ variants: [other, variant(), etsy], description: { plain: "Line one\nA < B & C" } });
  let r = await ask(fake(() => ok(P)).f);
  assert.equal(r.body.price, "$24.99"); assert.equal(r.body.shop, "Tarlton Place"); assert.equal(r.body.condition, "Used");
  assert.equal(r.body.description, "{Line one<br>A &lt; B &amp; C}");
  r = await ask(fake(() => ok(P)).f, null, "shop=" + encodeURIComponent(GID) + "&url=" + encodeURIComponent("https://www.etsy.com/listing/1234567890/pyrex"));
  assert.equal(r.body.offShopify, true); assert.equal(r.body.shop, "etsy.com"); assert.equal(r.body.domain, "etsy.com", "never the catalog's unchecked seller");
  /* the card's store has left the cluster: Shopify's lowest price, no store named */
  r = await ask(fake(() => ok(product({ variants: [other] }))).f);
  assert.equal(r.body.price, "$24.99"); assert.equal(r.body.shop, ""); assert.equal(r.body.gone, undefined);
  /* Owl & Twig's own offer is never the one shown */
  r = await ask(fake(() => ok(product({ variants: [variant({ url: "https://owlandtwigvintage.com/products/pyrex", seller: { name: "Owl & Twig", url: "https://owlandtwigvintage.com", domain: "owlandtwigvintage.com" } })] }))).f,
    null, "shop=" + encodeURIComponent(GID) + "&url=" + encodeURIComponent("https://owlandtwigvintage.com/products/pyrex"));
  assert.equal(r.body.gone, true);
});

test("sold or gone: not_found and an unavailable offer answer gone (200), so the popup offers Watch for the next one", async () => {
  let r = await ask(fake(notFound).f);
  assert.equal(r.status, 200); assert.equal(r.body.gone, true); assert.equal(r.headers["Cache-Control"], "no-store");
  r = await ask(fake(() => ok(product({ variants: [variant({ available: false })] }))).f);
  assert.equal(r.body.gone, true); assert.equal(r.body.price, "$24.99");
  r = await ask(fake(() => ok(product({ variants: [] }))).f);
  assert.equal(r.body.gone, true, "no offer left from anyone");
});

test("auth: with the key a Bearer token; a token the catalog refuses falls back to keyless in the same request", async () => {
  const tok = () => res(200, { access_token: "tok-1", expires_in: 3600 });
  let s = fake(() => ok(product()), tok);
  let r = await ask(s.f, Object.assign({ SHOPIFY_CATALOG_ID: "none" }, KEY));
  assert.equal(r.status, 200); assert.equal(r.body.mode, "token");
  assert.equal(s.mcp()[0].init.headers.Authorization, "Bearer tok-1");
  SC.shopcatReset();
  s = fake((init, n) => n === 1 ? res(401, { error: "unauthorized" }) : ok(product()), tok);
  r = await quiet(() => ask(s.f, Object.assign({ SHOPIFY_CATALOG_ID: "none" }, KEY)));
  assert.equal(r.status, 200); assert.equal(r.body.mode, "keyless");
  assert.equal(s.mcp().length, 2); assert.equal(s.mcp()[1].init.headers.Authorization, undefined);
  SC.shopcatReset();
  s = fake(() => ok(product()), () => res(401, { error: "invalid_client" }));
  r = await quiet(() => ask(s.f, Object.assign({ SHOPIFY_CATALOG_ID: "none" }, KEY)));
  assert.equal(r.status, 200); assert.equal(r.body.mode, "keyless", "a refused key: keyless");
});

test("errors: a bad id or link asks nothing; Shopify busy is 429 and waits; failures are 502; the day's cap is 429", async () => {
  const never = fake(() => { throw new Error("must not call"); });
  for (const q of ["shop=gid%3A%2F%2Fshopify%2FProduct%2F1", "shop=javascript%3Aalert(1)", "url=" + encodeURIComponent(CARD), "shop=" + encodeURIComponent(GID) + "&url=http%3A%2F%2Fx.example%2Fp"]) {
    const r = await ask(never.f, null, q);
    assert.equal(r.status, 400, q); assert.equal(r.headers["Cache-Control"], "no-store");
  }
  assert.equal(never.calls.length, 0);
  let s = fake(() => res(429, {}, { "retry-after": "20" }));
  let r = await ask(s.f);
  assert.equal(r.status, 429); assert.equal(r.body.error, "busy");
  r = await ask(s.f);
  assert.equal(r.status, 429); assert.equal(s.mcp().length, 1, "the isolate waits Shopify's Retry-After");
  SC.shopcatReset();
  r = await quiet(() => ask(fake(() => res(500, {})).f));
  assert.equal(r.status, 502); assert.equal(r.body.error, "shopify 500"); assert.equal(r.body.src, "shopify");
  r = await quiet(() => ask(fake(() => res(200, { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params" } })).f));
  assert.equal(r.status, 502);
  r = await quiet(() => ask(fake(() => res(200, { jsonrpc: "2.0", id: 1, result: { isError: true, structuredContent: {} } })).f));
  assert.equal(r.status, 502);
  r = await quiet(() => ask(fake(() => res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { ucp: { status: "error" }, messages: [{ code: "invalid_id" }] } } })).f));
  assert.equal(r.status, 502); assert.equal(r.body.error, "shopify invalid_id");
  r = await quiet(() => ask(fake(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }).f));
  assert.equal(r.status, 502); assert.equal(r.body.error, "timeout");
  s = fake(() => ok(product()));
  r = await ask(s.f, null, null, D(s.f, null, (n) => n === "shopcat:all"));
  assert.equal(r.status, 429); assert.equal(r.body.error, "daily limit"); assert.equal(s.mcp().length, 0, "a capped call never reaches Shopify");
  s = fake(() => ok(product()));
  r = await ask(s.f, null, null, D(s.f, null, (n) => n === "shopcat:203.0.113.9"));
  assert.equal(r.status, 429); assert.equal(r.body.error, "slow down"); assert.equal(s.mcp().length, 0);
});

test("never cached: /item?shop= is routed before the item cache, and nothing in shopcat.js caches or keeps a product", () => {
  const route = INDEX.indexOf('url.pathname === "/item" && url.searchParams.has("shop")'), cached = INDEX.indexOf('if (url.pathname === "/item") {');
  assert.ok(route > 0 && route < cached, "the Shopify branch comes first, so itemRoute's PCACHE (1 day) never sees it");
  assert.match(INDEX, /function shopDeps\(\) \{ return \{ vCount, ipKey, json, sgwExact, itemDesc \}; \}/);
  const body = SHOPCAT.slice(SHOPCAT.indexOf("export function shopcatProductBody"), SHOPCAT.indexOf("/* ---------- v211: the admin's Diagnose card"));
  assert.doesNotMatch(body, /PCACHE|caches\.|\.put\(|PROWL_ALERTS|max-age/, "no Cache API, no KV, no max-age");
});
