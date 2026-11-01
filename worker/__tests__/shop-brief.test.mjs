/* v212: the admin's morning briefing. Run: node --test worker/__tests__/shop-brief.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefStats, briefNotes, briefFallback, briefPrompt, shopBrief, detroitDay } from "../shop-brief.js";

const NOW = Date.parse("2026-11-01T16:00:00Z");
const ago = d => new Date(NOW - d * 86400000).toISOString();
const li = (title, amt, type) => ({ title, discountedTotalSet: { shopMoney: { amount: String(amt) } }, product: type === undefined ? null : { productType: type } });
const ord = (d, lines, x) => Object.assign({ createdAt: ago(d), cancelledAt: null, test: false, lineItems: { nodes: lines } }, x || {});

test("stats: 30 days against the 30 before, yesterday, categories; Pro, cancelled and test orders left out", () => {
  const s = briefStats([
    ord(1, [li("Blenko vase", 100, "Vases")]),
    ord(5, [li("Viking ashtray", 50, "Kitchen & Dining"), li("Prowl Pro", 7, "Digital Subscription")]),
    ord(3, [li("Prowl Pro", 7, "Digital Subscription")]),
    ord(2, [li("Haeger vase", 40, "Vases")], { cancelledAt: ago(1) }),
    ord(2, [li("Test", 999, "Vases")], { test: true }),
    ord(40, [li("Old decanter", 60, "Barware")]),
    ord(70, [li("Too old", 500, "Vases")])
  ], NOW);
  assert.equal(s.sales30, 150); assert.equal(s.orders30, 2);
  assert.equal(s.salesPrev, 60); assert.equal(s.ordersPrev, 1);
  assert.equal(s.salesChange, 150);
  assert.equal(s.salesYday, 100); assert.equal(s.ordersYday, 1);
  assert.equal(s.daysSinceOrder, 1);
  assert.deepEqual(s.categories, [{ type: "Vases", sales: 100, items: 1 }, { type: "Kitchen & Dining", sales: 50, items: 1 }]);
  assert.equal(s.week.length, 2);
  assert.equal(s.typesKnown, true);
});

test("stats without product types say so", () => {
  const s = briefStats([ord(1, [{ title: "Vase", discountedTotalSet: { shopMoney: { amount: "10" } } }])], NOW);
  assert.equal(s.typesKnown, false);
  assert.equal(s.categories[0].type, "Other");
});

test("notes: three from the model's JSON, else null; fallback always gives three", () => {
  const ok = briefNotes('Here: [{"kind":"Top performers","text":"A"},{"kind":"Slow movers","text":"B"},{"kind":"Buy","text":"C"}]');
  assert.equal(ok.length, 3); assert.equal(ok[1].text, "B");
  assert.equal(briefNotes("no json"), null);
  assert.equal(briefNotes('[{"kind":"x","text":"only one"}]'), null);
  const s = briefStats([], NOW);
  const f = briefFallback(s);
  assert.equal(f.length, 3); assert.match(f[0].text, /No sales yesterday/);
  assert.match(briefPrompt(s), /JSON array/);
});

test("shopBrief: cached per Detroit day; falls back without read_products; uses the fallback when the AI fails", async () => {
  const kv = new Map(), calls = [];
  const deps = {
    kvGet: async (e, k) => kv.has(k) ? kv.get(k) : null, kvPut: async (e, k, v) => { kv.set(k, v); },
    gql: async (e, q) => { calls.push(q); if (q.includes("productType")) return { errors: [{ message: "Access denied for product field" }] };
      return { data: { orders: { pageInfo: { hasNextPage: false }, nodes: [ord(1, [{ title: "Vase", discountedTotalSet: { shopMoney: { amount: "25" } } }])] } } }; },
    ai: async () => ({ status: 500, content: "" })
  };
  const b = await shopBrief({}, deps, NOW, false);
  assert.equal(b.ai, false); assert.equal(b.notes.length, 3); assert.equal(b.stats.sales30, 25);
  assert.equal(calls.filter(q => !q.includes("shopifyqlQuery")).length, 2);
  assert.ok(kv.has("shopbrief2:" + detroitDay(NOW)));
  const again = await shopBrief({}, deps, NOW, false);
  assert.equal(again.cached, true); assert.equal(calls.filter(q => !q.includes("shopifyqlQuery")).length, 2);
});

import { siteStats, pageKind, pageName, siteVisits } from "../shop-brief.js";
test("v215: site visits: kinds, guide names, weeks in order, referrers", () => {
  assert.equal(pageKind("/blogs/guides/hen-on-nest-collectors-guide"), "guide");
  assert.equal(pageKind("/blogs/guides"), "guides list");
  assert.equal(pageKind("/products/x"), "product"); assert.equal(pageKind("/pages/prowl-app"), "prowl"); assert.equal(pageKind("/"), "home");
  assert.equal(pageName("/blogs/guides/hen-on-nest-collectors-guide"), "Hen on nest collectors guide");
  const s = siteStats(
    [{ week: "2026-10-26", sessions: "648", online_store_visitors: "547", sessions_with_cart_additions: "3", sessions_that_completed_checkout: "0" },
     { week: "2026-10-19", sessions: "675", online_store_visitors: "507", sessions_with_cart_additions: "2", sessions_that_completed_checkout: "0" }],
    [{ landing_page_path: "/pages/prowl-app", sessions: "355", online_store_visitors: "16", sessions_with_cart_additions: "2" },
     { landing_page_path: "/blogs/guides/hen-on-nest-collectors-guide", sessions: "235", online_store_visitors: "192", sessions_with_cart_additions: "0" },
     { landing_page_path: "/products/lamp", sessions: "70", online_store_visitors: "70", sessions_with_cart_additions: "0" }],
    [{ referrer_source: "search", referrer_name: "google", sessions: "765" }, { referrer_source: "direct", referrer_name: "", sessions: "1531" }]);
  assert.equal(s.thisWeek.week, "2026-10-26"); assert.equal(s.lastWeek.visits, 675);
  assert.equal(s.visits30, 660);
  assert.deepEqual(s.guides, [{ name: "Hen on nest collectors guide", path: "/blogs/guides/hen-on-nest-collectors-guide", visits: 235, carts: 0 }]);
  assert.equal(s.kinds[0].kind, "prowl");
  assert.equal(s.refs[0].from, "google"); assert.equal(s.refs[1].from, "direct");
});
test("v215: siteVisits throws an access error that shopBrief turns into needs read_reports", async () => {
  const deps = { gql: async () => ({ errors: [{ message: "Access denied for shopifyqlQuery field. Required access: `read_reports`" }] }) };
  await assert.rejects(siteVisits({}, deps), (e) => e.access === true);
  const kv = new Map();
  const b = await shopBrief({}, { kvGet: async () => null, kvPut: async (e, k, v) => kv.set(k, v),
    gql: async (e, q) => q.includes("shopifyqlQuery") ? { errors: [{ message: "Access denied, read_reports" }] } : { data: { orders: { pageInfo: { hasNextPage: false }, nodes: [] } } } }, NOW, false);
  assert.equal(b.siteErr, "needs read_reports"); assert.equal(b.stats.site, null);
});
