/* v169 Saved forever says when a listing is over (Matt: "build the sold and ended check next").
   Run: node --test worker/__tests__/saved-ended-v169.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../saved.js";

const H = 3600000, NOW = Date.UTC(2026, 9, 24, 12), DAYS = new Date(NOW).toISOString().slice(0, 10);
const find = (url, at, extra = {}) => ({ url, title: "Rookwood vase", price: "$40", image: "", src: "", hunt: "", at, ...extra });
const EBAY = "https://www.ebay.com/itm/123456789012", SGW = "https://shopgoodwill.com/item/2345678", ETSY = "https://www.etsy.com/listing/123456789/vase",
  SALV = "https://shopthesalvationarmy.com/Listing/Details/123456/vase", CHAIRISH = "https://www.chairish.com/product/1/vase";

test("what each marketplace's answer means", () => {
  assert.equal(S.savedEndFrom("ebay", { error: "ebay 500" }, NOW), null, "could not tell: look again tomorrow");
  assert.equal(S.savedEndFrom("ebay", { title: "x" }, NOW), "live");
  assert.deepEqual(S.savedEndFrom("ebay", { gone: true }, NOW), { st: "ended", at: DAYS }, "eBay never gives an ended listing's price");
  assert.deepEqual(S.savedEndFrom("shopgoodwill", { gone: true, bids: 7, price: "$61.00" }, NOW), { st: "sold", at: DAYS, p: "$61.00" });
  assert.deepEqual(S.savedEndFrom("shopgoodwill", { gone: true, bids: 0, price: "$9.99" }, NOW), { st: "ended", at: DAYS }, "no bids: ended, not sold");
  assert.deepEqual(S.savedEndFrom("shopgoodwill", { gone: true }, NOW), { st: "ended", at: DAYS }, "a 404 is ended");
  assert.deepEqual(S.savedEndFrom("salvation", { gone: true, bids: 2, price: "$20.00" }, NOW), { st: "sold", at: DAYS, p: "$20.00" });
  assert.deepEqual(S.savedEndFrom("etsy", { gone: true, state: "sold_out", price: "$45.00" }, NOW), { st: "sold", at: DAYS, p: "$45.00" });
  assert.deepEqual(S.savedEndFrom("etsy", { gone: true, state: "expired", price: "$45.00" }, NOW), { st: "ended", at: DAYS });
});

test("the finds to look at: not over, a marketplace Prowl reads, not looked at today, the longest unchecked first", () => {
  const list = [find(EBAY, 1, { ck: NOW - 30 * H }), find(SGW, 2), find(ETSY, 3, { ck: NOW - 2 * H }), find(SALV, 4, { end: { st: "ended", at: "2026-10-01" } }), find(CHAIRISH, 5)];
  assert.deepEqual(S.savedDue(list, NOW, 10).map((f) => f.url), [SGW, EBAY]);
  assert.deepEqual(S.savedDue(list, NOW, 1).map((f) => f.url), [SGW]);
  assert.equal(S.savedSrc(CHAIRISH), "");
  assert.ok(S.savedListDue({ saved: [find(EBAY, 1)] }, NOW));
  assert.ok(!S.savedListDue({ saved: [find(EBAY, 1)], ckd: NOW - 3 * H }, NOW), "looked at 3 hours ago");
  assert.ok(!S.savedListDue({ saved: [] }, NOW));
});

test("an end and a check time come only from the stored copy, and survive every merge", () => {
  const end = { st: "sold", at: "2026-10-20", p: "$61.00" };
  const m = S.savedMerge({ saved: [find(SGW, NOW - 5, { end, ck: NOW - 9 })], ckd: NOW - 9 }, { saved: [find(SGW, NOW - 1, { end: { st: "sold", at: "2026-10-21", p: "$1" } }), find(EBAY, NOW - 2, { end, ck: 5 })] }, NOW);
  const sgw = m.saved.find((f) => f.url === SGW), ebay = m.saved.find((f) => f.url === EBAY);
  assert.deepEqual(sgw.end, end, "the device's newer copy keeps the stored end, not its own");
  assert.equal(sgw.ck, NOW - 9);
  assert.equal(ebay.end, undefined, "a device cannot say a listing is over");
  assert.equal(m.ckd, NOW - 9);
  assert.equal(S.savedEnd({ st: "ended", at: "2026-10-20", p: "$9" }).p, undefined, "only a sale has a price");
  assert.equal(S.savedEnd({ st: "gone", at: "2026-10-20" }), null);
});

/* ---- the clock's check, from index.js ---- */
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
class FakeKV {
  constructor() { this.m = new Map(); this.puts = 0; }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.puts++; this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
function setup(answers) {
  const kv = new FakeKV(), asked = [];
  const reader = (src) => async (id) => { asked.push(src + ":" + (id && id.id ? id.id : id)); const a = answers[src]; if (a instanceof Error) throw a; return a; };
  const deps = {
    ...S, kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; }, kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)),
    itemEbay: reader("ebay"), itemEtsy: reader("etsy"), itemSgw: reader("shopgoodwill"), itemSalvation: reader("salvation"),
  };
  const names = ["itemRef", "savedRead", "savedCheckTick"], keys = Object.keys(deps);
  const W = new Function(...keys, names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { W, kv, env: { PROWL_ALERTS: kv }, asked };
}

test("one run looks at the next member's list, marks what is over, and writes once", async () => {
  const { W, kv, env, asked } = setup({ shopgoodwill: { gone: true, bids: 4, price: "$61.00" }, ebay: { title: "still for sale" }, etsy: { gone: true, state: "expired" }, salvation: new Error("timeout") });
  kv.set("saved:all", ["a@b.co"]);
  kv.set("saved:a@b.co", { saved: [find(SGW, NOW - 4), find(EBAY, NOW - 3), find(ETSY, NOW - 2), find(SALV, NOW - 1), find(CHAIRISH, NOW)], gone: [] });
  const puts = kv.puts;
  const r = await W.savedCheckTick(env, NOW);
  assert.deepEqual(r, { checked: 4, ended: 2 });
  assert.deepEqual(asked.sort(), ["ebay:123456789012", "etsy:123456789", "salvation:123456", "shopgoodwill:2345678"]);
  const L = kv.json("saved:a@b.co"), by = (u) => L.saved.find((f) => f.url === u);
  assert.deepEqual(by(SGW).end, { st: "sold", at: DAYS, p: "$61.00" });
  assert.deepEqual(by(ETSY).end, { st: "ended", at: DAYS });
  assert.equal(by(EBAY).end, undefined, "still for sale");
  assert.equal(by(SALV).end, undefined, "a reader that failed says nothing");
  assert.equal(by(SALV).ck, NOW, "and is looked at again tomorrow");
  assert.equal(by(CHAIRISH).ck, undefined, "a marketplace Prowl cannot read is left alone");
  assert.equal(L.ckd, NOW);
  assert.equal(kv.puts - puts, 1, "one write");
  /* the next run, minutes later: the list is not due */
  assert.deepEqual(await W.savedCheckTick(env, NOW + 5 * 60000), { checked: 0 });
  /* a day later: only what is not over yet */
  asked.length = 0;
  await W.savedCheckTick(env, NOW + 21 * H);
  assert.deepEqual(asked.sort(), ["ebay:123456789012", "salvation:123456"]);
});

test("no members, or none due: nothing is read or written", async () => {
  const { W, kv, env, asked } = setup({});
  assert.deepEqual(await W.savedCheckTick(env, NOW), { checked: 0 });
  kv.set("saved:all", ["a@b.co"]);
  kv.set("saved:a@b.co", { saved: [find(EBAY, NOW)], gone: [], ckd: NOW - H });
  const puts = kv.puts;
  assert.deepEqual(await W.savedCheckTick(env, NOW), { checked: 0 });
  assert.equal(kv.puts, puts);
  assert.equal(asked.length, 0);
});

test("wired: the clock runs it, Etsy passes its state, the page gets the end but not the check time, v169", () => {
  assert.match(INDEX, /try \{ await savedCheckTick\(env\); \}/);
  assert.match(INDEX, /out\.gone = true; out\.state = String\(j\.state\)/);
  assert.match(INDEX, /delete o\.ck; out\.push\(o\);/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 169, "v169 or later");
});
