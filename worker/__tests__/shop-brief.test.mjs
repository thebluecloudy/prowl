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
  assert.equal(calls.length, 2);
  assert.ok(kv.has("shopbrief:" + detroitDay(NOW)));
  const again = await shopBrief({}, deps, NOW, false);
  assert.equal(again.cached, true); assert.equal(calls.length, 2);
});
