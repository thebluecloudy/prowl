/* v132 NEAR ME on the worker: /near, /trip, /trips (group trips in KV), the finds feed (R2) and the sweep, against a
   fake Google and fake stores. Run: node --test worker/__tests__/trips.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as TRIP from "../trip.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => { const m = new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX); assert.ok(m, name); return m[0]; };
function fromIndex(names, deps, pre) {
  const keys = Object.keys(deps);
  return new Function(...keys, pre + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
}
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
}
class FakeR2 {
  constructor() { this.m = new Map(); }
  async put(k, v, o) { this.m.set(k, { body: v, meta: o }); }
  async get(k) { return this.m.has(k) ? { body: this.m.get(k).body } : null; }
  async list(o) { return { objects: [...this.m.keys()].filter((k) => k.startsWith(o.prefix)).map((k) => ({ key: k })), truncated: false }; }
  async delete(keys) { for (const k of [].concat(keys)) this.m.delete(k); }
}
const PCACHE = { m: new Map(), async match(k) { const v = this.m.get(typeof k === "string" ? k : k.url); return v ? new Response(v.b, { status: v.s, headers: v.h }) : undefined; }, async put(k, res) { const h = {}; res.headers.forEach((v, n) => { h[n] = v; }); this.m.set(typeof k === "string" ? k : k.url, { b: await res.clone().text(), s: res.status, h }); } };

/* ---- the fake Google: the reference route and its shops ---- */
const WAY = [[42.4806, -83.4755], [41.6639, -83.5552], [41.5754, -83.63], [41.0442, -83.6499], [40.2987, -83.068], [39.9612, -82.9988], [39.3331, -82.9824], [38.7317, -82.9977], [38.4784, -82.6379], [38.4192, -82.4452], [38.4345, -82.1322]].map(([lat, lng]) => ({ lat, lng }));
function encodePolyline(pts) {
  let out = "", plat = 0, plng = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const p of pts) { const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5); out += enc(lat - plat) + enc(lng - plng); plat = lat; plng = lng; }
  return out;
}
const WAY35 = [[42.4806, -83.4755], [41.6639, -83.5552], [41.5754, -83.63], [41.0442, -83.6499], [40.2987, -83.068], [39.9612, -82.9988], [39.3331, -82.9824], [39.052, -82.6366], [38.8445, -82.137], [38.4345, -82.1322]].map(([lat, lng]) => ({ lat, lng }));
const ROUTE35 = (() => { const out = []; for (let i = 0; i < WAY35.length - 1; i++) { const a = WAY35[i], b = WAY35[i + 1], n = Math.max(1, Math.round(TRIP.haversineKm(a, b) / 2)); for (let k = 0; k < n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lng: a.lng + (b.lng - a.lng) * k / n }); } out.push(WAY35[WAY35.length - 1]); return out; })();
const ROUTE_PTS = (() => { const out = []; for (let i = 0; i < WAY.length - 1; i++) { const a = WAY[i], b = WAY[i + 1], n = Math.max(1, Math.round(TRIP.haversineKm(a, b) / 2)); for (let k = 0; k < n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lng: a.lng + (b.lng - a.lng) * k / n }); } out.push(WAY[WAY.length - 1]); return out; })();
const HOURS_TUE_SUN = { periods: [0, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 10, minute: 0 }, close: { day: d, hour: 17, minute: 0 } })), weekdayDescriptions: ["Monday: Closed", "Tuesday: 10:00 AM – 5:00 PM", "Wednesday: 10:00 AM – 5:00 PM", "Thursday: 10:00 AM – 5:00 PM", "Friday: 10:00 AM – 5:00 PM", "Saturday: 10:00 AM – 5:00 PM", "Sunday: 10:00 AM – 5:00 PM"] };
const HOURS_DAILY = { periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 10, minute: 0 }, close: { day: d, hour: 18, minute: 0 } })), weekdayDescriptions: ["Monday: 10:00 AM – 6:00 PM", "Tuesday: 10:00 AM – 6:00 PM", "Wednesday: 10:00 AM – 6:00 PM", "Thursday: 10:00 AM – 6:00 PM", "Friday: 10:00 AM – 6:00 PM", "Saturday: 10:00 AM – 6:00 PM", "Sunday: 10:00 AM – 6:00 PM"] };
function gPlace(name, town, st, lat, lng, extra) {
  return Object.assign({ id: "ChIJ" + name.replace(/\W+/g, ""), displayName: { text: name }, formattedAddress: "1 Main St, " + town + ", " + st + " 00000, USA",
    addressComponents: [{ longText: "1", types: ["street_number"] }, { longText: "Main Street", types: ["route"] }, { longText: town, types: ["locality"] }, { longText: st, shortText: st, types: ["administrative_area_level_1"] }],
    location: { latitude: lat, longitude: lng }, rating: 4.6, userRatingCount: 300, utcOffsetMinutes: -240, regularOpeningHours: HOURS_DAILY,
    photos: [{ name: "places/ChIJ" + name.replace(/\W+/g, "") + "/photos/P1" }], primaryTypeDisplayName: { text: "Antique Store" } }, extra || {});
}
const SHOPS = [
  gPlace("Maumee Antique Mall", "Maumee", "OH", 41.5754, -83.6425, { userRatingCount: 1200, editorialSummary: { text: "Over 300 dealers in 53,000 sq ft" } }),
  gPlace("Jeffrey's Antique Gallery", "Findlay", "OH", 41.0995, -83.6565, { editorialSummary: { text: "350 dealers" } }),
  gPlace("Delaware Antique Mall", "Delaware", "OH", 40.299, -83.07, { editorialSummary: { text: "Antique mall on two floors" } }),
  gPlace("Chillicothe Antique Emporium", "Chillicothe", "OH", 39.334, -82.981, { editorialSummary: { text: "100+ dealers" }, regularOpeningHours: HOURS_TUE_SUN }),
  gPlace("Unique Antiques Warehouse", "Portsmouth", "OH", 38.733, -82.996, { editorialSummary: { text: "A warehouse of antiques" } }),
  gPlace("Bluegrass Collectors", "Ashland", "KY", 38.479, -82.64, { editorialSummary: { text: "40 vendors" } }),
  gPlace("Central City Antiques", "Huntington", "WV", 38.419, -82.461, { editorialSummary: { text: "60 dealers on Central City's antique row" } }),
  gPlace("Olde Central City Vintage", "Huntington", "WV", 38.4193, -82.4605, { userRatingCount: 40 }),
  gPlace("14th Street Collectibles", "Huntington", "WV", 38.4188, -82.46, { userRatingCount: 25, rating: 4.3 }),
  gPlace("Mansfield Antique Barn", "Mansfield", "OH", 40.7584, -82.5154, { editorialSummary: { text: "200 dealers" } }),
  gPlace("Ellie Mills Mercantile", "Jackson", "OH", 39.052, -82.6366, { userRatingCount: 5, rating: 5, primaryTypeDisplayName: { text: "Home goods store" } }),   /* on US-35 */
  gPlace("The Mason Jar", "Point Pleasant", "WV", 38.8445, -82.137, { userRatingCount: 176, primaryTypeDisplayName: { text: "Home goods store" } }),
  gPlace("Gaffney's Treasures and Gifts", "Marion", "OH", 40.62, -83.30, { userRatingCount: 60, primaryTypeDisplayName: { text: "Gift shop" } }),   /* on both, small */
  gPlace("Hillbilly Flea Market", "Ashland", "KY", 38.4795, -82.6410, { userRatingCount: 970, rating: 3.9, primaryTypeDisplayName: { text: "Flea Market" } }),   /* v138: out unless Flea markets is on */
];
const BLENKO = gPlace("Blenko Glass Company", "Milton", "WV", 38.4345, -82.1322, { regularOpeningHours: { periods: [1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: 9, minute: 0 }, close: { day: d, hour: 15, minute: 30 } })), weekdayDescriptions: ["Monday: 9:00 AM – 3:30 PM", "Tuesday: 9:00 AM – 3:30 PM", "Wednesday: 9:00 AM – 3:30 PM", "Thursday: 9:00 AM – 3:30 PM", "Friday: 9:00 AM – 3:30 PM", "Saturday: Closed", "Sunday: Closed"] } });
const CALLS = [];
function fakeGoogle(u, init) {
  u = String(u); CALLS.push(u);
  const ok = (j) => Promise.resolve({ ok: true, status: 200, json: async () => j, headers: new Headers({ "Content-Type": "application/json" }) });
  if (/places:searchText/.test(u)) {
    const b = JSON.parse(init.body);
    if (/paged test/.test(b.textQuery)) {   /* v139: 45 shops over three pages */
      const page = b.pageToken === "p2" ? 1 : b.pageToken === "p3" ? 2 : 0, all = Array.from({ length: 45 }, (_, i) => gPlace("Paged Shop " + i, "Paged", "OH", 40 + i / 1000, -83, {}));
      return ok({ places: all.slice(page * 20, page * 20 + 20), nextPageToken: page < 2 ? "p" + (page + 2) : undefined });
    }
    if (/blenko/i.test(b.textQuery)) return ok({ places: [BLENKO] });
    if (/nowhere/i.test(b.textQuery)) return ok({ places: [] });
    const c = b.locationBias ? b.locationBias.circle : null, r = b.locationRestriction ? b.locationRestriction.rectangle : null;
    if (r) {   /* v138: a trip box; Google stays inside it */
      if (r.low.latitude > 44) return ok({ places: [] });
      return ok({ places: SHOPS.filter((p) => p.location.latitude >= r.low.latitude && p.location.latitude <= r.high.latitude && p.location.longitude >= r.low.longitude && p.location.longitude <= r.high.longitude) });
    }
    if (!c) return ok({ places: [] });
    const here = { lat: c.center.latitude, lng: c.center.longitude };
    if (here.lat > 44) return ok({ places: [] });   /* the far north: no shops at all */
    return ok({ places: SHOPS.filter((p) => TRIP.haversineKm(here, { lat: p.location.latitude, lng: p.location.longitude }) <= c.radius / 1000) });
  }
  if (/computeRoutes/.test(u)) { const b = JSON.parse(init.body); if (b.destination.address === "nowhere special") return ok({ routes: [] });
    if (b.origin.location.latLng.latitude < 39) return ok({ routes: [{ polyline: { encodedPolyline: encodePolyline(ROUTE_PTS.filter((p) => p.lng > -82.47)) }, distanceMeters: 30000, duration: "1500s" }] }); if (b.destination.address === "nowhere") return ok({ routes: [{ polyline: { encodedPolyline: encodePolyline([{ lat: 46.5, lng: -84.3 }, { lat: 46.6, lng: -84.2 }]) }, distanceMeters: 12000, duration: "900s" }] }); /* v136: the fastest first (US-35), then the US-23 alternative with more along it */
    return ok({ routes: [{ polyline: { encodedPolyline: encodePolyline(ROUTE35) }, distanceMeters: 571000, duration: "20880s" }].concat(b.computeAlternativeRoutes ? [{ polyline: { encodedPolyline: encodePolyline(ROUTE_PTS) }, distanceMeters: 640000, duration: "23400s" }] : []) }); }
  if (/geocode\/json/.test(u)) { const south = /latlng=38\./.test(u); return ok({ results: [{ address_components: [{ long_name: south ? "Huntington" : "Novi", short_name: south ? "Huntington" : "Novi", types: ["locality", "political"] }, { long_name: south ? "West Virginia" : "Michigan", short_name: south ? "WV" : "MI", types: ["administrative_area_level_1", "political"] }] }] }); }
  const m = /\/v1\/places\/([^?]+)/.exec(u);
  if (m) { const p = SHOPS.concat([BLENKO]).find((x) => x.id === decodeURIComponent(m[1])); return ok(p ? { id: p.id, regularOpeningHours: p.regularOpeningHours, utcOffsetMinutes: -240 } : {}); }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

/* ---- the worker's functions, with their helpers ---- */
const SECRET = "s".repeat(40);
const PRO = {};   /* cid -> paid Pro, the fake shop */
const names = ["gKey", "gFetch", "gPlacesText", "gPlacesAll", "gPlacesPage", "gPlaceHours", "gRoutes", "gTown", "nearNum", "tripCell", "nearAnswer", "nearRoute", "tripBuild", "tripRoute", "ppRoute",
  "proCids", "tripIdOk", "tripMemberIdFor", "tripWho", "tripPro", "tripId", "tripGet", "tripPut", "tripIndexAdd", "tripJoin", "tripSummary", "acctHash", "tripAcctLink", "findSig", "findUrl", "tripsRoute", "findPhotoRoute", "tripSweep",
  "b64u", "b64uStr", "unb64u", "sessKey", "sessMint", "sessVerify", "sessMember", "pxHmac", "alSame", "alEmail", "sha16", "kvGet", "kvPut", "readJson", "vClean", "scrubPII", "ipKey", "ip6Parts", "cors", "json"];
const pre = [constLine("NEAR_PER_IP"), constLine("G_PLACE_FIELDS"), constLine("G_TIMEOUT_MS"), constLine("ALLOW_ORIGINS").replace(/^const ALLOW_ORIGINS = \[.*$/m, 'const ALLOW_ORIGINS = ["https://www.owlandtwigvintage.com", "https://owlandtwigvintage.com"];'), "const SESS_DAYS = 30;"].join("\n");
const W = fromIndex(names, Object.assign({ fetch: fakeGoogle, PCACHE, vCount: async () => true, isOwner: (r) => r.headers.get("x-prowl-owner") === "owner-key-0123456789", alProShop: async (env, email, c, cid) => ({ pro: !!PRO[cid] }), console: { error() {} } }, TRIP), pre);

function envWith(o) { return Object.assign({ PROWL_ALERTS: new FakeKV(), PROWL_SESSION_SECRET: SECRET, GOOGLE_MAPS_KEY: "k".repeat(30) }, o || {}); }
const ORIGIN = "https://www.owlandtwigvintage.com";
async function req(env, method, path, body, cid, hdr) {
  const tok = cid ? await W.sessMint(env, cid) : "";
  const headers = Object.assign({ origin: ORIGIN, authorization: tok ? "Bearer " + tok : "", "content-length": body ? String(JSON.stringify(body).length) : "0", "cf-connecting-ip": "1.2.3.4" }, hdr || {});
  return { method, url: "https://prowl.thebluecloud.workers.dev" + path, headers: { get: (h) => headers[h.toLowerCase()] || null }, text: async () => (body ? JSON.stringify(body) : "") };
}
async function call(env, method, path, body, cid, hdr) {
  const r = await req(env, method, path, body, cid, hdr), url = new URL(r.url);
  const res = path.startsWith("/near") ? await W.nearRoute(r, env, url, ORIGIN) : path.startsWith("/trip?") ? await W.tripRoute(r, env, url, ORIGIN)
    : path.startsWith("/trips") ? await W.tripsRoute(r, env, url, ORIGIN) : path.startsWith("/finds/") ? await W.findPhotoRoute(r, env, url) : await W.ppRoute(r, env, url);
  const type = res.headers.get("Content-Type") || "";
  return { status: res.status, body: /json/.test(type) ? await res.json() : null, res, type };
}
const NOVI = "lat=42.4806&lng=-83.4755";

test("/near: without the key a plain 'not set up'; with it the shops around a point, ranked, with live hours and proxied photos; a cache hit the second time", async () => {
  const off = await call(envWith({ GOOGLE_MAPS_KEY: "" }), "GET", "/near?" + NOVI);
  assert.equal(off.status, 503); assert.equal(off.body.error, "not set up"); assert.deepEqual(off.body.places, []);
  const bad = await call(envWith(), "GET", "/near?lat=91&lng=0");
  assert.equal(bad.status, 400);
  const env = envWith(); CALLS.length = 0; PCACHE.m.clear();
  const r = await call(env, "GET", "/near?lat=38.4192&lng=-82.4452");   /* standing in Huntington */
  assert.equal(r.status, 200);
  assert.equal(CALLS.filter((u) => /searchText/.test(u)).length, 2, "two searches: antiques and malls, vintage and thrift");
  const names = r.body.places.map((p) => p.name);
  assert.equal(names[0], "Central City Antiques", "the biggest first");
  assert.equal(names.filter((n) => /Central City|14th Street/.test(n)).length, 3, "the three Huntington shops");
  assert.ok(names.indexOf("Bluegrass Collectors") === -1, "Ashland, 18 km off, is outside the circle");
  assert.ok(!r.body.places.find((p) => p.near > TRIP.NEAR_KEEP_KM), "v133: nothing beyond NEAR_KEEP_KM");
  assert.ok(names.indexOf("Maumee Antique Mall") === -1, "Maumee is not near Huntington");
  const c = r.body.places[0];
  assert.equal(c.town, "Huntington, WV"); assert.equal(c.why, "60 dealers"); assert.equal(c.photo, "/pp?n=places%2FChIJCentralCityAntiques%2Fphotos%2FP1");
  assert.equal(c.hours.offset, -240); assert.equal(c.hours.periods.length, 7); assert.equal(typeof c.near, "number");
  assert.equal(TRIP.openAt(c.hours, Date.parse("2026-10-26T16:00:00Z")), true, "the page can say OPEN NOW from what it got");
  /* v135: the kinds asked for go into the query and the cache key */
  const recs = await call(env, "GET", "/near?lat=38.4191&lng=-82.4451&cats=records,toys");
  assert.equal(recs.res.headers.get("X-Prowl-Cache"), null, "another kind is another answer");
  const q = CALLS.filter((u) => /searchText/.test(u)).length;
  assert.ok(q >= 3, "it asked Google again");
  const again = await call(env, "GET", "/near?lat=38.4191&lng=-82.4451");
  assert.equal(again.res.headers.get("X-Prowl-Cache"), "hit", "the same ~1 km cell within 10 minutes");
  assert.equal(again.body.places[0].name, "Central City Antiques");
});

test("/trip: the reference route from Novi to Blenko, in drive order, the Central City cluster, Monday hours, the Maps link with a town for origin", async () => {
  const env = envWith(); CALLS.length = 0; PCACHE.m.clear();
  const r = await call(env, "GET", "/trip?" + NOVI + "&to=" + encodeURIComponent("Blenko Glass Company, Milton, WV") + "&day=2026-10-26");
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.origin.town, "Novi, MI");
  assert.equal(b.dest.name, "Blenko Glass Company"); assert.equal(b.dest.town, "Milton, WV");
  assert.deepEqual(b.stops.map((s) => s.name), ["Maumee Antique Mall", "Jeffrey's Antique Gallery", "Delaware Antique Mall", "Chillicothe Antique Emporium", "Unique Antiques Warehouse", "Bluegrass Collectors", "Central City Antiques"]);
  assert.deepEqual(b.stops[6].nested.map((s) => s.name), ["Olde Central City Vintage", "14th Street Collectibles"]);
  assert.equal(b.weekday, 1, "a Monday");
  const emporium = b.stops[3];
  assert.deepEqual(TRIP.hoursForDay(emporium.hours, b.weekday), { open: false, text: "Closed" }, "Chillicothe is closed on Mondays");
  assert.deepEqual(TRIP.hoursForDay(b.dest.hours, b.weekday), { open: true, text: "9:00 AM – 3:30 PM" }, "Blenko's Monday schedule");
  const u = new URL(b.maps);
  assert.equal(u.searchParams.get("origin"), "Novi, MI");
  assert.equal(u.searchParams.get("destination"), "Blenko Glass Company, Milton, WV");
  assert.equal(u.searchParams.get("waypoints").split("|").length, 7);
  assert.ok(!/Olde Central/.test(u.searchParams.get("waypoints")), "nested stops are not waypoints");
  assert.ok(!TRIP.hasStreet(JSON.stringify(b).replace(/1 Main St/g, "")), "no street address in the answer besides the shops' own");
  assert.ok(!/42\.48|83\.4755/.test(JSON.stringify(b.origin)), "the origin point is not echoed");
  assert.equal(b.route.km, 640); assert.equal(b.route.min, 390); assert.equal(b.empty, false);
  assert.equal(b.route.slower, 42, "v136: the route with the most to see, 42 minutes longer than Google's fastest");
  assert.equal(b.route.routes, 2);
  assert.ok(!b.stops.find((s) => /Gaffney|Ellie Mills/.test(s.name)), "small shops are not anchors");
  assert.deepEqual(b.more.map((m) => m.name), ["Gaffney's Treasures and Gifts"], "smaller shops along the way, listed apart");
  assert.ok(!JSON.stringify(b).includes("Hillbilly"), "v138: a flea market is out while its chip is off");
  assert.equal(b.stops[5].name, "Bluegrass Collectors", "so Ashland's anchor is the collectors' shop");
  const searches = CALLS.filter((u) => /searchText/.test(u)).length;
  assert.ok(searches >= 20 && searches <= 120, "two routes, two queries a box, shared boxes asked once: " + searches);
  const again = await call(env, "GET", "/trip?" + NOVI + "&to=" + encodeURIComponent("blenko glass company, milton, wv") + "&day=2026-10-26");
  assert.equal(again.res.headers.get("X-Prowl-Cache"), "hit");
});

test("/trip: an empty corridor is a result with the route, not an error; no route is a 404; no key is 'not set up'", async () => {
  const env = envWith(); PCACHE.m.clear();
  const far = await call(env, "GET", "/trip?lat=46.5&lng=-84.3&to=nowhere");   /* Sault Ste. Marie: the fake has no shops up there */
  assert.equal(far.status, 200); assert.equal(far.body.empty, true); assert.deepEqual(far.body.stops, []);
  assert.match(far.body.maps, /^https:\/\/www\.google\.com\/maps\/dir\//, "the route is still offered");
  const none = await call(env, "GET", "/trip?" + NOVI + "&to=" + encodeURIComponent("nowhere special"));
  assert.equal(none.status, 404); assert.equal(none.body.error, "no route");
  const off = await call(envWith({ GOOGLE_MAPS_KEY: "" }), "GET", "/trip?" + NOVI + "&to=anywhere");
  assert.equal(off.status, 503); assert.equal(off.body.error, "not set up");
  assert.equal((await call(env, "GET", "/trip?" + NOVI)).status, 400);
});

test("v139: a full box is read on to its next pages, and never past the third", async () => {
  const env = envWith(); CALLS.length = 0;
  const all = await W.gPlacesAll(env, "paged test", { lat: 40, lng: -83 }, 22000, true, 3);
  assert.equal(all.length, 45);
  assert.equal(CALLS.filter((u) => /searchText/.test(u)).length, 3);
  CALLS.length = 0;
  assert.equal((await W.gPlacesAll(env, "paged test", { lat: 40, lng: -83 }, 22000, true, 1)).length, 20, "one page when asked for one");
  const one = await W.gPlacesText(env, "paged test", { lat: 40, lng: -83 }, 22000, 20, true);
  assert.equal(one.length, 20, "the plain call is still one page");
});

test("/pp: only a place photo name, through the worker", async () => {
  const bad = await call(envWith(), "GET", "/pp?n=" + encodeURIComponent("https://evil/x"));
  assert.equal(bad.status, 404);
  assert.equal((await call(envWith({ GOOGLE_MAPS_KEY: "" }), "GET", "/pp?n=" + encodeURIComponent("places/ChIJx/photos/P1abcdef"))).status, 503);
  /* v133: Google's photo names run to 500 characters and more; every photo answered 404 on the first live day */
  const long = "places/ChIJATQDOM6yJIgREuVMbhvdRD8/photos/" + "Aa-ngMYA2fJs_IMj_pxqBvwyxiOKAf3Vfw4YwK3kyR9pxlIOF7WW7BfnPV5jVfuYsJ".repeat(9);
  assert.ok(long.length > 500);
  assert.equal((await call(envWith({ GOOGLE_MAPS_KEY: "" }), "GET", "/pp?n=" + encodeURIComponent(long))).status, 503, "a long name passes the shape check");
});

test("group trips: a sign-in is needed, Pro is decided on the worker, the organizer's trip is kept and every member sees the same stops", async () => {
  const env = envWith({ PRO_CIDS: "1001, 1002" }); PCACHE.m.clear();
  assert.equal((await call(env, "GET", "/trips")).status, 401);
  assert.equal((await call(env, "GET", "/trips")).body.signin, true);
  const noPro = await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755, day: "2026-10-26" }, "3003");
  assert.equal(noPro.status, 403); assert.equal(noPro.body.pro, false, "not on the comp list, no orders");
  PRO["4004"] = true;
  const paid = await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755, day: "2026-10-26" }, "4004");
  assert.equal(paid.status, 200, "a paid Pro order on the customer's own account counts");
  const made = await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755, day: "2026-10-26" }, "1001");
  assert.equal(made.status, 200);
  const t = made.body;
  assert.match(t.id, /^t[a-z0-9]{9}$/); assert.equal(t.org, true); assert.equal(t.mine, true); assert.equal(t.members, 1);
  assert.equal(t.origin, "Novi, MI"); assert.equal(t.stops.length, 7);
  const kept = JSON.parse(env.PROWL_ALERTS.m.get("trip:" + t.id));
  assert.deepEqual(kept.members, ["1001"]); assert.equal(kept.origin, "Novi, MI"); assert.deepEqual(kept.cats, ["antiques", "vintage", "thrift"]);
  assert.ok(!/42\.48|-83\.4755/.test(JSON.stringify(kept)), "the stored trip has no origin point, only its town");
  assert.ok(!TRIP.hasStreet(JSON.stringify(kept).replace(/1 Main St/g, "")));
  const mine = await call(env, "GET", "/trips", null, "1001");
  assert.equal(mine.body.trips.length, 1); assert.equal(mine.body.trips[0].id, t.id); assert.equal(mine.body.trips[0].org, true);
  assert.equal((await call(env, "GET", "/trips/" + t.id, null, "1002")).status, 404, "not a member yet");
  const sharedUnknown = await call(env, "POST", "/trips/" + t.id + "/share", { email: "Friend@Example.com" }, "1001");
  assert.deepEqual(sharedUnknown.body, { ok: true, added: false, pending: true, members: 1 }, "never signed in: the invitation waits");
  assert.ok(!JSON.stringify([...env.PROWL_ALERTS.m.keys()]).toLowerCase().includes("friend@example.com"), "the address is not in any key");
  await W.tripAcctLink(env, "1002", "friend@example.com");   /* the friend signs in to the store */
  const theirs = await call(env, "GET", "/trips/" + t.id, null, "1002");
  assert.equal(theirs.status, 200); assert.equal(theirs.body.org, false); assert.equal(theirs.body.members, 2);
  const orgView = await call(env, "GET", "/trips/" + t.id, null, "1001");
  assert.deepEqual(theirs.body.stops, orgView.body.stops, "identical stops, order and hours");
  assert.equal(theirs.body.maps, orgView.body.maps);
  assert.deepEqual(TRIP.hoursForDay(theirs.body.stops[3].hours, theirs.body.weekday), { open: false, text: "Closed" }, "live hours on the shared view");
  assert.equal((await call(env, "GET", "/trips", null, "1002")).body.trips.length, 1);
  await W.tripAcctLink(env, "1005", "third@example.com");
  const sharedKnown = await call(env, "POST", "/trips/" + t.id + "/share", { email: "third@example.com" }, "1001");
  assert.deepEqual(sharedKnown.body, { ok: true, added: true, pending: false, members: 3 });
  assert.equal((await call(env, "POST", "/trips/" + t.id + "/share", { email: "x@y.z" }, "1002")).status, 403, "only the organizer adds members");
  assert.equal((await call(env, "POST", "/trips/" + t.id + "/share", { email: "nope" }, "1001")).status, 400);
  /* v134: standing in Huntington, the organizer rebuilds: the stops behind drop, the origin is that town, members see it */
  assert.equal((await call(env, "POST", "/trips/" + t.id + "/rebuild", { lat: 38.4192, lng: -82.4452 }, "1002")).status, 403, "only the organizer");
  assert.equal((await call(env, "POST", "/trips/" + t.id + "/rebuild", { lat: 999, lng: 0 }, "1001")).status, 400);
  const rebuilt = await call(env, "POST", "/trips/" + t.id + "/rebuild", { lat: 38.4192, lng: -82.4452 }, "1001");
  assert.equal(rebuilt.status, 200);
  assert.equal(rebuilt.body.origin, "Huntington, WV");
  assert.deepEqual(rebuilt.body.stops.map((s) => s.name), ["Central City Antiques"]);
  assert.equal(new URL(rebuilt.body.maps).searchParams.get("origin"), "Huntington, WV");
  assert.equal(rebuilt.body.id, t.id); assert.equal(rebuilt.body.members, 3, "the same trip, the same group");
  const after = await call(env, "GET", "/trips/" + t.id, null, "1002");
  assert.deepEqual(after.body.stops.map((s) => s.name), ["Central City Antiques"], "the member sees the rebuilt list");
  assert.equal(after.body.origin, "Huntington, WV");
  assert.ok(!/42\.48|-83\.4755|38\.4192/.test(env.PROWL_ALERTS.m.get("trip:" + t.id)), "no origin point is kept, before or after");
  const closed = await call(env, "POST", "/trips/" + t.id + "/close", null, "1001");
  assert.equal(closed.status, 200);
  assert.equal(Date.parse(closed.body.expires) - Date.parse(closed.body.closes), TRIP.FINDS_GRACE_DAYS * 86400000);
});

test("v135: a Prowl Alerts member (email and token) keeps and shares trips without a store sign-in; the owner key is Pro; a share to an alerts member lands at once", async () => {
  const env = envWith({}); PCACHE.m.clear();
  env.PROWL_ALERTS.m.set("sub:matt@example.com", JSON.stringify({ email: "matt@example.com", tok: "tok-matt-0123456789", pro: true, hunts: [] }));
  env.PROWL_ALERTS.m.set("sub:hark@example.com", JSON.stringify({ email: "hark@example.com", tok: "tok-hark-0123456789", pro: false, hunts: [] }));
  const MATT = { "x-prowl-email": "Matt@Example.com", "x-prowl-tok": "tok-matt-0123456789" }, HARK = { "x-prowl-email": "hark@example.com", "x-prowl-tok": "tok-hark-0123456789" };
  assert.equal((await call(env, "GET", "/trips", null, "", { "x-prowl-email": "matt@example.com", "x-prowl-tok": "wrong" })).status, 401, "a wrong token is nobody");
  assert.equal((await call(env, "GET", "/trips", null, "", MATT)).status, 200);
  const made = await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755, day: "2026-10-26" }, "", MATT);
  assert.equal(made.status, 200, "an alerts member's Pro counts");
  const kept = JSON.parse(env.PROWL_ALERTS.m.get("trip:" + made.body.id));
  assert.match(kept.org, /^e[0-9a-f]{16}$/, "a hash of the address, never the address");
  assert.ok(!JSON.stringify([...env.PROWL_ALERTS.m.keys()].filter((k) => !k.startsWith("sub:"))).includes("matt@example.com"), "no address in a trip key");
  assert.equal((await call(env, "GET", "/trips", null, "", MATT)).body.trips[0].org, true);
  const shared = await call(env, "POST", "/trips/" + made.body.id + "/share", { email: "hark@example.com" }, "", MATT);
  assert.deepEqual(shared.body, { ok: true, added: true, pending: false, members: 2 }, "an alerts member who never signed in to the store joins at once");
  const theirs = await call(env, "GET", "/trips/" + made.body.id, null, "", HARK);
  assert.equal(theirs.status, 200); assert.equal(theirs.body.org, false); assert.equal(theirs.body.stops.length, 7);
  assert.equal((await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755 }, "", HARK)).status, 403, "no Pro, no trip of their own");
  const owner = await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755 }, "3003", { "x-prowl-owner": "owner-key-0123456789" });
  assert.equal(owner.status, 200, "the owner key is Pro");
});

const JPEG = (() => { const a = new Uint8Array(1200); a[0] = 0xff; a[1] = 0xd8; a[2] = 0xff; a[3] = 0xe0; return "data:image/jpeg;base64," + Buffer.from(a).toString("base64"); })();

test("trip finds: a member posts a photo check's find, every member sees it with a signed photo link, and it is gone after the grace window", async () => {
  const env = envWith({ PRO_CIDS: "1001,1002", PROWL_FINDS: new FakeR2() }); PCACHE.m.clear();
  const made = await call(env, "POST", "/trips", { to: "Blenko Glass Company, Milton, WV", lat: 42.4806, lng: -83.4755, day: "2026-10-26" }, "1001");
  const id = made.body.id;
  await W.tripAcctLink(env, "1002", "friend@example.com");
  await call(env, "POST", "/trips/" + id + "/share", { email: "friend@example.com" }, "1001");
  const noR2 = await call(envWith({ PRO_CIDS: "1001" }), "POST", "/trips/" + id + "/finds", { img: JPEG }, "1001");
  assert.equal(noR2.status, 404, "another store: the trip is not there");
  const env2 = envWith({ PRO_CIDS: "1001" }); env2.PROWL_ALERTS = env.PROWL_ALERTS;
  assert.equal((await call(env2, "POST", "/trips/" + id + "/finds", { img: JPEG }, "1001")).status, 503, "no bucket yet: a plain 'not set up'");
  assert.equal((await call(env, "POST", "/trips/" + id + "/finds", { img: "data:image/png;base64,AAAA" }, "1001")).status, 400);
  assert.equal((await call(env, "POST", "/trips/" + id + "/finds", { img: "data:image/jpeg;base64,AAAAAAAA" }, "1001")).status, 400, "not a JPEG inside");
  const posted = await call(env, "POST", "/trips/" + id + "/finds", { img: JPEG, item: "Blenko 384 decanter, tangerine", price: "$45", verdict: "FAIR", fair: "$40–$70", stop: "Central City Antiques", town: "Huntington, WV", name: "Matt" }, "1002");
  assert.equal(posted.status, 200);
  const f = posted.body;
  assert.equal(f.item, "Blenko 384 decanter, tangerine"); assert.equal(f.price, "$45"); assert.equal(f.verdict, "FAIR"); assert.equal(f.name, "Matt"); assert.equal(f.by, "me");
  assert.match(f.photo, /^\/finds\/t[a-z0-9]{9}\/f[a-z0-9]{9}\.jpg\?e=\d+&s=[0-9a-f]{32}$/);
  assert.equal(env.PROWL_FINDS.m.size, 1, "one object in the bucket");
  const feed = await call(env, "GET", "/trips/" + id + "/finds", null, "1001");
  assert.equal(feed.body.finds.length, 1); assert.equal(feed.body.finds[0].by, "", "another member's find");
  assert.equal(feed.body.finds[0].item, f.item);
  const img = await call(env, "GET", feed.body.finds[0].photo);
  assert.equal(img.status, 200); assert.equal(img.type, "image/jpeg");
  const u = new URL("https://x" + f.photo);
  assert.equal((await call(env, "GET", u.pathname + "?e=" + u.searchParams.get("e") + "&s=" + "0".repeat(32))).status, 404, "a wrong signature");
  assert.equal((await call(env, "GET", u.pathname + "?e=1&s=" + u.searchParams.get("s"))).status, 404, "an old link");
  assert.equal((await call(env, "GET", u.pathname)).status, 404, "a bare link");
  assert.equal((await call(env, "GET", "/trips/" + id + "/finds", null, "3003")).status, 404, "a stranger sees nothing");
  assert.equal((await call(env, "GET", "/trips/" + id, null, "1001")).body.finds, 1);
  /* the trip runs out: FINDS_GRACE_DAYS after it closes */
  const trip = JSON.parse(env.PROWL_ALERTS.m.get("trip:" + id));
  trip.closes = new Date(Date.now() - (TRIP.FINDS_GRACE_DAYS + 1) * 86400000).toISOString(); trip.expires = TRIP.tripExpires(trip.closes);
  env.PROWL_ALERTS.m.set("trip:" + id, JSON.stringify(trip));
  assert.equal((await call(env, "GET", f.photo)).status, 404, "the photo is not served once the trip has expired, whatever the bucket holds");
  assert.equal((await call(env, "GET", "/trips/" + id + "/finds", null, "1001")).status, 404);
  const all = JSON.parse(env.PROWL_ALERTS.m.get("trips:all")); all[0].expires = trip.expires; env.PROWL_ALERTS.m.set("trips:all", JSON.stringify(all));
  const sw = await W.tripSweep(env);
  assert.equal(sw.swept, 1);
  assert.equal(env.PROWL_FINDS.m.size, 0, "the photo is deleted");
  assert.equal(env.PROWL_ALERTS.m.has("tripfinds:" + id), false); assert.equal(env.PROWL_ALERTS.m.has("trip:" + id), false);
  assert.deepEqual(JSON.parse(env.PROWL_ALERTS.m.get("trips:all")), []);
});

test("the worker's own guards: routes are wired, the login links the account, the clock sweeps, the key never reaches the page", () => {
  assert.match(INDEX, /url\.pathname === "\/near" && request\.method === "GET"\) return nearRoute/);
  assert.match(INDEX, /url\.pathname === "\/trip" && request\.method === "GET"\) return tripRoute/);
  assert.match(INDEX, /url\.pathname\.startsWith\("\/trips\/"\)\) return tripsRoute/);
  assert.match(INDEX, /url\.pathname\.startsWith\("\/finds\/"\) && request\.method === "GET"\) return findPhotoRoute/);
  assert.match(INDEX, /await tripAcctLink\(env, id, email\)/);
  assert.match(INDEX, /await tripSweep\(env\)/);
  assert.match(INDEX, /const WORKER_VERSION = "v139"/);
  assert.equal((INDEX.match(/env\.GOOGLE_MAPS_KEY/g) || []).length, 1, "the key is read in one place (gKey) and never put in an answer");
  for (const name of ["nearRoute", "tripRoute", "tripsRoute", "tripBuild", "ppRoute"]) assert.ok(!/GOOGLE_MAPS_KEY/.test(indexFn(name)), name + " never touches the key itself");
});
