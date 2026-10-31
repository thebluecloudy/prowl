/* v204 (Matt, 2026-10-31, after Store › Facebook showed most hunts "Checks soon" or "Nothing on Facebook"): a near-me
   hunt is one Facebook search (pickup), an All USA hunt two (pickup and ships), so a member's 10 a day cover ~10 near-me
   hunts; each search keeps its counts with the finds (stat: Apify's raw, dropped far, dropped for words) and /fb-finds
   returns them as why, so the page can say why a hunt is empty. fb.js is imported; the index.js parts are taken out
   with fakes for KV, Caps and Apify. Run: node --test worker/__tests__/fb-why-v204.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as FB from "../fb.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
function build(name, deps) {
  const keys = Object.keys(deps);
  return new Function(...keys, indexFn(name) + "\nreturn " + name + ";")(...keys.map((k) => deps[k]));
}
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const kvGet = async (env, k, d) => { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const TODAY = new Date().toISOString().slice(0, 10);
const CELL = FB.fbCell(42.5, -83.5);
const L = (id, extra = {}) => ({ id: String(id), marketplace_listing_title: "Ceramic Panther " + id, listing_price: { amount: "40" },
  location: { latitude: 42.5, longitude: -83.5, reverse_geocode: { city: "Novi", state: "MI" } }, ...extra });
const FAR = { location: { latitude: 43.5, longitude: -83.5 } }, NOPOINT = { location: { reverse_geocode: { city: "Novi" } } }, OFF = { marketplace_listing_title: "Land Rover Discovery" };
const alPrefsT = (s) => ({ zip: (s && s.prefs && s.prefs.zip) || "", radius: (s && s.prefs && s.prefs.radius) || 50, fbusa: (s && s.prefs && s.prefs.fbusa) || [] });
function parts() {
  const fbOf = build("fbOf", { alPrefs: alPrefsT, fbMi: FB.fbMi });
  const fbHuntMi = build("fbHuntMi", { FB_USA_MI: FB.FB_USA_MI });
  const fbHunt = build("fbHunt", { fbHuntMi, kvGet, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey, fbJoin: FB.fbJoin, fbWhy: FB.fbWhy, FB_USA_MI: FB.FB_USA_MI });
  const fbTerms = build("fbTerms", { alActive: (env, s) => s.hunts.slice(0, 100), fbTerm: FB.fbTerm });
  return { fbOf, fbHuntMi, fbHunt, fbTerms };
}

/* ---- 1. counting ---- */
test("fbClean counts what it drops: far (past the radius or no point) and words (a hunt word missing)", () => {
  const raw = [L(1111111), L(2222222, FAR), L(3333333, NOPOINT), L(4444444, OFF), L(5555555, OFF), L(6666666, { is_sold: true })];
  const st = {};
  const out = FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, mi: 25 }, st);
  assert.deepEqual(out.map((x) => x.id), ["1111111"]);
  assert.deepEqual(st, { far: 2, words: 2 }, "a sold listing is neither");
  const ship = {};
  FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, ship: true }, ship);
  assert.deepEqual(ship, { far: 0, words: 2 }, "shipping has no distance to drop for");
  const usa = {};
  FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, mi: 500 }, usa);
  assert.deepEqual(usa, { far: 1, words: 2 }, "500 miles keeps the far one; the one with no point still goes");
  assert.equal(FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, mi: 25 }).length, 1, "the stat is optional");
});

test("fbRun returns the search's stat: Apify's raw count, far, words and when", async () => {
  const body = [L(1111111), L(2222222, FAR), L(4444444, OFF)];
  const f = async () => ({ ok: true, status: 200, json: async () => body });
  const r = await FB.fbRun({ APIFY_TOKEN: "t" }, "panther", CELL, 24, f, { mi: 25 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.stat.raw, r.stat.far, r.stat.words], [3, 1, 1]);
  assert.match(r.stat.at, /^\d{4}-\d{2}-\d{2}T/);
  const z = await FB.fbRun({ APIFY_TOKEN: "t" }, "panther", CELL, 24, async () => ({ ok: true, status: 200, json: async () => [] }), { mi: 25 });
  assert.deepEqual([z.stat.raw, z.stat.far, z.stat.words, z.items.length], [0, 0, 0, 0]);
});

test("fbMerge keeps the latest search's stat with the record; without one the old record's stays; fbStat cleans it", () => {
  const a = FB.fbMerge(null, [], TODAY, "2026-10-31T08:00:00.000Z", { raw: 24, far: 20, words: 4, at: "2026-10-31T08:00:00.000Z" });
  assert.deepEqual(a.stat, { raw: 24, far: 20, words: 4, at: "2026-10-31T08:00:00.000Z" });
  const b = FB.fbMerge(a, [{ id: "1", found: TODAY }], TODAY, undefined, { raw: 3, far: 0, words: 2, at: "2026-10-31T09:00:00.000Z" });
  assert.deepEqual(b.stat, { raw: 3, far: 0, words: 2, at: "2026-10-31T09:00:00.000Z" }, "the latest search's");
  assert.deepEqual(FB.fbMerge(b, [], TODAY).stat, b.stat, "no new stat: the old one stays");
  assert.ok(!("stat" in FB.fbMerge(null, [], TODAY)), "a record from before v204 has none");
  assert.deepEqual(FB.fbStat({ raw: "7", far: -3, words: 1e9, at: "<b>", x: "secret" }).raw, 7);
  const c = FB.fbStat({ raw: "7", far: -3, words: 1e9, at: "<b>", x: "secret" });
  assert.deepEqual([c.far, c.words, Object.keys(c).sort()], [0, 1000, ["at", "far", "raw", "words"]]);
  assert.match(c.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(FB.fbStat(null), null);
});

test("fbWhy sums the kept searches' counts, null when none has any", () => {
  assert.deepEqual(FB.fbWhy([{ stat: { raw: 24, far: 20, words: 4 } }], 25), { raw: 24, far: 20, words: 4, mi: 25 });
  assert.deepEqual(FB.fbWhy([{ stat: { raw: 10, far: 2, words: 1 } }, { stat: { raw: 5, far: 0, words: 5 } }], 500), { raw: 15, far: 2, words: 6, mi: 500 });
  assert.deepEqual(FB.fbWhy([{ stat: { raw: 3 } }, { items: [] }, null], 77), { raw: 3, far: 0, words: 0, mi: 50 });
  assert.equal(FB.fbWhy([{ items: [] }, null], 25), null);
  assert.equal(FB.fbWhy(null, 25), null);
});

/* ---- 2. the sweep ---- */
function caps() {
  const m = new Map();
  return { m, vCount: async (n, lim) => { const c = m.get(n) || 0; if (c >= lim) return false; m.set(n, c + 1); return true; },
    fbGive: async (n) => { m.set(n, Math.max(0, (m.get(n) || 0) - 1)); }, fbLeft: async (n, lim) => Math.max(0, lim - (m.get(n) || 0)) };
}
function sweep(call) {
  const calls = [], P = parts(), kv = new FakeKV(), C = caps(), tries = new Map();
  const env = { PROWL_ALERTS: kv, APIFY_TOKEN: "t", FB_LIVE: "on" };
  const fbSweep = build("fbSweep", {
    fbLive: FB.fbLive, kvGet, FB_PER_RUN: FB.FB_PER_RUN, FB_CALLS_EACH: 4, FB_GEO_CALLS: 2, FB_GEO_PER_RUN: 2,
    fbTry: async (k) => { const n = (tries.get(k) || 0) + 1; if (n > FB.FB_TRIES) return 0; tries.set(k, n); return n; }, FB_TRIES: FB.FB_TRIES, FB_DAY_LIST_MAX: 2000,
    FB_RUN_ITEMS: FB.FB_RUN_ITEMS, FB_TTL: FB.FB_TTL, fbOf: P.fbOf, fbTerms: P.fbTerms, fbHuntMi: P.fbHuntMi, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey,
    FB_MEMBER_DAY: FB.FB_MEMBER_DAY, FB_USA_MI: FB.FB_USA_MI, ctrName: async (n) => n, vCount: C.vCount, fbGive: C.fbGive,
    fbArea: async () => CELL, fbMerge: FB.fbMerge, scrubPII: (s) => String(s),
    fbCall: async (env, term, cell, n, opt) => { calls.push(term + "|" + (opt.ship ? "ship" : opt.mi)); return call ? call(term, opt) : { ok: true, items: [], raw: 0, cost: 0.00005, stat: { raw: 0, far: 0, words: 0, at: "2026-10-31T08:00:00.000Z" } }; },
  });
  return { kv, C, calls, run: (subs) => fbSweep(env, subs, 50) };
}
const member = (email, hunts, prefs = {}) => ({ email, pro: true, hunts, prefs: Object.assign({ zip: "48375" }, prefs) });

test("a near-me hunt is one search (pickup), an All USA hunt two (pickup within 500 mi and ships)", async () => {
  const S = sweep();
  await S.run([member("m@example.com", ["Panther", "Hull"], { radius: 25, fbusa: ["hull"] })]);
  await S.run([member("m@example.com", ["Panther", "Hull"], { radius: 25, fbusa: ["hull"] })]);
  assert.deepEqual(S.calls, ["panther|25", "hull|500", "hull|ship"]);
  assert.equal(S.kv.json("fb3s:panther"), null);
  assert.ok(S.kv.json("fb3s:hull"));
});

test("10 near-me hunts are swept in a day for one member, one search each; the 11th waits for tomorrow", async () => {
  const H = Array.from({ length: 14 }, (_, i) => "hunt" + String(i).padStart(2, "0")), S = sweep();
  for (let i = 0; i < 12; i++) await S.run([member("m@example.com", H)]);
  assert.deepEqual(S.calls, H.slice(0, 10).map((h) => h + "|50"));
  assert.equal(S.C.m.get("fbm:m@example.com"), 10);
  assert.deepEqual(S.kv.json("fbrot:m@example.com"), { i: 10 });
});

test("the sweep keeps each search's stat with its KV entry, pickup and ships", async () => {
  const S = sweep((term, opt) => ({ ok: true, items: [], raw: 24, cost: 0.01, stat: opt.ship ? { raw: 9, far: 0, words: 9, at: "2026-10-31T08:00:00.000Z" } : { raw: 24, far: 20, words: 4, at: "2026-10-31T08:00:00.000Z" } }));
  await S.run([member("m@example.com", ["Panther"], { fbusa: ["panther"] })]);
  assert.deepEqual(S.kv.json("fb3:panther|42.5,-83.5|500").stat, { raw: 24, far: 20, words: 4, at: "2026-10-31T08:00:00.000Z" });
  assert.deepEqual(S.kv.json("fb3s:panther").stat, { raw: 9, far: 0, words: 9, at: "2026-10-31T08:00:00.000Z" });
});

/* ---- 3. /fb-finds ---- */
class Res {}
const json = (body, status, origin, extra) => Object.assign(new Res(), { status, body, headers: extra });
function routes() {
  const kv = new FakeKV(), P = parts(), C = caps();
  kv.set("sub:pro@example.com", { email: "pro@example.com", tok: "T".repeat(24), pro: true, hunts: ["Panther", "Hull", "Rookwood", "Pyrex", "Roseville"], prefs: { zip: "48375", radius: 25, fbusa: ["hull"] } });
  kv.set("fb3:panther|42.5,-83.5|25", { updated: "2026-10-31T08:00:00.000Z", items: [], stat: { raw: 24, far: 24, words: 0, at: "2026-10-31T08:00:00.000Z" } });
  kv.set("fb3s:panther", { updated: "2026-10-31T09:00:00.000Z", items: [{ id: "3333333", ships: true }], stat: { raw: 5, far: 0, words: 0, at: "2026-10-31T09:00:00.000Z" } });
  kv.set("fb3:hull|42.5,-83.5|500", { updated: "2026-10-30T09:00:00.000Z", items: [], stat: { raw: 10, far: 2, words: 8, at: "2026-10-30T09:00:00.000Z" } });
  kv.set("fb3s:hull", { updated: "2026-10-30T09:00:00.000Z", items: [], stat: { raw: 6, far: 0, words: 6, at: "2026-10-30T09:00:00.000Z" } });
  kv.set("fb3:pyrex|42.5,-83.5|25", { updated: "2026-10-30T09:00:00.000Z", items: [] });   /* before v204: no stat */
  kv.set("fb3:roseville|42.5,-83.5|100", { updated: "2026-10-30T09:00:00.000Z", items: [{ id: "4444444", miles: 10 }], stat: { raw: 1, far: 0, words: 0, at: "2026-10-30T09:00:00.000Z" } });
  const env = { PROWL_ALERTS: kv, OWNER_KEY: "owner-key-0123456789", FB_LIVE: "on", APIFY_TOKEN: "t" };
  const fbWho = build("fbWho", { isOwner: (req, env) => req.headers.get("X-Prowl-Owner") === env.OWNER_KEY, sessMember: async () => null,
    alEmail: (e) => String(e || "").trim().toLowerCase(), alSame: (a, b) => a === b, kvGet, json });
  const fbAreaFor = build("fbAreaFor", { fbOf: P.fbOf, kvGet, FB_OWN_ZIP: "fbownzip" });
  const fbFinds = build("fbFinds", { fbWho, fbAreaFor, fbLive: FB.fbLive, fbTerm: FB.fbTerm, json, vCount: async () => true, ipKey: (x) => x, FB_FINDS_PER_IP: 1000, fbArea: async () => CELL,
    fbTerms: P.fbTerms, fbHunt: P.fbHunt, fbLeft: C.fbLeft, FB_SEARCH_DAY: FB.FB_SEARCH_DAY, Response: Res });
  const PRO = { "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "T".repeat(24) };
  return { finds: (q) => fbFinds(new Request("https://w/fb-finds?" + q, { headers: PRO }), env, new URL("https://w/fb-finds?" + q), "o") };
}

test("/fb-finds?term= returns why; a near-me hunt counts its pickup search only (and shows no shipping finds)", async () => {
  const R = routes();
  const r = await R.finds("term=Panther");
  assert.deepEqual(r.body.why, { raw: 24, far: 24, words: 0, mi: 25 });
  assert.deepEqual(r.body.items, [], "v204: the shipping find is not shown for a near-me hunt");
  assert.equal(r.body.updated, "2026-10-31T08:00:00.000Z");
  assert.equal(r.body.pending, false);
  const h = await R.finds("term=Hull");
  assert.deepEqual(h.body.why, { raw: 16, far: 2, words: 14, mi: 500 }, "an All USA hunt: pickup and ships together");
  assert.equal((await R.finds("term=Pyrex")).body.why, null, "a record from before v204");
  assert.equal((await R.finds("term=Rookwood")).body.why, null, "never searched");
});

test("/fb-finds?all=1 carries why for each hunt", async () => {
  const R = routes();
  const r = await R.finds("all=1");
  assert.deepEqual(r.body.hunts.map((x) => [x.term, x.why]), [
    ["panther", { raw: 24, far: 24, words: 0, mi: 25 }], ["hull", { raw: 16, far: 2, words: 14, mi: 500 }], ["rookwood", null], ["pyrex", null],
    ["roseville", null]]);
  assert.deepEqual(r.body.hunts[4].items.map((x) => x.id), ["4444444"], "a wider radius's finds still show, without its counts (another radius's search)");
});

test("wiring: every kept search saves its stat; the version", () => {
  for (const f of ["fbSweep", "fbSearch", "fbTestRun"]) assert.match(indexFn(f), /fbMerge\(old, r\.items, day, undefined, r\.stat\)/, f);
  assert.match(indexFn("fbSweep"), /if \(mi === FB_USA_MI\) jobs\.push\(\{ k: "s\|" \+ term/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 204, "v204 or later");
  assert.match(INDEX, /^ \*   v204: /m, "a header line for v204");
});

test("review fix: no reason until the hunt's own pickup search has run (not from the shared ships search alone)", () => {
  const src = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(src, /const why = pick \? fbWhy\(usa \? \[pick, ship\] : \[pick\], mi\) : null;/);
});
