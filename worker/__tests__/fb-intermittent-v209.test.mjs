/* v209 (Matt, 2026-11-01: Facebook finds for his hunt "mc escher" "sometimes show and sometimes don't"):
   1. a signed-in member reads their own ZIP and radius even with the owner key (the last admin test's fbownzip made
      Matt's own devices read another area than the one his hunts are swept in); the owner key alone still reads it;
   4. an All USA hunt whose shipping search alone has run gives a reason (why.ship);
   7. the sweep's turn goes to the hunts searched longest ago, so adding, removing or moving hunts skips none;
   and All USA (Matt: "I don't want to see just shipped. I will reach out to them to see if they would ship."): its own
   search keeps every listing at any distance, pickup too (miles when it has a point), plus the ships search, 2 calls.
   fb.js is imported; the index.js parts are taken out with fakes. Run: node --test worker/__tests__/fb-intermittent-v209.test.mjs */
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
const CARLETON = FB.fbCell(42.06, -83.39), NOVI = FB.fbCell(42.48, -83.47);
const alPrefsT = (s) => ({ zip: (s && s.prefs && s.prefs.zip) || "", radius: (s && s.prefs && s.prefs.radius) || 50, fbusa: (s && s.prefs && s.prefs.fbusa) || [] });
const fbOf = build("fbOf", { alPrefs: alPrefsT, fbMi: FB.fbMi });
const fbHuntMi = build("fbHuntMi", { FB_USA_MI: FB.FB_USA_MI });
const fbHunt = build("fbHunt", { fbHuntMi, kvGet, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey, fbJoin: FB.fbJoin, fbWhy: FB.fbWhy, FB_USA_MI: FB.FB_USA_MI });
const fbTerms = build("fbTerms", { alActive: (env, s) => s.hunts.slice(0, 100), fbTerm: FB.fbTerm });
const fbAreaFor = build("fbAreaFor", { fbOf, kvGet, FB_OWN_ZIP: "fbownzip", FB_USA_MI: FB.FB_USA_MI, fbMi: FB.fbMi });
const MATT = { email: "matt@example.com", tok: "M".repeat(24), pro: true, hunts: ["MC Escher"], prefs: { zip: "48117", radius: 50 } };
const FOUR = [["100000001", 22], ["100000002", 27], ["100000003", 24], ["100000004", 20]].map(([id, miles]) => ({ id, title: "MC Escher " + id, miles, found: TODAY }));

/* ---- 1. the owner key and a signed-in member ---- */
test("fbAreaFor: owner key + session reads the member's own ZIP and radius, not the last test's; the owner key alone still reads the test's", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv };
  kv.set("fbownzip", { zip: "48375", mi: 25 });
  const u = (q) => new URL("https://w/fb-finds?term=mc+escher" + q);
  assert.deepEqual(await fbAreaFor(env, { sub: MATT, owner: true }, u("")), { zip: "48117", mi: 50, usa: [] }, "Matt's desktop (owner key and signed in)");
  assert.deepEqual(await fbAreaFor(env, { sub: MATT, owner: false }, u("")), { zip: "48117", mi: 50, usa: [] }, "Matt's phone");
  assert.equal((await fbAreaFor(env, { sub: MATT, owner: true }, u("&zip=10001"))).zip, "48117", "&zip= is for the owner key alone");
  assert.deepEqual(await fbAreaFor(env, { sub: null, owner: true }, u("")), { zip: "48375", mi: 25, usa: [] }, "the owner key alone: the last test's area and distance");
  assert.equal((await fbAreaFor(env, { sub: null, owner: true }, u("&zip=10001"))).zip, "10001");
  kv.m.delete("fbownzip");
  assert.equal((await fbAreaFor(env, { sub: null, owner: true }, u(""))).zip, "", "no test kept: no area");
});

test("/fb-finds: Matt's devices agree, with or without the owner key, after a test at another ZIP", async () => {
  class Res {}
  const json = (body, status) => Object.assign(new Res(), { status, body });
  const kv = new FakeKV();
  kv.set("sub:matt@example.com", MATT);
  kv.set(FB.fbPickKey("mc escher", CARLETON, 50), { updated: new Date().toISOString(), items: FOUR });
  kv.set("fbownzip", { zip: "48375", mi: 50 });   /* the last Diagnose › Facebook test, from Novi */
  const env = { PROWL_ALERTS: kv, OWNER_KEY: "owner-key-0123456789", FB_LIVE: "on" };
  const fbWho = build("fbWho", { isOwner: (req, env) => req.headers.get("X-Prowl-Owner") === env.OWNER_KEY, sessMember: async () => null,
    alEmail: (e) => String(e || "").trim().toLowerCase(), alSame: (a, b) => a === b, kvGet, json });
  const fbFinds = build("fbFinds", { fbWho, fbAreaFor, fbLive: FB.fbLive, fbTerm: FB.fbTerm, json, vCount: async () => true, ipKey: (x) => x, FB_FINDS_PER_IP: 1000,
    fbArea: async (env, zip) => (zip === "48117" ? CARLETON : zip === "48375" ? NOVI : null), fbTerms, fbHunt, fbLeft: async () => 5, FB_SEARCH_DAY: 5, Response: Res });
  const ask = (h) => fbFinds(new Request("https://w/fb-finds?term=mc%20escher", { headers: h }), env, new URL("https://w/fb-finds?term=mc%20escher"), "o");
  const me = { "X-Prowl-Email": "matt@example.com", "X-Prowl-Tok": "M".repeat(24) };
  const phone = await ask(me), desk = await ask(Object.assign({ "X-Prowl-Owner": "owner-key-0123456789" }, me));
  assert.equal(phone.body.items.length, 4);
  assert.equal(desk.body.items.length, 4, "the owner key no longer moves a signed-in owner to the test's area");
  assert.equal(desk.body.pending, false);
  const alone = await ask({ "X-Prowl-Owner": "owner-key-0123456789" });
  assert.equal(alone.body.pending, true, "the owner key alone reads the test's area (Novi), as before");
});

/* ---- 4. All USA, nothing yet but the ships search ---- */
test("fbHunt: an All USA hunt whose ships search alone has run says so (why.ship), with its counts or without", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, o = { zip: "48117", mi: 50, usa: ["mc escher"] };
  kv.set(FB.fbShipKey("mc escher"), { updated: new Date().toISOString(), items: [], stat: { raw: 0, far: 0, words: 0, at: new Date().toISOString() } });
  let v = await fbHunt(env, o, CARLETON, "mc escher");
  assert.equal(v.usa, true);
  assert.deepEqual(v.why, { raw: 0, far: 0, words: 0, mi: 500, ship: true });
  kv.set(FB.fbShipKey("mc escher"), { updated: new Date().toISOString(), items: [] });   /* a record from before v204: no counts */
  v = await fbHunt(env, o, CARLETON, "mc escher");
  assert.deepEqual(v.why, { raw: 0, far: 0, words: 0, mi: 500, ship: true });
  kv.set(FB.fbPickKey("mc escher", CARLETON, 500), { updated: new Date().toISOString(), items: [], stat: { raw: 7, far: 0, words: 7, at: new Date().toISOString() } });
  v = await fbHunt(env, o, CARLETON, "mc escher");
  assert.equal(v.why.ship, undefined, "once its own search has run, the usual reason");
  assert.equal(v.why.raw, 7);
  v = await fbHunt(env, { zip: "48117", mi: 50, usa: [] }, CARLETON, "mc escher");
  assert.equal(v.why, null, "a near-me hunt never reads the ships search");
});

/* ---- All USA: every listing, any distance, plus the ships search ---- */
const L = (id, loc) => ({ id: String(id), marketplace_listing_title: "MC Escher print " + id, listing_price: { amount: "40" }, location: loc });
test("All USA keeps pickup listings at any distance (miles when they have a point) and the ones with no point; near me still drops them", () => {
  const raw = [L(1111111, { latitude: 42.28, longitude: -83.74 }), L(2222222, { latitude: 34.05, longitude: -118.24 }), L(3333333, { reverse_geocode: { city: "Austin", state: "TX" } }),
    { id: "4444444", marketplace_listing_title: "Land Rover", location: { latitude: 42.1, longitude: -83.4 } }];
  const st = {};
  const usa = FB.fbClean(raw, TODAY, { term: "mc escher", lat: CARLETON.lat, lng: CARLETON.lng, mi: FB.FB_USA_MI }, st);
  assert.deepEqual(usa.map((x) => x.id), ["1111111", "2222222", "3333333"]);
  assert.ok(usa[0].miles > 10 && usa[0].miles < 30, "Ann Arbor carries its miles");
  assert.ok(usa[1].miles > 1900, "Los Angeles too: Matt can ask the seller to ship");
  assert.equal(usa[2].miles, undefined, "no point, no miles");
  assert.ok(usa.every((x) => !x.ships));
  assert.deepEqual(st, { far: 0, words: 1 }, "the word match still holds");
  const near = FB.fbClean(raw, TODAY, { term: "mc escher", lat: CARLETON.lat, lng: CARLETON.lng, mi: 50 });
  assert.deepEqual(near.map((x) => x.id), ["1111111"]);
  const inp = FB.fbInput("mc escher", CARLETON, { mi: FB.FB_USA_MI });
  assert.equal(inp.radiusKm, FB.FB_SHIP_KM, "Facebook's widest radius");
  assert.ok(!("deliveryMethod" in inp), "pickup and shipping alike");
  assert.equal(FB.fbInput("mc escher", CARLETON, { ship: true }).deliveryMethod, "shipping");
});

test("fbHunt: an All USA hunt borrowing an earlier record keeps every distance; a near-me one only its radius", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv };
  kv.set(FB.fbPickKey("mc escher", CARLETON, 100), { updated: new Date().toISOString(), items: [{ id: "1", miles: 80 }, { id: "2", miles: 20 }, { id: "3" }] });
  const usa = await fbHunt(env, { zip: "48117", mi: 50, usa: ["mc escher"] }, CARLETON, "mc escher");
  assert.deepEqual(usa.items.map((x) => x.id).sort(), ["1", "2", "3"]);
  const near = await fbHunt(env, { zip: "48117", mi: 50, usa: [] }, CARLETON, "mc escher");
  assert.deepEqual(near.items.map((x) => x.id), ["2"]);
});

/* ---- 7. the rotation ---- */
function caps() {
  const m = new Map();
  return { m, vCount: async (n, lim) => { const c = m.get(n) || 0; if (c >= lim) return false; m.set(n, c + 1); return true; }, fbGive: async (n) => { m.set(n, Math.max(0, (m.get(n) || 0) - 1)); } };
}
let clock = Date.now();
function sweep(fail = () => false) {
  const kv = new FakeKV(), C = caps(), tries = new Map(), calls = [];
  const env = { PROWL_ALERTS: kv, APIFY_TOKEN: "t", FB_LIVE: "on" };
  const fbSweep = build("fbSweep", {
    fbLive: FB.fbLive, kvGet, FB_PER_RUN: FB.FB_PER_RUN, FB_CALLS_EACH: 4, FB_GEO_CALLS: 2, FB_GEO_PER_RUN: 2,
    fbTry: async (k) => { const n = (tries.get(k) || 0) + 1; if (n > FB.FB_TRIES) return 0; tries.set(k, n); return n; }, FB_TRIES: FB.FB_TRIES, FB_DAY_LIST_MAX: 2000,
    FB_RUN_ITEMS: FB.FB_RUN_ITEMS, FB_TTL: FB.FB_TTL, fbOf, fbTerms, fbHuntMi, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey,
    FB_MEMBER_DAY: FB.FB_MEMBER_DAY, FB_USA_MI: FB.FB_USA_MI, ctrName: async (n) => n, vCount: C.vCount, fbGive: C.fbGive,
    fbArea: async () => CARLETON, fbMerge: FB.fbMerge, scrubPII: (s) => String(s),
    Date: class extends Date { static now() { return (clock += 300000); } },   /* runs 5 minutes apart, as the alert clock */
    fbCall: async (env, term, cell, n, opt) => {
      const c = term + (opt.ship ? "|ship" : opt.mi === FB.FB_USA_MI ? "|usa" : "");
      calls.push(c);
      return fail(c) ? { ok: false, error: "apify timed out" } : { ok: true, items: [], raw: 0, cost: 0 };
    },
  });
  const day = async (sub) => { C.m.clear(); tries.clear(); kv.m.delete("fb3day:" + TODAY); calls.length = 0; for (let i = 0; i < 8; i++) await fbSweep(env, [sub], 50); return calls.slice(); };
  return { kv, day };
}
const H12 = Array.from({ length: 12 }, (_, i) => "hunt" + String(i).padStart(2, "0"));
const mem = (hunts, prefs = {}) => ({ email: "m@example.com", pro: true, hunts, prefs: Object.assign({ zip: "48117" }, prefs) });

test("rotation: a hunt added at the front, one removed and the list reordered skip none: the ones searched longest ago go next", async () => {
  const S = sweep();
  assert.deepEqual(await S.day(mem(H12)), H12.slice(0, 10), "day 1: in order");
  /* a new hunt at the front, hunt05 gone, hunt10 moved to the end: under the old pointer (i: 10) hunt09 came round again and hunt11 waited */
  const list = ["new hunt"].concat(H12.filter((h) => h !== "hunt05" && h !== "hunt10"), ["hunt10"]);
  const d2 = await S.day(mem(list));
  assert.deepEqual(d2.slice(0, 3).sort(), ["hunt10", "hunt11", "new hunt"], "day 2: the never-searched first");
  assert.deepEqual(d2.slice(3), ["hunt00", "hunt01", "hunt02", "hunt03", "hunt04", "hunt06", "hunt07"], "then the oldest searches, in turn");
  assert.ok(!("hunt05" in S.kv.json("fbrot:m@example.com").t), "a removed hunt drops out of the record");
  const d3 = await S.day(mem(list));
  assert.deepEqual(d3.slice(0, 2), ["hunt08", "hunt09"], "day 3: the last two of day 1 before the rest of day 2");
  assert.deepEqual(new Set(d2.concat(d3)).size, list.length, "every hunt had its turn in two days");
});

test("rotation: an old record ({ i } only) keeps its place; an All USA hunt is still two calls (its own search and ships)", async () => {
  const S = sweep();
  S.kv.set("fbrot:m@example.com", { i: 7 });
  const d = await S.day(mem(H12, { fbusa: ["hunt08"] }));
  assert.deepEqual(d, ["hunt07", "hunt08|usa", "hunt08|ship", "hunt09", "hunt10", "hunt11", "hunt00", "hunt01", "hunt02", "hunt03"]);
  const rot = S.kv.json("fbrot:m@example.com");
  assert.equal(rot.i, 7);
  assert.equal(Object.keys(rot.t).length, 9, "nine hunts searched, one KV record");
});

/* review fix: a hunt whose search keeps failing had its turn once its tries are used, so it no longer goes first every day */
const n03 = (d) => d.filter((c) => /^hunt03/.test(c)).length;
test("rotation: a hunt whose search always fails uses its 2 tries, then waits its turn like the rest", async () => {
  const S = sweep((c) => c === "hunt03");
  const d1 = await S.day(mem(H12)), d2 = await S.day(mem(H12)), d3 = await S.day(mem(H12));
  assert.equal(n03(d1), 2, "day 1: its 2 tries");
  assert.equal(d2[0], "hunt09", "day 2: the never-searched go first, not the failing hunt: " + d2);
  assert.equal(n03(d3), 0, "day 3: not again until its turn comes round: " + d3);
  assert.equal(new Set(d1.concat(d2, d3)).size, 12, "every hunt had its turn");
});

test("rotation: an All USA hunt whose ships search fails waits its turn the next day (its own search is not redone daily)", async () => {
  const S = sweep((c) => c === "hunt03|ship"), m = mem(H12, { fbusa: ["hunt03"] });
  const d1 = await S.day(m), d2 = await S.day(m);
  assert.deepEqual(d1.filter((c) => /^hunt03/.test(c)), ["hunt03|usa", "hunt03|ship", "hunt03|ship"]);
  assert.deepEqual(d2.slice(0, 4), ["hunt08", "hunt09", "hunt10", "hunt11"], "day 2: the hunts not searched yet go first, not its own search again: " + d2);
  assert.ok(d2.indexOf("hunt03|usa") > d2.indexOf("hunt02"), "then it waits its turn behind the ones searched before it");
});

test("rotation: a hunt whose try was refused (nothing went out) is not stamped", async () => {
  const kv = new FakeKV(), C = caps(), env = { PROWL_ALERTS: kv, APIFY_TOKEN: "t", FB_LIVE: "on" };
  const fbSweep = build("fbSweep", {
    fbLive: FB.fbLive, kvGet, FB_PER_RUN: FB.FB_PER_RUN, FB_CALLS_EACH: 4, FB_GEO_CALLS: 2, FB_GEO_PER_RUN: 2,
    fbTry: async () => 0, FB_TRIES: FB.FB_TRIES, FB_DAY_LIST_MAX: 2000,
    FB_RUN_ITEMS: FB.FB_RUN_ITEMS, FB_TTL: FB.FB_TTL, fbOf, fbTerms, fbHuntMi, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey,
    FB_MEMBER_DAY: FB.FB_MEMBER_DAY, FB_USA_MI: FB.FB_USA_MI, ctrName: async (n) => n, vCount: C.vCount, fbGive: C.fbGive,
    fbArea: async () => CARLETON, fbMerge: FB.fbMerge, scrubPII: (s) => String(s), Date,
    fbCall: async () => { throw new Error("no call expected"); },
  });
  const r = await fbSweep(env, [mem(H12.slice(0, 3))], 50);
  assert.equal(r.calls, 0);
  const rot = kv.json("fbrot:m@example.com");
  assert.ok(!rot || !rot.t || !Object.keys(rot.t).length, "nothing stamped: " + JSON.stringify(rot));
});
