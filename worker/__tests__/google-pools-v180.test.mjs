/* v180 (the security and trust audit, 2026-10-28: "Places Details, Photo, Autocomplete and Geocoding have no site-wide
   daily cap"): each has a site-wide daily pool on top of the per-address limit, counted only when Google is asked.
   Run: node --test worker/__tests__/google-pools-v180.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const ROUTES = [
  ["reviewsRoute", "grv:all", "G_REVIEWS_PER_DAY", /gFetch\("https:\/\/places\.googleapis\.com\/v1\/places\/"/],
  ["ppRoute", "gpp:all", "G_PHOTOS_PER_DAY", /fetch\("https:\/\/places\.googleapis\.com\/v1\/" \+ n \+ "\/media/],
  ["suggestRoute", "gsg:all", "G_SUGGEST_PER_DAY", /places:autocomplete/],
  ["geoRoute", "ggeo:all", "G_GEO_PER_DAY", /await gGeocode\(env, q\)/],
  ["geoBackRoute", "ggeo:all", "G_GEO_PER_DAY", /await gReverse\(env, pt\)/],
];

test("each Google lookup takes from its site-wide pool after the cache and the per-address limit, before Google", () => {
  for (const [fn, key, lim, google] of ROUTES) {
    const src = indexFn(fn);
    const pool = src.indexOf('vCount("' + key + '", ' + lim + ")");
    assert.ok(pool > 0, fn + " counts " + key);
    const hit = src.indexOf("PCACHE.match(key)");
    if (hit > 0) assert.ok(hit < pool, fn + ": a cache hit is free");
    assert.ok(src.search(/vCount\("(rv|pp|sg|geo):" \+ ipKey/) < pool, fn + ": the per-address limit first");
    assert.ok(pool < src.search(google), fn + ": before Google is asked");
    assert.match(src.slice(pool, pool + 200), /daily limit/, fn + " says daily limit");
  }
});

test("the pools have sane limits and show in the admin", () => {
  const consts = INDEX.match(/^const G_REVIEWS_PER_DAY = .*$/m)[0];
  const C = new Function(consts + "\nreturn { G_REVIEWS_PER_DAY, G_PHOTOS_PER_DAY, G_SUGGEST_PER_DAY, G_GEO_PER_DAY };")();
  for (const v of Object.values(C)) assert.ok(v > 0 && v <= 5000);
  for (const [key, name] of [["grv:all", "G_REVIEWS_PER_DAY"], ["gpp:all", "G_PHOTOS_PER_DAY"], ["gsg:all", "G_SUGGEST_PER_DAY"], ["ggeo:all", "G_GEO_PER_DAY"]]) {
    const m = new RegExp('\\{ key: "' + key + '", name: "[^"]+", limit: (\\d+) \\}').exec(INDEX);
    assert.ok(m, key + " is an admin pool");
    assert.equal(Number(m[1]), C[name], key + " shows the real limit");
  }
});

test("a refused pool answers 429 and Google is never asked", async () => {
  let asked = 0;
  const deps = {
    vCount: async (k) => k !== "grv:all", gKey: () => "k", ipKey: (x) => x, cors: () => ({}),
    json: (body, status) => ({ status, body }), PCACHE: { match: async () => null, put: async () => {} },
    gFetch: async () => { asked++; return {}; }, Response, encodeURIComponent, REVIEWS_PER_IP: 300, G_REVIEWS_PER_DAY: 300,
  };
  const keys = Object.keys(deps);
  const reviewsRoute = new Function(...keys, indexFn("reviewsRoute") + "\nreturn reviewsRoute;")(...keys.map((k) => deps[k]));
  const r = await reviewsRoute({ headers: { get: () => "203.0.113.9" } }, {}, new URL("https://w/reviews?id=ChIJabcdef"), "o");
  assert.equal(r.status, 429);
  assert.deepEqual(r.body, { error: "daily limit" });
  assert.equal(asked, 0);
});
