/* v213 review fixes (worker/shopcat.js):
   - a token the catalog refuses enters the credentials' 5-minute wait, so the next passes and requests search keyless
     with no exchange; every catalog call counts in shopcat:all; shopcat:last is written on a change, not per request;
   - the optional saved-catalog pass failing (not a 429) falls back to the whole Global Catalog;
   - an off-Shopify card names the vetted link's host, and the seller's name only when its domain is under the same
     trusted suffix;
   - the Diagnose sample titles are only cards a hunt would show;
   - SHOPCAT_OFF_ALLOW takes pasted URLs, ignores public suffixes, and the Diagnose card lists what it ignored.
   Run: node --test worker/__tests__/shop-catalog-review-v213.test.mjs */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as SC from "../shopcat.js";
import { adminPage } from "../admin-page.js";

const KEY = { SHOPIFY_CATALOG_CLIENT_ID: "0123456789abcdef0123456789abcdef", SHOPIFY_CATALOG_CLIENT_SECRET: "shpss_reviewSecretValue_77" };
const ORIGIN = "https://www.owlandtwigvintage.com";
const json = (body, status, origin, extra) => ({ status: status || 200, body, headers: Object.assign({}, extra || {}) });
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
function product(id, title, o = {}) {
  return { id: "p" + id, title, media: o.noPhoto ? [] : [{ type: "image", url: "https://cdn.shopify.com/s/files/" + id + ".jpg" }],
    variants: [{ id: "v" + id, url: o.url || "https://shop" + id + ".example/products/p", price: { amount: 4500, currency: "USD" }, availability: { available: true },
      condition: ["secondhand"], source: o.source || "shopify", seller: o.seller || { name: "Shop " + id, url: "https://shop" + id + ".example", domain: "shop" + id + ".example" } }] };
}
const answer = (ps) => res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { products: ps } } });
function kv() { let puts = 0; const m = new Map(); return { m, puts: () => puts, put: async (k, v) => { puts++; m.set(k, v); }, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; } }; }
function fake(token, catalog) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: (() => { try { return JSON.parse(init.body); } catch (e) { return init.body; } })() });
    if (String(url) === SC.SHOPCAT_TOKEN_URL) return token(init);
    if (String(url) === SC.SHOPCAT_MCP_URL) return catalog(init, calls[calls.length - 1].body);
    throw new Error("unexpected " + url);
  };
  return { f, calls, tokens: () => calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL), searches: () => calls.filter((c) => c.url === SC.SHOPCAT_MCP_URL) };
}
function deps(f, counts) {
  return { vCount: async (n) => { if (counts) counts[n] = (counts[n] || 0) + 1; return true; }, ipKey: (x) => String(x || "anon"), json, sgwExact: (items) => items, fetch: f };
}
function ask(f, env, q, counts) {
  const url = new URL("https://prowl.example.workers.dev/shop-live?" + q);
  return SC.shopLive(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), env, url, ORIGIN, deps(f, counts));
}
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

beforeEach(() => SC.shopcatReset());

test("a token the catalog refuses: one exchange, then the 5-minute wait; the next request makes no exchange and no KV write; every call counted", async () => {
  const store = kv(), env = Object.assign({ PROWL_ALERTS: store }, KEY);   /* the default saved catalog: 3 passes */
  const s = fake(() => res(200, { access_token: "tok", expires_in: 3600 }), (init) => init.headers.Authorization ? res(401, {}) : answer([product(1, "Ceramic panther")]));
  const c1 = {};
  const r1 = await quiet(() => ask(s.f, env, "term=ceramic+panther", c1));
  assert.equal(r1.status, 200); assert.equal(r1.body.mode, "keyless"); assert.equal(r1.body.items.length, 1);
  assert.equal(s.tokens().length, 1, "one exchange (it worked), never a second for the refused token");
  assert.equal(s.searches().length, 4, "the refused Bearer call, then 3 keyless passes");
  assert.equal(s.searches().filter((c) => c.init.headers.Authorization).length, 1);
  assert.equal(c1["shopcat:all"], 4, "every catalog call is counted");
  assert.ok(store.puts() <= 3, "KV: the exchange, the refusal, the keyless mode at most (" + store.puts() + ")");
  assert.equal(SC.shopcatTokenDown(Date.now(), env), true, "the credentials are in the wait");
  const st = await SC.shopcatStatus(env);
  assert.equal(st.last.ok, false); assert.equal(st.last.status, 401); assert.equal(st.last.error, "catalog refused the token");
  assert.ok(st.waitUntil > Date.now());
  const puts = store.puts(), c2 = {};
  const r2 = await ask(s.f, env, "term=ceramic+panther", c2);
  assert.equal(r2.body.mode, "keyless");
  assert.equal(s.tokens().length, 1, "no exchange in the wait");
  assert.equal(s.searches().length, 7, "3 keyless calls, none with the token");
  assert.equal(c2["shopcat:all"], 3);
  assert.equal(store.puts(), puts, "no KV write when nothing changed");
  /* after the wait: at most one exchange (the window starts again) */
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + SC.SHOPCAT_TOKEN_FAIL_MS + 1000;
    await quiet(() => ask(s.f, env, "term=ceramic+panther"));
    assert.equal(s.tokens().length, 2, "one exchange per window");
    await ask(s.f, env, "term=ceramic+panther");
    assert.equal(s.tokens().length, 2);
  } finally { Date.now = realNow; }
});

test("a refused exchange (a bad key): one exchange plus the Basic retry per window, then keyless with no exchange", async () => {
  const s = fake(() => res(401, { error: "invalid_client" }), () => answer([product(1, "Ceramic panther")]));
  const env = Object.assign({}, KEY);
  await quiet(() => ask(s.f, env, "term=ceramic+panther"));
  assert.equal(s.tokens().length, 2, "the JSON body, then HTTP Basic, once for all 3 passes");
  await quiet(() => ask(s.f, env, "term=ceramic+panther"));
  assert.equal(s.tokens().length, 2);
});

test("the saved-catalog pass failing (not a 429) falls back to the whole Global Catalog", async () => {
  for (const bad of [res(200, { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "catalog not found" } }), res(404, {}), res(500, {})]) {
    SC.shopcatReset();
    const s = fake(() => { throw new Error("no exchange"); }, (init, body) => body.params.arguments.catalog.catalog_id ? bad : answer([product(1, "Ceramic panther")]));
    const r = await ask(s.f, {}, "term=ceramic+panther");
    assert.equal(r.status, 200, "status " + bad.status); assert.equal(r.body.items.length, 1);
    assert.equal(s.searches().length, 3, "catalog pass, then both Global Catalog passes");
  }
  /* a 429 on the catalog pass still stops the hunt (Shopify asked us to wait) */
  SC.shopcatReset();
  const b = fake(() => { throw new Error("no exchange"); }, () => ({ status: 429, headers: { get: (k) => k === "Retry-After" ? "5" : null }, json: async () => ({}), text: async () => "{}" }));
  const r429 = await ask(b.f, {}, "term=ceramic+panther");
  assert.equal(r429.status, 429); assert.equal(b.searches().length, 1);
  /* every pass failing is still an error */
  SC.shopcatReset();
  const all = fake(() => { throw new Error("no exchange"); }, () => res(500, {}));
  const rx = await ask(all.f, {}, "term=ceramic+panther");
  assert.equal(rx.status, 502); assert.deepEqual(rx.body.items, []);
});

test("an off-Shopify card names the vetted link's host; the seller's name only under the same trusted suffix", () => {
  const scam = SC.shopcatItem(product(1, "Pyrex", { source: "external", url: "https://www.amazon.com/dp/X", seller: { name: "Etsy", domain: "cheap-copies.biz" } }), {});
  assert.equal(scam.domain, "amazon.com"); assert.equal(scam.shop, "amazon.com"); assert.equal(scam.offShopify, true);
  const ok = SC.shopcatItem(product(2, "Pyrex", { source: "external", url: "https://www.etsy.com/listing/1", seller: { name: "Vintage Nook on Etsy", domain: "www.etsy.com" } }), {});
  assert.equal(ok.domain, "etsy.com"); assert.equal(ok.shop, "Vintage Nook on Etsy");
  const sub = SC.shopcatItem(product(3, "Pyrex", { source: "external", url: "https://m.ebay.com/itm/1", seller: { name: "eBay seller", domain: "ebay.com" } }), {});
  assert.equal(sub.domain, "m.ebay.com"); assert.equal(sub.shop, "eBay seller");
  /* a Shopify store's card is unchanged */
  const shop = SC.shopcatItem(product(4, "Pyrex"), {});
  assert.equal(shop.domain, "shop4.example"); assert.equal(shop.shop, "Shop 4");
});

test("Diagnose sample titles: only cards a hunt would show (not own, not photo-less, every word of the term)", async () => {
  const ps = [product(1, "Owl and Twig Pyrex bowl", { url: "https://www.owlandtwigvintage.com/products/x", seller: { name: "Owl & Twig", domain: "owlandtwigvintage.com" } }),
    product(2, "No photo Pyrex", { noPhoto: true }), product(3, "Glass bowl"), product(4, "Real Pyrex"), product(5, "Hidden Pyrex", { source: "external", url: "https://fake.ru/p" })];
  const s = fake(() => { throw new Error("no exchange"); }, () => answer(ps));
  const D = Object.assign(deps(s.f), { sgwExact: (items, term) => items.filter((c) => c.title.toLowerCase().indexOf(term) !== -1) });
  const r = await SC.shopcatTest({}, D, "pyrex", "https://prowl.example.workers.dev");
  assert.deepEqual(r.search.titles, ["Real Pyrex"]);
  assert.equal(r.search.count, 5); assert.equal(r.search.hidden.count, 1);
});

test("SHOPCAT_OFF_ALLOW: pasted URLs become hosts; public suffixes and junk are ignored and listed for Diagnose", async () => {
  const env = { SHOPCAT_OFF_ALLOW: "https://www.vintagefinds.co.uk/shop?x=1, http://Retro.Example.com/, co.uk, com, myshopify.com, *.github.io, kitschy.net/path, not a domain" };
  const p = SC.shopcatOffAllowParse(env);
  assert.deepEqual(p.add, ["vintagefinds.co.uk", "retro.example.com", "kitschy.net"]);
  assert.deepEqual(p.ignored, ["co.uk", "com", "myshopify.com", "*.github.io", "not", "a", "domain"]);
  assert.equal(SC.shopcatTrusted("https://vintagefinds.co.uk/p/1", env), true);
  assert.equal(SC.shopcatTrusted("https://anything.co.uk/p/1", env), false, "co.uk trusts nothing");
  assert.equal(SC.shopcatTrusted("https://scam.myshopify.com/p/1", env), false);
  const st = await SC.shopcatStatus(env);
  assert.deepEqual(st.offAllow, p);
});

test("the Diagnose card lists the SHOPCAT_OFF_ALLOW entries it ignored", async (t) => {
  const dom = new JSDOM(adminPage("n0nce", "v213"), { url: "https://prowl.example.workers.dev/admin#diagnose", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path) => {
        const j = String(path) === "/admin/api/shopcat" ? { on: false, method: "", waitUntil: 0, catalogId: "", search: null, last: null, shape: { id: { len: 0 }, secret: { len: 0 } },
          offAllow: { add: ["vintagefinds.co.uk"], ignored: ["co.uk", "myshopify.com"] } } : {};
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  const card = d.querySelector("#v-diagnose #shccard");
  for (let i = 0; i < 100 && !/ignored/.test(card.textContent); i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(card.textContent, /SHOPCAT_OFF_ALLOW adds: vintagefinds\.co\.uk\./);
  assert.match(card.textContent, /SHOPCAT_OFF_ALLOW entries ignored \(.*\): co\.uk, myshopify\.com\./);
});
