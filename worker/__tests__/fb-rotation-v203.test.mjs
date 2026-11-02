/* v203 (Matt, 2026-10-31: "10 a day is fine"; "local plus ship with a radius. All USA."): each Pro member's hunts get
   FB_MEMBER_DAY Facebook searches a day, in turn from a pointer kept in KV; a hunt is a pickup search within the member's
   radius (500 miles for an All USA hunt) and a shipping search shared by everyone; off-topic and far-away listings are
   dropped; /fb-finds?all=1 for the Store tab and POST /fb-search, 5 a day. fb.js is imported; the index.js parts are
   taken out with fakes for KV, Caps and Apify. Run: node --test worker/__tests__/fb-rotation-v203.test.mjs */
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
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); if (o && o.expirationTtl) this.ttl.set(k, o.expirationTtl); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const kvGet = async (env, k, d) => { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const TODAY = new Date().toISOString().slice(0, 10);
const CELL = FB.fbCell(42.5, -83.5);
/* Caps as a Map: take (lim 0 only reads), give */
function caps() {
  const m = new Map();
  return {
    m,
    vCount: async (n, lim) => { const c = m.get(n) || 0; if (c >= lim) return false; m.set(n, c + 1); return true; },
    fbGive: async (n) => { m.set(n, Math.max(0, (m.get(n) || 0) - 1)); },
    fbLeft: async (n, lim) => Math.max(0, lim - (m.get(n) || 0)),
  };
}
const alPrefsT = (s) => ({ zip: (s && s.prefs && s.prefs.zip) || "", radius: (s && s.prefs && s.prefs.radius) || 50, fbusa: (s && s.prefs && s.prefs.fbusa) || [] });
function parts() {
  const fbOf = build("fbOf", { alPrefs: alPrefsT, fbMi: FB.fbMi });
  const fbHuntMi = build("fbHuntMi", { FB_USA_MI: FB.FB_USA_MI });
  const fbHunt = build("fbHunt", { fbHuntMi, kvGet, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey, fbJoin: FB.fbJoin, fbWhy: FB.fbWhy, FB_USA_MI: FB.FB_USA_MI });
  const fbTerms = build("fbTerms", { alActive: (env, s) => s.hunts.slice(0, 100), fbTerm: FB.fbTerm });
  return { fbOf, fbHuntMi, fbHunt, fbTerms };
}
const L = (id, extra = {}) => ({ id: String(id), marketplace_listing_title: "Ceramic Panther " + id, listing_price: { amount: "40" },
  location: { latitude: 42.5, longitude: -83.5, reverse_geocode: { city: "Novi", state: "MI" } }, ...extra });

/* ---- 1. fb.js ---- */
test("fbMatch: every hunt word starts some title word; plurals count; stop words and an empty hunt ask nothing", () => {
  assert.equal(FB.fbMatch("panther", "Vintage Black Panthers pair"), true, "panther finds Panthers");
  assert.equal(FB.fbMatch("panthers", "Ceramic Panther TV lamp"), true, "panthers finds Panther");
  assert.equal(FB.fbMatch("ceramic panther", "2004 Land Rover Discovery"), false, "Facebook's similar items are dropped");
  assert.equal(FB.fbMatch("ceramic panther", "Ceramic cat"), false, "every word, not any");
  assert.equal(FB.fbMatch("the panther of the night", "Panther night light"), true, "stop words are not asked for");
  assert.equal(FB.fbMatch("pyrex dishes", "Pyrex dish set"), true);
  assert.equal(FB.fbMatch("roseville vases", "Roseville vase"), true);
  assert.equal(FB.fbMatch("hull", "Seashell bowl"), false, "the start of a word, not inside one");
  assert.equal(FB.fbMatch("", "anything"), true);
  assert.equal(FB.fbMatch("the and of", "anything"), true, "only stop words: nothing to ask");
  assert.equal(FB.fbMatch("panther", ""), false);
});

test("fbMiles: haversine miles, rounded", () => {
  assert.equal(FB.fbMiles(42.5, -83.5, 42.5, -83.5), 0);
  assert.ok(Math.abs(FB.fbMiles(40.7128, -74.006, 34.0522, -118.2437) - 2445) <= 5, "New York to Los Angeles");
  assert.equal(FB.fbMiles(42.5, -83.5, 43.5, -83.5), 69, "a degree of latitude");
  assert.equal(FB.fbMiles(42.5, -83.5, 43.5, -83.5), FB.fbMiles(43.5, -83.5, 42.5, -83.5));
});

test("fbClean with a hunt: off-topic, far and placeless pickup listings dropped, miles kept; the shipping search keeps far ones, ships: true", () => {
  const raw = [L(1111111), L(2222222, { location: { latitude: 43.5, longitude: -83.5 } }), L(3333333, { location: { reverse_geocode: { city: "Novi" } } }),
    L(4444444, { marketplace_listing_title: "Land Rover Discovery" }), L(5555555, { location: { latitude: 42.95, longitude: -83.5 } }), L(6666666, { location: { latitude: 0, longitude: 0 } })];
  const near = FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, mi: 25 });
  assert.deepEqual(near.map((x) => [x.id, x.miles]), [["1111111", 0]], "69 mi and 31 mi are past 25 + 5; no point, or 0,0, is dropped; the Land Rover is off-topic");
  assert.ok(!("ships" in near[0]));
  const fifty = FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, mi: 50 });
  assert.deepEqual(fifty.map((x) => [x.id, x.miles]), [["1111111", 0], ["5555555", 31]]);
  const usa = FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, mi: 500 });
  assert.deepEqual(usa.map((x) => [x.id, x.miles]), [["1111111", 0], ["2222222", 69], ["3333333", undefined], ["5555555", 31], ["6666666", undefined]], "v209: All USA keeps every distance and the placeless ones (no miles); the Land Rover still goes");
  const ship = FB.fbClean(raw, TODAY, { term: "panther", lat: 42.5, lng: -83.5, ship: true });
  assert.deepEqual(ship.map((x) => [x.id, x.miles, x.ships]), [["1111111", undefined, true], ["2222222", undefined, true], ["3333333", undefined, true], ["5555555", undefined, true], ["6666666", undefined, true]],
    "shipping does not depend on distance and carries none (review fix: shared by every member, so no miles from one ZIP); the Land Rover still goes");
  const plain = FB.fbClean(raw, TODAY);
  assert.equal(plain.length, 6, "without a hunt: v200's behaviour");
  assert.ok(plain.every((x) => !("miles" in x) && !("ships" in x)));
  assert.doesNotMatch(JSON.stringify(ship), /latitude|longitude/, "the listing's point is not kept");
});

test("fbInput: miles become km, the shipping search is 805 km with deliveryMethod shipping, no option is v200's 40 km", () => {
  assert.equal(FB.fbInput("x", CELL).radiusKm, 40);
  assert.ok(!("deliveryMethod" in FB.fbInput("x", CELL)));
  assert.deepEqual([25, 50, 100, 500].map((mi) => FB.fbInput("x", CELL, { mi }).radiusKm), [40, 80, 161, 805]);
  assert.equal(FB.fbInput("x", CELL, { mi: 77 }).radiusKm, 80, "an unknown radius is 50 miles");
  const s = FB.fbInput("x", CELL, { ship: true });
  assert.deepEqual([s.radiusKm, s.deliveryMethod], [805, "shipping"]);
  assert.ok(!("cookies" in s));
  const rq = FB.fbRequest({}, "tok_SECRET", "x", CELL, 24, { ship: true });
  assert.equal(JSON.parse(rq.init.body).deliveryMethod, "shipping");
  assert.doesNotMatch(rq.url, /SECRET/, "the token stays in the header");
  assert.equal(rq.init.headers.Authorization, "Bearer tok_SECRET");
});

test("fbJoin: pickup nearest first, then the ones that ship, one per listing, 60 at most, the latest update", () => {
  const pick = { updated: "2026-10-30T08:00:00.000Z", items: [{ id: "1", miles: 30 }, { id: "2", miles: 3 }, { id: "3" }, { id: "4", miles: 10 }] };
  const ship = { updated: "2026-10-31T08:00:00.000Z", items: [{ id: "4", ships: true }, { id: "5", ships: true }, null, { id: "" }] };
  const j = FB.fbJoin(pick, ship);
  assert.deepEqual(j.items.map((x) => x.id), ["2", "4", "1", "3", "5"]);
  assert.equal(j.items[1].ships, undefined, "the pickup copy wins");
  assert.equal(j.updated, "2026-10-31T08:00:00.000Z");
  assert.deepEqual(FB.fbJoin(null, null), { items: [], near: [], updated: "" });   /* v217: + near */
  const many = { items: Array.from({ length: 70 }, (_, i) => ({ id: String(i), miles: i })) };
  assert.equal(FB.fbJoin(many, null).items.length, 60);
  assert.deepEqual(pick.items.map((x) => x.id), ["1", "2", "3", "4"], "the kept list is not reordered in place");
});

test("the keys: fb3:<hunt>|<cell>|<miles> for pickup, fb3s:<hunt> for shipping, an unknown radius is 50", () => {
  assert.equal(FB.fbPickKey("panther", CELL, 25), "fb3:panther|42.5,-83.5|25");
  assert.equal(FB.fbPickKey("panther", CELL, 500), "fb3:panther|42.5,-83.5|500");
  assert.equal(FB.fbPickKey("panther", CELL, "x"), "fb3:panther|42.5,-83.5|50");
  assert.equal(FB.fbShipKey("panther"), "fb3s:panther");
  assert.deepEqual([FB.FB_MEMBER_DAY, FB.FB_SEARCH_DAY, FB.FB_USA_MI], [10, 5, 500]);
});

/* ---- 2. the sweep ---- */
function sweep({ kv = new FakeKV(), C = caps(), tries = new Map(), call } = {}) {
  const calls = [], P = parts();
  kv.set("fbz:48375", { lat: 42.5, lng: -83.5 });
  const env = { PROWL_ALERTS: kv, APIFY_TOKEN: "t", FB_LIVE: "on" };
  const fbSweep = build("fbSweep", {
    fbLive: FB.fbLive, kvGet, FB_PER_RUN: FB.FB_PER_RUN, FB_CALLS_EACH: 4, FB_GEO_CALLS: 2, FB_GEO_PER_RUN: 2,
    fbTry: async (k) => { const n = (tries.get(k) || 0) + 1; if (n > FB.FB_TRIES) return 0; tries.set(k, n); return n; }, FB_TRIES: FB.FB_TRIES, FB_DAY_LIST_MAX: 2000,
    FB_RUN_ITEMS: FB.FB_RUN_ITEMS, FB_TTL: FB.FB_TTL, fbOf: P.fbOf, fbTerms: P.fbTerms, fbHuntMi: P.fbHuntMi, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey,
    FB_MEMBER_DAY: FB.FB_MEMBER_DAY, FB_USA_MI: FB.FB_USA_MI, ctrName: async (n) => n, vCount: C.vCount, fbGive: C.fbGive,
    fbArea: async (env, zip) => (zip === "48375" || zip === "48377" ? CELL : zip === "10001" ? FB.fbCell(40.75, -74.0) : null),
    fbMerge: FB.fbMerge, scrubPII: (s) => String(s),
    fbCall: async (env, term, cell, n, opt) => { calls.push(term + "|" + cell.key + "|" + (opt.ship ? "ship" : opt.mi)); return call ? call(term, opt) : { ok: true, items: [{ id: "123456", title: term, found: TODAY }], raw: 1, cost: 0.00055 }; },
  });
  return { fbSweep, kv, env, calls, C, tries, run: (subs, room = 50) => fbSweep(env, subs, room) };
}
const member = (email, zip, hunts, prefs = {}) => ({ email, pro: true, hunts, prefs: Object.assign({ zip }, prefs) });
const H30 = Array.from({ length: 30 }, (_, i) => "hunt" + String(i).padStart(2, "0"));
/* the next day: Caps and the day's list start over; the finds and the pointer stay */
function nextDay(S) { S.C.m.clear(); S.tries.clear(); S.kv.m.delete("fb3day:" + TODAY); S.calls.length = 0; }

test("30 hunts: at most 10 counted searches a day however many runs, and the next day starts where the last stopped", async () => {
  const sub = member("m@example.com", "48375", H30), S = sweep();
  for (let i = 0; i < 12; i++) await S.run([sub]);
  assert.equal(S.calls.length, 10, "10 a day");
  assert.equal(S.C.m.get("fbm:m@example.com"), 10);
  assert.deepEqual(S.calls.map((c) => c.split("|")[0]), H30.slice(0, 10), "in turn; v204: a near-me hunt is one (pickup) search, so 10 hunts a day");
  assert.ok(S.calls.every((c) => /\|50$/.test(c)), "no shipping search for a near-me hunt");
  assert.deepEqual(Object.keys(S.kv.json("fbrot:m@example.com").t).sort(), H30.slice(0, 10), "v209: each searched hunt's time");
  nextDay(S);
  for (let i = 0; i < 12; i++) await S.run([sub]);
  assert.deepEqual(S.calls.map((c) => c.split("|")[0]), H30.slice(10, 20), "resumed where it stopped");
  assert.deepEqual(Object.keys(S.kv.json("fbrot:m@example.com").t).sort(), H30.slice(0, 20));
  nextDay(S); for (let i = 0; i < 6; i++) await S.run([sub]);
  assert.deepEqual(S.calls.map((c) => c.split("|")[0]), H30.slice(20, 30));
  nextDay(S); await S.run([sub]);
  assert.deepEqual(S.calls, ["hunt00|42.5,-83.5|50", "hunt01|42.5,-83.5|50"], "after the last hunt, round to the first");
});

test("a day that ends with the run budget, not the member's 10, still moves the pointer on (bug fix)", async () => {
  const sub = member("m@example.com", "48375", H30), S = sweep();
  for (let i = 0; i < 3; i++) await S.run([sub]);   /* 6 calls: the runs end before the member's 10 */
  assert.equal(S.calls.length, 6);
  assert.deepEqual(Object.keys(S.kv.json("fbrot:m@example.com").t).sort(), H30.slice(0, 6), "v209: the six searched; the rest wait their turn");
  nextDay(S);
  await S.run([sub]);
  assert.deepEqual(S.calls, ["hunt06|42.5,-83.5|50", "hunt07|42.5,-83.5|50"]);
});

test("a job another member did today is free; the shipping search (All USA hunts, v204) is shared across areas", async () => {
  const a = member("a@example.com", "48375", ["Panther"]), b = member("b@example.com", "48377", ["panther"]);
  const c = member("c@example.com", "10001", ["Panther"], { fbusa: ["panther"] }), d = member("d@example.com", "48375", ["Panther"], { fbusa: ["panther"] });
  const S = sweep();
  for (let i = 0; i < 3; i++) await S.run([a, b, c, d]);
  assert.deepEqual(S.calls, ["panther|42.5,-83.5|50", "panther|40.8,-74|500", "panther|40.8,-74|ship", "panther|42.5,-83.5|500"],
    "b's area and radius are a's; d only needs its 500-mile pickup search, c's shipping one is shared");
  assert.deepEqual(["a", "b", "c", "d"].map((x) => S.C.m.get("fbm:" + x + "@example.com") || 0), [1, 0, 2, 1]);
  const e = member("e@example.com", "48375", ["panther"], { radius: 100 });
  await S.run([e]);
  assert.deepEqual(S.calls.slice(4), ["panther|42.5,-83.5|100"], "another radius is another pickup search");
});

test("an All USA hunt (prefs.fbusa) searches 500 miles and keeps its finds apart", async () => {
  const sub = member("m@example.com", "48375", ["Panther", "Hull"], { radius: 25, fbusa: ["panther"] }), S = sweep();
  await S.run([sub]);
  await S.run([sub]);
  assert.deepEqual(S.calls, ["panther|42.5,-83.5|500", "panther|42.5,-83.5|ship", "hull|42.5,-83.5|25"], "v204: ships only for the All USA hunt");
  assert.ok(S.kv.json("fb3:panther|42.5,-83.5|500"));
  assert.ok(S.kv.json("fb3:hull|42.5,-83.5|25"));
});

test("a capped call gives the member's search back and stops the day", async () => {
  const sub = member("m@example.com", "48375", ["Panther", "Hull"]), S = sweep({ call: () => ({ ok: false, capped: true }) });
  await S.run([sub]);
  assert.equal(S.calls.length, 1);
  assert.equal(S.C.m.get("fbm:m@example.com"), 0);
  assert.equal(S.kv.json("fb3day:" + TODAY)._cap, 1);
  await S.run([sub, member("o@example.com", "10001", ["Rookwood"])]);
  assert.equal(S.calls.length, 1, "nobody else today");
});

test("free members and members without an email are never searched", async () => {
  const S = sweep();
  await S.run([{ email: "f@example.com", pro: false, hunts: ["x"], prefs: { zip: "48375" } }, { pro: true, hunts: ["x"], prefs: { zip: "48375" } }]);
  assert.equal(S.calls.length, 0);
  assert.equal(S.C.m.size, 0);
});

/* ---- 3. /fb-finds?all=1 and /fb-search ---- */
class Res {}
const json = (body, status, origin, extra) => Object.assign(new Res(), { status, body, headers: extra });
function routes({ live = "on", C = caps(), call } = {}) {
  const kv = new FakeKV(), P = parts(), calls = [];
  kv.set("sub:pro@example.com", { email: "pro@example.com", tok: "T".repeat(24), pro: true, hunts: ["Panther", "Hull", "Rookwood"], prefs: { zip: "48375", radius: 25, fbusa: ["hull"] } });
  kv.set("sub:free@example.com", { email: "free@example.com", tok: "F".repeat(24), pro: false, hunts: ["x"], prefs: { zip: "48375" } });
  kv.set("sub:nozip@example.com", { email: "nozip@example.com", tok: "N".repeat(24), pro: true, hunts: ["x"], prefs: {} });
  kv.set("fb3:panther|42.5,-83.5|25", { updated: "2026-10-31T08:00:00.000Z", items: [{ id: "1111111", miles: 12 }, { id: "2222222", miles: 2 }] });
  kv.set("fb3s:panther", { updated: "2026-10-31T09:00:00.000Z", items: [{ id: "3333333", ships: true }] });
  kv.set("fb3:hull|42.5,-83.5|500", { updated: "2026-10-30T09:00:00.000Z", items: Array.from({ length: 20 }, (_, i) => ({ id: String(4000000 + i), miles: i })) });
  const env = { PROWL_ALERTS: kv, OWNER_KEY: "owner-key-0123456789", FB_LIVE: live, APIFY_TOKEN: "t" };
  const fbWho = build("fbWho", { isOwner: (req, env) => req.headers.get("X-Prowl-Owner") === env.OWNER_KEY, sessMember: async () => null,
    alEmail: (e) => String(e || "").trim().toLowerCase(), alSame: (a, b) => a === b, kvGet, json });
  const fbAreaFor = build("fbAreaFor", { fbOf: P.fbOf, kvGet, FB_OWN_ZIP: "fbownzip" });
  const fbArea = async (env, zip) => (zip === "48375" ? CELL : null);
  const fbFinds = build("fbFinds", { fbWho, fbAreaFor, fbLive: FB.fbLive, fbTerm: FB.fbTerm, json, vCount: async () => true, ipKey: (x) => x, FB_FINDS_PER_IP: 1000, fbArea,
    fbTerms: P.fbTerms, fbHunt: P.fbHunt, fbLeft: C.fbLeft, FB_SEARCH_DAY: FB.FB_SEARCH_DAY, Response: Res });
  const readJson = async (req) => { try { return await req.json(); } catch (e) { return {}; } };
  const fbSearch = build("fbSearch", { fbWho, readJson, fbTerm: FB.fbTerm, json, fbLive: FB.fbLive, fbAreaFor, fbLeft: C.fbLeft, fbArea, vCount: C.vCount, fbGive: C.fbGive,
    fbCall: async (env, q, cell, n, opt) => { calls.push([q, cell.key, opt]); return call ? call(q) : { ok: true, items: [{ id: "9999999", title: q, found: TODAY }] }; },
    FB_RUN_ITEMS: FB.FB_RUN_ITEMS, fbPickKey: FB.fbPickKey, kvGet, fbMerge: FB.fbMerge, FB_TTL: FB.FB_TTL, FB_SEARCH_DAY: FB.FB_SEARCH_DAY, Response: Res });
  const PRO = { "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "T".repeat(24) }, OWN = { "X-Prowl-Owner": "owner-key-0123456789" };
  const finds = (h, q) => fbFinds(new Request("https://w/fb-finds?" + q, { headers: h }), env, new URL("https://w/fb-finds?" + q), "o");
  const search = (h, body) => fbSearch(new Request("https://w/fb-search", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, h), body: JSON.stringify(body) }), env, "o");
  return { kv, env, C, calls, finds, search, PRO, OWN };
}

test("/fb-finds?all=1: each hunt with its finds (12 at most; v204: shipping ones for All USA hunts only), All USA marked, and the searches left today", async () => {
  const R = routes();
  R.C.m.set("fbq:pro@example.com", 2);
  const r = await R.finds(R.PRO, "all=1");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["hunts", "left", "live"]);
  assert.equal(r.body.live, true);
  assert.equal(r.body.left, 3);
  assert.deepEqual(r.body.hunts.map((h) => [h.term, h.usa, h.pending, h.items.length]), [["panther", false, false, 2], ["hull", true, false, 12], ["rookwood", false, true, 0]]);
  assert.deepEqual(r.body.hunts[0].items.map((x) => x.id), ["2222222", "1111111"], "nearest first; v204: a near-me hunt leaves out the shipping finds");
  assert.equal(r.body.hunts[0].updated, "2026-10-31T08:00:00.000Z");
  assert.equal(r.headers["Cache-Control"], "private, no-store");
  const one = await R.finds(R.PRO, "term=Hull");
  assert.deepEqual([one.body.usa, one.body.radius, one.body.items.length], [true, 25, 20], "one hunt: all its finds, and the member's radius");
  assert.equal((await R.finds({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "F".repeat(24) }, "all=1")).status, 403);
  assert.equal((await R.finds({}, "all=1")).status, 401);
  assert.deepEqual((await R.finds({ "X-Prowl-Email": "nozip@example.com", "X-Prowl-Tok": "N".repeat(24) }, "all=1")).body, { live: true, nozip: true, hunts: [] });
  const own = await R.finds(R.OWN, "all=1&zip=48375");
  assert.deepEqual([own.status, own.body.hunts, own.body.left], [200, [], 5], "the owner key alone has no hunts of its own");
});

test("/fb-search: 5 a day for a Pro member, kept where the hunt page reads it; the 6th is 429 with no call", async () => {
  const R = routes();
  for (let i = 1; i <= 5; i++) {
    const r = await R.search(R.PRO, { q: "  Ceramic   Panther " });
    assert.equal(r.status, 200, "search " + i);
    assert.deepEqual([r.body.ok, r.body.q, r.body.radius, r.body.left], [true, "ceramic panther", 25, 5 - i]);
  }
  assert.deepEqual(R.calls[0], ["ceramic panther", "42.5,-83.5", { mi: 25 }], "pickup within the member's radius");
  assert.equal(R.kv.json("fb3:ceramic panther|42.5,-83.5|25").items[0].id, "9999999");
  const sixth = await R.search(R.PRO, { q: "panther" });
  assert.deepEqual([sixth.status, sixth.body.left], [429, 0]);
  assert.equal(R.calls.length, 5);
});

test("/fb-search: a capped or unreserved call gives the search back, a failed paid one does not; bad input, no ZIP, FB_LIVE off and free members ask nothing", async () => {
  let R = routes({ call: () => ({ ok: false, error: "apify 502" }) });
  let r = await R.search(R.PRO, { q: "panther" });
  assert.deepEqual([r.status, r.body.left], [503, 4], "review fix: a failed Apify call may still have cost, so it stays counted");
  assert.equal(R.kv.json("fb3:panther|42.5,-83.5|25").items.length, 2, "nothing kept");
  R = routes({ call: () => ({ ok: false, noCall: true, error: "the spend counter did not answer" }) });
  r = await R.search(R.PRO, { q: "panther" });
  assert.deepEqual([r.status, r.body.left], [503, 5], "nothing reached Apify: given back");
  R = routes({ call: () => ({ ok: false, capped: true, noCall: true }) });
  r = await R.search(R.PRO, { q: "panther" });
  assert.deepEqual([r.status, r.body.left], [503, 5]);
  assert.match(r.body.error, /used up for today/);
  R = routes();
  assert.equal((await R.search(R.PRO, { q: "" })).status, 400);
  assert.equal((await R.search(R.PRO, { q: "jane@example.com" })).status, 400, "no email addresses go to Apify");
  r = await R.search({ "X-Prowl-Email": "nozip@example.com", "X-Prowl-Tok": "N".repeat(24) }, { q: "panther" });
  assert.deepEqual([r.status, r.body.nozip, r.body.left], [400, true, 5]);
  assert.equal((await R.search({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "F".repeat(24) }, { q: "panther" })).status, 403);
  assert.equal((await R.search({}, { q: "panther" })).status, 401);
  assert.equal(R.calls.length, 0);
  assert.equal(R.C.m.size, 0, "nothing counted");
  R = routes({ live: "off" });
  assert.equal((await R.search(R.PRO, { q: "panther" })).status, 503);
  assert.deepEqual([R.calls.length, R.C.m.size], [0, 0]);
});

test("/fb-search: the owner key has 40 a day as fbq:owner, in the last test's area, FB_LIVE or not", async () => {
  const R = routes({ live: "off" });
  assert.equal((await R.search(R.OWN, { q: "panther" })).status, 400, "no ZIP yet");
  R.kv.set("fbownzip", "48375");
  for (let i = 0; i < 40; i++) assert.equal((await R.search(R.OWN, { q: "panther" })).status, 200);
  assert.equal((await R.search(R.OWN, { q: "panther" })).status, 429);
  assert.equal(R.C.m.get("fbq:owner"), 40);
  assert.deepEqual(R.calls[0][2], { mi: 50 });
});

test("fbLeft reads Caps without taking one (take with lim 0), and fbGive never goes below 0", async () => {
  const blk = (name) => { const i = INDEX.indexOf('    if (op === "' + name + '")'); assert.ok(i > 0, name); return INDEX.slice(i, INDEX.indexOf("\n    }\n", i) + 7); };
  const op = new Function("return async function (op, q) { const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200 });\n" + blk("take") + blk("give") + "return J({ error: op }, 400); };")();
  const store = new Map(), self = { s: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, arm: async () => {} };
  const capsCall = async (name, o, q) => JSON.parse(await (await op.call(self, o, q)).text());
  const fbLeft = build("fbLeft", { capsCall, capsDay: () => "x", ctrName: async (n) => n });
  const fbGive = build("fbGive", { capsCall, capsDay: () => "x", ctrName: async (n) => n });
  assert.equal(await fbLeft("fbq:a", 5), 5);
  store.set("c:fbq:a", 2);
  assert.equal(await fbLeft("fbq:a", 5), 3);
  assert.equal(await fbLeft("fbq:a", 5), 3, "reading takes nothing");
  await fbGive("fbq:a"); await fbGive("fbq:a"); await fbGive("fbq:a");
  assert.equal(store.get("c:fbq:a"), 0);
  const down = build("fbLeft", { capsCall: async () => { throw new Error("caps 500"); }, capsDay: () => "x", ctrName: async (n) => n });
  assert.equal(await down("fbq:a", 5), 0, "no Caps: none left shown");
});

/* ---- 4. prefs ---- */
const AL = { AL_SOURCES: ["ebay"], AL_FREQ_DAYS: { daily: 1 }, vClean: (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n), AL_MAX_HUNTS: 100, AL_MAX_PRICE: 100000,
  alWords: (s) => s, AL_SKIP_LEN: 40, AL_SKIP_MAX: 20, AL_SLOTS: [0], alTzClean: () => "", AL_RADII: [25, 50, 100], fbTerm: FB.fbTerm };
test("alPrefs: fbusa is a list of hunt terms, lowercased, single-spaced, deduplicated; anything else is none", () => {
  const alPrefs = build("alPrefs", AL);
  assert.deepEqual(alPrefs({ prefs: { fbusa: ["  Ceramic   Panther ", "ceramic panther", "", "HULL", null] } }).fbusa, ["ceramic panther", "hull"]);
  assert.deepEqual(alPrefs({ prefs: { fbusa: "panther" } }).fbusa, []);
  assert.deepEqual(alPrefs({}).fbusa, []);
  assert.equal(alPrefs({ prefs: { fbusa: Array.from({ length: 150 }, (_, i) => "h" + i) } }).fbusa.length, 100);
});

test("alPrefsSave keeps the All USA hunts as sent (a new hunt may not have reached the worker yet)", async () => {
  const kv = new FakeKV(), alPrefs = build("alPrefs", AL);
  kv.set("sub:m@example.com", { email: "m@example.com", tok: "T".repeat(24), pro: true, hunts: ["Ceramic  Panther", "Hull"] });
  const fn = build("alPrefsSave", { alReady: () => true, readJson: async (r) => r.json(), json: (b, st) => ({ b, st }), alEmail: (e) => String(e || "").toLowerCase(), kvGet,
    alSame: (a, b) => a === b, alPrefs, fbTerm: FB.fbTerm, alNowIn: () => ({ day: TODAY }), alNow: () => ({ day: TODAY }), kvPut: async (env, k, v) => kv.set(k, v),
    alSlotHour: () => 8, alHour: () => 8, AL_TZ: "America/New_York", alFree: () => 3, alFreeWeekly: () => 0, alActive: (env, s) => s.hunts });
  const req = new Request("https://w/alerts/prefs", { method: "POST", body: JSON.stringify({ email: "m@example.com", tok: "T".repeat(24), prefs: { fbusa: ["ceramic panther", "Rookwood", "hull"] } }) });
  const r = await fn(req, { PROWL_ALERTS: kv }, "o");
  assert.equal(r.st, 200);
  assert.deepEqual(r.b.prefs.fbusa, ["ceramic panther", "rookwood", "hull"], "review fix: not filtered by the hunts the worker has");
  assert.deepEqual(kv.json("sub:m@example.com").prefs.fbusa, ["ceramic panther", "rookwood", "hull"]);
});

/* ---- 5. wiring ---- */
test("the routes and the alert email read v203's finds", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/fb-search" && request\.method === "POST"\) return fbSearch\(request, env, origin\);/);
  assert.match(indexFn("fbAlertItems"), /const v = await fbHunt\(env, o, cell, term\);/, "the email has pickup and shipping finds");
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 203, "v203 or later");
});

test("fbMatch: -sses plurals and words written together or apart", () => {
  assert.equal(FB.fbMatch("glasses", "Vintage glass set"), true, "glasses -> glass");
  assert.equal(FB.fbMatch("dresses", "Prom dress"), true);
  assert.equal(FB.fbMatch("fire-king", "FIREKING jadeite mug"), true, "a hyphenated hunt finds the run-together title");
  assert.equal(FB.fbMatch("fire king", "Fire-King bowl"), true);
  assert.equal(FB.fbMatch("pyrex butterprint", "Pyrex butter print bowl"), true, "each hunt word starts a title word");
  assert.equal(FB.fbMatch("fire king", "King size fire pit"), true, "both words present still match (word order is not checked)");
  assert.equal(FB.fbMatch("fire-king", "Outdoor fire pit"), false);
  assert.equal(FB.fbMatch("ceramic panther", "2023 Land Rover discovery"), false);
});

/* ---- 6. review fixes ---- */
test("review fix: a radius or All USA change still shows an earlier search's finds, within the new distance", async () => {
  const { fbHunt } = parts(), kv = new FakeKV(), env = { PROWL_ALERTS: kv }, cell = FB.fbCell(42.5, -83.5);
  kv.set(FB.fbPickKey("panther", cell, 100), { updated: "2026-10-30T10:00:00Z", items: [{ id: "1", miles: 12 }, { id: "2", miles: 80 }] });
  const v = await fbHunt(env, { mi: 25, usa: [] }, cell, "panther");
  assert.deepEqual(v.items.map((x) => x.id), ["1"], "80 mi is past 25 + 5");
  assert.equal(v.pending, false);
  const u = await fbHunt(env, { mi: 25, usa: ["panther"] }, cell, "panther");
  assert.deepEqual(u.items.map((x) => x.id), ["1", "2"], "All USA keeps both");
  const none = await fbHunt(env, { mi: 25, usa: [] }, cell, "hull");
  assert.equal(none.pending, true);
});

test("review fixes, wired: the newest finds go to the email; only an unreserved or capped call is given back; Store searches mark the sweep's job; delete removes fbrot", () => {
  const f = (n) => { const m = new RegExp("^(async )?function " + n + "\\(", "m").exec(INDEX); return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2); };
  assert.match(f("fbAlertItems"), /v\.items\.sort\(\(a, b\) => \(String\(a\.found/);
  assert.match(f("fbSearch"), /if \(r\.noCall\) await fbGive\(name\);/);
  assert.doesNotMatch(f("fbSearch"), /^\s*await fbGive\(name\);/m, "a failed paid search stays counted");
  assert.match(f("fbSearch"), /jk = "p\|" \+ q \+ "\|" \+ cell\.key \+ "\|" \+ o\.mi/);
  assert.match(f("fbSweep"), /if \(!r\.ok && r\.noCall\) \{ await fbGive\("fbm:" \+ sub\.email\);/);
  assert.match(f("fbCall"), /noCall: true, error: "the spend counter did not answer"/);
  assert.match(f("fbCall"), /capped: true, noCall: true/);
  assert.match(f("alPurge"), /kv\.delete\(await ctrName\("fbrot:" \+ email\)\)/);
});
