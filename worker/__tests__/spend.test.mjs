/* v193: the admin's Spending tab. Every paid call is counted by the wrapped global fetch (spend.js spendWrap), per UTC
   day and service in the "spend" Caps object, and the admin prices it with KV spend:cfg (list prices until the owner
   saves) plus the monthly bills. Run: node --test worker/__tests__/spend.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as SP from "../spend.js";
import { adminFetch, signSession } from "../admin.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const DAY = 86400000, NOW = Date.UTC(2026, 9, 30, 15, 0, 0);

/* a Durable Object storage stand-in: sorted keys, list with prefix/start (inclusive)/end (exclusive), delete in batches */
class FakeStorage {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined; }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(ks) { assert.ok(ks.length <= 128, "at most 128 a delete"); for (const k of ks) this.m.delete(k); }
  async list(o = {}) {
    const keys = [...this.m.keys()].sort().filter((k) => (!o.prefix || k.startsWith(o.prefix)) && (!o.start || k >= o.start) && (!o.end || k < o.end));
    return new Map(keys.map((k) => [k, structuredClone(this.m.get(k))]));
  }
}
const res = (body, init = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), Object.assign({ status: 200, headers: { "Content-Type": "application/json" } }, init));

test("paidKey knows the paid hosts, and the Google SKU from the address and field mask; anything else is free", () => {
  const k = SP.paidKey;
  assert.equal(k("https://api.meta.ai/v1/responses"), "muse");
  assert.equal(k("https://api.meta.ai/v1/chat/completions"), "muse");
  assert.equal(k("https://api.typesafe.ai/v1/systemone"), "jev");
  assert.equal(k("https://serpapi.com/search.json?engine=google_lens&url=x"), "lens");
  assert.equal(k("https://vision.googleapis.com/v1/images:annotate?key=x"), "g_vision");
  assert.equal(k("https://places.googleapis.com/v1/places:searchText", { headers: { "X-Goog-FieldMask": "places.id" } }), "g_text");
  assert.equal(k("https://places.googleapis.com/v1/places:searchNearby"), "g_nearby");
  assert.equal(k("https://places.googleapis.com/v1/places:autocomplete"), "g_suggest");
  assert.equal(k("https://places.googleapis.com/v1/places/abc", { headers: { "X-Goog-FieldMask": "id,regularOpeningHours,utcOffsetMinutes" } }), "g_hours");
  assert.equal(k("https://places.googleapis.com/v1/places/abc", { headers: new Headers({ "X-Goog-FieldMask": "id,rating,userRatingCount,editorialSummary,reviews,googleMapsUri" }) }), "g_reviews");
  assert.equal(k("https://places.googleapis.com/v1/places/abc/photos/def/media?maxWidthPx=480&key=k"), "g_photo");
  assert.equal(k("https://maps.googleapis.com/maps/api/geocode/json?address=x"), "g_geo");
  assert.equal(k("https://routes.googleapis.com/directions/v2:computeRoutes"), "g_route");
  for (const free of ["https://fcm.googleapis.com/fcm/send/x", "https://api.ebay.com/buy/browse/v1/item_summary/search", "https://www.google.com/maps/search/?api=1",
    "https://maps.googleapis.com/maps/api/staticmap?x", "http://api.meta.ai/v1/responses", "not a url", "", null, "https://serpapi.com/account"]) assert.equal(k(free), "", String(free));
  assert.deepEqual([...new Set(SP.SPEND_SERVICES.map((s) => s.key))].sort(), [...SP.SPEND_KEYS].sort(), "keys are unique");
});

test("the wrapped fetch answers exactly as fetch, and counts each paid call; Muse tokens and searches from its answer", async () => {
  const buf = new SP.SpendBuffer(), seen = [];
  const raw = async (u, init) => {
    seen.push(String(u));
    if (/meta\.ai/.test(u)) return res({ usage: { input_tokens: 1200, output_tokens: 340 }, output: [{ type: "web_search_call" }, { type: "web_search_call" }, { type: "message" }], answer: 1 });
    if (/typesafe/.test(u)) return res({ answers: {} });
    if (/media/.test(u)) return res("img", { headers: { "cf-cache-status": "HIT" } });
    if (/throw/.test(u)) throw new Error("network");
    return res({ ok: 1 });
  };
  const f = SP.spendWrap(raw, buf);
  assert.equal(f.__prowlSpend, true);
  const r = await f("https://api.meta.ai/v1/responses", { method: "POST", body: "{}" });
  assert.equal((await r.json()).answer, 1, "the caller still reads the answer");
  await f("https://api.typesafe.ai/v1/systemone", { method: "POST", body: "x".repeat(400) });
  await f("https://places.googleapis.com/v1/places/a/photos/b/media?k=1");
  await f("https://api.ebay.com/x");
  await assert.rejects(f("https://places.googleapis.com/v1/places:searchText?throw=1"), /network/, "an error still reaches the caller");
  await f(new Request("https://vision.googleapis.com/v1/images:annotate?key=k", { method: "POST", body: "{}" }));
  assert.equal(seen.length, 6);
  const d = buf.drain(), day = SP.dayOf(Date.now());
  assert.deepEqual(d.rows[day + "|muse"], { n: 1, ti: 1200, to: 340, ws: 2 });
  assert.deepEqual(d.rows[day + "|jev"], { n: 1, ti: 100, to: 0, ws: 0 }, "Jev: about 4 characters a token of what was sent");
  assert.deepEqual(d.rows[day + "|g_vision"], { n: 1, ti: 0, to: 0, ws: 0 }, "a Request object is read for its address");
  assert.equal(d.rows[day + "|g_photo"], undefined, "a cache hit is free");
  assert.equal(d.rows[day + "|g_text"], undefined, "a call that threw before any answer is not counted");
  assert.equal(Object.keys(d.rows).length, 3, "eBay is not a paid service");
  assert.equal(buf.drain(), null, "drained");
});

test("a counting failure never breaks the call: an odd answer, unreadable JSON, a failed status", async () => {
  const buf = new SP.SpendBuffer();
  const f = SP.spendWrap(async (u) => (/meta/.test(u) ? new Response("not json", { status: 200 }) : /typesafe/.test(u) ? new Response("{}", { status: 500 }) : { ok: true, status: 200 }), buf);
  assert.equal(await (await f("https://api.meta.ai/v1/responses", { body: "{}" })).text(), "not json");
  assert.equal((await f("https://api.typesafe.ai/v1/systemone", { body: "abcd" })).status, 500);
  assert.equal((await f("https://serpapi.com/search.json?q=1")).status, 200, "a bare object without headers or clone");
  const d = buf.drain(), day = SP.dayOf(Date.now());
  assert.deepEqual(d.rows[day + "|muse"], { n: 1, ti: 0, to: 0, ws: 0 }, "Muse that answered still costs a call");
  assert.deepEqual(d.rows[day + "|jev"], { n: 1, ti: 1, to: 0, ws: 0 }, "Jev that failed was still sent");
  assert.deepEqual(d.rows[day + "|lens"], { n: 1, ti: 0, to: 0, ws: 0 });
});

test("museUsage reads both Muse APIs; jevUsage prefers TypeSafe's own count; odd values count 0", () => {
  assert.deepEqual(SP.museUsage({ usage: { prompt_tokens: 50, completion_tokens: 20 } }), { ti: 50, to: 20, ws: 0 });
  assert.deepEqual(SP.museUsage({ usage: { input_tokens: -5, output_tokens: "x" }, output: "nope" }), { ti: 0, to: 0, ws: 0 });
  assert.deepEqual(SP.museUsage(null), { ti: 0, to: 0, ws: 0 });
  assert.deepEqual(SP.jevUsage({ usage: { input_tokens: 77 } }, "x".repeat(4000)), { ti: 77 });
  assert.deepEqual(SP.jevUsage(null, "abcde"), { ti: 2 });
  assert.deepEqual(SP.jevUsage(null, new FormData()), { ti: 0 }, "a picture upload is not text");
});

test("the buffer: one row per UTC day and service; unknown keys and odd numbers dropped", () => {
  const b = new SP.SpendBuffer();
  b.tick("muse", { ti: 10, to: 5, ws: 1 }, NOW);
  b.tick("muse", { ti: 10.7, to: -3 }, NOW + 60000);
  b.tick("muse", null, NOW + DAY);
  b.tick("g_text", { n: 3 }, NOW);
  b.tick("nope", null, NOW);
  b.tick("constructor", null, NOW);
  assert.deepEqual(b.drain().rows, {
    "2026-10-30|muse": { n: 2, ti: 20, to: 5, ws: 1 }, "2026-10-31|muse": { n: 1, ti: 0, to: 0, ws: 0 }, "2026-10-30|g_text": { n: 3, ti: 0, to: 0, ws: 0 } });
});

test("the spend object: sadd merges per day and service, refuses unknown keys and bad days, sget lists a range", async () => {
  const st = new FakeStorage();
  let r = await SP.spendOp(st, "sadd", { rows: { "2026-10-30|muse": { n: 2, ti: 100, to: 50, ws: 1 }, "2026-10-30|g_text": { n: 1 }, "2026-10-30|evil": { n: 9 },
    "bad|muse": { n: 1 }, "2026-10-29|muse": { n: -4, ti: "x" }, "__proto__": { n: 1 } } }, NOW);
  assert.equal(r.added, 3);
  await SP.spendOp(st, "sadd", { rows: { "2026-10-30|muse": { n: 1, ti: 1e15 } } }, NOW);
  assert.deepEqual(await st.get("w:2026-10-30|muse"), { n: 3, ti: 1e9 + 100, to: 50, ws: 1 }, "one add is capped");
  assert.deepEqual(await st.get("w:2026-10-29|muse"), { n: 0, ti: 0, to: 0, ws: 0 });
  r = await SP.spendOp(st, "sget", { from: "2026-10-30", to: "2026-10-30" }, NOW);
  assert.deepEqual(r.rows.map((x) => x.key).sort(), ["g_text", "muse"]);
  assert.deepEqual(r.rows.find((x) => x.key === "muse"), { day: "2026-10-30", key: "muse", n: 3, ti: 1e9 + 100, to: 50, ws: 1 });
  assert.deepEqual(await SP.spendOp(st, "sget", { from: "x", to: "2026-10-30" }, NOW), { error: "bad days" });
  assert.deepEqual(await SP.spendOp(st, "nope", {}, NOW), { error: "bad op" });
});

test("rows older than SPEND_KEEP_DAYS are pruned once a day, when a row is added", async () => {
  const st = new FakeStorage();
  for (let i = 0; i < 300; i++) await st.put("w:" + SP.dayOf(NOW - (SP.SPEND_KEEP_DAYS + 1 + i) * DAY) + "|muse", { n: 1 });
  await st.put("w:" + SP.dayOf(NOW - 10 * DAY) + "|muse", { n: 1 });
  await SP.spendOp(st, "sadd", { rows: { [SP.dayOf(NOW) + "|muse"]: { n: 1 } } }, NOW);
  assert.equal((await st.list({ prefix: "w:" })).size, 2, "the old rows went, in batches of 128");
  await st.put("w:" + SP.dayOf(NOW - 500 * DAY) + "|muse", { n: 1 });
  await SP.spendOp(st, "sadd", { rows: { [SP.dayOf(NOW) + "|muse"]: { n: 1 } } }, NOW + 1000);
  assert.equal((await st.list({ prefix: "w:" })).size, 3, "only once a day");
});

test("prices: list prices until saved; empty clears one, a bad number is refused; monthly bills cleaned and capped", () => {
  const d = SP.spendDefaults();
  assert.deepEqual(d.prices.muse, { tin: 1.25, tout: 4.25, ws: 2.5 });
  assert.deepEqual(d.prices.g_text, { call: 40 });
  assert.deepEqual(d.prices.lens, { call: null }, "SerpApi bills by plan");
  assert.deepEqual(d.prices.g_nearby, { call: 40 }, "from Matt's Google billing price list");
  /* Matt's billing account price list (2026-10-30): the price after the free tier, and the free calls a month */
  const G = { g_text: [40, 1000], g_nearby: [40, 1000], g_hours: [20, 1000], g_reviews: [25, 1000], g_photo: [7, 1000], g_suggest: [2.83, 10000],
    g_geo: [5, 10000], g_route: [5, 10000], g_vision: [3.5, 1000] };
  for (const s of SP.SPEND_SERVICES) if (G[s.key]) assert.deepEqual([s.price.call, s.free], G[s.key], s.key);
  assert.equal(SP.SPEND_SERVICES.find((s) => s.key === "muse").free, undefined, "Muse has no free allowance");
  for (const s of SP.SPEND_SERVICES) assert.match(s.src, /^https:\/\//, s.key + " has a source"), assert.match(s.bill, /^https:\/\//, s.key + " has a billing page");
  let r = SP.spendCfgClean({ prices: { muse: { tin: "2", tout: "", call: 9 }, g_text: { call: 35.123456 }, nope: { call: 1 } } });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.cfg.prices.muse, { tin: 2, tout: null, ws: 2.5 }, "a field the service does not use is ignored");
  assert.equal(r.cfg.prices.g_text.call, 35.1235);
  assert.equal("nope" in r.cfg.prices, false);
  r = SP.spendCfgClean({ prices: { g_text: { call: -1 }, g_geo: { call: "abc" }, jev: { tin: 1e9 } } });
  assert.deepEqual(r.errors, ["jev.tin", "g_text.call", "g_geo.call"]);
  assert.equal(r.cfg.prices.g_text.call, 40, "a refused number keeps the list price");
  const fixed = [{ name: "Shopify plan", perMonth: "39" }, { name: "", perMonth: "" }, { name: "  Claude <b>Max</b> for matt@example.com  ", perMonth: 100 },
    ...Array.from({ length: 12 }, (_, i) => ({ name: "Bill " + i, perMonth: 1 }))];
  r = SP.spendCfgClean({ fixed });
  assert.equal(r.cfg.fixed.length, SP.SPEND_FIXED_MAX);
  assert.deepEqual(r.cfg.fixed[0], { name: "Shopify plan", perMonth: 39 });
  assert.equal(r.cfg.fixed[1].name, "Claude bMax/b for [email]", "no tags, no email address");
  assert.ok(r.errors.some((e) => /at most/.test(e)));
  r = SP.spendCfgClean({ fixed: [{ name: "Cloudflare", perMonth: "" }, { name: "", perMonth: 5 }, { name: "x".repeat(60), perMonth: 5 }] });
  assert.deepEqual(r.errors, ["fixed: Cloudflare", "fixed: a row without a name"]);
  assert.equal(r.cfg.fixed[0].name.length, 40);
});

test("the estimate: per 1,000 calls and per 1M tokens; a used service without a price is no estimate, not $0", () => {
  const S = Object.fromEntries(SP.SPEND_SERVICES.map((s) => [s.key, s]));
  assert.equal(SP.spendCost(S.g_text, { n: 250 }, { call: 40 }), 10);
  assert.equal(SP.spendCost(S.muse, { n: 9, ti: 2e6, to: 1e6, ws: 4 }, { tin: 1.25, tout: 4.25, ws: 2.5 }), 2.5 + 4.25 + 0.01);
  assert.equal(SP.spendCost(S.g_nearby, { n: 5 }, { call: null }), null);
  assert.equal(SP.spendCost(S.g_text, { n: 3603 }, { call: 40 }, 1000), 104.12, "Matt's Oct 16-30 Text Search: 2,603 billed calls after the free 1,000");
  assert.equal(SP.spendCost(S.g_text, { n: 900 }, { call: 40 }, 1000), 0, "inside the free allowance");
  assert.equal(SP.spendCost(S.muse, { n: 9, ti: 1e6 }, { tin: 1.25 }, 5), 1.25, "the allowance is calls, never tokens");
  assert.equal(SP.spendCost(S.g_nearby, { n: 0 }, { call: null }), 0, "nothing used costs nothing");
  assert.equal(SP.spendCost(S.muse, { n: 1, ti: 1e6, to: 0, ws: 0 }, { tin: 1.25, tout: null, ws: null }), 1.25, "only the parts used need a price");
});

test("periods are UTC: today, 7 days, this month, last month (across a year end too)", () => {
  assert.deepEqual(SP.spendPeriods(NOW), { today: { from: "2026-10-30", to: "2026-10-30" }, d7: { from: "2026-10-24", to: "2026-10-30" },
    month: { from: "2026-10-01", to: "2026-10-30" }, last: { from: "2026-09-01", to: "2026-09-30" } });
  const jan = SP.spendPeriods(Date.UTC(2027, 0, 3, 1));
  assert.deepEqual(jan.last, { from: "2026-12-01", to: "2026-12-31" });
  assert.deepEqual(jan.d7, { from: "2026-12-28", to: "2027-01-03" });
});

test("the summary adds each service per period and the monthly bills to the month totals", () => {
  const cfg = SP.spendCfgClean({ fixed: [{ name: "Shopify", perMonth: 39 }, { name: "Cloudflare", perMonth: 5 }] }).cfg;
  const rows = [{ day: "2026-10-30", key: "g_text", n: 100 }, { day: "2026-10-25", key: "g_text", n: 100 }, { day: "2026-10-02", key: "g_text", n: 1100 },
    { day: "2026-09-15", key: "g_text", n: 1050 }, { day: "2026-10-30", key: "lens", n: 3 }, { day: "2026-10-30", key: "muse", n: 2, ti: 1e6, to: 1e6, ws: 0 }];
  const s = SP.spendSummary(rows, cfg, NOW), g = s.services.find((x) => x.key === "g_text");
  assert.deepEqual([g.today.n, g.d7.n, g.month.n, g.last.n], [100, 200, 1300, 1050]);
  assert.deepEqual([g.today.cost, g.d7.cost, g.month.cost, g.last.cost], [4, 8, 12, 2], "today and 7 days at list price; the months take off the free 1,000");
  assert.equal(s.services.find((x) => x.key === "lens").today.cost, null, "SerpApi has no per-call price");
  assert.deepEqual(s.totals.today, { calls: 4 + 5.5, unpriced: 1 });
  assert.equal(s.totals.fixed, 44);
  assert.equal(s.totals.monthAll, Math.round((12 + 5.5 + 44) * 100) / 100);
  assert.equal(s.totals.lastAll, 2 + 44);
  assert.equal(s.services.length, SP.SPEND_SERVICES.length, "every service has a row, used or not");
});

/* ---------- index.js: where the counting is wired ---------- */
test("index.js wraps the global fetch once, flushes after each request and cron run, and the spend object answers sadd/sget", () => {
  assert.match(INDEX, /import \{ SpendBuffer, spendOp, spendWrap \} from "\.\/spend\.js";/);
  assert.match(INDEX, /try \{ if \(typeof globalThis\.fetch === "function" && !globalThis\.fetch\.__prowlSpend\) globalThis\.fetch = spendWrap\(globalThis\.fetch\.bind\(globalThis\), SBUF\); \} catch \(e\) \{\}/, "wrapped once, and a read-only fetch never stops the worker");
  assert.match(INDEX, /try \{ spendFlush\(ctx\); \} catch \(e\) \{\}/);
  assert.match(INDEX, /ctx\.waitUntil\(cronRun\(env\)\.then\(\(\) => spendFlush\(null\)\)\);/);
  assert.match(INDEX, /if \(op === "sadd" \|\| op === "sget"\) \{[^]*?spendOp\(this\.s, op, q, Date\.now\(\)\)/);
  assert.match(INDEX, /capsCall\("spend", "sadd", d\)/);
  assert.match(INDEX, /const WORKER_VERSION = "v19[3-9]"|const WORKER_VERSION = "v[2-9]\d\d"/);
  /* Caps' own housekeeping never deletes spend rows */
  const alarm = INDEX.slice(INDEX.indexOf("  async alarm() {"), INDEX.indexOf("\n}\n", INDEX.indexOf("  async alarm() {")));
  assert.doesNotMatch(alarm, /"w:"/);
  assert.match(alarm, /for \(const pre of \["s:", "n:", "m:"\]\)/, "the prefixes the alarm clears");
});

test("every paid host index.js calls is a counted service (a new paid host needs a row in spend.js)", () => {
  const hosts = new Set([...INDEX.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]));
  const paidHosts = [...hosts].filter((h) => /(^|\.)(meta\.ai|typesafe\.ai|serpapi\.com|googleapis\.com)$/.test(h));
  assert.ok(paidHosts.length >= 6, paidHosts.join(" "));
  for (const h of paidHosts) {
    if (/^(fcm|android)\.googleapis\.com$/.test(h)) continue;   /* Web Push (push.js), free */
    const urls = [...INDEX.matchAll(new RegExp("https://" + h.replace(/\./g, "\\.") + "/[^\"'`\\s)]*", "g"))].map((m) => m[0]);
    /* a literal may be only the start of an address built from parts ("https://places.googleapis.com/v1/" + n + "/media") */
    for (const u of urls) assert.ok(["", "abc", "places/a/photos/b/media", "json"].some((tail) => SP.paidKey(u + tail) !== ""), "counted: " + u);
  }
});

/* ---------- the admin routes ---------- */
const KEY = "test-admin-key-0123456789", ORIGIN = "https://prowl.example.workers.dev";
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
}
function admin(rows) {
  const kv = new FakeKV(), audits = [], calls = [];
  const env = { PROWL_ALERTS: kv, ADMIN_KEY: KEY };
  const H = {
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)), vCount: async () => true,
    capsCall: async (n, op, body) => { calls.push([n, op, body]); if (op === "sget") { if (rows === "down") throw new Error("caps 500"); return { rows: rows || [] }; } audits.push(...(body && body.a || [])); return {}; }
  };
  const call = async (method, path, body, headers = {}) => {
    const h = { Cookie: "prowl_admin=" + await signSession(KEY, Date.now() + 3600000) };
    if (body !== undefined) Object.assign(h, { "Content-Type": "application/json", "X-Prowl-Admin": "1", Origin: ORIGIN });
    Object.assign(h, headers);
    const pending = [];
    const r = await adminFetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => pending.push(p) }, H);
    await Promise.all(pending);
    return { status: r.status, j: await r.json() };
  };
  return { kv, env, call, audits, calls };
}

test("GET /admin/api/spend: counts from the spend object, list prices, every service with its source; signed in only", async () => {
  const today = SP.dayOf(Date.now());
  const A = admin([{ day: today, key: "g_text", n: 10, ti: 0, to: 0, ws: 0 }]);
  const r = await A.call("GET", "/admin/api/spend");
  assert.equal(r.status, 200);
  assert.equal(r.j.ok, true);
  assert.deepEqual(A.calls.find((c) => c[1] === "sget").slice(0, 2), ["spend", "sget"]);
  assert.equal(r.j.services.find((s) => s.key === "g_text").today.cost, 0.4);
  assert.equal(r.j.meta.length, SP.SPEND_SERVICES.length);
  assert.deepEqual(r.j.cfg.prices.g_text, { call: 40 });
  assert.equal(r.j.fixedMax, SP.SPEND_FIXED_MAX);
  assert.doesNotMatch(JSON.stringify(r.j), /@/, "nothing personal");
  const down = await admin("down").call("GET", "/admin/api/spend");
  assert.equal(down.status, 200);
  assert.equal(down.j.ok, false, "counts unavailable is said, prices still come back");
  const out = await adminFetch(new Request(ORIGIN + "/admin/api/spend"), A.env, {}, {});
  assert.equal(out.status, 401);
});

test("POST /admin/api/spend/cfg saves prices and bills, audited; a bad value saves nothing; only from the admin page", async () => {
  const A = admin([]);
  let r = await A.call("POST", "/admin/api/spend/cfg", { prices: { g_nearby: { call: 40 }, muse: { ws: "" } }, fixed: [{ name: "Shopify plan", perMonth: 39 }] });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.match(r.j.message, /Saved/);
  const saved = JSON.parse(A.kv.m.get("spend:cfg"));
  assert.equal(saved.prices.g_nearby.call, 40);
  assert.equal(saved.prices.muse.ws, null);
  assert.deepEqual(saved.fixed, [{ name: "Shopify plan", perMonth: 39 }]);
  assert.equal(r.j.totals.fixed, 39);
  assert.deepEqual(A.audits.map((a) => [a.action, a.ok]), [["spend-prices", true]]);
  r = await A.call("POST", "/admin/api/spend/cfg", { prices: { g_text: { call: -3 } }, fixed: [] });
  assert.equal(r.status, 400);
  assert.match(r.j.error, /g_text\.call/);
  assert.equal(JSON.parse(A.kv.m.get("spend:cfg")).prices.g_text.call, 40, "nothing saved");
  r = await A.call("POST", "/admin/api/spend/cfg", { prices: {} }, { "X-Prowl-Admin": "0" });
  assert.equal(r.status, 403);
  r = await A.call("GET", "/admin/api/spend/cfg");
  assert.equal(r.status, 405);
});
