/* v157 Road Trip upgrades on the worker: /trip's detour and line, GET /order (Optimize route and leg times) through the
   public OSRM router with a straight-line fallback. Run: node --test worker/__tests__/order.test.mjs */
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
const PCACHE = { m: new Map(), async match(k) { const v = this.m.get(k); return v ? new Response(v.b, { status: v.s, headers: v.h }) : undefined; }, async put(k, res) { const h = {}; res.headers.forEach((v, n) => { h[n] = v; }); this.m.set(k, { b: await res.clone().text(), s: res.status, h }); } };
const CALLS = [];
let OSRM = "ok";
function fakeFetch(u, init) {
  u = String(u); CALLS.push({ u, init });
  if (!/router\.project-osrm\.org/.test(u)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  if (OSRM === "down") return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
  const coords = /driving\/([^?]+)/.exec(u)[1].split(";"), n = coords.length;
  if (/\/trip\//.test(u)) {   /* visits input 0, then the last-but-one, then the rest backwards, then the end */
    const visit = [0].concat(Array.from({ length: n - 2 }, (_, i) => n - 2 - i), [n - 1]);
    const wp = coords.map((_, i) => ({ waypoint_index: visit.indexOf(i) }));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ code: "Ok", waypoints: wp, trips: [{ legs: Array.from({ length: n - 1 }, () => ({ duration: 600, distance: 16093.44 })) }] }) });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ code: "Ok", routes: [{ legs: Array.from({ length: n - 1 }, (_, i) => ({ duration: 60 * (i + 1) * 10, distance: 1609.344 * (i + 1) })) }] }) });
}
const names = ["osrmCall", "orderRoute", "cors", "json", "ipKey", "ip6Parts"];
const pre = [constLine("ORDER_PER_IP"), constLine("ALLOW_ORIGINS").replace(/^const ALLOW_ORIGINS = \[.*$/m, 'const ALLOW_ORIGINS = ["https://www.owlandtwigvintage.com", "https://owlandtwigvintage.com"];')].join("\n");
let ALLOW = true;
const W = fromIndex(names, Object.assign({ fetch: fakeFetch, PCACHE, vCount: async () => ALLOW, console: { error() {} } }, TRIP), pre);
const ORIGIN = "https://www.owlandtwigvintage.com";
async function order(qs) {
  const url = new URL("https://prowl.thebluecloud.workers.dev/order?" + qs);
  const res = await W.orderRoute({ method: "GET", url: url.href, headers: { get: () => null } }, {}, url, ORIGIN);
  return { status: res.status, body: await res.json(), res };
}
const P = "p=" + encodeURIComponent("42.4806,-83.4755|41.6539,-83.5379|41.0442,-83.6499|39.9612,-82.9988|38.4345,-82.1322");

test("trip.js: detourParse, routeLine, orderPts, orderEst, osrmRead", () => {
  assert.equal(TRIP.detourParse("30"), 30); assert.equal(TRIP.detourParse("5"), 5); assert.equal(TRIP.detourParse("7"), TRIP.DETOUR_MIN); assert.equal(TRIP.detourParse(null), TRIP.DETOUR_MIN);
  const pts = Array.from({ length: 500 }, (_, i) => ({ lat: 42 + i / 1000, lng: -83 - i / 1000 }));
  const line = TRIP.routeLine(pts);
  assert.equal(line.length, 160); assert.deepEqual(line[0], [42, -83]); assert.deepEqual(line[159], [42.499, -83.499]);
  assert.equal(TRIP.orderPts("1,2"), null, "one point is not a drive");
  assert.equal(TRIP.orderPts("1,2|x,3"), null);
  assert.equal(TRIP.orderPts(Array.from({ length: 15 }, () => "1,2").join("|")), null, "at most ORDER_MAX");
  assert.deepEqual(TRIP.orderPts("42.48061,-83.47549|41.6,-83.5"), [{ lat: 42.481, lng: -83.475 }, { lat: 41.6, lng: -83.5 }], "3 decimals before anything leaves");
  /* a zig-zag: start at 0, stops at 3, 1, 2 along a line, end at 4 */
  const line5 = [{ lat: 0, lng: 0 }, { lat: 0, lng: 3 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }, { lat: 0, lng: 4 }];
  assert.deepEqual(TRIP.orderEst(line5, false), [0, 2, 3, 1, 4], "start and end kept, the stops in line");
  const loop = TRIP.orderEst([{ lat: 0, lng: 0 }, { lat: 0, lng: 2 }, { lat: 1, lng: 1 }, { lat: 0, lng: 1 }], true);
  assert.equal(loop[0], 0); assert.equal(loop.length, 4);
  assert.equal(TRIP.estLegs(line5, [0, 2, 3, 1, 4], false).length, 4);
  assert.equal(TRIP.estLegs(line5, [0, 2, 3, 1, 4], true).length, 5, "a loop has the leg home");
  assert.equal(TRIP.osrmRead({ code: "NoRoute" }, 3, true), null);
  assert.deepEqual(TRIP.osrmRead({ code: "Ok", waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }], trips: [{ legs: [{ duration: 600, distance: 1609.344 }, { duration: 90, distance: 3218.688 }] }] }, 3, true), { order: [0, 2, 1], legs: [{ min: 10, mi: 1 }, { min: 2, mi: 2 }] });
});

test("/order: OSRM's order with the start and end kept, legs in minutes and miles, kept a day; keep=1 times the given order", async () => {
  CALLS.length = 0; PCACHE.m.clear(); OSRM = "ok";
  const r = await order(P);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.order, [0, 3, 2, 1, 4]); assert.equal(r.body.src, "osrm");
  assert.deepEqual(r.body.legs[0], { min: 10, mi: 10 });
  const c = CALLS[0];
  assert.match(c.u, /^https:\/\/router\.project-osrm\.org\/trip\/v1\/driving\/-83\.475,42\.481;-83\.538,41\.654;/, "lng,lat, 3 decimals");
  assert.match(c.u, /\?source=first&destination=last&roundtrip=false&overview=false$/);
  assert.match(c.init.headers["User-Agent"], /^Prowl\/1\.0/);
  CALLS.length = 0;
  const again = await order(P);
  assert.equal(again.res.headers.get("X-Prowl-Cache"), "hit"); assert.equal(CALLS.length, 0);
  const k = await order("keep=1&" + P);
  assert.deepEqual(k.body.order, [0, 1, 2, 3, 4]); assert.equal(k.body.legs.length, 4); assert.deepEqual(k.body.legs[1], { min: 20, mi: 2 });
  assert.match(CALLS[CALLS.length - 1].u, /\/route\/v1\/driving\//);
  const lp = await order("loop=1&keep=1&" + P);
  assert.equal(lp.body.legs.length, 5, "a loop is timed home too");
  const lo = await order("loop=1&p=" + encodeURIComponent("42.48,-83.47|42.49,-83.48|42.47,-83.46|42.52,-83.53"));
  assert.match(CALLS[CALLS.length - 1].u, /\?source=first&roundtrip=true&overview=false$/);
  assert.equal(lo.body.order[0], 0);
});

test("/order: OSRM down falls back to the straight-line estimate, kept 10 minutes; bad points are 400; the per-IP limit says slow down", async () => {
  PCACHE.m.clear(); OSRM = "down";
  const r = await order(P);
  assert.equal(r.status, 200); assert.equal(r.body.src, "est");
  assert.equal(r.body.order[0], 0); assert.equal(r.body.order[4], 4);
  assert.equal(r.res.headers.get("Cache-Control"), "private, max-age=600");
  assert.equal((await order("p=1,2")).status, 400);
  OSRM = "ok"; PCACHE.m.clear(); ALLOW = false;
  assert.equal((await order(P)).status, 429);
  ALLOW = true;
});

test("/trip takes the detour (cache key only when it is not the default) and answers line without its first mile", () => {
  const tr = indexFn("tripRoute"), tb = indexFn("tripBuild");
  assert.match(tr, /detour = detourParse\(url\.searchParams\.get\("detour"\)\)/);
  assert.match(tr, /\(detour !== DETOUR_MIN \? "&d=" \+ detour : ""\)/, "no detour, the same key as before, so kept trips find their build");
  assert.match(tb, /alongRoute\(all, route\.pts, detour \|\| DETOUR_MIN\)/);
  assert.match(tb, /line: routeLine\(best\.route\.pts\.filter\(\(p\) => haversineMi\(from, p\) > 1\)\)/);
  assert.match(INDEX, /url\.pathname === "\/order" && request\.method === "GET"\) return orderRoute/);
});
