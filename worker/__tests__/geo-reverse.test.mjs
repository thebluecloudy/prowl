/* v159 Use my location on the worker: GET /geo?lat=..&lng=.. names the town a phone's fix is in (reverse Google
   Geocoding on GOOGLE_MAPS_KEY, US only), from the point rounded to ~1 km, with the nearest Craigslist site, against a
   fake Google and a fake Craigslist area list. Run: node --test worker/__tests__/geo-reverse.test.mjs */
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
const US = comp("United States", "US", ["country", "political"]), OH = comp("Ohio", "OH", ["administrative_area_level_1", "political"]);
/* what Google answers for a latlng near Chillicothe: a street address first, then the ZIP, then the city */
const REV = {
  "39.33,-82.98": [
    { types: ["street_address"], geometry: { location: { lat: 39.3331, lng: -82.9823 } }, address_components: [comp("123", "123", ["street_number"]), comp("Main Street", "Main St", ["route"]), comp("Chillicothe", "Chillicothe", ["locality", "political"]), comp("Ross County", "Ross County", ["administrative_area_level_2"]), OH, US, comp("45601", "45601", ["postal_code"])] },
    { types: ["postal_code"], geometry: { location: { lat: 39.33, lng: -82.98 } }, address_components: [comp("45601", "45601", ["postal_code"]), comp("Chillicothe", "Chillicothe", ["locality", "political"]), OH, US] },
  ],
  /* out in the country: a township and a ZIP only in a later result */
  "39.4,-82.7": [
    { types: ["plus_code"], geometry: { location: { lat: 39.4, lng: -82.7 } }, address_components: [comp("C7XX+XX", "C7XX+XX", ["plus_code"])] },
    { types: ["administrative_area_level_3"], geometry: { location: { lat: 39.4, lng: -82.7 } }, address_components: [comp("Colerain Township", "Colerain Township", ["administrative_area_level_3", "political"]), OH, US] },
    { types: ["postal_code"], geometry: { location: { lat: 39.4, lng: -82.7 } }, address_components: [comp("43115", "43115", ["postal_code"]), OH, US] },
  ],
  "43.65,-79.38": [{ types: ["locality"], geometry: { location: { lat: 43.65, lng: -79.38 } }, address_components: [comp("Toronto", "Toronto", ["locality"]), comp("Ontario", "ON", ["administrative_area_level_1"]), comp("Canada", "CA", ["country"])] }],
};
const AREAS = [
  { Country: "US", Hostname: "chillicothe", Latitude: 39.3331, Longitude: -82.9824 },
  { Country: "US", Hostname: "columbus", Latitude: 39.9612, Longitude: -82.9988 },
];
const CALLS = [];
function fakeFetch(u, init) {
  u = String(u); CALLS.push({ u, init });
  const ok = (j) => Promise.resolve({ ok: true, status: 200, json: async () => j, headers: new Headers() });
  if (/reference\.craigslist\.org\/Areas/.test(u)) return ok(AREAS);
  if (/geocode\/json\?latlng=/.test(u)) {
    const ll = /latlng=([^&]+)/.exec(u)[1].split(",").map(Number).join(",");
    return ok({ status: REV[ll] ? "OK" : "ZERO_RESULTS", results: REV[ll] || [] });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}
const names = ["gKey", "gFetch", "gGeocode", "gReverse", "clAreas", "geoRoute", "geoBackRoute", "cors", "json", "ipKey", "ip6Parts", "scrubPII"];
const LOGS = [];
const pre = ["let CL_AREAS = null;", constLine("GEO_PER_IP"), constLine("G_REVIEWS_PER_DAY"), constLine("G_TIMEOUT_MS"), constLine("ALLOW_ORIGINS").replace(/^const ALLOW_ORIGINS = \[.*$/m, 'const ALLOW_ORIGINS = ["https://www.owlandtwigvintage.com", "https://owlandtwigvintage.com"];')].join("\n");
let ALLOW = true;
const W = fromIndex(names, Object.assign({ fetch: fakeFetch, PCACHE, vCount: async () => ALLOW, console: { error: (...a) => LOGS.push(a.join(" ")), log: (...a) => LOGS.push(a.join(" ")) } }, TRIP), pre);
const ORIGIN = "https://www.owlandtwigvintage.com";
const env = (o) => Object.assign({ GOOGLE_MAPS_KEY: "k".repeat(30) }, o || {});
async function rev(e, qs) {
  const url = new URL("https://prowl.thebluecloud.workers.dev/geo?" + qs);
  const r = { method: "GET", url: url.href, headers: { get: (h) => ({ origin: ORIGIN, "cf-connecting-ip": "1.2.3.4" })[h.toLowerCase()] || null } };
  const res = await W.geoRoute(r, e, url, ORIGIN);
  return { status: res.status, body: await res.json(), res };
}

test("geoRound keeps 2 decimals (~1 km) and refuses what is not a point; geoReverse names the town, never a street", () => {
  assert.deepEqual(TRIP.geoRound("39.33312", "-82.98234"), { lat: 39.33, lng: -82.98 });
  assert.equal(TRIP.geoRound("", "1"), null);
  assert.equal(TRIP.geoRound(null, "1"), null);
  assert.equal(TRIP.geoRound("91", "0"), null);
  assert.equal(TRIP.geoRound("abc", "0"), null);
  assert.deepEqual(TRIP.geoReverse(REV["39.33,-82.98"]), { town: "Chillicothe, OH", city: "Chillicothe", st: "OH", zip: "45601" });
  assert.deepEqual(TRIP.geoReverse(REV["39.4,-82.7"]), { town: "Colerain Township, OH", city: "Colerain Township", st: "OH", zip: "43115" }, "a township, and the ZIP from a later result");
  assert.equal(TRIP.geoReverse(REV["43.65,-79.38"]), null, "outside the US");
  assert.equal(TRIP.geoReverse([]), null);
  assert.equal(TRIP.geoReverse(null), null);
});

test("/geo?lat&lng: the town of the rounded point with its Craigslist site; kept per rounded point; misses 404 and not kept", async () => {
  assert.equal((await rev(env({ GOOGLE_MAPS_KEY: "" }), "lat=39.333&lng=-82.982")).status, 503);
  assert.equal((await rev(env(), "lat=&lng=-82.98")).status, 400);
  assert.equal((await rev(env(), "lat=39.3")).status, 400, "lat without lng is not a typed place either");
  assert.equal((await rev(env(), "lat=200&lng=0")).status, 400);
  CALLS.length = 0; PCACHE.m.clear(); LOGS.length = 0;
  const r = await rev(env(), "lat=39.33312&lng=-82.98234");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { lat: 39.33, lng: -82.98, town: "Chillicothe, OH", city: "Chillicothe", st: "OH", zip: "45601", cl: "chillicothe" });
  assert.equal(r.res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const g = CALLS.find((c) => /geocode/.test(c.u));
  assert.match(g.u, /latlng=39\.33,-82\.98&/, "Google gets only the rounded point");
  assert.ok(![...PCACHE.m.keys()].some((k) => /39\.333/.test(k)), "the cache key holds only the rounded point");
  CALLS.length = 0;
  const near = await rev(env(), "lat=39.3349&lng=-82.9801");
  assert.equal(near.res.headers.get("X-Prowl-Cache"), "hit", "a fix within the same ~1 km cell is a cache hit");
  assert.equal(CALLS.length, 0);
  const town = await rev(env(), "lat=39.4&lng=-82.7");
  assert.equal(town.body.town, "Colerain Township, OH"); assert.equal(town.body.zip, "43115");
  const miss = await rev(env(), "lat=10&lng=10");
  assert.equal(miss.status, 404);
  assert.ok(![...PCACHE.m.keys()].some((k) => /ll=10\.00/.test(k)), "a miss is not kept");
  assert.equal((await rev(env(), "lat=43.65&lng=-79.38")).status, 404, "not in the US");
  assert.ok(!LOGS.some((l) => /39\.3|82\.9/.test(l)), "coordinates are never logged");
  ALLOW = false; PCACHE.m.clear();
  assert.equal((await rev(env(), "lat=39.33&lng=-82.98")).status, 429, "GEO_PER_IP is shared");
  ALLOW = true;
});

test("/geo?q= still geocodes typed text; the reverse route never logs and never touches the key itself", () => {
  assert.match(indexFn("geoRoute"), /searchParams\.has\("lat"\) \|\| url\.searchParams\.has\("lng"\)\) return geoBackRoute/);
  assert.ok(!/console\.(log|error)/.test(indexFn("geoBackRoute")), "nothing logged");
  assert.ok(!/console\.(log|error)/.test(indexFn("gReverse")), "nothing logged");
  assert.ok(!/GOOGLE_MAPS_KEY/.test(indexFn("geoBackRoute")));
  assert.ok(Number(/^const WORKER_VERSION = "v(\d+)";/m.exec(INDEX)[1]) >= 159, "v159 or later (a later worker keeps this route)");
});
