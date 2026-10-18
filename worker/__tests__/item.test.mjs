/* v81 listing popup: which URLs open, the description sanitizer, and each source's reader.
   Run: node --test worker/__tests__/item.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeKey } from "../metrics.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const LISTING = readFileSync(new URL("./fixtures/salvation-listing.html", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => { const m = new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX); assert.ok(m, name); return m[0]; };

function load(deps = {}, nowIso = "2026-10-07T19:36:00Z") {
  const RealDate = Date, fixed = RealDate.parse(nowIso);
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }
  const names = ["hibidText", "money", "ebayMoney", "ebaySale", "ebayAge", "ptOff", "sgwMs", "timeLeft", "salvationEnd", "itemRef", "itemDesc", "itemImages", "itemEbay", "itemSgw", "salvationItem", "itemRoute"];
  const src = [
    constLine("ITEM_TAGS"), constLine("PT_FMT"), "const itemImg = " + /const itemImg = ([^\n]+)/.exec(INDEX)[1],
    'const SALVATION_BASE = "https://shopthesalvationarmy.com";',
    'const EBAY_ITEM_URL = "https://www.ebay.com/itm/";', constLine("EBAY_GETITEM_URL"), constLine("SGW_ITEM_API"),
    "const ITEM_CACHE_SECONDS = 86400, ITEM_PER_IP = 300, ITEM_IMAGES = 24, ITEM_DESC_MAX = 20000;",
    "const UPSTREAM_TIMEOUT_MS = 5000;",
  ].concat(names.map(indexFn)).join("\n");
  const keys = ["Date", "fetch", "ebayToken", "PCACHE", "vCount", "ipKey", "json", "console", "itemSalvation", "AFF_ON", "affId"];
  const vals = [FakeDate, deps.fetch || (async () => { throw new Error("no fetch"); }), async () => "TOKEN", deps.PCACHE, deps.vCount || (async () => true), (x) => String(x || "ip"),
    (body, status, origin, extra) => ({ body, status: status || 200, extra: extra || {} }), { error() {} }, deps.itemSalvation || (async () => ({ error: "x" })), deps.AFF_ON || { ebay: true, depop: false }, deps.affId || ((p, k) => (p === "ebay" && k === "camp" ? "5339216838" : ""))];
  return new Function(...keys, src + "\nreturn { " + names.join(", ") + " };")(...vals);
}
const resp = (status, body) => ({ status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("only eBay, ShopGoodwill and Salvation Army listing URLs open", () => {
  const { itemRef } = load();
  assert.deepEqual(itemRef("https://www.ebay.com/itm/123456789012"), { src: "ebay", id: "123456789012" });
  assert.deepEqual(itemRef("https://www.ebay.com/itm/some-title/123456789012?hash=x"), { src: "ebay", id: "123456789012" });
  assert.deepEqual(itemRef("https://shopgoodwill.com/item/278987071"), { src: "shopgoodwill", id: "278987071" });
  assert.deepEqual(itemRef("https://shopthesalvationarmy.com/Listing/Details/588443092/SEALED-Bluray-Lot-40-Titles-B2516"), { src: "salvation", id: "588443092", slug: "SEALED-Bluray-Lot-40-Titles-B2516" });
  for (const bad of ["http://www.ebay.com/itm/123456789012", "https://evil.example/itm/123456789012", "https://ebay.com.evil.example/itm/123456789012",
    "https://www.etsy.com/listing/1", "https://shopthesalvationarmy.com/Listing/Details/1/../../admin", "javascript:alert(1)", ""]) {
    assert.equal(itemRef(bad), null, bad);
  }
});

test("descriptions keep a few formatting tags and nothing that can run", () => {
  const { itemDesc } = load();
  const out = itemDesc('<div style="color:red" onclick="x()"><h2>Nice <b onmouseover="y()">lamp</b></h2><script>alert(1)</script><style>p{}</style>' +
    '<img src=x onerror=alert(2)><iframe src="https://evil"></iframe><p class="a">Works <a href="javascript:alert(3)">here</a></p>' +
    '<svg><script>alert(4)</script></svg><form><input value="x"></form><ul><li>one<li>two</ul>1 < 2</div>');
  assert.doesNotMatch(out, /script|onerror|onclick|onmouseover|iframe|style|svg|<img|<a|href|javascript|form|input|class=/i);
  assert.match(out, /<h4>Nice <b>lamp<\/b><\/h4>/);
  assert.match(out, /<p>Works here<\/p>/);
  assert.match(out, /<ul><li>one<li>two<\/ul>/);
  assert.match(out, /1 &lt; 2/);
  assert.ok(itemDesc("x".repeat(30000)).length <= 20001);
});

test("eBay: getItemByLegacyId with the EPN header; photos, aspects, affiliate URL", async () => {
  const seen = [];
  const { itemEbay } = load({ fetch: async (u, o) => { seen.push({ u, h: o.headers }); return resp(200, {
    title: "Haeger panther TV lamp", price: { value: "45.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"],
    image: { imageUrl: "https://i.ebayimg.com/images/g/a/s-l1600.jpg" }, additionalImages: [{ imageUrl: "https://i.ebayimg.com/images/g/b/s-l1600.jpg" }, { imageUrl: "http://insecure/x.jpg" }],
    description: "<p>Great <script>x</script>lamp</p>", condition: "Used", localizedAspects: [{ name: "Brand", value: "Haeger" }],
    itemWebUrl: "https://www.ebay.com/itm/123456789012?hash=1", itemAffiliateWebUrl: "https://www.ebay.com/itm/123456789012?mkcid=1&campid=5339216838" }); } });
  const r = await itemEbay("123456789012", { EPN_CAMPAIGN_ID: "5339216838" });
  assert.match(seen[0].u, /get_item_by_legacy_id\?legacy_item_id=123456789012$/);
  assert.equal(seen[0].h["X-EBAY-C-ENDUSERCTX"], "affiliateCampaignId=5339216838");
  assert.deepEqual(r.images, ["https://i.ebayimg.com/images/g/a/s-l1600.jpg", "https://i.ebayimg.com/images/g/b/s-l1600.jpg"]);
  assert.equal(r.description, "<p>Great lamp</p>");
  assert.deepEqual(r.aspects, [{ n: "Brand", v: "Haeger" }]);
  assert.equal(r.affUrl, "https://www.ebay.com/itm/123456789012?mkcid=1&campid=5339216838");
  assert.equal(r.price, "$45.00");
});

test("eBay: with the eBay affiliate switch off (v89), no EPN header is sent", async () => {
  const seen = [];
  const { itemEbay } = load({ AFF_ON: { ebay: false, depop: false }, fetch: async (u, o) => { seen.push(o.headers); return resp(200, { title: "x", itemWebUrl: "https://www.ebay.com/itm/1" }); } });
  await itemEbay("123456789012", { EPN_CAMPAIGN_ID: "5339216838" });
  assert.equal(seen[0]["X-EBAY-C-ENDUSERCTX"], undefined);
});

test("eBay: an ended or removed listing is gone, not an error", async () => {
  const { itemEbay } = load({ fetch: async () => resp(404, { errors: [{ errorId: 11001 }] }) });
  assert.deepEqual(await itemEbay("1234567", {}), { gone: true });
});

test("ShopGoodwill: every photo from the item detail, with the bid and description", async () => {
  const { itemSgw } = load({ fetch: async (u) => { assert.match(u, /GetItemDetailModelByItemId\/278987071$/); return resp(200, {
    itemId: 278987071, title: "Marvel and DC Action Figure Lot", currentPrice: 12.5, numberOfBids: 7, isAuction: true, endTime: "2026-10-09T18:12:00",
    description: "<p><strong>Figures</strong></p><p onclick='x'>Good</p>", imageServer: "https://shopgoodwillimages.azureedge.net/production/",
    imageUrlString: "115\\Items\\2026-09-16\\14dd9734waii_09161.jpg;115\\Items\\2026-09-16\\98cf3521waii_09162.jpg" }); } });
  const r = await itemSgw("278987071");
  assert.deepEqual(r.images, ["https://shopgoodwillimages.azureedge.net/production/115/Items/2026-09-16/14dd9734waii_09161.jpg", "https://shopgoodwillimages.azureedge.net/production/115/Items/2026-09-16/98cf3521waii_09162.jpg"]);
  assert.equal(r.bids, 7);
  assert.equal(r.price, "$12.50");
  assert.ok(r.time_left);
  assert.equal(r.description, "<p><strong>Figures</strong></p><p>Good</p>");
  assert.equal(r.gone, undefined);
});

test("ShopGoodwill: an expired auction is gone", async () => {
  const { itemSgw } = load({ fetch: async () => resp(200, { itemId: 1, title: "x", isAuction: true, endTime: "2026-10-01T10:00:00", isItemEndTimeExpire: true, imageUrlString: "" }) });
  assert.equal((await itemSgw("1")).gone, true);
});

test("Salvation Army: the listing's own photos (not similar listings), price, bids, words, no bidder names", () => {
  const { salvationItem } = load();
  const r = salvationItem(LISTING, { id: "588443092", slug: "SEALED-Bluray-Lot-40-Titles-B2516" });
  assert.equal(r.title, "SEALED Blu-ray Lot: 40 Titles [B2516]");
  assert.deepEqual(r.images.map((u) => u.slice(-50)), [
    "/4963b99d-c4f6-4834-a0f5-61f1f36de4c6_largesize.jpg".slice(-50),
    "/1f367e45-a876-49bc-9b00-81e3e1d6ab4b_largesize.jpg".slice(-50),
    "/d60e60fa-63e8-4d75-a668-a6d481eea776_largesize.jpg".slice(-50)]);
  assert.equal(r.price, "$61.00", "the current price, not the quick-bid amount");
  assert.equal(r.bids, 6);
  assert.equal(r.time_left, "7h 24m");
  assert.match(r.description, /genres &amp; include La La Land/);
  assert.doesNotMatch(JSON.stringify(r), /somebody|HighBidder/);
});

test("/item: bad URLs refused, cache hit skips the source, errors are not cached, results are", async () => {
  const store = new Map();
  const PCACHE = { match: async (k) => (store.has(k.url) ? { json: async () => store.get(k.url) } : null), put: async (k, res) => { store.set(k.url, JSON.parse(await res.text())); } };
  let calls = 0;
  const L = load({ PCACHE, fetch: async () => { calls++; return resp(200, { itemId: 555, title: "Lamp", isAuction: false, currentPrice: 3, imageUrlString: "" }); } });
  const req = { headers: { get: () => "1.2.3.4" } };
  const call = (u) => L.itemRoute({}, new URL("https://w.example/item?url=" + encodeURIComponent(u)), "o", req);
  assert.equal((await call("https://www.etsy.com/listing/1")).status, 400);
  const a = await call("https://shopgoodwill.com/item/555");
  assert.equal(a.body.title, "Lamp");
  assert.equal(a.body.src, "shopgoodwill");
  const b = await call("https://shopgoodwill.com/item/555");
  assert.equal(b.extra["X-Prowl-Cache"], "hit");
  assert.equal(calls, 1, "fetched once");
  const L2 = load({ PCACHE, fetch: async () => resp(500, "") });
  const e = await L2.itemRoute({}, new URL("https://w.example/item?url=" + encodeURIComponent("https://shopgoodwill.com/item/666")), "o", req);
  assert.equal(e.status, 502);
  assert.ok(!store.has("https://prowl-verdicts.invalid/item2/shopgoodwill/666"));
});

test("/item: the per-visitor cap answers 429 before any source is asked", async () => {
  let calls = 0;
  const L = load({ PCACHE: { match: async () => null, put: async () => {} }, vCount: async () => false, fetch: async () => { calls++; return resp(200, {}); } });
  const r = await L.itemRoute({}, new URL("https://w.example/item?url=" + encodeURIComponent("https://shopgoodwill.com/item/555")), "o", { headers: { get: () => "ip" } });
  assert.equal(r.status, 429);
  assert.equal(calls, 0);
});

test("/item is wired and measured", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/item"\) \{   \/\* v81/);
  assert.equal(routeKey("/item"), "item:popup");
});
