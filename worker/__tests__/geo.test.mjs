/* v157 In a location on the worker: GET /geo turns a typed town, "City, ST" or ZIP into a point (Google Geocoding on
   GOOGLE_MAPS_KEY, US only) with the nearest Craigslist site, against a fake Google and a fake Craigslist area list.
   Run: node --test worker/__tests__/geo.test.mjs */
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
const PCACHE = { m: new Map(), async match(k) { const v = this.m.get(typeof k === "string" ? k : k.url); return v ? new Response(v.b, { status: v.s, headers: v.h }) : undefined; }, async put(k, res) { const h = {}; res.headers.forEach((v, n) => { h[n] = v; }); this.m.set(typeof k === "string" ? k : k.url, { b: await res.clone().text(), s: res.status, h }); } };

const comp = (long, short, types) => ({ long_name: long, short_name: short, types });
const GEO = {
  "milton, wv": { geometry: { location: { lat: 38.43453, lng: -82.13221 } }, address_components: [comp("Milton", "Milton", ["locality", "political"]), comp("Cabell County", "Cabell County", ["administrative_area_level_2"]), comp("West Virginia", "WV", ["administrative_area_level_1", "political"]), comp("United States", "US", ["country", "political"])] },
  "48377": { geometry: { location: { lat: 42.50124, lng: -83.47843 } }, address_components: [comp("48377", "48377", ["postal_code"]), comp("Novi", "Novi", ["locality", "political"]), comp("Michigan", "MI", ["administrative_area_level_1", "political"]), comp("United States", "US", ["country", "political"])] },
  "toronto": { geometry: { location: { lat: 43.65, lng: -79.38 } }, address_components: [comp("Toronto", "Toronto", ["locality"]), comp("Ontario", "ON", ["administrative_area_level_1"]), comp("Canada", "CA", ["country"])] },
};
const AREAS = [
  { Country: "US", Hostname: "huntington", Latitude: 38.419201, Longitude: -82.445297 },
  { Country: "US", Hostname: "charlestonwv", Latitude: 38.349701, Longitude: -81.632797 },
  { Country: "US", Hostname: "detroit", Latitude: 42.331402, Longitude: -83.045799 },
  { Country: "CA", Hostname: "toronto", Latitude: 43.65, Longitude: -79.38 },
  { Country: "US", Hostname: "bad host!", Latitude: 1, Longitude: 1 },
];
const CALLS = [];
let CL_DOWN = false;
function fakeFetch(u, init) {
  u = String(u); CALLS.push({ u, init });
  const ok = (j) => Promise.resolve({ ok: true, status: 200, json: async () => j, headers: new Headers() });
  if (/reference\.craigslist\.org\/Areas/.test(u)) return CL_DOWN ? Promise.resolve({ ok: false, status: 503, json: async () => ({}) }) : ok(AREAS);
  if (/geocode\/json\?address=/.test(u)) {
    const q = decodeURIComponent(/address=([^&]+)/.exec(u)[1]).toLowerCase();
    return ok({ status: GEO[q] ? "OK" : "ZERO_RESULTS", results: GEO[q] ? [GEO[q]] : [] });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}
const names = ["gKey", "gFetch", "gGeocode", "clAreas", "geoRoute", "cors", "json", "ipKey", "ip6Parts", "scrubPII"];
const pre = ["let CL_AREAS = null;", constLine("GEO_PER_IP"), constLine("G_TIMEOUT_MS"), constLine("ALLOW_ORIGINS").replace(/^const ALLOW_ORIGINS = \[.*$/m, 'const ALLOW_ORIGINS = ["https://www.owlandtwigvintage.com", "https://owlandtwigvintage.com"];')].join("\n");
let ALLOW = true;
const W = fromIndex(names, Object.assign({ fetch: fakeFetch, PCACHE, vCount: async () => ALLOW, console: { error() {} } }, TRIP), pre);
const ORIGIN = "https://www.owlandtwigvintage.com";
const env = (o) => Object.assign({ GOOGLE_MAPS_KEY: "k".repeat(30) }, o || {});
async function geo(e, q) {
  const url = new URL("https://prowl.thebluecloud.workers.dev/geo" + (q == null ? "" : "?q=" + encodeURIComponent(q)));
  const r = { method: "GET", url: url.href, headers: { get: (h) => ({ origin: ORIGIN, "cf-connecting-ip": "1.2.3.4" })[h.toLowerCase()] || null } };
  const res = await W.geoRoute(r, e, url, ORIGIN);
  return { status: res.status, body: await res.json(), res };
}

test("geoQuery tidies the typed text; geoPlace reads a Geocoding result, US only; clNearest picks the closest Craigslist site", () => {
  assert.equal(TRIP.geoQuery("  Milton,\n  WV <script> "), "Milton, WV script");
  assert.equal(TRIP.geoQuery("x".repeat(200)).length, TRIP.GEO_Q_MAX);
  assert.deepEqual(TRIP.geoPlace(GEO["milton, wv"]), { lat: 38.4345, lng: -82.1322, town: "Milton, WV", city: "Milton", st: "WV", zip: "" });
  assert.deepEqual(TRIP.geoPlace(GEO["48377"]), { lat: 42.5012, lng: -83.4784, town: "Novi, MI", city: "Novi", st: "MI", zip: "48377" });
  assert.equal(TRIP.geoPlace(GEO.toronto), null, "outside the US");
  assert.equal(TRIP.geoPlace({ address_components: [] }), null, "no point");
  const areas = TRIP.clAreasSlim(AREAS);
  assert.deepEqual(areas.map((a) => a[0]), ["huntington", "charlestonwv", "detroit"], "US sites with a clean hostname only");
  assert.equal(TRIP.clNearest(areas, { lat: 38.4345, lng: -82.1322 }), "huntington", "Milton is 17 miles from Huntington, 27 from Charleston");
  assert.equal(TRIP.clNearest(areas, { lat: 46.5, lng: -84.3 }), "", "nothing within CL_NEAR_MI");
});

test("/geo: not set up without the key; the typed place with its Craigslist site; kept per text; a miss is 404 and not kept", async () => {
  const off = await geo(env({ GOOGLE_MAPS_KEY: "" }), "Milton, WV");
  assert.equal(off.status, 503); assert.equal(off.body.error, "not set up");
  assert.equal((await geo(env(), "")).status, 400);
  assert.equal((await geo(env(), "x")).status, 400);
  CALLS.length = 0; PCACHE.m.clear();
  const r = await geo(env(), "Milton, WV");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { q: "Milton, WV", lat: 38.4345, lng: -82.1322, town: "Milton, WV", city: "Milton", st: "WV", zip: "", cl: "huntington" });
  assert.equal(r.res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const g = CALLS.find((c) => /geocode/.test(c.u));
  assert.match(g.u, /components=country:US/, "US places only");
  const cl = CALLS.find((c) => /craigslist/.test(c.u));
  assert.match(cl.init.headers["User-Agent"], /^Prowl\/1\.0 \(\+https:\/\/owlandtwigvintage\.com/, "an honest User-Agent");
  CALLS.length = 0;
  const again = await geo(env(), "  milton,   WV ");
  assert.equal(again.res.headers.get("X-Prowl-Cache"), "hit", "the same text, any case or spacing, is a cache hit");
  assert.equal(CALLS.length, 0, "Google and Craigslist were not asked again");
  const zip = await geo(env(), "48377");
  assert.equal(zip.body.town, "Novi, MI"); assert.equal(zip.body.zip, "48377"); assert.equal(zip.body.cl, "detroit");
  assert.equal(CALLS.filter((c) => /craigslist/.test(c.u)).length, 0, "the area list is fetched once an isolate");
  const miss = await geo(env(), "Atlantis");
  assert.equal(miss.status, 404);
  assert.ok(![...PCACHE.m.keys()].some((k) => /atlantis/.test(k)), "a miss is not kept");
  assert.equal((await geo(env(), "Toronto")).status, 404, "not in the US");
});

test("/geo: Craigslist down still answers the place, with no site; the per-IP limit says slow down", async () => {
  const W2 = fromIndex(names, Object.assign({ fetch: fakeFetch, PCACHE, vCount: async () => ALLOW, console: { error() {} } }, TRIP), pre);   /* a fresh isolate */
  CL_DOWN = true; PCACHE.m.clear();
  const url = new URL("https://prowl.thebluecloud.workers.dev/geo?q=48377");
  const res = await W2.geoRoute({ method: "GET", url: url.href, headers: { get: () => null } }, env(), url, ORIGIN);
  const b = await res.json();
  assert.equal(res.status, 200); assert.equal(b.town, "Novi, MI"); assert.equal(b.cl, "");
  CL_DOWN = false; PCACHE.m.clear(); ALLOW = false;
  assert.equal((await geo(env(), "Milton, WV")).status, 429);
  ALLOW = true;
});

test("/geo is wired before the catch-all and never logs the typed text", () => {
  assert.match(INDEX, /url\.pathname === "\/geo" && request\.method === "GET"\) return geoRoute/);
  assert.ok(INDEX.indexOf('url.pathname === "/geo"') < INDEX.indexOf('url.pathname === "/sales"'));
  assert.ok(!/console\.(log|error)\([^)]*\bq\b/.test(indexFn("geoRoute")), "the typed text is never logged");
  assert.ok(!/GOOGLE_MAPS_KEY/.test(indexFn("geoRoute")), "geoRoute never touches the key itself");
});
