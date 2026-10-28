import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routeKey, hourKey, HIST_EDGES, histIndex, pctFromHist, emptyAgg, addToAgg, mergeAgg,
  MetricsBuffer, metricsOp, metricsPrune, summarize, uptimeFrom,
} from "../metrics.js";

/* Durable Object storage stand-in: Map-backed, values structured-cloned like the real thing,
   list() honours prefix/start (inclusive)/end (exclusive)/reverse/limit and returns a key-sorted Map,
   and delete() refuses more than 128 keys at once just as Cloudflare does. */
class FakeStorage {
  constructor(init) { this.m = new Map(); this.deletes = 0; if (init) for (const k in init) this.m.set(k, structuredClone(init[k])); }
  async get(key) { return this.m.has(key) ? structuredClone(this.m.get(key)) : undefined; }
  async put(key, value) { this.m.set(key, structuredClone(value)); }
  async delete(keys) {
    if (Array.isArray(keys)) {
      if (keys.length > 128) throw new Error("delete: more than 128 keys");
      this.deletes++;
      let n = 0; for (const k of keys) if (this.m.delete(k)) n++;
      return n;
    }
    this.deletes++;
    return this.m.delete(keys);
  }
  async list(o = {}) {
    let ks = Array.from(this.m.keys()).sort();
    if (o.prefix) ks = ks.filter(k => k.startsWith(o.prefix));
    if (o.start != null) ks = ks.filter(k => k >= o.start);
    if (o.end != null) ks = ks.filter(k => k < o.end);
    if (o.reverse) ks.reverse();
    if (o.limit != null) ks = ks.slice(0, o.limit);
    return new Map(ks.map(k => [k, structuredClone(this.m.get(k))]));
  }
  keys(prefix) { return Array.from(this.m.keys()).filter(k => k.startsWith(prefix)).sort(); }
}

const H = 3600000, D = 86400000;
const NOW = Date.parse("2026-10-05T21:30:00Z");
const hist = arr => { const h = [0, 0, 0, 0, 0, 0, 0, 0]; arr.forEach((v, i) => { h[i] = v; }); return h; };
const agg = o => Object.assign(emptyAgg(), o, { h: hist(o.h || []) });

/* ---------- FakeStorage itself, so the tests below can trust it ---------- */
test("FakeStorage list honours prefix, start, end, reverse and limit", async () => {
  const s = new FakeStorage({ "a:3": 3, "a:1": 1, "a:2": 2, "b:1": 9 });
  assert.deepEqual([...(await s.list({ prefix: "a:" })).keys()], ["a:1", "a:2", "a:3"]);
  assert.deepEqual([...(await s.list({ prefix: "a:", start: "a:2" })).keys()], ["a:2", "a:3"]);
  assert.deepEqual([...(await s.list({ prefix: "a:", end: "a:3" })).keys()], ["a:1", "a:2"]);
  assert.deepEqual([...(await s.list({ prefix: "a:", reverse: true, limit: 2 })).keys()], ["a:3", "a:2"]);
  await assert.rejects(s.delete(new Array(129).fill("x")));
  const v = { x: [1] }; await s.put("o", v); v.x.push(2);
  assert.deepEqual(await s.get("o"), { x: [1] });   /* stored copies do not alias */
});

/* ---------- routes ---------- */
test("routeKey maps every documented path", () => {
  const table = {
    "/": "live:shopgoodwill", "/ebay": "live:ebay", "/etsy": "live:etsy", "/chairish": "live:chairish",
    "/poshmark": "live:poshmark", "/poshsold": "live:poshsold", "/depop": "live:depop", "/vinted": "live:vinted",
    "/grailed": "live:grailed", "/hibid": "live:hibid",
    "/verdict": "ai:fairprice", "/appraise": "ai:photo", "/research": "ai:research", "/guide": "ai:guide",
    "/where": "ai:where", "/hunt-check": "ai:huntcheck", "/shop-picks": "shop:picks",
    "/proxy": "store:login", "/proxy/login": "store:login", "/proxy/me": "store:login",
    "/alerts/nope": "alerts:other", "/alerts": "alerts:other", "/alerts/": "alerts:other", "/alerts/in/extra": "alerts:other",
    "/nothing-here": "other", "/ebay/": "other", "/proxyx": "other", "/me": "other",
  };
  for (const n of ["subscribe", "confirm", "signin", "in", "status", "prefs", "mail", "delete", "move", "move-confirm", "unsub", "test", "gift", "giftstop", "likes", "redeem", "signout-others"]) table["/alerts/" + n] = "alerts:" + n;
  for (const [p, want] of Object.entries(table)) assert.equal(routeKey(p), want, p);
});

test("routeKey never records admin, diagnostics, favicon or robots", () => {
  for (const p of ["/admin", "/admin/", "/admin/api/overview", "/admin/login", "/__selftest", "/__alerts-why", "/favicon.ico", "/robots.txt"]) {
    assert.equal(routeKey(p), null, p);
  }
});

test("hourKey is the UTC hour", () => {
  assert.equal(hourKey(NOW), "2026-10-05T21");
  assert.equal(hourKey(Date.parse("2026-10-05T23:59:59.999Z") + 1), "2026-10-06T00");
});

/* ---------- histogram ---------- */
test("histIndex bucket edges", () => {
  assert.deepEqual(HIST_EDGES, [100, 250, 500, 1000, 2000, 4000, 8000]);
  const cases = [[0, 0], [99, 0], [99.9, 0], [100, 1], [249, 1], [250, 2], [499, 2], [500, 3], [999, 3], [1000, 4], [1999, 4],
    [2000, 5], [3999, 5], [4000, 6], [7999, 6], [8000, 7], [120000, 7], [Infinity, 7], [-5, 0], [NaN, 0], [undefined, 0], ["300", 2]];
  for (const [ms, i] of cases) assert.equal(histIndex(ms), i, String(ms));
});

test("pctFromHist answers the upper edge of the bucket holding the rank", () => {
  assert.equal(pctFromHist(hist([]), 0.5), 0);
  assert.equal(pctFromHist([], 0.95), 0);
  assert.equal(pctFromHist(null, 0.95), 0);
  assert.equal(pctFromHist(hist([10]), 0.5), 100);
  assert.equal(pctFromHist(hist([10]), 0.95), 100);
  /* 50 fast, 40 medium, 10 slow */
  const h = hist([50, 0, 0, 40, 0, 0, 0, 10]);
  assert.equal(pctFromHist(h, 0.5), 100);    /* rank 50 is the last of bucket 0 */
  assert.equal(pctFromHist(h, 0.51), 1000);  /* rank 51 is in bucket 3 (500..999) */
  assert.equal(pctFromHist(h, 0.9), 1000);
  assert.equal(pctFromHist(h, 0.95), 8000);  /* "8000+" */
  assert.equal(pctFromHist(h, 1), 8000);
  assert.equal(pctFromHist(h, 0), 100);      /* rank 1: the fastest bucket with anything in it */
  assert.equal(pctFromHist(hist([0, 0, 3]), 0), 500);
  /* 60 requests, p95 = rank 57 exactly (floating point must not push it to 58) */
  assert.equal(pctFromHist(hist([57, 3]), 0.95), 100);
  assert.equal(pctFromHist(hist([56, 4]), 0.95), 250);
  assert.equal(pctFromHist(hist([1, 1]), 5), 250);   /* p clamps to 1 */
});

/* ---------- aggregates ---------- */
test("addToAgg classifies status, cache hits, duration and histogram", () => {
  const a = emptyAgg();
  assert.deepEqual(a, { n: 0, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [0, 0, 0, 0, 0, 0, 0, 0] });
  addToAgg(a, { r: "live:ebay", s: 200, ms: 50, hit: true });
  addToAgg(a, { r: "live:ebay", s: 304, ms: 120, hit: false });
  addToAgg(a, { r: "live:ebay", s: 404, ms: 300 });
  addToAgg(a, { r: "live:ebay", s: 429, ms: 5 });
  addToAgg(a, { r: "live:ebay", s: 502, ms: 9000 });
  addToAgg(a, { r: "live:ebay", s: 500, ms: 2500.6 });
  assert.deepEqual(a, { n: 6, hit: 1, e4: 1, e5: 2, lim: 1, ms: 50 + 120 + 300 + 5 + 9000 + 2501, h: [2, 1, 1, 0, 0, 1, 0, 1] });
});

test("mergeAgg adds into the first aggregate and tolerates missing parts", () => {
  const a = agg({ n: 2, hit: 1, ms: 300, h: [1, 1] });
  const out = mergeAgg(a, agg({ n: 3, e5: 1, e4: 1, lim: 1, ms: 700, h: [0, 0, 3] }));
  assert.equal(out, a);
  assert.deepEqual(a, { n: 5, hit: 1, e4: 1, e5: 1, lim: 1, ms: 1000, h: [1, 1, 3, 0, 0, 0, 0, 0] });
  assert.deepEqual(mergeAgg(undefined, { n: 1, h: [1] }), { n: 1, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [1, 0, 0, 0, 0, 0, 0, 0] });
  assert.deepEqual(mergeAgg({ n: 4 }, { n: 1, ms: "bad", h: "nope" }), { n: 5, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [0, 0, 0, 0, 0, 0, 0, 0] });
  assert.deepEqual(mergeAgg(emptyAgg(), null), emptyAgg());
});

/* ---------- worker-side buffer ---------- */
test("MetricsBuffer flushes after maxEvents", () => {
  const b = new MetricsBuffer({ maxEvents: 3, maxAgeMs: 60000 });
  assert.equal(b.add({ r: "live:ebay", s: 200, ms: 10 }, NOW), false);
  assert.equal(b.add({ r: "live:ebay", s: 200, ms: 10 }, NOW + 1), false);
  assert.equal(b.add({ r: "live:etsy", s: 200, ms: 10 }, NOW + 2), true);
  assert.ok(b.drain());
  assert.equal(b.add({ r: "live:ebay", s: 200, ms: 10 }, NOW + 3), false);   /* count starts again after a drain */
});

test("MetricsBuffer flushes once the oldest un-drained event is maxAgeMs old", () => {
  const b = new MetricsBuffer();   /* defaults: 20 events / 30 s */
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW), false);
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW + 29999), false);
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW + 30000), true);
  b.drain();
  /* the age clock restarts from the first event after the drain, not from the old one */
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW + 50000), false);
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW + 79999), false);
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW + 80000), true);
});

test("MetricsBuffer default maxEvents is 20", () => {
  const b = new MetricsBuffer();
  let due = false;
  for (let i = 0; i < 19; i++) due = b.add({ r: "other", s: 200, ms: 1 }, NOW);
  assert.equal(due, false);
  assert.equal(b.add({ r: "other", s: 200, ms: 1 }, NOW), true);
});

test("MetricsBuffer drain shape: hour|route aggregates plus queued 5xx errors, then empty", () => {
  const b = new MetricsBuffer({ maxErrors: 2 });
  const t0 = Date.parse("2026-10-05T21:59:59Z"), t1 = t0 + 2000;   /* straddles the hour */
  b.add({ r: "live:ebay", s: 200, ms: 120, hit: true }, t0);
  b.add({ r: "live:ebay", s: 502, ms: 3000, err: "x".repeat(200), q: "ceramic panther" }, t0);
  b.add({ r: "live:ebay", s: 503, ms: 50, err: "boom" }, t1);
  b.add({ r: "ai:fairprice", s: 500, ms: 50 }, t1);   /* third error: counted, message dropped */
  b.add({ r: null, s: 200, ms: 1 }, t1);              /* unrecorded routes are ignored */
  const out = b.drain();
  assert.deepEqual(Object.keys(out).sort(), ["b", "e"]);
  assert.deepEqual(Object.keys(out.b).sort(), ["2026-10-05T21|live:ebay", "2026-10-05T22|ai:fairprice", "2026-10-05T22|live:ebay"]);
  assert.deepEqual(out.b["2026-10-05T21|live:ebay"], { n: 2, hit: 1, e4: 0, e5: 1, lim: 0, ms: 3120, h: [0, 1, 0, 0, 0, 1, 0, 0] });
  assert.equal(out.b["2026-10-05T22|ai:fairprice"].e5, 1);
  assert.equal(out.e.length, 2);
  assert.deepEqual(out.e[0], { t: t0, r: "live:ebay", s: 502, m: "x".repeat(160), q: "ceramic panther" });
  assert.deepEqual(out.e[1], { t: t1, r: "live:ebay", s: 503, m: "boom", q: "" });
  assert.equal(b.drain(), null);
  assert.equal(new MetricsBuffer().drain(), null);
});

/* ---------- Durable Object ops ---------- */
test("mrec merges hourly aggregates into x: keys", async () => {
  const s = new FakeStorage();
  const r = await metricsOp(s, "mrec", { b: { "2026-10-05T21|live:ebay": agg({ n: 2, hit: 1, ms: 200, h: [1, 1] }) } }, NOW);
  assert.deepEqual(r, { ok: true });
  await metricsOp(s, "mrec", { b: { "2026-10-05T21|live:ebay": agg({ n: 1, e5: 1, ms: 9000, h: [0, 0, 0, 0, 0, 0, 0, 1] }), "2026-10-05T21|other": agg({ n: 1, h: [1] }) } }, NOW);
  assert.deepEqual(await s.get("x:2026-10-05T21|live:ebay"), { n: 3, hit: 1, e4: 0, e5: 1, lim: 0, ms: 9200, h: [1, 1, 0, 0, 0, 0, 0, 1] });
  assert.equal((await s.get("x:2026-10-05T21|other")).n, 1);
  /* malformed keys are skipped rather than stored under odd names */
  await metricsOp(s, "mrec", { b: { "bad": agg({ n: 1 }), "2026-10-05T21|Has Space": agg({ n: 1 }), "2026-10-05|live:ebay": agg({ n: 1 }) } }, NOW);
  assert.deepEqual(s.keys("x:"), ["x:2026-10-05T21|live:ebay", "x:2026-10-05T21|other"]);
});

test("mrec stores errors under padded time keys and keeps the newest 500", async () => {
  const s = new FakeStorage({ "c:all": 7, "n:t:2026-10-05:lamp": { v: 1, r: 1 } });
  await metricsOp(s, "mrec", { e: [{ t: NOW, r: "live:ebay", s: 502, m: "upstream 503", q: "lamp", extra: "dropped" }] }, NOW);
  const [k] = s.keys("y:");
  assert.match(k, /^y:\d{13}:[0-9a-f]{4}$/);
  assert.equal(k.slice(2, 15), String(NOW).padStart(13, "0"));
  assert.deepEqual(await s.get(k), { t: NOW, r: "live:ebay", s: 502, m: "upstream 503", q: "lamp" });
  /* 520 more, in batches like the worker sends them */
  for (let i = 0; i < 26; i++) {
    await metricsOp(s, "mrec", { e: Array.from({ length: 20 }, (_, j) => ({ t: NOW + 1000 + i * 20 + j, r: "other", s: 500, m: "m" + (i * 20 + j) })) }, NOW);
  }
  const ys = s.keys("y:");
  assert.equal(ys.length, 500);
  /* the oldest 21 are gone: the first one plus m0..m19 */
  const oldest = await s.get(ys[0]);
  assert.equal(oldest.m, "m20");
  assert.equal((await s.get(ys[499])).m, "m519");
  /* Caps' own keys are untouched */
  assert.equal(await s.get("c:all"), 7);
  assert.ok(await s.get("n:t:2026-10-05:lamp"));
});

test("mrec stores cron runs (cap 400) with at most five short error strings", async () => {
  const s = new FakeStorage();
  await metricsOp(s, "mrec", { c: { t: NOW, ms: 4200, members: 12, checked: 30, sent: 3, failed: 1, errors: ["a", "b", "c", "d", "e", "f", "y".repeat(300)], email: "x@y.z" } }, NOW);
  const v = await s.get("z:" + String(NOW).padStart(13, "0"));
  assert.deepEqual(v, { t: NOW, ms: 4200, members: 12, checked: 30, sent: 3, failed: 1, errors: ["a", "b", "c", "d", "e"] });
  for (let i = 1; i <= 410; i++) await metricsOp(s, "mrec", { c: { t: NOW + i * 300000, sent: i } }, NOW);
  const zs = s.keys("z:");
  assert.equal(zs.length, 400);
  assert.equal((await s.get(zs[0])).sent, 11);    /* run 0 (the first) and runs 1..10 trimmed */
  assert.equal((await s.get(zs[399])).sent, 410);
});

test("mrec stores one probe per source per hour; a later one overwrites", async () => {
  const s = new FakeStorage();
  const t = Date.parse("2026-10-05T21:05:00Z");
  await metricsOp(s, "mrec", { p: [
    { t: t, source: "ebay", ok: true, status: 200, n: 40, ms: 800, err: "" },
    { t: t, source: "etsy", ok: false, status: 503, n: 0, ms: 1200, err: "upstream 503" },
    { t: t, source: "Bad Source!", ok: true },
  ] }, NOW);
  await metricsOp(s, "mrec", { p: [{ t: t + 20 * 60000, source: "etsy", ok: true, status: 200, n: 12, ms: 600 }] }, NOW);
  await metricsOp(s, "mrec", { p: [{ t: t + H, source: "etsy", ok: true, status: 200, n: 11, ms: 500 }] }, NOW);
  assert.deepEqual(s.keys("p:"), ["p:2026-10-05T21|ebay", "p:2026-10-05T21|etsy", "p:2026-10-05T22|etsy"]);
  assert.deepEqual(await s.get("p:2026-10-05T21|etsy"), { t: t + 20 * 60000, source: "etsy", ok: true, status: 200, n: 12, ms: 600, err: "" });
});

test("mrec stores admin audit entries (cap 300) by allowlist", async () => {
  const s = new FakeStorage();
  await metricsOp(s, "mrec", { a: [{ t: NOW, action: "mail-off", id: "M-1234abcd", ok: true, note: "emails turned off", email: "pii@example.com" }] }, NOW);
  const [k] = s.keys("a:");
  assert.match(k, /^a:\d{13}:[0-9a-f]{4}$/);
  assert.deepEqual(await s.get(k), { t: NOW, action: "mail-off", id: "M-1234abcd", ok: true, note: "emails turned off" });
  for (let i = 0; i < 7; i++) await metricsOp(s, "mrec", { a: Array.from({ length: 50 }, (_, j) => ({ t: NOW + 1 + i * 50 + j, action: "login", ok: false, note: String(i * 50 + j) })) }, NOW);
  const as = s.keys("a:");
  assert.equal(as.length, 300);
  assert.equal((await s.get(as[0])).note, "50");   /* 351 written: the first entry and notes 0..49 trimmed */
  assert.equal((await s.get(as[299])).note, "349");
  /* one call stores at most 50 entries */
  const one = new FakeStorage();
  await metricsOp(one, "mrec", { a: Array.from({ length: 80 }, (_, j) => ({ t: NOW + j, action: "x", note: String(j) })) }, NOW);
  assert.equal(one.keys("a:").length, 50);
});

test("mrec with nothing in it is a harmless no-op", async () => {
  const s = new FakeStorage();
  assert.deepEqual(await metricsOp(s, "mrec", {}, NOW), { ok: true });
  assert.deepEqual(await metricsOp(s, "mrec", null, NOW), { ok: true });
  assert.deepEqual(await metricsOp(s, "mrec", { e: [], a: [], p: [] }, NOW), { ok: true });
  assert.equal(s.m.size, 0);
});

async function seeded() {
  const s = new FakeStorage({ "c:all": 3 });
  const b = {};
  for (let i = 0; i < 60; i++) b[hourKey(NOW - i * H) + "|live:ebay"] = agg({ n: 1, h: [1] });
  await metricsOp(s, "mrec", { b: b }, NOW);
  await metricsOp(s, "mrec", { e: Array.from({ length: 30 }, (_, i) => ({ t: NOW - (30 - i) * 60000, r: "other", s: 500, m: "e" + i })) }, NOW);
  for (let i = 0; i < 80; i++) await metricsOp(s, "mrec", { c: { t: NOW - (80 - i) * 300000, sent: i } }, NOW);
  for (let d = 0; d < 10; d++) await metricsOp(s, "mrec", { p: [{ t: NOW - d * D, source: "ebay", ok: d !== 2, status: 200, n: d, ms: 100 }] }, NOW);
  for (const half of [0, 30]) await metricsOp(s, "mrec", { a: Array.from({ length: 30 }, (_, i) => ({ t: NOW - (60 - half - i) * 1000, action: "find", ok: true, note: "n" + (half + i) })) }, NOW);
  return s;
}

test("mget defaults: 48 h of buckets, newest-first errors/crons/audit, 7 days of probes", async () => {
  const s = await seeded();
  const r = await metricsOp(s, "mget", {}, NOW);
  assert.deepEqual(Object.keys(r).sort(), ["audit", "buckets", "crons", "errors", "probes"]);
  assert.equal(r.buckets.length, 48);
  assert.deepEqual(r.buckets[0], { hour: hourKey(NOW - 47 * H), route: "live:ebay", n: 1, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [1, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(r.buckets[47].hour, "2026-10-05T21");
  assert.equal(r.errors.length, 30);
  assert.equal(r.errors[0].m, "e29");
  assert.equal(r.crons.length, 60);
  assert.equal(r.crons[0].sent, 79);
  assert.equal(r.crons[59].sent, 20);
  assert.equal(r.audit.length, 50);
  assert.equal(r.audit[0].note, "n59");
  /* probes from today back to 7 days ago (the hour exactly 7 days back is the cutoff, inclusive) */
  assert.deepEqual(r.probes.map(p => p.n), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(r.probes[7], { hour: "2026-10-05T21", source: "ebay", t: NOW, ok: true, status: 200, n: 0, ms: 100, err: "" });
});

test("mget honours explicit limits", async () => {
  const s = await seeded();
  const r = await metricsOp(s, "mget", { hours: 24, errors: 5, crons: 3, probeDays: 2, audit: 0 }, NOW);
  assert.equal(r.buckets.length, 24);
  assert.equal(r.buckets[0].hour, hourKey(NOW - 23 * H));
  assert.deepEqual(r.errors.map(e => e.m), ["e29", "e28", "e27", "e26", "e25"]);
  assert.deepEqual(r.crons.map(c => c.sent), [79, 78, 77]);
  assert.deepEqual(r.probes.map(p => p.n), [2, 1, 0]);
  assert.deepEqual(r.audit, []);
  /* silly values are clamped, not trusted */
  const big = await metricsOp(s, "mget", { hours: 1e9, errors: -4, crons: "x" }, NOW);
  assert.equal(big.buckets.length, 60);
  assert.deepEqual(big.errors, []);
  assert.equal(big.crons.length, 60);
});

test("peek reads Caps daily counters, missing as 0", async () => {
  const s = new FakeStorage({ "c:all": 42, "c:ap:all": 7, "v:all": 999 });
  assert.deepEqual(await metricsOp(s, "peek", { keys: ["all", "ap:all", "rs:all"] }, NOW), { values: { all: 42, "ap:all": 7, "rs:all": 0 } });
  assert.deepEqual(await metricsOp(s, "peek", {}, NOW), { values: {} });
  assert.equal(await s.get("c:all"), 42);   /* reading does not take one */
});

test("unknown op answers bad op", async () => {
  assert.deepEqual(await metricsOp(new FakeStorage(), "take", {}, NOW), { error: "bad op" });
  assert.deepEqual(await metricsOp(new FakeStorage(), undefined, {}, NOW), { error: "bad op" });
});

/* ---------- pruning ---------- */
test("metricsPrune deletes by age per prefix, in chunks, and counts what is left", async () => {
  const s = new FakeStorage({ "c:all": 1, "v:x": { v: 1, e: 0 }, "n:t:2020-01-01:lamp": { v: 1, r: 1 }, "s:t:2020-01-01:lamp:ab": 1, "m:t:2020-01-01": 1 });
  const put = (k, v) => s.put(k, v || {});
  const p13 = t => String(t).padStart(13, "0");
  /* x: 8 days by hour key: 200 old (forces more than one delete chunk), 2 fresh */
  for (let i = 0; i < 200; i++) await put("x:" + hourKey(NOW - 9 * D - i * H) + "|other");
  await put("x:" + hourKey(NOW - 8 * D + H) + "|live:ebay");
  await put("x:" + hourKey(NOW) + "|live:ebay");
  /* p: 8 days */
  await put("p:" + hourKey(NOW - 8 * D - H) + "|ebay");
  await put("p:" + hourKey(NOW - 7 * D) + "|ebay");
  /* y: and a: 30 days */
  await put("y:" + p13(NOW - 31 * D) + ":aaaa");
  await put("y:" + p13(NOW - 29 * D) + ":bbbb");
  await put("a:" + p13(NOW - 30 * D - 1) + ":aaaa");
  await put("a:" + p13(NOW - 1000) + ":bbbb");
  /* z: 7 days */
  await put("z:" + p13(NOW - 7 * D - 1));
  await put("z:" + p13(NOW - 6 * D));
  /* junk under a metrics prefix */
  await put("x:garbage");
  const kept = await metricsPrune(s, NOW);
  assert.equal(kept, 2 + 1 + 1 + 1 + 1);
  assert.deepEqual(s.keys("x:"), ["x:" + hourKey(NOW - 8 * D + H) + "|live:ebay", "x:" + hourKey(NOW) + "|live:ebay"]);
  assert.deepEqual(s.keys("p:"), ["p:" + hourKey(NOW - 7 * D) + "|ebay"]);
  assert.deepEqual(s.keys("y:"), ["y:" + p13(NOW - 29 * D) + ":bbbb"]);
  assert.deepEqual(s.keys("a:"), ["a:" + p13(NOW - 1000) + ":bbbb"]);
  assert.deepEqual(s.keys("z:"), ["z:" + p13(NOW - 6 * D)]);
  assert.ok(s.deletes >= 2);
  /* Caps keys untouched */
  for (const k of ["c:all", "v:x", "n:t:2020-01-01:lamp", "s:t:2020-01-01:lamp:ab", "m:t:2020-01-01"]) assert.ok(s.m.has(k), k);
  /* nothing to do the second time */
  assert.equal(await metricsPrune(s, NOW), 6);
  assert.equal(await metricsPrune(new FakeStorage(), NOW), 0);
});

/* ---------- summaries ---------- */
test("summarize windows to the last N hours and builds series, routes, totals and live", () => {
  const hk = i => hourKey(NOW - i * H);
  const buckets = [
    { hour: hk(0), route: "live:ebay", ...agg({ n: 10, hit: 4, ms: 5000, e5: 1, h: [2, 2, 2, 2, 1, 0, 0, 1] }) },
    { hour: hk(1), route: "live:ebay", ...agg({ n: 10, ms: 3000, h: [5, 5] }) },
    { hour: hk(23), route: "live:etsy", ...agg({ n: 4, e4: 1, lim: 1, ms: 12000, h: [0, 0, 0, 0, 0, 2, 2] }) },
    { hour: hk(5), route: "ai:fairprice", ...agg({ n: 30, e5: 3, ms: 60000, h: [0, 0, 0, 0, 30] }) },
    { hour: hk(24), route: "live:ebay", ...agg({ n: 999, h: [999] }) },   /* just outside 24 h */
    { hour: hourKey(NOW + H), route: "live:ebay", ...agg({ n: 777, h: [777] }) },   /* a future hour */
    null, { hour: hk(0) },
  ];
  const r = summarize(buckets, NOW);
  assert.equal(r.series.hours.length, 24);
  assert.equal(r.series.hours[0], hk(23));
  assert.equal(r.series.hours[23], "2026-10-05T21");
  assert.equal(r.series.req[23], 10);
  assert.equal(r.series.req[22], 10);
  assert.equal(r.series.req[18], 30);
  assert.equal(r.series.req[0], 4);
  assert.equal(r.series.req.reduce((a, b) => a + b, 0), 54);
  assert.equal(r.series.err5[23], 1);
  assert.equal(r.series.err5[18], 3);
  assert.equal(r.series.slow[23], 1);   /* the one at 8 s+ */
  assert.equal(r.series.slow[0], 4);    /* 2 s..4 s and 4 s..8 s */
  assert.equal(r.series.slow[18], 0);   /* 1..2 s is not slow */

  assert.deepEqual(r.routes.map(x => x.route), ["ai:fairprice", "live:ebay", "live:etsy"]);
  const ebay = r.routes[1];
  assert.deepEqual(ebay, { route: "live:ebay", n: 20, hit: 4, hitPct: 20, e4: 0, e5: 1, lim: 0, avgMs: 400, p50: 250, p95: 2000, errPct: 5 });
  const etsy = r.routes[2];
  assert.equal(etsy.p50, 4000);
  assert.equal(etsy.p95, 8000);
  assert.equal(etsy.e4, 1);
  assert.equal(etsy.lim, 1);
  assert.equal(r.routes[0].errPct, 10);

  assert.equal(r.totals.n, 54);
  assert.equal(r.totals.e5, 4);
  assert.equal(r.totals.ms, 80000);
  assert.equal(r.totals.h.length, 8);
  assert.equal(r.totals.errPct, 7.4);
  assert.equal(r.live.n, 24);
  assert.equal(r.live.hit, 4);
  assert.equal(r.live.p50, 250);
  assert.deepEqual(r.live.h, [7, 7, 2, 2, 1, 2, 2, 1]);
});

test("summarize with a shorter window and with nothing at all", () => {
  const b = [{ hour: hourKey(NOW - 3 * H), route: "other", ...agg({ n: 2, h: [2] }) }, { hour: hourKey(NOW - 2 * H), route: "other", ...agg({ n: 1, h: [1] }) }];
  const r = summarize(b, NOW, 3);
  assert.deepEqual(r.series.hours, [hourKey(NOW - 2 * H), hourKey(NOW - H), hourKey(NOW)]);
  assert.deepEqual(r.series.req, [1, 0, 0]);
  const empty = summarize([], NOW);
  assert.deepEqual(empty.routes, []);
  assert.equal(empty.series.req.length, 24);
  assert.ok(empty.series.req.every(x => x === 0));
  assert.equal(empty.totals.n, 0);
  assert.equal(empty.totals.p50, 0);
  assert.equal(empty.live.avgMs, 0);
  assert.equal(summarize(undefined, NOW).routes.length, 0);
});

test("uptimeFrom: 24 h and 7 day uptime, last check, down flag", () => {
  const probes = [];
  /* ebay: hourly for 3 days, failing every 4th, and the latest one failed */
  for (let i = 71; i >= 0; i--) {
    const t = NOW - i * H, bad = i % 4 === 0;
    probes.push({ hour: hourKey(t), source: "ebay", t: t, ok: !bad, status: bad ? 503 : 200, n: bad ? 0 : 30, ms: 700 + i, err: bad ? "upstream 503" : "" });
  }
  /* etsy: one good check 3 days ago, one 8 days ago (outside 7 days) */
  probes.push({ hour: hourKey(NOW - 8 * D), source: "etsy", t: NOW - 8 * D, ok: false, status: 0, n: 0, ms: 0, err: "timeout" });
  probes.push({ hour: hourKey(NOW - 3 * D), source: "etsy", t: NOW - 3 * D, ok: true, status: 200, n: 9, ms: 450, err: "" });
  const u = uptimeFrom(probes, NOW);
  assert.deepEqual(u.map(x => x.source), ["ebay", "etsy"]);
  const ebay = u[0];
  assert.equal(ebay.checks24, 24);
  assert.equal(ebay.pct24, 75);
  assert.equal(ebay.checks7d, 72);
  assert.equal(ebay.pct7d, 75);
  assert.equal(ebay.down, true);
  assert.equal(ebay.lastStatus, 503);
  assert.equal(ebay.lastErr, "upstream 503");
  assert.equal(ebay.lastN, 0);
  assert.equal(ebay.lastMs, 700);
  assert.equal(ebay.lastAt, NOW);
  assert.equal(ebay.lastOkAt, hourKey(NOW - H));
  const etsy = u[1];
  assert.equal(etsy.checks24, 0);
  assert.equal(etsy.pct24, null);   /* no checks: unknown, not 0 % */
  assert.equal(etsy.checks7d, 1);
  assert.equal(etsy.pct7d, 100);
  assert.equal(etsy.down, false);
  assert.equal(etsy.lastOkAt, hourKey(NOW - 3 * D));
  assert.equal(etsy.lastN, 9);
});

test("uptimeFrom orders by time, falls back to the hour key, and handles no data", () => {
  const u = uptimeFrom([
    { hour: "2026-10-05T21", source: "vinted", ok: true, status: 200, n: 5, ms: 300 },
    { hour: "2026-10-05T19", source: "vinted", ok: false, status: 403, n: 0, ms: 20, err: "blocked" },
  ], NOW);
  assert.equal(u.length, 1);
  assert.equal(u[0].down, false);
  assert.equal(u[0].lastStatus, 200);
  assert.equal(u[0].pct24, 50);
  assert.equal(u[0].lastOkAt, "2026-10-05T21");
  assert.equal(u[0].lastAt, Date.parse("2026-10-05T21:00:00Z"));
  const never = uptimeFrom([{ hour: "2026-10-05T20", source: "grailed", ok: false, status: 0, err: "dns" }], NOW)[0];
  assert.equal(never.lastOkAt, null);
  assert.equal(never.pct24, 0);
  assert.equal(never.down, true);
  assert.equal(never.lastN, null);
  assert.deepEqual(uptimeFrom([], NOW), []);
  assert.deepEqual(uptimeFrom(undefined, NOW), []);
});

/* ---------- end to end: worker buffer -> Durable Object -> dashboard ---------- */
test("buffer drain feeds mrec, and mget feeds summarize and uptimeFrom", async () => {
  const s = new FakeStorage();
  const buf = new MetricsBuffer({ maxEvents: 5 });
  const evs = [
    { r: routeKey("/ebay"), s: 200, ms: 90, hit: true },
    { r: routeKey("/ebay"), s: 200, ms: 1500 },
    { r: routeKey("/"), s: 502, ms: 2100, err: "upstream unreachable", q: "lamp" },
    { r: routeKey("/verdict"), s: 429, ms: 10 },
    { r: routeKey("/alerts/status"), s: 200, ms: 40 },
  ];
  let due = false;
  for (const ev of evs) due = buf.add(ev, NOW);
  assert.equal(due, true);
  const payload = buf.drain();
  await metricsOp(s, "mrec", JSON.parse(JSON.stringify(payload)), NOW);
  await metricsOp(s, "mrec", { p: [{ t: NOW, source: "ebay", ok: true, status: 200, n: 20, ms: 500, err: "" }] }, NOW);
  const got = JSON.parse(JSON.stringify(await metricsOp(s, "mget", {}, NOW)));
  assert.equal(got.errors.length, 1);
  assert.equal(got.errors[0].q, "lamp");
  const sum = summarize(got.buckets, NOW);
  assert.equal(sum.totals.n, 5);
  assert.equal(sum.live.n, 3);
  assert.equal(sum.live.e5, 1);
  assert.equal(sum.series.slow[23], 1);
  assert.equal(sum.routes[0].route, "live:ebay");
  assert.equal(sum.routes.find(r => r.route === "ai:fairprice").lim, 1);
  const up = uptimeFrom(got.probes, NOW);
  assert.deepEqual(up.map(x => [x.source, x.pct24, x.down]), [["ebay", 100, false]]);
});

/* ---------- hardening (review fixes) ---------- */
test("routeKey never answers an inherited property name", () => {
  for (const p of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(routeKey(p), "other", p);
});

test("mergeAgg rebuilds a malformed first argument from the agg fields only", () => {
  const out = mergeAgg({ n: 2, email: "pii@example.com", route: "x" }, { n: 1, h: [1] });
  assert.deepEqual(out, { n: 3, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [1, 0, 0, 0, 0, 0, 0, 0] });
  assert.deepEqual(mergeAgg("abc", { n: 1 }), { n: 1, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [0, 0, 0, 0, 0, 0, 0, 0] });
  /* Infinity and NaN never get into a stored count (JSON would turn them into null) */
  assert.deepEqual(mergeAgg(emptyAgg(), { n: Infinity, ms: NaN, h: [Infinity, -3, 2] }), { n: 0, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [0, 0, 2, 0, 0, 0, 0, 0] });
});

test("mrec survives out-of-range times instead of losing the rest of the batch", async () => {
  const s = new FakeStorage();
  const r = await metricsOp(s, "mrec", {
    p: [{ t: 1e20, source: "ebay", ok: true, status: 200, n: 3, ms: 100 }],
    e: [{ t: 1e20, r: "other", s: 500, m: "x" }, { t: -5, r: "other", s: 500, m: "y" }],
    c: { t: 1e20, sent: 1 },
    a: [{ t: "soon", action: "login", ok: true }],
  }, NOW);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(s.keys("p:"), ["p:" + hourKey(NOW) + "|ebay"]);
  for (const k of [...s.keys("y:"), ...s.keys("a:"), ...s.keys("z:")]) assert.equal(k.slice(2, 15), String(NOW).padStart(13, "0"), k);
  assert.equal(s.keys("y:").length, 2);
  /* a bad clock on the caller's side falls back to now rather than throwing */
  assert.equal(summarize([], NaN).series.hours.length, 24);
  assert.equal(new MetricsBuffer().add({ r: "other", s: 200, ms: 1 }, NaN), false);
  assert.equal(uptimeFrom([{ source: "ebay", t: 1e20, ok: true }], NOW)[0].lastOkAt, null);
});

test("no stored text keeps an email address, even if a caller forgets to scrub", async () => {
  const s = new FakeStorage();
  const b = new MetricsBuffer();
  b.add({ r: "alerts:signin", s: 502, ms: 5, err: "no member jane.doe@example.com", q: "jane@example.com" }, NOW);
  const d = b.drain();
  assert.deepEqual(d.e[0], { t: NOW, r: "alerts:signin", s: 502, m: "no member [email]", q: "[email]" });
  await metricsOp(s, "mrec", {
    e: [{ t: NOW, r: "other", s: 500, m: "send to bob@example.org failed", q: "x@y.zz" }],
    c: { t: NOW, errors: ["bounce from carol@example.net"] },
    p: [{ t: NOW, source: "ebay", ok: false, err: "contact dave@example.com" }],
    a: [{ t: NOW, action: "find", id: "e@x.io", ok: true, note: "for erin@example.com" }],
  }, NOW);
  const all = JSON.stringify([...s.m.values()]);
  assert.ok(!/@/.test(all), all);
  assert.match(all, /\[email\]/);
});

test("a route or source named __proto__ is ordinary data", () => {
  const sum = summarize([{ hour: hourKey(NOW), route: "__proto__", ...agg({ n: 2, h: [2] }) }, { hour: hourKey(NOW), route: "other", ...agg({ n: 1, h: [1] }) }], NOW);
  assert.deepEqual(sum.routes.map(r => [r.route, r.n]), [["__proto__", 2], ["other", 1]]);
  const up = uptimeFrom([{ source: "__proto__", t: NOW, ok: true }, { source: "ebay", t: NOW, ok: false }], NOW);
  assert.deepEqual(up.map(u => [u.source, u.pct24, u.down]), [["__proto__", 100, false], ["ebay", 0, true]]);
});

/* ---------- review fixes ---------- */
test("MetricsBuffer: a lone server error asks for a flush straight away (a quiet isolate may never see another request); a storm still batches", () => {
  const b = new MetricsBuffer({ maxAgeMs: 120000 });
  assert.equal(b.add({ r: "live:ebay", s: 200, ms: 5 }, NOW), false);
  assert.equal(b.add({ r: "live:ebay", s: 502, ms: 900, err: "upstream" }, NOW + 10), true, "the error goes out now");
  const d = b.drain();
  assert.equal(d.e.length, 1); assert.equal(d.b["2026-10-05T21|live:ebay"].e5, 1);
  assert.equal(b.add({ r: "live:ebay", s: 503, ms: 900 }, NOW + 1000), false, "at most one early flush every 5 seconds");
  assert.equal(b.add({ r: "live:ebay", s: 503, ms: 900 }, NOW + 6000), true);
  assert.equal(b.add({ r: "other", s: 404, ms: 3 }, NOW + 20000), false, "a 4xx waits for the batch");
});

/* counts the rows each storage.list call reads */
class CountingStorage extends FakeStorage {
  constructor() { super(); this.rowsRead = 0; }
  async list(o) { const m = await super.list(o); this.rowsRead += m.size; return m; }
}
test("mrec keeps the caps without listing every key on each write", async () => {
  const s = new CountingStorage();
  for (let i = 0; i < 400; i++) await metricsOp(s, "mrec", { c: { t: NOW + i * 300000, sent: i } }, NOW);
  assert.equal(s.keys("z:").length, 400);
  s.rowsRead = 0;
  for (let i = 400; i < 450; i++) await metricsOp(s, "mrec", { c: { t: NOW + i * 300000, sent: i } }, NOW);
  assert.equal(s.keys("z:").length, 400, "still capped at 400");
  assert.equal((await s.get(s.keys("z:")[0])).sent, 50, "the oldest went first");
  assert.ok(s.rowsRead <= 50, "about one row read per run once full, not 400 (read " + s.rowsRead + ")");
  /* errors in batches, the way the worker sends them */
  for (let i = 0; i < 30; i++) await metricsOp(s, "mrec", { e: Array.from({ length: 20 }, (_, j) => ({ t: NOW + i * 20 + j, r: "other", s: 500, m: "m" + (i * 20 + j) })) }, NOW);
  assert.equal(s.keys("y:").length, 500);
  assert.equal((await s.get(s.keys("y:")[0])).m, "m100");
  /* the daily prune re-counts, so a counter that drifted is put right */
  await s.put("q:z:", 9999);
  await metricsPrune(s, NOW);
  assert.equal(await s.get("q:z:"), s.keys("z:").length);
  assert.equal(await s.get("q:y:"), s.keys("y:").length);
  assert.equal(await s.get("q:a:"), undefined, "no counter is made for a prefix that holds nothing");
  const empty = new FakeStorage();
  await metricsPrune(empty, NOW);
  assert.equal(empty.m.size, 0, "a Caps object without metrics gets no counters");
});

test("a cron record can carry the overview's member counts, numbers only", async () => {
  const s = new FakeStorage();
  await metricsOp(s, "mrec", { c: { t: NOW, sent: 1, counts: { total: 12, late: 2, sentToday: "3", email: "jane@example.com", huntsLeftToday: -4, bogus: 9 } } }, NOW);
  const v = await s.get("z:" + String(NOW).padStart(13, "0"));
  assert.deepEqual(Object.keys(v.counts), ["total", "pro", "gifted", "trial", "free", "freeLegacy", "mailOff", "paused", "noHunts", "new7d", "hunts", "activeHunts",
    "dueToday", "sentToday", "late", "checkedToday", "huntsLeftToday"]);
  assert.deepEqual([v.counts.total, v.counts.late, v.counts.sentToday, v.counts.huntsLeftToday], [12, 2, 3, 0]);
  assert.ok(!JSON.stringify(v).includes("@"));
  const got = await metricsOp(s, "mget", { crons: 1 }, NOW);
  assert.equal(got.crons[0].counts.total, 12);
});

test("mget: hours 0 and probeDays 0 skip those sections (the overview reads them less often)", async () => {
  const s = await seeded();
  const r = await metricsOp(s, "mget", { hours: 0, errors: 0, crons: 1, probeDays: 0, audit: 0 }, NOW);
  assert.deepEqual([r.buckets, r.probes, r.errors, r.audit], [[], [], [], []]);
  assert.equal(r.crons.length, 1);
});
