/* v212: the Shopify strip searches keyless (no Authorization header, the agent profile alone: Shopify's Anonymous tier,
   shopify.dev/docs/agents/profiles/auth-and-rate-limiting) when the key is missing, refused or in its 5-minute wait;
   Matt's saved catalog goes as catalog.catalog_id (SHOPIFY_CATALOG_ID overrides, "none" sends none) with a fill from the
   whole Global Catalog; off-Shopify offers are kept and marked; every Shopify call names itself (User-Agent); a non-JSON
   refusal (a bare 403) keeps a scrubbed snippet and who answered, and is retried with HTTP Basic; the Diagnose card shows
   which mode the last search used.
   Run: node --test worker/__tests__/shop-catalog-keyless-v212.test.mjs */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as SC from "../shopcat.js";
import { adminPage } from "../admin-page.js";

const ID = "0123456789abcdef0123456789abcdef", SECRET = "shpss_5ecretValueThatMustNeverLeak_42";
const KEY = { SHOPIFY_CATALOG_CLIENT_ID: ID, SHOPIFY_CATALOG_CLIENT_SECRET: SECRET };
const ORIGIN = "https://www.owlandtwigvintage.com";
const json = (body, status, origin, extra) => ({ status: status || 200, body, headers: Object.assign({}, extra || {}) });
function res(status, body, headers = {}, text) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => { if (text != null) throw new SyntaxError("not JSON"); return body; }, text: async () => text != null ? text : JSON.stringify(body) };
}
function kv() { const m = new Map(); return { m, put: async (k, v) => { m.set(k, v); }, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; } }; }
function product(id, title, o = {}) {
  return { id: "p" + id, title, media: [{ type: "image", url: o.img || "https://cdn.shopify.com/s/files/1/" + id + ".jpg" }],
    variants: [{ id: "v" + id, url: o.url || "https://shop" + id + ".example/products/p", price: { amount: 4500, currency: "USD" }, availability: { available: true },
      condition: ["secondhand"], source: o.source || "shopify", seller: { name: o.shop || "Shop " + id, url: "https://shop" + id + ".example", domain: o.domain || "shop" + id + ".example" } }] };
}
const answer = (ps) => res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { products: ps } } });
function fake(token, catalog) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: (() => { try { return JSON.parse(init.body); } catch (e) { return init.body; } })() });
    if (String(url) === SC.SHOPCAT_TOKEN_URL) return token(init, calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL).length);
    if (String(url) === SC.SHOPCAT_MCP_URL) return catalog(init, calls.filter((c) => c.url === SC.SHOPCAT_MCP_URL).length);
    throw new Error("unexpected " + url);
  };
  return { f, calls, tokens: () => calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL), searches: () => calls.filter((c) => c.url === SC.SHOPCAT_MCP_URL) };
}
const D = (f) => ({ vCount: async () => true, ipKey: (x) => String(x || "anon"), json, sgwExact: (items) => items, fetch: f });
function ask(f, env, q = "term=ceramic+panther") {
  const url = new URL("https://prowl.example.workers.dev/shop-live?" + q);
  return SC.shopLive(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), env, url, ORIGIN, D(f));
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };
const noToken = () => { throw new Error("no token exchange expected"); };

beforeEach(() => SC.shopcatReset());

test("no secrets: keyless search, no Authorization, the profile in meta, the User-Agent on every call; the caps still count", async () => {
  const counts = {};
  const s = fake(noToken, () => answer([product(1, "Ceramic panther planter")]));
  const url = new URL("https://prowl.example.workers.dev/shop-live?term=ceramic+panther&max=1");
  const d = Object.assign(D(s.f), { vCount: async (n) => { counts[n] = (counts[n] || 0) + 1; return true; } });
  const r = await SC.shopLive(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), { SHOPIFY_CATALOG_ID: "none" }, url, ORIGIN, d);
  assert.equal(r.status, 200);
  assert.equal(r.body.on, true); assert.equal(r.body.mode, "keyless"); assert.equal(r.body.items.length, 1);
  assert.equal(r.body.off, undefined, "never { off: true } any more");
  const q = s.searches()[0];
  assert.equal(q.init.headers.Authorization, undefined);
  assert.equal(q.init.headers["User-Agent"], SC.SHOPCAT_UA);
  assert.equal(q.init.headers.Accept, "application/json");
  assert.match(SC.SHOPCAT_UA, /^Prowl\/212 \(\+https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl\)$/);
  assert.equal(q.body.params.arguments.meta["ucp-agent"].profile, "https://prowl.example.workers.dev/ucp/profile.json");
  assert.ok(counts["shopcat:203.0.113.9"] && counts["shopcat:all"], "per-IP and site caps");
  assert.equal(r.headers["Cache-Control"], "no-store");
});

test("a refused key: the exchange's error is kept for Diagnose, and the search goes keyless; in the wait no new exchange", async () => {
  const store = kv(), env = Object.assign({ PROWL_ALERTS: store, SHOPIFY_CATALOG_ID: "none" }, KEY);
  const s = fake(() => res(401, { error: "invalid_client", error_description: "Client authentication failed" }), () => answer([product(1, "Ceramic panther")]));
  const r = await quiet(() => ask(s.f, env, "term=ceramic+panther&max=1"));
  assert.equal(r.status, 200); assert.equal(r.body.mode, "keyless"); assert.equal(r.body.items.length, 1);
  assert.equal(s.tokens().length, 2, "the JSON body, then HTTP Basic");
  assert.ok(s.tokens().every((c) => c.init.headers["User-Agent"] === SC.SHOPCAT_UA), "the exchange names itself too");
  assert.equal(s.searches()[0].init.headers.Authorization, undefined);
  const r2 = await quiet(() => ask(s.f, env, "term=ceramic+panther&max=1"));
  assert.equal(r2.body.mode, "keyless"); assert.equal(s.tokens().length, 2, "the 5-minute wait: no exchange");
  const st = await SC.shopcatStatus(env);
  assert.equal(st.on, true);
  assert.equal(st.last.error, "invalid_client", "the token error still shows so Matt can fix the key");
  assert.equal(st.search.mode, "keyless");
  const rec = JSON.parse(store.m.get(SC.SHOPCAT_LAST_KEY));
  assert.equal(rec.search.mode, "keyless", "the mode is in shopcat:last");
  assert.ok(!store.m.get(SC.SHOPCAT_LAST_KEY).includes(SECRET) && !store.m.get(SC.SHOPCAT_LAST_KEY).includes(ID));
});

test("a working key: token mode; a token Shopify refuses twice falls back keyless", async () => {
  const s = fake(() => res(200, { access_token: "tok", expires_in: 3600 }), () => answer([product(1, "Ceramic panther")]));
  const r = await ask(s.f, Object.assign({ SHOPIFY_CATALOG_ID: "none" }, KEY), "term=ceramic+panther&max=1");
  assert.equal(r.body.mode, "token"); assert.equal(s.searches()[0].init.headers.Authorization, "Bearer tok");
  SC.shopcatReset();
  const s2 = fake(() => res(200, { access_token: "tok", expires_in: 3600 }), (init) => init.headers.Authorization ? res(401, {}) : answer([product(1, "Ceramic panther")]));
  const r2 = await ask(s2.f, Object.assign({ SHOPIFY_CATALOG_ID: "none" }, KEY), "term=ceramic+panther&max=1");
  assert.equal(r2.status, 200); assert.equal(r2.body.mode, "keyless"); assert.equal(s2.searches().length, 3);
});

test("catalog_id: Matt's saved catalog by default, SHOPIFY_CATALOG_ID overrides, none sends none; then a fill from the whole catalog", async () => {
  assert.equal(SC.shopcatCatalogId({}), "01m6bnevzyfcxd7e3s8g125vca");
  assert.equal(SC.shopcatCatalogId({ SHOPIFY_CATALOG_ID: " 01abcdefabcdefabcdefabcdef " }), "01abcdefabcdefabcdefabcdef");
  assert.equal(SC.shopcatCatalogId({ SHOPIFY_CATALOG_ID: "none" }), "");
  assert.equal(SC.shopcatCatalogId({ SHOPIFY_CATALOG_ID: "OFF" }), "");
  assert.equal(SC.shopcatCatalogId({ SHOPIFY_CATALOG_ID: "bad id!" }), "01m6bnevzyfcxd7e3s8g125vca", "a malformed value is ignored");
  const s = fake(noToken, (init, n) => answer(n === 1 ? [product(1, "Ceramic panther A")] : n === 2 ? [product(2, "Ceramic panther B")] : [product(3, "Ceramic panther C")]));
  const r = await ask(s.f, { SHOPIFY_CATALOG_ID: "01abcdefabcdefabcdefabcdef" }, "term=ceramic+panther&max=3");
  const q = s.searches().map((c) => c.body.params.arguments.catalog);
  assert.equal(q.length, 3);
  assert.equal(q[0].catalog_id, "01abcdefabcdefabcdefabcdef");
  assert.equal(q[0].saved_catalog_slug, undefined, "the deprecated alias is not sent");
  assert.deepEqual(q[0].filters, { available: true, ships_to: { country: "US" }, condition: ["secondhand"] }, "our filters still go with the catalog");
  assert.equal(q[1].catalog_id, undefined); assert.deepEqual(q[1].filters.condition, ["secondhand"]);
  assert.equal(q[2].catalog_id, undefined); assert.equal(q[2].filters.condition, undefined);
  assert.deepEqual(r.body.items.map((x) => x.title), ["Ceramic panther A", "Ceramic panther B", "Ceramic panther C"]);
  SC.shopcatReset();
  const s2 = fake(noToken, () => answer([product(1, "Ceramic panther")]));
  await ask(s2.f, {}, "term=ceramic+panther&max=1");
  assert.equal(s2.searches()[0].body.params.arguments.catalog.catalog_id, "01m6bnevzyfcxd7e3s8g125vca", "the default");
  assert.equal(s2.searches().length, 1, "max met by the catalog: no fill");
  SC.shopcatReset();
  const s3 = fake(noToken, () => answer([product(1, "Ceramic panther")]));
  await ask(s3.f, { SHOPIFY_CATALOG_ID: "none" }, "term=ceramic+panther&max=1");
  assert.equal(s3.searches()[0].body.params.arguments.catalog.catalog_id, undefined);
});

test("off-Shopify offers from known stores are kept and marked; a card needs a price and an https photo; Owl & Twig's own still hidden", () => {
  const ext = product(1, "Pyrex bowl", { source: "external", img: "https://i.etsystatic.com/p.jpg", url: "https://www.etsy.com/listing/1", shop: "Bid Site", domain: "etsy.com" });
  assert.deepEqual(Object.assign({}, SC.shopcatItem(ext, {})), { title: "Pyrex bowl", price: 45, currency: "USD", img: "https://i.etsystatic.com/p.jpg", shop: "Bid Site", domain: "etsy.com",
    url: "https://www.etsy.com/listing/1", secondhand: true, offShopify: true });
  assert.equal(SC.shopcatItem(product(2, "No photo", { img: "http://insecure.example/p.jpg" }), {}), null, "no https photo: dropped");
  const np = product(3, "No price"); np.variants[0].price = null;
  assert.equal(SC.shopcatItem(np, {}), null, "no price: dropped");
  assert.deepEqual(SC.shopcatItem(product(4, "Ours", { source: "external", url: "https://www.owlandtwigvintage.com/products/x", domain: "owlandtwigvintage.com" }), {}), { own: true });
  /* a Shopify store's offer is preferred over an external one in the same cluster */
  const both = product(5, "Pyrex dish", { source: "external", url: "https://ext.example/p" });
  both.variants.push(Object.assign({}, both.variants[0], { id: "v55", source: "shopify", url: "https://store.example/products/p", seller: { name: "Store", domain: "store.example" } }));
  assert.equal(SC.shopcatItem(both, {}).url, "https://store.example/products/p");
  assert.equal(SC.shopcatItem(both, {}).offShopify, undefined);
});

test("a bare 403 with no JSON (an edge block): retried with HTTP Basic, a scrubbed snippet and who answered are kept", async () => {
  const store = kv(), env = Object.assign({ PROWL_ALERTS: store, SHOPIFY_CATALOG_ID: "none" }, KEY);
  const page = "<html><head><title>Attention Required! | Cloudflare</title><script>var x='" + SECRET + "'</script></head><body><h1>Sorry, you have been blocked</h1> client " + ID + "</body></html>";
  const s = fake(() => res(403, null, { server: "cloudflare", "cf-ray": "8abc123-SJC" }, page), () => answer([]));
  const r = await quiet(() => ask(s.f, env));
  assert.equal(r.body.mode, "keyless");
  assert.equal(s.tokens().length, 2, "a 403 with no JSON is tried with Basic too");
  const a = SC.shopcatLast().attempts[0];
  assert.equal(a.status, 403); assert.equal(a.error, "not JSON"); assert.equal(a.server, "cloudflare"); assert.equal(a.ray, true);
  assert.match(a.desc, /Attention Required! \| Cloudflare Sorry, you have been blocked/);
  assert.ok(!a.desc.includes("<") && !a.desc.includes(SECRET) && !a.desc.includes(ID), a.desc);
  assert.ok(a.desc.length <= 200);
  const st = await SC.shopcatStatus(env);
  assert.equal(st.last.attempts[0].server, "cloudflare"); assert.equal(st.last.attempts[0].ray, true);
});

test("shopcatTest runs from the worker keyless when there is no key or it is refused, and says which", async () => {
  const s = fake(() => res(401, { error: "invalid_client" }), (init) => answer([product(1, "Pyrex bowl"), product(2, "Pyrex dish")]));
  const t = await quiet(() => SC.shopcatTest(KEY, D(s.f), "pyrex", "https://prowl.example.workers.dev"));
  assert.equal(t.exchange.ok, false); assert.equal(t.search.ok, true); assert.equal(t.search.mode, "keyless"); assert.equal(t.search.count, 2);
  assert.equal(t.search.catalog, true, "the default saved catalog");
  assert.equal(s.searches()[0].init.headers.Authorization, undefined);
  assert.equal(s.searches()[0].body.params.arguments.catalog.catalog_id, SC.SHOPCAT_CATALOG_ID);
  const k = await SC.shopcatTest({}, D(s.f), "pyrex", "https://prowl.example.workers.dev");
  assert.equal(k.on, false); assert.equal(k.exchange, null); assert.equal(k.search.mode, "keyless");
  /* a search refused by an edge says who answered */
  const e = fake(noToken, () => res(403, null, { server: "cloudflare", "cf-ray": "1" }, "<h1>Forbidden</h1>"));
  const x = await SC.shopcatTest({}, D(e.f), "pyrex", "");
  assert.equal(x.search.ok, false); assert.equal(x.search.error, "Forbidden"); assert.equal(x.search.server, "cloudflare"); assert.equal(x.search.ray, true);
});

test("the Diagnose card shows the mode of the last search, the saved catalog, and where the two key values are", async (t) => {
  const dom = new JSDOM(adminPage("n0nce", "v212"), { url: "https://prowl.example.workers.dev/admin#diagnose", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path) => {
        const p = String(path);
        const j = p === "/admin/api/shopcat" ? { on: true, method: "", waitUntil: 0, catalogId: "01m6bnevzyfcxd7e3s8g125vca", search: { at: Date.now(), mode: "keyless", status: 200, catalog: true },
          last: { at: Date.now(), ok: false, status: 403, error: "not JSON", desc: "Forbidden", method: "post", tried: ["post", "basic"], attempts: [{ method: "post", status: 403, error: "not JSON", desc: "Forbidden", server: "cloudflare", ray: true }] },
          shape: { id: { len: 32, set: true }, secret: { len: 38, set: true }, swapped: false } }
          : p === "/admin/api/shopcat/test" ? { on: true, term: "pyrex", exchange: { ok: false, status: 403, error: "not JSON", desc: "Forbidden", method: "post", tried: ["post"], attempts: [] }, search: { ok: true, mode: "keyless", catalog: true, status: 200, count: 10, titles: ["Pyrex bowl"] } } : {};
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  const wait = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f()); };
  const card = d.querySelector("#v-diagnose #shccard");
  await wait(() => /Last search/.test(card.textContent));
  assert.match(card.textContent, /Last searchKeyless · 200/);
  assert.match(card.textContent, /Saved catalog01m6bnevzyfcxd7e3s8g125vca/);
  assert.match(card.textContent, /answered by cloudflare, with a cf-ray: looks like an edge block/);
  assert.match(card.textContent, /Dev Dashboard › Catalogs › Get an API key .*Client ID into SHOPIFY_CATALOG_CLIENT_ID .*Client secret into SHOPIFY_CATALOG_CLIENT_SECRET/);
  d.querySelector("#shc-run").click();
  await wait(() => /Search “pyrex” \(keyless, saved catalog\): 10 items/.test(card.textContent));
  assert.match(card.textContent, /Token: refused \(403\): not JSON \(searching keyless\)/);
});
