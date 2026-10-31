/* v200 (Matt, 2026-10-31: Apify, Pro members, a hard cap of $1 a day): Facebook Marketplace finds through Apify's
   curious_coder~facebook-marketplace, never a login or a cookie. fb.js is pure and imported; the index.js parts are
   taken out with fakes for KV, Caps and Apify. Run: node --test worker/__tests__/fb-apify-v200.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as FB from "../fb.js";
import * as SP from "../spend.js";
import { adminFetch, signSession } from "../admin.js";

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
/* an item as the actor answers it (trimmed from its sample), seller and all */
const raw = (id, extra = {}) => ({
  id: String(id), marketplace_listing_title: "Pyrex Butterprint bowl " + id, custom_title: "pyrex bowl",
  listing_price: { formatted_amount: "$25", amount: "25.00", currency: "USD" },
  primary_listing_photo_url: "https://scontent-mia3-1.xx.fbcdn.net/v/t39/" + id + ".jpg",
  location: { reverse_geocode: { city: "Novi", state: "MI", city_page: { id: "1" } }, latitude: 42.48, longitude: -83.47 },
  is_hidden: false, is_live: true, is_pending: false, is_sold: false,
  marketplace_listing_seller: { name: "Ray Goberdhan", id: "pfbid02Q55", profile_picture: { uri: "https://scontent.xx.fbcdn.net/p.jpg" } },
  story: { actors: [{ name: "Ray Goberdhan" }] }, redacted_description: { text: "call me at jane@example.com" },
  apify_charge_info: { listing_item: true }, ...extra });

/* ---- 1. the request ---- */
test("the Apify request: POST to run-sync-get-dataset-items, the token in a Bearer header only, details off, no cookies", () => {
  const cell = FB.fbCell(42.4806, -83.4755);
  const rq = FB.fbRequest({}, "apify_api_SECRET123", "pyrex butterprint", cell, 24);
  const u = new URL(rq.url);
  assert.equal(u.origin + u.pathname, "https://api.apify.com/v2/acts/curious_coder~facebook-marketplace/run-sync-get-dataset-items");
  assert.equal(u.searchParams.get("maxItems"), "24");
  assert.equal(u.searchParams.get("maxTotalChargeUsd"), "0.01205", "review fix: Apify itself stops at the estimate fbCall reserved");
  assert.equal(new URL(FB.fbRequest({}, "t", "x", cell, 500).url).searchParams.get("maxTotalChargeUsd"), FB.fbEstimate(60).toFixed(5), "the same clamp as maxItems");
  assert.ok(Number(u.searchParams.get("timeout")) >= 60 && Number(u.searchParams.get("timeout")) <= 90);
  assert.doesNotMatch(rq.url, /SECRET|token/i, "never in the address");
  assert.equal(rq.init.method, "POST");
  assert.equal(rq.init.headers.Authorization, "Bearer apify_api_SECRET123");
  assert.ok(!Object.keys(rq.init.headers).some((h) => /cookie/i.test(h)));
  assert.equal(rq.init.credentials, undefined);
  const body = JSON.parse(rq.init.body);
  assert.deepEqual(body, { searchKeyword: "pyrex butterprint", latitude: 42.5, longitude: -83.5, radiusKm: 40, getListingDetails: false, getAllListingPhotos: false,
    strictFiltering: true, maxPagesPerUrl: 1, proxy: { useApifyProxy: true, apifyProxyCountry: "US" } });
  assert.ok(!("cookies" in body));
  assert.equal(new URL(FB.fbRequest({ FB_ACTOR: "someone~other-actor" }, "t", "x", cell, 5).url).pathname, "/v2/acts/someone~other-actor/run-sync-get-dataset-items");
  assert.match(FB.fbRequest({ FB_ACTOR: "../../evil" }, "t", "x", cell, 5).url, /curious_coder~facebook-marketplace/, "a bad FB_ACTOR is ignored");
});

test("fbRun sends exactly that request and keeps only the cleaned listings; a failure is charged at the estimate, never says the token", async () => {
  const cell = FB.fbCell(42.48, -83.47), seen = [];
  const ok = await FB.fbRun({ APIFY_TOKEN: "tok_SECRET" }, "pyrex", cell, 24, async (url, init) => { seen.push([url, init]); return new Response(JSON.stringify([raw(1234567), raw(2345678)]), { status: 200 }); });
  assert.equal(ok.ok, true);
  assert.equal(ok.items.length, 2);
  assert.equal(ok.cost, 0.00105);
  assert.equal(seen.length, 1);
  assert.equal(seen[0][1].headers.Authorization, "Bearer tok_SECRET");
  const bad = await FB.fbRun({ APIFY_TOKEN: "tok_SECRET" }, "pyrex", cell, 24, async () => new Response(JSON.stringify({ error: { type: "not-enough-usage-to-run-paid-actor", message: "tok_SECRET" } }), { status: 402 }));
  assert.equal(bad.ok, false);
  assert.equal(bad.cost, FB.fbEstimate(24));
  assert.doesNotMatch(bad.error, /SECRET/);
  assert.match(bad.error, /^apify 402/);
  const down = await FB.fbRun({ APIFY_TOKEN: "t" }, "pyrex", cell, 24, async () => { throw new Error("tok_SECRET boom"); });
  assert.equal(down.error, "apify unreachable");
  assert.deepEqual(await FB.fbRun({}, "pyrex", cell, 24, async () => assert.fail("no token, no call")), { ok: false, error: "APIFY_TOKEN not set", cost: 0 });
});

/* ---- 2. cleaning ---- */
test("each listing keeps only id, title, price (USD), an fbcdn photo, the town, the link and the day: never the seller", () => {
  const out = FB.fbClean([
    raw(1234567),
    raw(2222222, { is_sold: true }), raw(3333333, { is_pending: true }), raw(4444444, { is_hidden: true }),
    raw(5555555, { primary_listing_photo_url: "https://evil.example.com/x.fbcdn.net/a.jpg", listing_price: { formatted_amount: "CA$30", currency: "CAD" } }),
    raw(6666666, { marketplace_listing_title: "", custom_title: "Email me at jane@example.com <b>now</b>", primary_listing_photo_url: "http://scontent.xx.fbcdn.net/a.jpg" }),
    raw("12ab"), raw(1234567), null, "x",
  ], TODAY);
  assert.deepEqual(out.map((x) => x.id), ["1234567", "5555555", "6666666"]);
  assert.deepEqual(out[0], { id: "1234567", title: "Pyrex Butterprint bowl 1234567", price: "$25", url: "https://www.facebook.com/marketplace/item/1234567/",
    image: "https://scontent-mia3-1.xx.fbcdn.net/v/t39/1234567.jpg", location: "Novi, MI", found: TODAY });
  assert.equal(out[1].image, "", "only Facebook's image hosts");
  assert.equal(out[1].price, "", "USD only");
  assert.equal(out[2].image, "", "https only");
  assert.equal(out[2].title, "Email me at [email] b now /b");
  const all = JSON.stringify(out);
  assert.doesNotMatch(all, /Goberdhan|pfbid|seller|profile|jane@|description|latitude/);
});

test("the week's finds merge by id, newest first, at most 60, older than 7 days dropped", () => {
  const day = "2026-10-31", old = { items: [{ id: "111111", found: "2026-10-30" }, { id: "222222", found: "2026-10-20" }, { id: "333333", found: "2026-10-29" }] };
  const m = FB.fbMerge(old, [{ id: "333333", found: day }, { id: "444444", found: day }], day, "2026-10-31T12:00:00.000Z");
  assert.deepEqual(m.items.map((x) => x.id), ["333333", "444444", "111111"]);
  assert.equal(m.day, day);
  const many = FB.fbMerge(null, Array.from({ length: 70 }, (_, i) => ({ id: String(100000 + i), found: day })), day);
  assert.equal(many.items.length, 60);
});

test("an area is the ZIP's point rounded to 0.1 degree, shared by neighbours", () => {
  assert.deepEqual(FB.fbCell(42.4806, -83.4755), { lat: 42.5, lng: -83.5, key: "42.5,-83.5" });
  assert.equal(FB.fbCell(42.47, -83.46).key, FB.fbCell(42.52, -83.54).key);
  assert.equal(FB.fbCell(NaN, 1), null);
  assert.equal(FB.fbKey("pyrex", FB.fbCell(42.48, -83.47)), "fb2:pyrex|42.5,-83.5");
});

/* ---- 3. the cap ---- */
/* the Caps object's take and addlim taken out of index.js and run on a Map, as the Durable Object runs them */
function capsDO() {
  const blk = (name) => { const i = INDEX.indexOf('    if (op === "' + name + '")'); assert.ok(i > 0, name); return INDEX.slice(i, INDEX.indexOf("\n    }\n", i) + 7); };
  const op = new Function("return async function (op, q) { const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200 });\n" + blk("take") + blk("addlim") + "return J({ error: op }, 400); };")();
  const store = new Map(), self = { s: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, arm: async () => {} };
  let q0 = Promise.resolve();   /* a Durable Object handles one request at a time (its storage calls hold its input gate) */
  return { obj: { op: (o, q) => (q0 = q0.then(() => op.call(self, o, q))) }, store };
}
function capHarness({ spent = 0, run, caps = true } = {}) {
  const adds = [], reserves = [];
  let ran = 0;
  const capsCall = async (name, op, q) => {
    if (!caps) return null;
    assert.equal(op, "addlim");
    reserves.push(q.n);
    if (spent + q.n > q.lim) return { ok: false, n: spent };
    spent += q.n; return { ok: true, n: spent };
  };
  const fbReserve = build("fbReserve", { capsCall, capsDay: () => "caps:" + TODAY, console });
  const fbCall = build("fbCall", {
    fbCapUnits: FB.fbCapUnits, fbUnits: FB.fbUnits, fbEstimate: FB.fbEstimate, fbItems: FB.fbItems, fbReserve,
    fbSpendAdd: async (u) => { adds.push(u); spent += u; },
    fbRun: async (env, term, cell, n) => { ran++; return run ? run(n) : { ok: true, items: [], raw: n, cost: FB.fbEstimate(n) }; },
  });
  return { fbCall, adds, reserves, ran: () => ran, spent: () => spent };
}
test("the cap: the estimate is reserved in Caps before Apify is asked (refused if it would pass $1); only a cost above it is added after", async () => {
  const cell = FB.fbCell(42.48, -83.47);
  let H = capHarness({ spent: 0, run: () => ({ ok: true, items: [{ id: "1" }], raw: 3, cost: 0.00155 }) });
  let r = await H.fbCall({}, "pyrex", cell, 24);
  assert.equal(r.ok, true);
  assert.deepEqual(H.reserves, [1205], "reserved before the call");
  assert.deepEqual(H.adds, [], "a cheaper run stays counted at the estimate");
  assert.equal(r.used, 1205);
  assert.equal(r.cap, 100000);
  H = capHarness({ run: () => ({ ok: true, items: [], raw: 30, cost: 0.01555 }) });
  r = await H.fbCall({}, "pyrex", cell, 24);
  assert.deepEqual(H.adds, [350], "a dearer one adds only the difference");
  assert.equal(r.used, 1555);
  H = capHarness({ spent: 100000 - 1204 });
  r = await H.fbCall({}, "pyrex", cell, 24);
  assert.equal(r.capped, true, "24 listings ($0.01205) would pass $1");
  assert.equal(H.ran(), 0);
  assert.equal(H.spent(), 100000 - 1204, "nothing reserved");
  H = capHarness({ spent: 100000 - 1205 });
  assert.equal((await H.fbCall({}, "pyrex", cell, 24)).ok, true, "exactly at the cap is allowed");
  H = capHarness({ spent: 150000 });
  assert.equal((await H.fbCall({ FB_DAY_USD: "2" }, "pyrex", cell, 24)).ok, true, "FB_DAY_USD raises it");
  H = capHarness({ run: () => ({ ok: false, error: "apify timed out", cost: FB.fbEstimate(24) }) });
  await H.fbCall({}, "pyrex", cell, 24);
  assert.deepEqual([H.spent(), H.adds], [1205, []], "a failed run stays counted at the estimate");
});

test("two runs at once both see the same spend, yet only one fits: the reservation is one Caps step", async () => {
  const D = capsDO(), cell = FB.fbCell(42.48, -83.47);
  const capsCall = async (name, op, q) => JSON.parse(await (await D.obj.op(op, q)).text());
  const fbReserve = build("fbReserve", { capsCall, capsDay: () => "caps:" + TODAY, console });
  D.store.set("c:fbusd:all", 100000 - 2000);
  let release, ran = 0;
  const gate = new Promise((r) => { release = r; });
  const fbCall = build("fbCall", { fbCapUnits: FB.fbCapUnits, fbUnits: FB.fbUnits, fbEstimate: FB.fbEstimate, fbItems: FB.fbItems, fbReserve, fbSpendAdd: async () => {},
    fbRun: async () => { ran++; await gate; return { ok: true, items: [], raw: 24, cost: FB.fbEstimate(24) }; } });
  const both = Promise.all([fbCall({}, "a", cell, 24), fbCall({}, "b", cell, 24)]);
  await new Promise((r) => setTimeout(r, 0));
  release();
  const [a, b] = await both;
  assert.equal(ran, 1, "the second call is refused while the first is still running");
  assert.deepEqual([!!a.ok, !!b.capped], [true, true]);
  assert.equal(D.store.get("c:fbusd:all"), 100000 - 2000 + 1205);
});

test("no Caps (the binding missing, or it errors): no Apify call, from the sweep or the admin's test", async () => {
  const cell = FB.fbCell(42.48, -83.47);
  const H = capHarness({ caps: false });
  const r = await H.fbCall({}, "pyrex", cell, 24);
  assert.equal(r.ok, false);
  assert.match(r.error, /spend counter/);
  assert.equal(H.ran(), 0);
  const boom = build("fbReserve", { capsCall: async () => { throw new Error("caps 500"); }, capsDay: () => "x", console: { error() {} } });
  assert.equal(await boom(1205, 100000), null);
  const fbTry = build("fbTry", { capsCall: async () => null, capsDay: () => "x", FB_TRIES: 2, console });
  assert.equal(await fbTry("pyrex|42.5,-83.5"), 0, "no try without Caps either");
  const fbTestRun = build("fbTestRun", { fbTerm: FB.fbTerm, fbArea: async () => cell, fbCall: H.fbCall, FB_RUN_ITEMS: 24, FB_UNIT: FB.FB_UNIT, fbEstimate: FB.fbEstimate,
    fbCapUnits: FB.fbCapUnits, fbLive: FB.fbLive, scrubPII: (x) => x });
  const t = await fbTestRun({ APIFY_TOKEN: "t" }, "pyrex", "48375");
  assert.equal(t.ok, false);
  assert.match(t.error, /spend counter/);
  assert.equal(H.ran(), 0);
});

test("a try is taken in Caps before the call: FB_TRIES a day per hunt and cell, so a killed run's try still counts", async () => {
  const D = capsDO();
  const capsCall = async (name, op, q) => JSON.parse(await (await D.obj.op(op, q)).text());
  const fbTry = build("fbTry", { capsCall, capsDay: () => "x", FB_TRIES: FB.FB_TRIES, console });
  assert.deepEqual([await fbTry("pyrex|42.5,-83.5"), await fbTry("pyrex|42.5,-83.5"), await fbTry("pyrex|42.5,-83.5")], [1, 2, 0]);
  assert.equal(await fbTry("hull|42.5,-83.5"), 1);
});

test("the day's spend shows as an admin pool in dollars, its limit following FB_DAY_USD", () => {
  assert.match(INDEX, /\{ key: "fbusd:all", name: "Facebook finds \(Apify\), \$ today", limit: FB_UNIT, usd: FB_UNIT, limitVar: "FB_DAY_USD" \}/);
  assert.match(indexFn("fbReserve"), /capsCall\(capsDay\(\), "addlim", \{ k: "fbusd:all", n: units, lim: cap \}\)/);
  assert.match(indexFn("fbSpendAdd"), /capsCall\(capsDay\(\), "add", \{ k: "fbusd:all"/);
  assert.doesNotMatch(INDEX, /function fbSpent\(/, "no peek-then-call");
});

/* fbArea: only an answer that says the ZIP is unknown is kept as a miss */
function areaHarness(answer) {
  const kv = new FakeKV(), asked = [];
  const fbArea = build("fbArea", { kvGet, gKey: () => "k", vCount: async (n) => { asked.push(n); return true; }, G_GEO_PER_DAY: 1000,
    gFetch: async () => answer, geoPlace: (r) => (r && r.geometry ? { lat: r.geometry.location.lat, lng: r.geometry.location.lng } : null), fbCell: FB.fbCell,
    FB_ZIP_TTL: FB.FB_ZIP_TTL, FB_ZIP_MISS_TTL: FB.FB_ZIP_MISS_TTL });
  return { fbArea, kv, env: { PROWL_ALERTS: kv }, asked };
}
test("fbArea: a quota, key or passing Google error (each a 200) keeps nothing; ZERO_RESULTS is kept as a miss for 7 days", async () => {
  for (const status of ["OVER_QUERY_LIMIT", "REQUEST_DENIED", "UNKNOWN_ERROR", "INVALID_REQUEST"]) {
    const A = areaHarness({ status, results: [] });
    assert.equal(await A.fbArea(A.env, "48375", true), null, status);
    assert.equal(A.kv.m.size, 0, status + ": nothing kept, asked again later");
  }
  let A = areaHarness({ status: "OK", results: [{}] });
  assert.equal(await A.fbArea(A.env, "48375", true), null);
  assert.equal(A.kv.m.size, 0, "OK without a usable point keeps nothing either");
  A = areaHarness({ status: "ZERO_RESULTS", results: [] });
  assert.equal(await A.fbArea(A.env, "00000", true), null);
  assert.deepEqual(A.kv.json("fbz:00000"), { miss: 1 });
  assert.equal(A.kv.ttl.get("fbz:00000"), 7 * 86400);
  A = areaHarness({ status: "OK", results: [{ geometry: { location: { lat: 42.48, lng: -83.47 } } }] });
  assert.equal((await A.fbArea(A.env, "48375", true)).key, "42.5,-83.5");
  assert.deepEqual(A.kv.json("fbz:48375"), { lat: 42.5, lng: -83.5 });
  assert.equal(A.kv.ttl.get("fbz:48375"), 90 * 86400);
});

/* ---- 4. the sweep ---- */
function sweepHarness({ live = "on", subs, done = null, call, area } = {}) {
  const kv = new FakeKV(), calls = [], geo = [], tries = new Map();
  if (done) kv.set("fb2day:" + TODAY, done);
  kv.set("fbz:48375", { lat: 42.5, lng: -83.5 });
  const env = { PROWL_ALERTS: kv, APIFY_TOKEN: "t", FB_LIVE: live };
  const fbSweep = build("fbSweep", {
    fbLive: FB.fbLive, kvGet, FB_PER_RUN: FB.FB_PER_RUN, FB_CALLS_EACH: 4, FB_GEO_CALLS: 2, FB_GEO_PER_RUN: 2,
    fbTry: async (k) => { const n = (tries.get(k) || 0) + 1; if (n > FB.FB_TRIES) return 0; tries.set(k, n); return n; }, FB_TRIES: FB.FB_TRIES, FB_DAY_LIST_MAX: 2000, FB_RUN_ITEMS: FB.FB_RUN_ITEMS, FB_TTL: FB.FB_TTL,
    alPrefs: (s) => ({ zip: (s.prefs && s.prefs.zip) || "" }), alActive: (env, s) => s.hunts.slice(0, s.pro ? 100 : 3),
    fbArea: area ? async (env, zip, ask) => { if (ask) geo.push(zip); return area(zip, ask); }
      : async (env, zip) => (zip === "48375" || zip === "48377" ? FB.fbCell(42.5, -83.5) : zip === "10001" ? FB.fbCell(40.75, -74.0) : null),
    fbTerm: FB.fbTerm, fbKey: FB.fbKey, fbMerge: FB.fbMerge, scrubPII: (s) => String(s),
    fbCall: async (env, term, cell, n) => { calls.push(term + "|" + cell.key); return call ? call(term) : { ok: true, items: [{ id: "123456", title: term, found: TODAY }], raw: 1, cost: 0.00055 }; },
  });
  return { fbSweep, kv, env, calls, geo, tries };
}
const pro = (zip, hunts) => ({ email: "x@example.com", pro: true, hunts, prefs: { zip } });
test("the sweep: at most 2 Apify calls a run, once a day per hunt and cell (neighbours share), Pro members with a ZIP only", async () => {
  const subs = [pro("48375", ["Pyrex Butterprint", "Fire-King jadeite", "Hull vase"]), pro("48377", ["pyrex  butterprint"]), { email: "f@example.com", pro: false, hunts: ["Roseville"], prefs: { zip: "48375" } },
    pro("", ["Rookwood"]), pro("10001", ["Pyrex Butterprint"])];
  const S = sweepHarness({ subs });
  let r = await S.fbSweep(S.env, subs, 50);
  assert.equal(r.calls, 2);
  assert.deepEqual(S.calls, ["pyrex butterprint|42.5,-83.5", "fire-king jadeite|42.5,-83.5"]);
  const kept = S.kv.json("fb2:pyrex butterprint|42.5,-83.5");
  assert.equal(kept.items[0].id, "123456");
  assert.equal(S.kv.ttl.get("fb2:pyrex butterprint|42.5,-83.5"), 8 * 86400);
  r = await S.fbSweep(S.env, subs, 50);
  assert.deepEqual(S.calls.slice(2), ["hull vase|42.5,-83.5", "pyrex butterprint|40.8,-74"], "the neighbour's same hunt is not searched again; the free member and the ZIP-less one never");
  r = await S.fbSweep(S.env, subs, 50);
  assert.equal(r.calls, 0, "everything swept today");
  assert.equal((await S.fbSweep(S.env, subs, 3)).calls, 0, "no room left in the run's outside calls");
});

test("the sweep's geocoding counts in the run's outside calls: room 6 with a new ZIP makes at most 1 Apify call", async () => {
  const subs = [pro("48375", ["Pyrex", "Hull", "Roseville"])];
  let S = sweepHarness({ subs, area: (zip, ask) => (ask ? FB.fbCell(42.5, -83.5) : null) });
  let r = await S.fbSweep(S.env, subs, 6);
  assert.deepEqual([S.geo.length, r.calls], [1, 1], "2 for Google and its counter, 4 for the call");
  S = sweepHarness({ subs, area: (zip, ask) => (ask ? FB.fbCell(42.5, -83.5) : null) });
  r = await S.fbSweep(S.env, subs, 5);
  assert.deepEqual([S.geo.length, r.calls], [0, 0], "not enough room for both: Google is not asked for nothing");
  S = sweepHarness({ subs });
  assert.equal((await S.fbSweep(S.env, subs, 7)).calls, 1, "a cached ZIP: 4 a call");
});

test("a try is taken before the call: a run killed mid-call is not retried uncounted, and two overlapping runs share FB_TRIES", async () => {
  const subs = [pro("48375", ["Pyrex"])];
  const S = sweepHarness({ subs, call: () => new Promise(() => {}) });   /* Apify never answers: the run is killed */
  S.fbSweep(S.env, subs, 50);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(S.tries.get("pyrex|42.5,-83.5"), 1, "the try was taken before Apify was asked");
  S.fbSweep(S.env, subs, 50);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(S.calls.length, 2);
  const r = await S.fbSweep(S.env, subs, 50);
  assert.equal(r.calls, 0, "both tries used: no third call, however many runs");
  assert.equal(S.calls.length, 2);
  assert.equal(S.kv.json("fb2day:" + TODAY)["pyrex|42.5,-83.5"], -2, "and the day's list remembers it");
});

test("FB_LIVE off (or no token) does nothing at all", async () => {
  const subs = [pro("48375", ["Pyrex"])];
  for (const live of ["", "off", "shadow"]) {
    const S = sweepHarness({ live, subs });
    assert.equal((await S.fbSweep(S.env, subs, 50)).calls, 0, live);
    assert.equal(S.kv.m.size, 1, "nothing written");
  }
  const S = sweepHarness({ subs });
  delete S.env.APIFY_TOKEN;
  assert.equal((await S.fbSweep(S.env, subs, 50)).calls, 0);
});

test("the cap stops the sweep for the day; a failure keeps nothing, is noted quietly and tried at most twice", async () => {
  const subs = [pro("48375", ["Pyrex", "Hull"])];
  let S = sweepHarness({ subs, call: () => ({ ok: false, capped: true }) });
  await S.fbSweep(S.env, subs, 50);
  assert.equal(S.calls.length, 1);
  assert.equal(S.kv.json("fb2day:" + TODAY)._cap, 1);
  await S.fbSweep(S.env, subs, 50);
  assert.equal(S.calls.length, 1, "stopped for the day");
  S = sweepHarness({ subs, call: () => ({ ok: false, error: "apify 502" }) });
  const r = await S.fbSweep(S.env, subs, 50);
  assert.deepEqual(r.errors, ["facebook: apify 502", "facebook: apify 502"]);
  assert.equal(S.kv.json("fb2:pyrex|42.5,-83.5"), null, "no empty cache on a failure");
  await S.fbSweep(S.env, subs, 50);
  await S.fbSweep(S.env, subs, 50);
  assert.equal(S.calls.length, 4, "each hunt tried twice, then left for tomorrow");
});

test("the alert clock runs the sweep with what is left of the run's outside calls", () => {
  const tick = indexFn("alTick");
  assert.match(tick, /await fbSweep\(env, subs\.map\(x => x\.sub\), FB_RUN_CALLS - used\)/);
  assert.match(tick, /fr\.errors\.forEach\(note\)/, "a short, scrubbed note to the admin errors");
});

/* ---- 5. /fb-finds ---- */
function findsHarness() {
  const kv = new FakeKV();
  kv.set("sub:pro@example.com", { email: "pro@example.com", tok: "T".repeat(24), pro: true, prefs: { zip: "48375" } });
  kv.set("sub:free@example.com", { email: "free@example.com", tok: "F".repeat(24), pro: false, prefs: { zip: "48375" } });
  kv.set("sub:nozip@example.com", { email: "nozip@example.com", tok: "N".repeat(24), pro: true, prefs: {} });
  kv.set("fb2:pyrex butterprint|42.5,-83.5", { updated: "2026-10-31T08:00:00.000Z", day: "2026-10-31", items: [{ id: "1234567", title: "Pyrex bowl", url: "https://www.facebook.com/marketplace/item/1234567/" }] });
  const env = { PROWL_ALERTS: kv, OWNER_KEY: "owner-key-0123456789", FB_LIVE: "on" };
  const json = (body, status, origin, extra) => ({ status, body, headers: extra });
  const fbFinds = build("fbFinds", {
    isOwner: (req, env) => req.headers.get("X-Prowl-Owner") === env.OWNER_KEY, sessMember: async () => null, alEmail: (e) => String(e || "").trim().toLowerCase(),
    alSame: (a, b) => a === b, kvGet, json, fbTerm: FB.fbTerm, vCount: async () => true, ipKey: (x) => x, FB_FINDS_PER_IP: 1000,
    alPrefs: (s) => ({ zip: (s.prefs && s.prefs.zip) || "" }), fbLive: FB.fbLive, fbArea: async (env, zip) => (zip === "48375" ? FB.fbCell(42.5, -83.5) : null), fbKey: FB.fbKey,
  });
  const ask = (h, q = "term=Pyrex%20Butterprint") => fbFinds(new Request("https://w/fb-finds?" + q, { headers: h }), env, new URL("https://w/fb-finds?" + q), "o");
  return { ask };
}
test("/fb-finds: 401 signed out, 403 not Pro, the member's area's finds for Pro, the owner key may name a ZIP", async () => {
  const F = findsHarness();
  assert.equal((await F.ask({})).status, 401);
  assert.equal((await F.ask({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "wrong" })).status, 401);
  assert.equal((await F.ask({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "F".repeat(24) })).status, 403);
  const ok = await F.ask({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "T".repeat(24) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.items[0].id, "1234567");
  assert.equal(ok.body.live, true);
  assert.equal(ok.headers["Cache-Control"], "private, no-store");
  const nz = await F.ask({ "X-Prowl-Email": "nozip@example.com", "X-Prowl-Tok": "N".repeat(24) });
  assert.deepEqual(nz.body, { term: "pyrex butterprint", live: true, nozip: true, items: [] });
  const own = await F.ask({ "X-Prowl-Owner": "owner-key-0123456789" }, "term=pyrex%20butterprint&zip=48375");
  assert.equal(own.status, 200);
  assert.equal(own.body.items.length, 1);
  assert.equal((await F.ask({ "X-Prowl-Owner": "owner-key-0123456789" })).body.nozip, true);
  assert.equal((await F.ask({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "T".repeat(24) }, "term=")).status, 400);
});

test("/fb-finds while FB_LIVE is off: a Pro member gets nothing, and nothing is asked of Google or counted", async () => {
  const kv = new FakeKV(), areas = [], counts = [];
  kv.set("sub:pro@example.com", { email: "pro@example.com", tok: "T".repeat(24), pro: true, prefs: { zip: "48375" } });
  kv.set("fb2:pyrex|42.5,-83.5", { updated: "x", items: [{ id: "1234567" }] });
  const json = (body, status) => ({ status, body });
  const fbFinds = build("fbFinds", {
    isOwner: (req, env) => req.headers.get("X-Prowl-Owner") === env.OWNER_KEY, sessMember: async () => null, alEmail: (e) => String(e || "").trim().toLowerCase(),
    alSame: (a, b) => a === b, kvGet, json, fbTerm: FB.fbTerm, vCount: async (n) => { counts.push(n); return true; }, ipKey: (x) => x, FB_FINDS_PER_IP: 1000,
    alPrefs: (s) => ({ zip: (s.prefs && s.prefs.zip) || "" }), fbLive: FB.fbLive, fbArea: async (env, zip, ask) => { areas.push(ask); return FB.fbCell(42.5, -83.5); }, fbKey: FB.fbKey,
  });
  const env = { PROWL_ALERTS: kv, OWNER_KEY: "owner-key-0123456789", FB_LIVE: "off" };
  const ask = (h) => fbFinds(new Request("https://w/fb-finds?term=pyrex", { headers: h }), env, new URL("https://w/fb-finds?term=pyrex"), "o");
  const r = await ask({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "T".repeat(24) });
  assert.deepEqual([r.status, r.body], [200, { term: "pyrex", live: false, items: [] }]);
  assert.deepEqual([areas, counts], [[], []], "no fbArea(..., true), no counter");
  const own = await ask({ "X-Prowl-Owner": "owner-key-0123456789" });
  assert.equal(own.body.nozip, true, "the owner still gets the full answer");
});

/* ---- 6. the alert email ---- */
test("the daily email: a Pro member's cached Facebook finds join the hunt as source facebook, through the usual filters", async () => {
  const kv = new FakeKV();
  kv.set("fbz:48375", { lat: 42.5, lng: -83.5 });
  kv.set("fb2:pyrex butterprint|42.5,-83.5", { items: [{ id: "1234567", title: "Pyrex Butterprint bowl", price: "$25", url: "https://www.facebook.com/marketplace/item/1234567/", image: "https://x.fbcdn.net/a.jpg", found: TODAY },
    { id: "7654321", title: "bad", url: "https://evil.example.com/x" }] });
  const fbAlertItems = build("fbAlertItems", {
    fbLive: FB.fbLive, alPrefs: (s) => ({ zip: s.prefs.zip }), kvGet, fbTerm: FB.fbTerm, fbKey: FB.fbKey, AL_PER_SITE: 10,
    fbArea: async (env, zip, ask) => { assert.equal(ask, false, "no outside call from the alert check"); const c = await kvGet(env, "fbz:" + zip, null); return c ? FB.fbCell(c.lat, c.lng) : null; },
  });
  const env = { PROWL_ALERTS: kv, FB_LIVE: "on" }, sub = { pro: true, prefs: { zip: "48375" } };
  const items = await fbAlertItems(env, sub, "Pyrex Butterprint");
  assert.deepEqual(items, [{ title: "Pyrex Butterprint bowl", price: "$25", url: "https://www.facebook.com/marketplace/item/1234567/", image: "https://x.fbcdn.net/a.jpg", src: "facebook", time_left: "", bids: 0, dist: "" }]);
  assert.deepEqual(await fbAlertItems(env, { pro: false, prefs: { zip: "48375" } }, "Pyrex Butterprint"), [], "free members get none");
  assert.deepEqual(await fbAlertItems({ PROWL_ALERTS: kv }, sub, "Pyrex Butterprint"), [], "nothing while FB_LIVE is off");
  /* alCheck adds them before the exact match and the seen memory, with the member's price and skip-words (local: their site list does not apply) */
  const chk = indexFn("alCheck");
  assert.match(chk, /all = all\.concat\(alFilter\(sub, await fbAlertItems\(env, sub, h\), true\)\)/);
  assert.ok(chk.indexOf("fbAlertItems") < chk.indexOf("alExact(all, h)") && chk.indexOf("alExact(all, h)") < chk.indexOf("all.filter(unseen)"));
  assert.match(INDEX, /facebook: "Facebook Marketplace"/);
});

/* ---- 7. the admin's Facebook test ---- */
const KEY = "test-admin-key-0123456789", ORIGIN = "https://prowl.example.workers.dev";
function admin(result) {
  const kv = new FakeKV(), asked = [];
  const env = { PROWL_ALERTS: kv, ADMIN_KEY: KEY };
  const H = { kvGet, kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)), vCount: async () => true, capsCall: async () => ({}),
    fbTestRun: async (e, term, zip) => { asked.push([term, zip]); return result; } };
  const call = async (body, signed = true, headers = {}) => {
    const h = Object.assign({ "Content-Type": "application/json", "X-Prowl-Admin": "1", Origin: ORIGIN }, signed ? { Cookie: "prowl_admin=" + await signSession(KEY, Date.now() + 3600000) } : {}, headers);
    const r = await adminFetch(new Request(ORIGIN + "/admin/api/fbtest", { method: "POST", headers: h, body: JSON.stringify(body) }), env, { waitUntil() {} }, H);
    return { status: r.status, j: await r.json() };
  };
  return { call, asked };
}
test("the admin's Facebook test: owner (admin session) only; shows the listings, the count, the cost and today's spend", async () => {
  const A = admin({ ok: true, items: [{ title: "Pyrex bowl", price: "$25", location: "Novi, MI", url: "https://www.facebook.com/marketplace/item/1234567/", image: "" }], raw: 1, cost: 0.00055, estimate: 0.01205, used: 0.0011, cap: 1, live: false });
  assert.equal((await A.call({ term: "pyrex", zip: "48375" }, false)).status, 401);
  assert.equal((await A.call({ term: "pyrex", zip: "48375" }, true, { "X-Prowl-Admin": "" })).status, 403);
  assert.equal(A.asked.length, 0);
  const r = await A.call({ term: "  pyrex   butterprint ", zip: "48375-1234" });
  assert.equal(r.status, 200);
  assert.deepEqual(A.asked, [["pyrex butterprint", "48375"]]);
  assert.deepEqual(r.j.items, [{ title: "Pyrex bowl", price: "$25", city: "Novi, MI", url: "https://www.facebook.com/marketplace/item/1234567/", image: "" }]);
  assert.equal(r.j.count, 1);
  assert.equal(r.j.cost, 0.00055);
  assert.equal(r.j.used, 0.0011);
  assert.equal(r.j.cap, 1);
  const bad = await admin({ ok: false, error: "Type a 5-digit US ZIP." }).call({ term: "pyrex", zip: "" });
  assert.equal(bad.status, 400);
  assert.match(bad.j.error, /ZIP/);
  assert.match(INDEX, /fbTestRun   \/\* v200/);
  const run = indexFn("fbTestRun");
  assert.doesNotMatch(run, /fbLive\(env\)\)? return/, "works while FB_LIVE is off");
  assert.match(run, /PROWL_ALERTS\.put\(fbKey\(term, cell\), JSON\.stringify\(fbMerge\(old, r\.items/, "v202: the finds are kept for the hunt page, as the sweep keeps them");
});

/* ---- 8. spend.js ---- */
test("spend.js counts each Apify run and its listings, priced per listing", async () => {
  assert.equal(SP.paidKey("https://api.apify.com/v2/acts/curious_coder~facebook-marketplace/run-sync-get-dataset-items?timeout=75&maxItems=24"), "apify");
  assert.equal(SP.paidKey("https://api.apify.com/v2/users/me"), "");
  const s = SP.SPEND_SERVICES.find((x) => x.key === "apify");
  assert.deepEqual(s.uses, ["call", "item"]);
  assert.deepEqual(s.price, { call: 0.05, item: 0.5 });
  const buf = new SP.SpendBuffer();
  const f = SP.spendWrap(async () => new Response(JSON.stringify([raw(1), raw(2), raw(3)]), { status: 200 }), buf);
  const r = await f("https://api.apify.com/v2/acts/curious_coder~facebook-marketplace/run-sync-get-dataset-items?timeout=75&maxItems=24", { method: "POST" });
  assert.equal((await r.json()).length, 3, "the caller still reads the answer");
  const d = buf.drain(), row = Object.keys(d.rows).find((k) => /\|apify$/.test(k));
  assert.deepEqual(d.rows[row], { n: 1, ti: 0, to: 0, ws: 0, it: 3 });
  assert.equal(SP.spendCost(s, { n: 1, it: 3 }, s.price), 0.0016);
});

test("the page learns Facebook finds are on for a Pro member from /alerts/status", () => {
  assert.match(indexFn("alStatus"), /fb: fbLive\(env\) && !!sub\.pro/);
});
