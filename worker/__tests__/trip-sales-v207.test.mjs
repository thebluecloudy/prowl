/* v207 estate sales on the way (Matt, 2026-10-31: "part of estate sale was to fold it into road trip map that will take
   you to each one"): GET /trip/sales?p=<route points>&day&tz&h lists the estate sales open on a Road trip's day within 3
   miles of its route, nearest to the road first, at most 12, for Pro members and the owner key only; the lists come from
   at most 5 points along the route (snapped to 0.1 degree, shared wk1: KV), the pages from wkd2:, 16 outside calls a
   request at most.
   Run: node --test worker/__tests__/trip-sales-v207.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../weekend.js";
import { haversineMi } from "../trip.js";

const TZ = "America/Detroit";
const D = (v) => ({ _type: "DateTime", _value: v });
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const CONSTS = [/^const WK_LIST_TTL = .*$/m, /^const WK_PENDING_TTL = .*$/m, /^const WK_TRIP_CALLS = .*$/m].map((re) => re.exec(INDEX)[0]).join("\n");
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
}
function rig({ apiBody = "[]", pages = {}, owner = false, env: envExtra = {}, count = () => true, calls = 0 } = {}) {
  const kv = new FakeKV(), fetched = [], counted = [];
  const env = { PROWL_ALERTS: kv, ...envExtra };
  const deps = {
    ...W,
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    json: (body, status) => { const r = new Response(null, { status: status || 200 }); Object.defineProperty(r, "body", { value: body }); return r; },
    isOwner: () => owner, Response,
    sessMember: async (req) => (req && req.sess) || null, alEmail: (v) => String(v || "").trim().toLowerCase(),
    vCount: async (k, lim) => { counted.push([k, lim]); return count(); }, ipKey: (ip) => ip,
    alTzClean: (z) => (/^America\/[A-Za-z_]+$/.test(String(z || "")) ? z : ""), AL_TZ: TZ, PROBE_UA: "UA",
    esPlace: () => null, esFetch: async () => ({ status: 0, items: null }),
    fetch: async (u) => {
      fetched.push(String(u));
      if (/\/api\/sale-details\?/.test(u)) return { status: 200, text: async () => apiBody };
      const p = pages[u];
      return p == null ? { status: 404, text: async () => "" } : { status: p.status || 200, text: async () => p.html || "" };
    },
    setTimeout, clearTimeout, AbortController, console: { log() {}, error() {} },
  };
  const names = ["wkOpen", "wkWho", "fbWho", "wkGet", "wkList", "wkDetails", "wkTripRoute", "alSame"];
  const keys = Object.keys(deps);
  const C = calls ? CONSTS.replace(/WK_TRIP_CALLS = \d+/, "WK_TRIP_CALLS = " + calls) : CONSTS;
  const X = new Function(...keys, C + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { X, env, kv, fetched, counted };
}
const req = (h = {}, sess = null) => ({ sess, headers: { get: (k) => (k in h ? h[k] : k === "CF-Connecting-IP" ? "1.2.3.4" : null) } });
const MEM = (kv, sub) => kv.m.set("sub:" + sub.email, JSON.stringify(sub));

/* tomorrow in Detroit, and a time on it written the way EstateSales.net writes one */
const TOMORROW = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86400000));
const AFTER = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 2 * 86400000));
const WIN = W.wkDayWin(TOMORROW, TZ), WIN2 = W.wkDayWin(AFTER, TZ);
function at(win, h) {
  const t = new Date(win.from + h * 3600000), p2 = (n) => String(n).padStart(2, "0");
  return D(t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()) + " " + ((t.getUTCHours() % 12) || 12) + ":" + p2(t.getUTCMinutes()) + " " + (t.getUTCHours() < 12 ? "AM" : "PM") + " UTC (UTC+00:00)");
}
/* Novi to Toledo, about 57 miles, nearly due south */
const NOVI = { lat: 42.48, lng: -83.47 }, TOLEDO = { lat: 41.65, lng: -83.54 };
const LINE = [NOVI, { lat: 42.2, lng: -83.49 }, { lat: 41.9, lng: -83.52 }, TOLEDO];
const P = LINE.map((x) => x.lat + "," + x.lng).join("|");
const lngAt = (lat) => -83.47 + (lat - 42.48) / (41.65 - 42.48) * (-0.07);
const sale = (id, lat, lng, o = {}) => ({ id, orgName: "Aloha Estate Sales", name: "Sale " + id, typeName: "EstateSales", url: "/MI/Monroe/48161/" + id, cityName: "Monroe", stateCode: "MI",
  latitude: lat, longitude: lng, pictureCount: 40, isPublished: true, includeInList: true, dates: [{ utcStartDate: at(o.win || WIN, 13), utcEndDate: at(o.win || WIN, 20) }], ...o.x });
const URL_OF = (id) => "https://www.estatesales.net/MI/Monroe/48161/" + id;
function page(id, o = {}) {
  const rec = { id, name: "Sale " + id, plainTextDescription: o.desc || "Tools and furniture.", pictures: [], showAddress: !o.hidden, latitude: o.lat, longitude: o.lng };
  const ld = { "@type": "SaleEvent", url: URL_OF(id), location: { address: { "@type": "PostalAddress", streetAddress: o.hidden ? "" : id % 1000 + " Telegraph Rd" } } };
  return `<html><head><meta property="og:image" content="https://picturescdn.estatesales.net/${id}/1-1/c.jpg"></head><script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    `<script type="application/json">${JSON.stringify({ s: { e: { [id]: rec } } })}</script></html>`;
}
const u = (q) => new URL("https://w.example/trip/sales?" + q);
const Q = "p=" + encodeURIComponent(P) + "&day=" + TOMORROW + "&tz=" + TZ;

test("the route's points are read strictly; the day is a local day in the caller's time zone", () => {
  assert.equal(W.wkTripLine("42.48,-83.47"), null, "one point is not a route");
  assert.equal(W.wkTripLine("42.48,-83.47|abc"), null);
  assert.equal(W.wkTripLine("95,1|1,1"), null);
  assert.equal(W.wkTripLine(Array.from({ length: 81 }, () => "1,1").join("|")), null, "80 points at most");
  assert.deepEqual(W.wkTripLine("42.4806,-83.4755|41.6512,-83.5432"), [{ lat: 42.48, lng: -83.48 }, { lat: 41.65, lng: -83.54 }], "2 decimals, about 1 km");
  const w = W.wkDayWin("2026-11-01", TZ);
  assert.equal(w.from, Date.UTC(2026, 10, 1, 4, 0), "Sunday Nov 1 starts in EDT");
  assert.equal(w.to, Date.UTC(2026, 10, 2, 5, 0), "and ends in EST: a 25-hour day");
  assert.equal(W.wkDayWin("2026-13-01", TZ), null);
  assert.equal(W.wkDayWin("tomorrow", TZ), null);
});

test("the corridor is read in a few circles snapped to 0.1 degree: 25 miles on a short drive, 50 on a long one, 5 at most", () => {
  const s = W.wkTripCircles(LINE);
  assert.equal(s.r, 25);
  assert.ok(s.pts.length >= 2 && s.pts.length <= 3, JSON.stringify(s.pts));
  for (const p of s.pts) { assert.equal(Math.round(p.lat * 10) / 10, p.lat); assert.equal(Math.round(p.lng * 10) / 10, p.lng); }
  /* every point of the road within 3 miles is inside a circle */
  for (let k = 0; k <= 20; k++) {
    const lat = 42.48 + (41.65 - 42.48) * k / 20, q = { lat, lng: lngAt(lat) + 0.05 };
    assert.ok(s.pts.some((c) => haversineMi(c, q) <= s.r), "covered at " + lat);
  }
  const long = W.wkTripCircles([{ lat: 42.48, lng: -83.47 }, { lat: 38.43, lng: -82.13 }]);   /* Novi to Milton, WV: ~290 mi as the crow flies */
  assert.equal(long.r, 50);
  assert.ok(long.pts.length >= 4 && long.pts.length <= 5, "the straight line is filled in, so the middle is read too: " + long.pts.length);
  assert.equal(long.partial, 0);
  const far = W.wkTripCircles([{ lat: 42.48, lng: -83.47 }, { lat: 33.75, lng: -84.39 }]);   /* Atlanta, ~600 mi */
  assert.equal(far.pts.length, W.WK_TRIP_LISTS);
  assert.equal(far.partial, 1, "past ~400 miles: the first stretch only, and it says so");
});

test("GET /trip/sales is for Pro members and the owner key: signed out 401, free 403, and EstateSales.net is asked nothing", async () => {
  const R = rig();
  assert.equal((await R.X.wkTripRoute(req(), R.env, u(Q), "o")).status, 401);
  MEM(R.kv, { email: "free@example.com", tok: "t-free", pro: false });
  assert.equal((await R.X.wkTripRoute(req({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "t-free" }), R.env, u(Q), "o")).status, 403);
  assert.equal((await R.X.wkTripRoute(req({}, { email: "free@example.com", pro: false }), R.env, u(Q), "o")).status, 403, "a free store session");
  assert.equal(R.fetched.length, 0);
  MEM(R.kv, { email: "pro@example.com", tok: "t-pro", pro: true });
  assert.equal((await R.X.wkTripRoute(req({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "t-pro" }), R.env, u(Q), "o")).status, 200, "a Pro member");
  const O = rig({ owner: true });
  assert.equal((await O.X.wkTripRoute(req(), O.env, u(Q), "o")).status, 200, "the owner key");
  assert.equal(O.counted.length, 0, "the owner is not counted");
  assert.equal((await O.X.wkTripRoute(req(), O.env, u("p=1,1&day=" + TOMORROW), "o")).status, 400);
  assert.equal((await O.X.wkTripRoute(req(), O.env, u("p=" + encodeURIComponent(P) + "&day=soon"), "o")).status, 400);
});

test("only sales open on the trip day within 3 miles of the road, nearest to the road first, with photo, hours, address and miles off; hunts mark picks", async () => {
  const on = 5100001, near = 5100002, far = 5100003, other = 5100004, pend = 5100005, gone = 5100006;
  const list = [
    sale(near, 42.0, lngAt(42.0) + 0.04),          /* ~2 mi off */
    sale(on, 42.3, lngAt(42.3)),                   /* on the road */
    sale(far, 42.1, lngAt(42.1) + 0.12),           /* ~6 mi off */
    sale(other, 42.25, lngAt(42.25), { win: WIN2 }),   /* the day after */
    sale(pend, 41.8, lngAt(41.8) + 0.01),
    sale(gone, 41.75, lngAt(41.75)),
  ];
  const pages = { [URL_OF(on)]: { html: page(on, { desc: "Rooms of Fire-King jadeite." }) }, [URL_OF(near)]: { html: page(near) }, [URL_OF(pend)]: { html: page(pend, { hidden: true }) }, [URL_OF(gone)]: { status: 404 } };
  const R = rig({ owner: true, apiBody: JSON.stringify(list), pages });
  const r = await R.X.wkTripRoute(req(), R.env, u(Q + "&h=" + encodeURIComponent("fire-king jadeite|panther")), "o");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const S = r.body.sales;
  assert.deepEqual(S.map((x) => x.id), [String(on), String(pend), String(near)], "nearest to the road first; 6 mi off, the next day and a dead link are left out");
  assert.ok(S[0].off < 0.5 && S[2].off > 1 && S[2].off <= 3, "miles off the road: " + S.map((x) => x.off));
  assert.equal(S[0].pick, true); assert.equal(S[0].match.hunt, "fire-king jadeite");
  assert.equal(S[2].pick, false);
  assert.equal(S[0].img, "https://picturescdn.estatesales.net/" + on + "/1-1/c.jpg");
  assert.equal(S[0].addr, "1 Telegraph Rd");
  assert.equal(S[1].addr, "", "address pending");
  assert.match(S[0].hours, /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d+, \d+ (AM|PM)–\d+ PM$/, "that day's hours, in the caller's time zone");
  assert.equal(S[0].url, URL_OF(on));
  assert.equal(r.body.mi, 3);
  const asked = R.fetched.filter((x) => /sale-details/.test(x));
  assert.ok(asked.length >= 2 && asked.length <= 3, "one list per circle");
  for (const a of asked) assert.match(a, /bycoordinatesanddistance:-?\d+\.\d0{3}_-?\d+\.\d0{3}_25&/, "the points EstateSales.net sees are snapped to 0.1 degree");
});

test("at most 12, at most 16 outside calls; a second look reads KV only; a new list past the day's count is refused (old lists still serve)", async () => {
  const list = Array.from({ length: 20 }, (_, i) => sale(5200000 + i, 42.4 - i * 0.03, lngAt(42.4 - i * 0.03) + (i % 3) * 0.01));
  const pages = {}; list.forEach((s) => { pages[URL_OF(s.id)] = { html: page(s.id) }; });
  const R = rig({ apiBody: JSON.stringify(list), pages, env: { SALES_PUBLIC: "on" } });
  const r = await R.X.wkTripRoute(req(), R.env, u(Q), "o");
  assert.equal(r.body.sales.length, 12);
  assert.equal(r.body.total, 20);
  assert.ok(r.body.calls <= 16 && R.fetched.length <= 16, "bounded: " + R.fetched.length);
  for (let i = 1; i < 12; i++) assert.ok(r.body.sales[i].off >= r.body.sales[i - 1].off);
  assert.equal(R.counted.length, 1); assert.match(R.counted[0][0], /^wkt:/);
  const n = R.fetched.length;
  const r2 = await R.X.wkTripRoute(req(), R.env, u(Q), "o");
  assert.equal(r2.status, 200);
  assert.ok(R.fetched.length - n <= 2, "the lists are kept; only pages not read the first time");
  assert.equal(R.counted.length, 1, "nothing new to fetch: not counted");
  const shut = rig({ apiBody: JSON.stringify(list), env: { SALES_PUBLIC: "on" }, count: () => false });
  const r3 = await shut.X.wkTripRoute(req(), shut.env, u(Q), "o");
  assert.equal(r3.status, 429);
  assert.equal(shut.fetched.length, 0);
  /* a kept list past its 3 hours still answers when the count is used up, marked stale */
  const key = [...R.kv.m.keys()].find((k) => k.startsWith("wk1:"));
  shut.kv.m.set(key, JSON.stringify({ ...JSON.parse(R.kv.m.get(key)), at: Date.now() - 4 * 3600000 }));
  const r4 = await shut.X.wkTripRoute(req(), shut.env, u(Q), "o");
  assert.equal(r4.status, 200);
  assert.equal(r4.body.stale, 1);
  assert.equal(r4.body.missing, 1, "some circles were not checked"); assert.equal(r4.body.partial, 0, "not a long drive");
  assert.equal(r.body.missing, 0); assert.equal(r.body.partial, 0);
});

test("a day that is over, or more than two weeks off, asks nothing", async () => {
  const R = rig({ owner: true });
  const r = await R.X.wkTripRoute(req(), R.env, u("p=" + encodeURIComponent(P) + "&day=2020-01-01&tz=" + TZ), "o");
  assert.equal(r.status, 200); assert.deepEqual(r.body.sales, []);
  assert.equal(R.fetched.length, 0);
});

/* review fixes (2026-10-31) */
test("a sale whose page the budget did not reach is left out, never shown as address-less; the nearest pages are read first", async () => {
  const list = Array.from({ length: 10 }, (_, i) => sale(5300000 + i, 42.4 - i * 0.05, lngAt(42.4 - i * 0.05) + (9 - i) * 0.004));
  const pages = {}; list.forEach((s) => { pages[URL_OF(s.id)] = { html: page(s.id) }; });
  const R = rig({ owner: true, apiBody: JSON.stringify(list), pages, calls: 8 });
  const r = await R.X.wkTripRoute(req(), R.env, u(Q), "o");
  assert.equal(r.status, 200);
  const lists = R.fetched.filter((x) => /sale-details/.test(x)).length, read = 8 - lists;
  assert.ok(read > 0 && read < 10, "the lists left room for only some pages: " + read);
  assert.equal(r.body.sales.length, read, "only the sales whose pages were read");
  for (const x of r.body.sales) { assert.ok(x.addr, "every sale shown has its address: " + x.id); assert.ok(x.img); }
  const byOff = list.map((s) => ({ id: String(s.id), off: haversineMi({ lat: s.latitude, lng: s.longitude }, { lat: s.latitude, lng: lngAt(s.latitude) }) })).sort((a, b) => a.off - b.off);
  assert.deepEqual(r.body.sales.map((x) => x.id).sort(), byOff.slice(0, read).map((x) => x.id).sort(), "the nearest to the road");
  assert.equal(r.body.total, 10);
});

test("wkAlongRows drops a sale with no page read and one whose page is gone", () => {
  const s1 = { id: 1, name: "A", url: "/MI/x/1", cityName: "x", stateCode: "MI" }, s2 = { ...s1, id: 2 }, s3 = { ...s1, id: 3 };
  const c = (s) => ({ s, days: [{ s: WIN.from + 9 * 3600000, e: WIN.from + 16 * 3600000 }], off: 1, prog: 0 });
  const rows = W.wkAlongRows([c(s1), c(s2), c(s3)], { by: { 1: { desc: "", caps: [], img: "", addr: "1 Main St" } }, gone: { 2: 1 } }, [], TZ, 12);
  assert.deepEqual(rows.map((x) => String(x.id)), ["1"]);
  assert.deepEqual(W.wkAlongRows([c(s1)], null, [], TZ, 12), []);
});
