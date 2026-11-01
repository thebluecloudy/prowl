/* v213 (Matt, 2026-11-01: "Known stores only"): the live Shopify strip keeps every Shopify store's offer, and an
   off-Shopify offer only when its link's host is on the trusted list (SHOPCAT_OFF_TRUSTED) or a subdomain of one, by an
   exact host-suffix match (etsy.com.fake.ru and notetsy.com are not etsy.com). SHOPCAT_OFF_ALLOW adds domains. The
   Diagnose test search says how many were hidden and from which domains.
   Run: node --test worker/__tests__/shop-catalog-known-stores-v213.test.mjs */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as SC from "../shopcat.js";
import { adminPage } from "../admin-page.js";

const ORIGIN = "https://www.owlandtwigvintage.com";
const json = (body, status, origin, extra) => ({ status: status || 200, body, headers: Object.assign({}, extra || {}) });
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
function product(id, title, url, source) {
  return { id: "p" + id, title, media: [{ type: "image", url: "https://img.example.net/" + id + ".jpg" }],
    variants: [{ id: "v" + id, url, price: { amount: 4500, currency: "USD" }, availability: { available: true }, condition: ["secondhand"],
      source: source || "external", seller: { name: "Seller " + id, url: url, domain: new URL(url).hostname } }] };
}
const answer = (ps) => res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { products: ps } } });
const D = (f) => ({ vCount: async () => true, ipKey: (x) => String(x || "anon"), json, sgwExact: (items) => items, fetch: f });
const catalog = (ps) => async (url) => { if (String(url) === SC.SHOPCAT_MCP_URL) return answer(ps); throw new Error("unexpected " + url); };
function ask(f, env, q) {
  const url = new URL("https://prowl.example.workers.dev/shop-live?" + q);
  return SC.shopLive(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), env, url, ORIGIN, D(f));
}
const ENV = { SHOPIFY_CATALOG_ID: "none" };

beforeEach(() => SC.shopcatReset());

test("the trusted list: known marketplaces and their subdomains kept, scam-looking and lookalike domains dropped", () => {
  for (const u of ["https://www.etsy.com/listing/1", "https://etsy.com/listing/1", "https://www.chairish.com/product/1", "https://poshmark.com/listing/x",
    "https://www.ebay.com/itm/1", "https://m.ebay.com/itm/1", "https://www.1stdibs.com/furniture/x", "https://www.ha.com/itm/x", "https://shop.target.com/p/x",
    "https://www.lot-art.com/auction-items/x", "https://www.everythingbutthehouse.com/x", "https://www.wayfair.com/x"]) {
    assert.equal(SC.shopcatTrusted(u, {}), true, u);
  }
  for (const u of ["https://etsy.com.fake.ru/listing/1", "https://notetsy.com/listing/1", "https://ebay.com-deals.net/x", "https://myetsy.co/x", "https://etsy.co/x",
    "https://info.vetmenow.gr/p", "https://astromemo.com/p", "https://pro.pistache.fr/p", "https://saccarwanda.org/p", "https://ograje-mihalic.si/p",
    "https://mayiti.net/p", "https://myessential-shop.com/p", "https://contemporaryf.com/p", "https://infantsprightly.com/p", "https://casaseismono.com/p",
    "https://openboxfox.com/p", "https://theidbook.com/p", "https://latenthart.com/p", "https://mytravelingboutique.com/p", "http://www.etsy.com/listing/1", "not a url", ""]) {
    assert.equal(SC.shopcatTrusted(u, {}), false, u);
  }
  assert.equal(SC.shopcatTrusted("www.etsy.com", {}), true, "a bare host works too");
});

test("SHOPCAT_OFF_ALLOW adds domains (comma-separated, any case, a leading www. or *. ignored); junk entries ignored", () => {
  const env = { SHOPCAT_OFF_ALLOW: " Latenthart.com, *.astromemo.com ,www.vintagefinds.org, not a domain,, " };
  assert.equal(SC.shopcatTrusted("https://latenthart.com/p", env), true);
  assert.equal(SC.shopcatTrusted("https://shop.astromemo.com/p", env), true);
  assert.equal(SC.shopcatTrusted("https://vintagefinds.org/p", env), true);
  assert.equal(SC.shopcatTrusted("https://notlatenthart.com/p", env), false);
  assert.equal(SC.shopcatTrusted("https://latenthart.com/p", {}), false, "not without the variable");
  assert.ok(SC.shopcatOffAllow(env).indexOf("not a domain") === -1);
  assert.equal(SC.shopcatOffAllow({}).length, SC.SHOPCAT_OFF_TRUSTED.length);
});

test("shopcatItem: every Shopify store's offer stays; an untrusted off-Shopify offer is hidden; a trusted one in its cluster wins over it", () => {
  assert.equal(SC.shopcatItem(product(1, "Pyrex bowl", "https://somevintageshop.example/products/x", "shopify"), {}).offShopify, undefined, "Shopify stores: any domain");
  assert.deepEqual(SC.shopcatItem(product(2, "Pyrex bowl", "https://info.vetmenow.gr/p"), {}), { hidden: true, domain: "info.vetmenow.gr" });
  const c = product(3, "Pyrex bowl", "https://astromemo.com/p");
  c.variants.push(Object.assign({}, c.variants[0], { id: "v33", url: "https://www.etsy.com/listing/3" }));
  const it = SC.shopcatItem(c, {});
  assert.equal(it.url, "https://www.etsy.com/listing/3"); assert.equal(it.offShopify, true);
  assert.equal(it.img, "https://img.example.net/3.jpg", "a kept off-Shopify item's photo may come from any https host");
});

test("/shop-live: Shopify and trusted kept, the rest dropped; an all-hidden answer says why with raw 0", async () => {
  const ps = [product(1, "Fire-King mug", "https://firekingfan.myshopify.com/products/m", "shopify"), product(2, "Fire-King mug", "https://www.ebay.com/itm/2"),
    product(3, "Fire-King mug", "https://ograje-mihalic.si/m"), product(4, "Fire-King mug", "https://etsy.com.fake.ru/m"), product(5, "Fire-King mug", "https://notetsy.com/m")];
  const r = await ask(catalog(ps), ENV, "term=fire+king+mug&max=12");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((x) => x.url), ["https://firekingfan.myshopify.com/products/m", "https://www.ebay.com/itm/2"]);
  SC.shopcatReset();
  const r2 = await ask(catalog([product(6, "Fire-King mug", "https://astromemo.com/m")]), ENV, "term=fire+king+mug");
  assert.deepEqual(r2.body.why, { raw: 0, words: 0, own: 0, hidden: 2 }, "two passes (no saved catalog), the same unknown store each time");
  SC.shopcatReset();
  const r3 = await ask(catalog([product(6, "Fire-King mug", "https://astromemo.com/m")]), Object.assign({ SHOPCAT_OFF_ALLOW: "astromemo.com" }, ENV), "term=fire+king+mug");
  assert.equal(r3.body.items.length, 1, "the variable lets it through");
});

test("Diagnose test search: the hidden count and their domains, titles only from what a hunt shows; the card says so", async () => {
  const ps = [product(1, "Shown mug", "https://shop1.myshopify.com/p", "shopify"), product(2, "Scam mug", "https://info.vetmenow.gr/p"),
    product(3, "Scam mug 2", "https://pro.pistache.fr/p"), product(4, "Scam mug 3", "https://info.vetmenow.gr/q"), product(5, "Etsy mug", "https://www.etsy.com/listing/5")];
  const t = await SC.shopcatTest(ENV, D(catalog(ps)), "mug", ORIGIN);
  assert.equal(t.search.ok, true); assert.equal(t.search.count, 5);
  assert.deepEqual(t.search.hidden, { count: 3, domains: ["info.vetmenow.gr", "pro.pistache.fr"] });
  assert.deepEqual(t.search.titles, ["Shown mug", "Etsy mug"]);
  SC.shopcatReset();
  const t2 = await SC.shopcatTest(ENV, D(catalog([product(1, "Shown", "https://shop1.myshopify.com/p", "shopify")])), "mug", ORIGIN);
  assert.equal(t2.search.hidden, undefined, "nothing hidden: no line");
});

test("the Diagnose card says how many other-store items were hidden and from which domains", async (t) => {
  const dom = new JSDOM(adminPage("n0nce", "v213"), { url: "https://prowl.example.workers.dev/admin#diagnose", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path) => {
        const p = String(path);
        const j = p === "/admin/api/shopcat" ? { on: false, method: "", waitUntil: 0, catalogId: SC.SHOPCAT_CATALOG_ID, search: null, last: null, shape: { id: { len: 0 }, secret: { len: 0 } } }
          : p === "/admin/api/shopcat/test" ? { on: false, term: "fire king", exchange: null, search: { ok: true, mode: "keyless", catalog: true, status: 200, count: 10, titles: ["Fire-King mug"],
            hidden: { count: 3, domains: ["info.vetmenow.gr", "astromemo.com"] } } } : {};
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  const wait = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f()); };
  const card = d.querySelector("#v-diagnose #shccard");
  await wait(() => !!d.querySelector("#shc-run"));
  d.querySelector("#shc-run").click();
  await wait(() => /hidden: not on the trusted list/.test(card.textContent));
  assert.match(card.textContent, /3 other-store items hidden: not on the trusted list \(info\.vetmenow\.gr, astromemo\.com\)\. Add a domain to SHOPCAT_OFF_ALLOW to show it\./);
});
