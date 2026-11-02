/* v219 (Matt, 2026-11-01, of a strip that said "Facebook had 16: 11 too far, 4 without all your words, 1 sold or not
   usable." and showed no cards: "When Facebook says this why not show them?"): each fb3:/fb3s: record keeps up to 12 of
   the listings its search set aside (near), why "far" (with miles) or "words" (with the missing hunt words), never the
   sold or unusable ones; /fb-finds answers them as near, apart from items; alerts read items only.
   Run: node --test worker/__tests__/fb-near-v219.test.mjs */
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
const L = (id, extra = {}) => ({ id: String(id), marketplace_listing_title: "Escher print " + id, listing_price: { amount: "40" },
  primary_listing_photo_url: "https://scontent.xx.fbcdn.net/p.jpg", location: { latitude: 42.5, longitude: -83.5, reverse_geocode: { city: "Novi", state: "MI" } }, ...extra });
const FAR = { location: { latitude: 43.4, longitude: -83.5, reverse_geocode: { city: "Saginaw", state: "MI" } } };
const NOPOINT = { location: { reverse_geocode: { city: "Novi" } } };
const WORDS = { marketplace_listing_title: "Framed print, M.C. style" };
const CTX = { term: "escher print", lat: 42.5, lng: -83.5, mi: 25 };

test("fbClean sets aside far and missing-word listings with their reasons; sold ones are never kept", () => {
  const raw = [L(1111111), L(2222222, FAR), L(3333333, NOPOINT), L(4444444, WORDS), L(5555555, { is_sold: true }), L(6666666, { is_pending: true, ...WORDS }), { id: "x", marketplace_listing_title: "bad id" }];
  const st = {}, near = [];
  const out = FB.fbClean(raw, TODAY, CTX, st, near);
  assert.deepEqual(out.map((x) => x.id), ["1111111"]);
  assert.deepEqual(st, { far: 2, words: 1 }, "the counts are as before");
  assert.deepEqual(near.map((x) => [x.id, x.why]), [["2222222", "far"], ["3333333", "far"], ["4444444", "words"]]);
  assert.equal(near[0].miles, 62, "a far one carries its miles");
  assert.ok(!("miles" in near[1]), "no point, no miles");
  assert.deepEqual(near[2].missing, ["escher"], "the missing hunt word");
  for (const x of near) {
    assert.deepEqual(Object.keys(x).filter((k) => !["id", "title", "price", "url", "image", "location", "found", "miles", "why", "missing"].includes(k)), [], "the same item shape plus why and missing");
    assert.match(x.url, /^https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/$/);
  }
  assert.equal(FB.fbClean(raw, TODAY, CTX, {}).length, 1, "aside is optional");
});

test("fbClean keeps at most FB_NEAR_MAX set aside; All USA sets none aside for distance", () => {
  const raw = Array.from({ length: 30 }, (_, i) => L(7000000 + i, i % 2 ? FAR : WORDS));
  const near = [];
  FB.fbClean(raw, TODAY, CTX, {}, near);
  assert.equal(FB.FB_NEAR_MAX, 12);
  assert.equal(near.length, 12);
  const usa = [];
  FB.fbClean(raw, TODAY, { ...CTX, mi: 500 }, {}, usa);
  assert.ok(usa.length && usa.every((x) => x.why === "words"), "v209: All USA keeps far listings as finds");
  const ship = [];
  FB.fbClean(raw, TODAY, { term: "escher print", lat: 42.5, lng: -83.5, ship: true }, {}, ship);
  assert.ok(ship.every((x) => x.why === "words" && x.ships === true && !("miles" in x)), "the shared ships search: words only, no one's distance");
});

test("fbMissing names the words fbMatch lacks, at most 4, none when it matches", () => {
  assert.deepEqual(FB.fbMissing("escher print", "Escher lithograph"), ["print"]);
  assert.deepEqual(FB.fbMissing("escher prints", "Escher Prints"), []);
  assert.deepEqual(FB.fbMissing("fire king jadeite", "Fireking jadeite mug"), [], "written together still matches");
  assert.deepEqual(FB.fbMissing("a b c d e f", "z"), ["b", "c", "d", "e"]);
});

test("fbRun returns near beside items", async () => {
  const body = [L(1111111), L(2222222, FAR), L(4444444, WORDS)];
  const r = await FB.fbRun({ APIFY_TOKEN: "t" }, "escher print", CELL, 24, async () => ({ ok: true, status: 200, json: async () => body }), { mi: 25 });
  assert.deepEqual(r.items.map((x) => x.id), ["1111111"]);
  assert.deepEqual(r.near.map((x) => x.id), ["2222222", "4444444"]);
});

test("fbMerge keeps near the way it keeps finds: the week, today's first, one per listing, none that is a find, capped", () => {
  const old = { updated: "x", day: "2020-01-01", items: [{ id: "1", found: TODAY }],
    near: [{ id: "2", why: "far", miles: 70, found: TODAY, url: "https://www.facebook.com/marketplace/item/2222222/" },
      { id: "3", why: "words", found: "2020-01-01", url: "https://www.facebook.com/marketplace/item/3333333/" },
      { id: "4", why: "sold", found: TODAY, url: "https://www.facebook.com/marketplace/item/4444444/" },
      { id: "5", why: "far", found: TODAY, url: "https://evil.example/5" }] };
  const fresh = [{ id: "2", found: TODAY }];
  const near = [{ id: "6", why: "words", missing: ["escher"], found: TODAY, url: "https://www.facebook.com/marketplace/item/6666666/" }];
  const r = FB.fbMerge(old, fresh, TODAY, undefined, null, near);
  assert.deepEqual(r.items.map((x) => x.id), ["2", "1"]);
  assert.deepEqual(r.near.map((x) => x.id), ["6"], "2 is a find now; 3 is past the week; 4 and 5 are not valid");
  const many = Array.from({ length: 20 }, (_, i) => ({ id: "n" + i, why: "far", found: TODAY, url: "https://www.facebook.com/marketplace/item/" + (8000000 + i) + "/" }));
  assert.equal(FB.fbMerge(null, [], TODAY, undefined, null, many).near.length, 12);
  assert.ok(!("near" in FB.fbMerge(null, [{ id: "1", found: TODAY }], TODAY)), "no set-aside ones: no field (the record is as before)");
  const keep = FB.fbMerge(r, [], TODAY);
  assert.deepEqual(keep.near.map((x) => x.id), ["6"], "a later merge without near keeps the week's");
});

test("fbJoin: near nearest first, then the ships ones, never a find, capped; old records without near load", () => {
  const pick = { updated: "2026-10-30T08:00:00.000Z", items: [{ id: "1", miles: 3 }],
    near: [{ id: "2", why: "far", miles: 90, url: "https://www.facebook.com/marketplace/item/2222222/" }, { id: "3", why: "far", miles: 40, url: "https://www.facebook.com/marketplace/item/3333333/" }, { id: "1", why: "words", url: "https://www.facebook.com/marketplace/item/1111111/" }] };
  const ship = { updated: "2026-10-31T08:00:00.000Z", items: [], near: [{ id: "4", why: "words", ships: true, url: "https://www.facebook.com/marketplace/item/4444444/" }] };
  const j = FB.fbJoin(pick, ship);
  assert.deepEqual(j.near.map((x) => x.id), ["3", "2", "4"]);
  assert.deepEqual(FB.fbJoin({ updated: "u", items: [{ id: "1" }] }, null), { items: [{ id: "1" }], near: [], updated: "u" }, "a record from before v219");
});

/* ---- index.js: /fb-finds, alerts ---- */
function parts() {
  const alPrefs = (s) => ({ zip: (s && s.prefs && s.prefs.zip) || "", radius: (s && s.prefs && s.prefs.radius) || 50, fbusa: (s && s.prefs && s.prefs.fbusa) || [] });
  const fbOf = build("fbOf", { alPrefs, fbMi: FB.fbMi });
  const fbHuntMi = build("fbHuntMi", { FB_USA_MI: FB.FB_USA_MI });
  const fbHunt = build("fbHunt", { fbHuntMi, kvGet, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey, fbJoin: FB.fbJoin, fbWhy: FB.fbWhy, FB_USA_MI: FB.FB_USA_MI });
  const fbTerms = build("fbTerms", { alActive: (env, s) => s.hunts.slice(0, 100), fbTerm: FB.fbTerm });
  return { fbOf, fbHuntMi, fbHunt, fbTerms };
}
class Res {}
const json = (body, status, origin, extra) => Object.assign(new Res(), { status, body, headers: extra });
const U = (id) => "https://www.facebook.com/marketplace/item/" + id + "/";
function setup() {
  const kv = new FakeKV(), P = parts();
  const sub = { email: "pro@example.com", tok: "T".repeat(24), pro: true, hunts: ["Escher print", "Pyrex", "Roseville", "Hull"], prefs: { zip: "48375", radius: 25, fbusa: ["hull"] } };
  kv.set("sub:pro@example.com", sub);
  kv.set("fb3:escher print|42.5,-83.5|25", { updated: "2026-10-31T08:00:00.000Z", day: TODAY, items: [{ id: "1111111", title: "Escher print", url: U(1111111), found: TODAY, miles: 4 }],
    near: [{ id: "2222222", title: "Escher print far", url: U(2222222), found: TODAY, miles: 62, why: "far" }, { id: "4444444", title: "Framed print", url: U(4444444), found: TODAY, miles: 2, why: "words", missing: ["escher"] }],
    stat: { raw: 16, far: 11, words: 4, at: "2026-10-31T08:00:00.000Z" } });
  kv.set("fb3:pyrex|42.5,-83.5|25", { updated: "2026-10-30T09:00:00.000Z", items: [{ id: "5555555", url: U(5555555), found: TODAY }] });   /* before v219: no near */
  kv.set("fb3:roseville|42.5,-83.5|100", { updated: "2026-10-30T09:00:00.000Z", items: [{ id: "6666666", url: U(6666666), miles: 10, found: TODAY }, { id: "7777777", url: U(7777777), miles: 80, found: TODAY }],
    near: [{ id: "8888888", url: U(8888888), miles: 140, why: "far", found: TODAY }, { id: "9999999", url: U(9999999), miles: 1, why: "words", found: TODAY }] });
  kv.set("fb3:hull|42.5,-83.5|500", { updated: "2026-10-30T09:00:00.000Z", items: [], near: [{ id: "1212121", url: U(1212121), miles: 300, why: "words", missing: ["hull"], found: TODAY }] });
  kv.set("fb3s:hull", { updated: "2026-10-30T09:00:00.000Z", items: [], near: [{ id: "1313131", url: U(1313131), ships: true, why: "words", found: TODAY }] });
  const env = { PROWL_ALERTS: kv, OWNER_KEY: "owner-key-0123456789", FB_LIVE: "on", APIFY_TOKEN: "t" };
  const fbWho = build("fbWho", { isOwner: () => false, sessMember: async () => null, alEmail: (e) => String(e || "").trim().toLowerCase(), alSame: (a, b) => a === b, kvGet, json });
  const fbAreaFor = build("fbAreaFor", { fbOf: P.fbOf, kvGet, FB_OWN_ZIP: "fbownzip" });
  const fbFinds = build("fbFinds", { fbWho, fbAreaFor, fbLive: FB.fbLive, fbTerm: FB.fbTerm, json, vCount: async () => true, ipKey: (x) => x, FB_FINDS_PER_IP: 1000, fbArea: async () => CELL,
    fbTerms: P.fbTerms, fbHunt: P.fbHunt, fbLeft: async () => 5, FB_SEARCH_DAY: FB.FB_SEARCH_DAY, Response: Res });
  const fbAlertItems = build("fbAlertItems", { fbLive: FB.fbLive, fbOf: P.fbOf, fbArea: async () => CELL, fbTerm: FB.fbTerm, fbHunt: P.fbHunt, AL_PER_SITE: 50 });
  const PRO = { "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "T".repeat(24) };
  return { env, sub, alerts: (h) => fbAlertItems(env, sub, h),
    finds: (q) => fbFinds(new Request("https://w/fb-finds?" + q, { headers: PRO }), env, new URL("https://w/fb-finds?" + q), "o") };
}

test("/fb-finds?term= answers near apart from items, with the reasons", async () => {
  const S = setup();
  const r = await S.finds("term=Escher%20print");
  assert.deepEqual(r.body.items.map((x) => x.id), ["1111111"]);
  assert.deepEqual(r.body.near.map((x) => [x.id, x.why, x.miles]), [["4444444", "words", 2], ["2222222", "far", 62]], "nearest first");
  assert.deepEqual(r.body.near[0].missing, ["escher"]);
  assert.deepEqual(r.body.why, { raw: 16, far: 11, words: 4, mi: 25 });
  assert.deepEqual((await S.finds("term=Pyrex")).body.near, [], "a record from before v219 loads, with no near");
  assert.deepEqual((await S.finds("term=Rookwood")).body.near, [], "never searched");
});

test("/fb-finds: All USA joins the pickup and ships set-aside ones; a borrowed wider radius sets its farther finds aside", async () => {
  const S = setup();
  const h = await S.finds("term=Hull");
  assert.deepEqual(h.body.near.map((x) => x.id), ["1212121", "1313131"]);
  const r = await S.finds("term=Roseville");
  assert.deepEqual(r.body.items.map((x) => x.id), ["6666666"], "within the member's 25 mi");
  assert.deepEqual(r.body.near.map((x) => [x.id, x.why]), [["9999999", "words"], ["7777777", "far"], ["8888888", "far"]]);
});

test("/fb-finds?all=1 carries near for each hunt", async () => {
  const S = setup();
  const r = await S.finds("all=1");
  assert.deepEqual(r.body.hunts.map((x) => [x.term, x.near.length]), [["escher print", 2], ["pyrex", 0], ["roseville", 3], ["hull", 2]]);
});

test("alerts (and so emails and Pounce) read the finds only, never the set-aside ones", async () => {
  const S = setup();
  const near = new Set();
  for (const k of S.env.PROWL_ALERTS.m.keys()) { const v = S.env.PROWL_ALERTS.json(k); for (const x of (v && v.near) || []) near.add(x.url); }
  for (const h of S.sub.hunts) {
    for (const x of await S.alerts(h)) assert.ok(!near.has(x.url), h + ": " + x.url + " is not a match");
  }
  assert.deepEqual((await S.alerts("Escher print")).map((x) => x.url), [U(1111111)]);
  assert.match(indexFn("fbAlertItems"), /v\.items\.sort/);
  assert.doesNotMatch(indexFn("fbAlertItems"), /\.near/);
});

test("wiring: every kept search saves near; /fb-search answers it; the version and header line", () => {
  for (const f of ["fbSweep", "fbSearch", "fbTestRun"]) assert.match(indexFn(f), /fbMerge\(old, r\.items, day, undefined, r\.stat, r\.near\)/, f);
  assert.match(indexFn("fbSearch"), /near: r\.near \|\| \[\]/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 219);
  assert.match(INDEX, /^ \*   v219: /m);
});

test("KV size: a full record with 12 set-aside listings stays small", () => {
  const img = "https://scontent-ord5-1.xx.fbcdn.net/v/t45.5328-4/" + "a".repeat(220);
  const it = (id, extra) => ({ id: String(id), title: "x".repeat(160), price: "$1,000", url: U(id), image: img, location: "Novi, MI", found: TODAY, miles: 999, ...extra });
  const items = Array.from({ length: 60 }, (_, i) => it(1000000 + i));
  const near = Array.from({ length: 20 }, (_, i) => it(2000000 + i, { why: "words", missing: ["a".repeat(30), "b".repeat(30), "c".repeat(30), "d".repeat(30)] }));
  const a = JSON.stringify(FB.fbMerge(null, items, TODAY, undefined, null)).length, b = JSON.stringify(FB.fbMerge(null, items, TODAY, undefined, null, near)).length;
  assert.ok(b - a < 10000, "12 set-aside listings add under 10 KB at their longest (" + (b - a) + ")");
  assert.ok(b < 60000, "the whole record stays under 60 KB (" + b + ")");
});
