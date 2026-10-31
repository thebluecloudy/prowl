/* v205 Weekend sweep: GET /weekend lists the estate sales open this Friday to Sunday within 25 miles of a point, from
   EstateSales.net's list near a point and each nearby sale's own page; sales that mention a hunt are Top picks; every
   sale links to its own page (dead or missing links are dropped); ended sales are hidden; at most 12. Pro members with a
   ZIP get the same list by email on Thursday mornings. v205 (Matt, 2026-10-31): all Prowl Pro members see it (a
   session or X-Prowl-Email/X-Prowl-Tok member with sub.pro, the owner key, or everyone while SALES_PUBLIC=on), and the
   Thursday email goes to every Pro member with a ZIP who has not turned it off.
   Run: node --test worker/__tests__/weekend-v205.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../weekend.js";

const TZ = "America/Detroit";
const T = (s) => W.wkTime(s);
const D = (v) => ({ _type: "DateTime", _value: v });
const NOVI = { lat: 42.4806, lng: -83.4755 };
/* one sale as EstateSales.net's list sends it with include=dates (fields as seen 2026-10-30) */
const sale = (id, o = {}) => ({ id, orgName: "Aloha Treasures Estate Sales", name: "Sale " + id, type: 1, typeName: "EstateSales", isMarketplaceSale: false,
  url: "/MI/Livonia/48150/" + id, cityName: "Livonia", stateCode: "MI", postalCodeNumber: "48150", latitude: 42.39, longitude: -83.37, pictureCount: 105,
  isPublished: true, includeInList: true,
  firstUtcStartDate: D("Fri 2026-10-30 10:00 AM EDT (UTC-04:00)"), lastUtcEndDate: D("Sat 2026-10-31 2:00 PM EDT (UTC-04:00)"),
  firstLocalStartDate: D("Fri 2026-10-30 6:00 AM EDT (UTC-04:00)"),
  dates: [{ utcStartDate: D("Fri 2026-10-30 10:00 AM EDT (UTC-04:00)"), utcEndDate: D("Fri 2026-10-30 5:00 PM EDT (UTC-04:00)"), localStartDate: D("Fri 2026-10-30 6:00 AM EDT (UTC-04:00)") },
    { utcStartDate: D("Sat 2026-10-31 10:00 AM EDT (UTC-04:00)"), utcEndDate: D("Sat 2026-10-31 2:00 PM EDT (UTC-04:00)") }], ...o });
const THU = Date.UTC(2026, 9, 29, 14, 0);   /* Thu Oct 29 2026, 10:00 AM in Detroit */

test("EstateSales.net's dates are read as the instants they name (EDT and EST), never as a bare local time", () => {
  assert.equal(T("Fri 2026-10-30 10:00 AM EDT (UTC-04:00)"), Date.UTC(2026, 9, 30, 14, 0));
  assert.equal(T(D("Sun 2026-11-01 4:00 PM EST (UTC-05:00)")), Date.UTC(2026, 10, 1, 21, 0));
  assert.equal(T("Sat 2026-10-31 12:30 PM EDT (UTC-04:00)"), Date.UTC(2026, 9, 31, 16, 30));
  assert.equal(T("Sat 2026-10-31 12:00 AM EDT (UTC-04:00)"), Date.UTC(2026, 9, 31, 4, 0));
  assert.equal(T("2026-10-30T10:00:00"), 0, "no zone, no instant");
  assert.equal(T(""), 0);
});

test("a sale's own link is kept only when it is on EstateSales.net and ends in the sale's id", () => {
  assert.equal(W.wkOwnUrl("/MI/Taylor/48180/5128683", "5128683"), "https://www.estatesales.net/MI/Taylor/48180/5128683");
  assert.equal(W.wkOwnUrl("https://www.estatesales.net/MI/West Bloomfield/48324/5132556", 5132556), "https://www.estatesales.net/MI/West-Bloomfield/48324/5132556");
  assert.equal(W.wkOwnUrl("/MI/Royal Oak/48067/traditional/5136894", "5136894"), "https://www.estatesales.net/MI/Royal-Oak/48067/traditional/5136894");
  assert.equal(W.wkOwnUrl("/MI/Taylor/48180/5128683", "999"), "", "someone else's sale");
  assert.equal(W.wkOwnUrl("/MI/Novi", "5128683"), "", "a city page is not the sale");
  assert.equal(W.wkOwnUrl("https://evil.example/MI/Taylor/48180/5128683", "5128683"), "");
  assert.equal(W.wkOwnUrl("javascript:alert(1)//5128683", "5128683"), "");
});

test("the list keeps in-person sales within the radius that have their own link, with each day's hours", () => {
  const list = [
    sale(5128683),
    sale(5122389, { typeName: "OnlineOnlyAuctions" }),
    sale(5000002, { isMarketplaceSale: true }),
    sale(5000003, { url: "" }),
    sale(5000004, { latitude: 42.73, longitude: -84.55 }),   /* Lansing, ~55 mi */
    sale(5000005, { orgName: "Private Listing", dates: [] }),
    sale(5128683),
  ];
  const got = W.wkFromApi(list, NOVI, 25);
  assert.deepEqual(got.map((x) => x.id), ["5128683", "5000005"]);
  const a = got[0];
  assert.equal(a.url, "https://www.estatesales.net/MI/Livonia/48150/5128683");
  assert.equal(a.co, "Aloha Treasures Estate Sales");
  assert.equal(a.city, "Livonia"); assert.equal(a.st, "MI"); assert.equal(a.type, "Estate sale");
  assert.ok(a.dist > 5 && a.dist < 10, "miles from the point");
  assert.equal(a.days.length, 2);
  assert.equal(a.days[0].s, Date.UTC(2026, 9, 30, 14, 0), "the utc dates, not EstateSales.net's shifted local ones");
  assert.equal(got[1].co, "", "a private listing names no company");
  assert.equal(got[1].days.length, 1, "no dates: its first start to its last end");
  assert.equal(got[1].days[0].span, 1);
});

test("the weekend: from Monday to Thursday it is the coming Fri-Sun; on Fri-Sun it is this one; DST is respected", () => {
  const w = W.wkWindow(THU, TZ);
  assert.equal(w.from, Date.UTC(2026, 9, 30, 4, 0), "Friday 00:00 EDT");
  assert.equal(w.to, Date.UTC(2026, 10, 2, 5, 0), "Monday 00:00 EST (clocks went back on Sunday)");
  assert.deepEqual(W.wkWindow(Date.UTC(2026, 10, 1, 17, 0), TZ), w, "Sunday afternoon: still this weekend");
  assert.deepEqual(W.wkWindow(Date.UTC(2026, 9, 26, 14, 0), TZ), w, "Monday: the coming weekend");
  const la = W.wkWindow(THU, "America/Los_Angeles");
  assert.equal(la.from, Date.UTC(2026, 9, 30, 7, 0));
});

test("hours are written in the caller's time zone, day by day", () => {
  const s = W.wkFromApi([sale(5128683)], NOVI, 25)[0];
  assert.equal(W.wkHours(s.days, TZ), "Fri Oct 30, 10 AM\u20135 PM \u00b7 Sat Oct 31, 10 AM\u20132 PM");
  assert.equal(W.wkHours(s.days, "America/Chicago"), "Fri Oct 30, 9 AM\u20134 PM \u00b7 Sat Oct 31, 9 AM\u20131 PM");
  assert.equal(W.wkHours([{ s: T("Thu 2026-10-29 10:00 AM EDT (UTC-04:00)"), e: T("Sun 2026-11-01 4:00 PM EST (UTC-05:00)"), span: 1 }], TZ), "Thu Oct 29 10 AM \u2013 Sun Nov 1 4 PM");
  assert.equal(W.wkHours([{ s: T("Sat 2026-10-31 9:30 AM EDT (UTC-04:00)"), e: T("Sat 2026-10-31 12:30 PM EDT (UTC-04:00)") }], TZ), "Sat Oct 31, 9:30 AM\u201312:30 PM");
});

/* a sale page shaped like the real one (2026-10-30): the app's record of the sale in its state block, and a SaleEvent */
function salePage(id, desc, pictures) {
  const rec = { saleId: id, id, name: "Royal Oak Vintage and Collectible", plainTextDescription: desc, mainPicture: { thumbnailUrl: "https://picturescdn.estatesales.net/" + id + "/1-2/a.jpg" }, pictures };
  const ld = { "@context": "http://schema.org/", "@type": "SaleEvent", url: "https://www.estatesales.net/MI/Royal Oak/48067/traditional/" + id, description: "short " + desc.slice(0, 20) };
  return `<html><script type="application/ld+json">${JSON.stringify(ld)}</script><script>var x=1</script>` +
    `<script id="estatesales-net-state" type="application/json">${JSON.stringify({ NGRX_STATE: { feature: { traditionalSaleViewState: { entitiesById: { [id]: rec } } } } })}</script></html>`;
}

test("a sale page gives its description, the photo captions the seller typed, and its picture", () => {
  const d = W.wkDetailParse(salePage(5136894, "A HOUSE FULL OF VINTAGE. Typewriter, sewing machine. Cash only.", [{ id: 1, description: "Pyrex Butterprint bowls" }, { id: 2 }, { id: 3, caption: "Smith-Corona typewriter" }]), "5136894");
  assert.equal(d.desc, "A HOUSE FULL OF VINTAGE. Typewriter, sewing machine. Cash only.");
  assert.deepEqual(d.caps, ["Pyrex Butterprint bowls", "Smith-Corona typewriter"]);
  assert.equal(d.img, "https://picturescdn.estatesales.net/5136894/1-2/a.jpg");
  const only = W.wkDetailParse(`<script type="application/ld+json">${JSON.stringify({ "@type": "SaleEvent", url: "https://www.estatesales.net/MI/Novi/48377/77777", description: "Fire-King jadeite" })}</script>`, "77777");
  assert.equal(only.desc, "Fire-King jadeite", "a page with only the SaleEvent block");
  assert.equal(W.wkDetailParse("<html>nothing</html>", "1"), null);
});

test("a hunt matches when every one of its words is in the title, the description or a caption, and says where", () => {
  const s = { name: "Mid-Century Home" }, det = { desc: "Lots of Fire King jadeite and Pyrex bowls.", caps: ["Rookwood owl paperweight"] };
  assert.deepEqual(W.wkTerms("Vintage Fire-King Jadeite"), ["fire", "king", "jadeite"]);
  assert.deepEqual(W.wkMatch(s, det, ["ceramic panther", "Fire-King jadeite"]), { hunt: "Fire-King jadeite", where: "the description", words: ["fire", "king", "jadeite"] });
  assert.equal(W.wkMatch(s, det, ["pyrex bowl"]).where, "the description", "a plural is the same word");
  assert.equal(W.wkMatch(s, det, ["rookwood owl"]).where, "a photo caption");
  assert.equal(W.wkMatch(s, det, ["mid century"]).where, "the title");
  assert.equal(W.wkMatch(s, det, ["rookwood panther"]), null, "every word, not just one");
  assert.equal(W.wkMatch(s, null, ["fire king"]), null, "no page read: only the title counts");
  assert.match(W.wkStandout(s, det, W.wkMatch(s, det, ["rookwood owl"])), /^Photo: Rookwood owl paperweight$/);
  assert.equal(W.wkStandout({ name: "x", pics: 40 }, null, null), "40 photos posted");
  assert.deepEqual(W.wkHunts(" Pyrex | pyrex|the|" + "x".repeat(80)), ["Pyrex", "x".repeat(60)]);
});

test("the list: Top picks first with their hunt, then the rest; ended, out-of-weekend and dead-link sales are left out; at most 12", () => {
  const win = W.wkWindow(THU, TZ);
  const list = [
    sale(1001, { name: "Typewriter heaven" }),
    sale(1002, { latitude: 42.47, longitude: -83.45 }),
    sale(1003, { dates: [{ utcStartDate: D("Thu 2026-10-29 9:00 AM EDT (UTC-04:00)"), utcEndDate: D("Thu 2026-10-29 3:00 PM EDT (UTC-04:00)") }] }),   /* over before Friday */
    sale(1004, { dates: [{ utcStartDate: D("Fri 2026-11-06 9:00 AM EST (UTC-05:00)"), utcEndDate: D("Fri 2026-11-06 3:00 PM EST (UTC-05:00)") }] }),   /* next week */
    sale(1005),
    sale(1006, { dates: [{ utcStartDate: D("Sat 2026-10-31 9:00 AM EDT (UTC-04:00)"), utcEndDate: D("Sat 2026-10-31 3:00 PM EDT (UTC-04:00)") }] }),
  ];
  const sales = W.wkFromApi(list, NOVI, 25);
  const read = W.wkToRead(sales, win, THU, 16);
  assert.deepEqual(read.map((x) => x.id).sort(), ["1001", "1002", "1005", "1006"], "only sales open this weekend are read");
  const details = { by: { 1006: { desc: "Pyrex galore. Cash only.", caps: [], img: "" } }, gone: { 1005: 1 } };
  const b = W.wkBuild(sales, details, ["pyrex", "typewriter"], win, THU, TZ, 12);
  assert.deepEqual(b.picks.map((x) => [x.id, x.match.hunt, x.match.where]), [["1001", "typewriter", "the title"], ["1006", "pyrex", "the description"]]);
  assert.deepEqual(b.rest.map((x) => x.id), ["1002"]);
  assert.equal(b.picks[0].url, "https://www.estatesales.net/MI/Livonia/48150/1001");
  assert.equal(b.picks[1].hours, "Sat Oct 31, 9 AM\u20133 PM");
  assert.equal(b.picks[1].standout, "Pyrex galore.");
  /* Saturday 3:30 PM: Friday is over and 1006 has ended; the rest show only what is left */
  const sat = Date.UTC(2026, 9, 31, 19, 30);
  const later = W.wkBuild(sales, details, ["pyrex"], win, sat, TZ, 12);
  assert.deepEqual(later.picks.concat(later.rest).map((x) => x.id), [], "every sale here ended by Saturday 3 PM");
  const many = W.wkFromApi(Array.from({ length: 20 }, (_, i) => sale(2000 + i, { name: i < 3 ? "Pyrex " + i : "Sale " + i })), NOVI, 25);
  const m = W.wkBuild(many, { by: {}, gone: {} }, ["pyrex"], win, THU, TZ, 12);
  assert.equal(m.picks.length, 3); assert.equal(m.rest.length, 9); assert.equal(m.total, 20);
});

/* ---- the worker's side: index.js functions run with stand-ins, the way the other worker tests do ---- */
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const CONSTS = [/^const WK_LIST_TTL = .*$/m, /^const AL_ESTATE_HOUR = .*$/m, /^const WK_PENDING_TTL = .*$/m, /^const AL_ESTATE_IMG = .*$/m].map((re) => re.exec(INDEX)[0]).join("\n");
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
}
function rig({ api = 200, apiBody = null, pages = {}, env: envExtra = {}, owner = false, city = null } = {}) {
  const kv = new FakeKV(), fetched = [], sent = [], merged = [];
  const env = { PROWL_ALERTS: kv, ...envExtra };
  const deps = {
    ...W,
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    json: (body, status) => { const r = new Response(null, { status: status || 200 }); Object.defineProperty(r, "body", { value: body }); return r; },
    isOwner: () => owner, Response,
    sessMember: async (req) => (req && req.sess) || null, alEmail: (v) => String(v || "").trim().toLowerCase(), vCount: async () => true, ipKey: (ip) => ip, alTzClean: (z) => (/^America\/[A-Za-z_]+$/.test(String(z || "")) ? z : ""), AL_TZ: "America/Detroit", PROBE_UA: "UA",
    esPlace: (st, c) => (st && c ? { st, city: c, slug: c } : null), esFetch: async () => (city ? { status: 200, items: city } : { status: 0, items: null }),
    fetch: async (u) => {
      fetched.push(String(u));
      if (/\/api\/sale-details\?/.test(u)) return { status: api, text: async () => (apiBody || "[]") };
      const p = pages[u];
      return p == null ? { status: 404, text: async () => "" } : { status: p.status || 200, text: async () => p.html || "" };
    },
    setTimeout, clearTimeout, AbortController,
    gKey: () => "k", G_GEO_PER_DAY: 1000, gGeocode: async () => ({ lat: 42.47, lng: -83.47, city: "Novi", st: "MI" }),
    alPrefs: (sub) => ({ tz: "", zip: "", estate: "", ...(sub.prefs || {}) }), alPaused: () => false, alActive: (e, sub) => sub.hunts,
    alMailSub: async (e, sub) => ({ ...sub, k: "ticket" }), alUnsubUrl: (sub) => "https://w.example/alerts/unsub?e=" + sub.email, alHomeUrl: () => "https://prowl.example/?alerts=in",
    alEsc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    alShell: (e, inner, why, links) => "<html>" + inner + "<p>" + why + "</p><p>" + links + "</p></html>", alFootText: () => "\n--\nfooter",
    alSend: async (e, to, subject, html, text, unsub) => { sent.push({ to, subject, html, text, unsub }); return { ok: true }; },
    alMerge: async (e, sub, f) => { merged.push(f); return sub; },
    console: { log() {}, error() {} },
    alCodeKey: (e) => e.PROWL_SESSION_SECRET || "", PROWL_APP: "https://www.owlandtwigvintage.com/pages/prowl-app", crypto: globalThis.crypto, TextEncoder,
  };
  const names = ["wkOpen", "wkWho", "fbWho", "wkGet", "wkList", "wkDetails", "wkSweep", "wkRoute", "alEstateOpen", "alEstateDue", "alEstateUnsubUrl", "wkZipPoint", "alEstateRow", "alEstateHtml", "alEstateText", "alEstateSubject", "alEstateSend", "alEstatePlanBtn", "wkPlanSig", "wkPlanLink", "wkPlanRoute", "pxHmac", "alSame"];
  const keys = Object.keys(deps);
  const X = new Function(...keys, CONSTS + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { X, env, kv, fetched, sent, merged };
}
/* Saturday of the coming weekend, h hours after its start, written the way EstateSales.net writes a date */
function satAt(win, h) {
  const t = new Date(win.from + 86400000 + h * 3600000), p2 = (n) => String(n).padStart(2, "0");
  return D(t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()) + " " + ((t.getUTCHours() % 12) || 12) + ":" + p2(t.getUTCMinutes()) + " " + (t.getUTCHours() < 12 ? "AM" : "PM") + " UTC (UTC+00:00)");
}
const REQ = { headers: { get: () => "1.2.3.4" } };
/* a request with these headers (CF-Connecting-IP 1.2.3.4 unless given); sess = the store session's member */
const req = (h = {}, sess = null) => ({ sess, headers: { get: (k) => (k in h ? h[k] : k === "CF-Connecting-IP" ? "1.2.3.4" : null) } });
const MEM = (kv, sub) => kv.set("sub:" + sub.email, sub);
const url = (q) => new URL("https://w.example/weekend?" + q);

test("GET /weekend is for Prowl Pro members, the owner's key, or everyone while SALES_PUBLIC=on", async () => {
  const shut = rig();
  assert.equal((await shut.X.wkRoute(req(), shut.env, url("lat=42.48&lng=-83.47"), "o")).status, 401, "signed out");
  MEM(shut.kv, { email: "free@example.com", tok: "t-free", pro: false });
  assert.equal((await shut.X.wkRoute(req({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "t-free" }), shut.env, url("lat=42.48&lng=-83.47"), "o")).status, 403, "a free member");
  MEM(shut.kv, { email: "pro@example.com", tok: "t-pro", pro: true });
  assert.equal((await shut.X.wkRoute(req({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "wrong" }), shut.env, url("lat=42.48&lng=-83.47"), "o")).status, 401, "a wrong token is signed out");
  assert.equal(shut.fetched.length, 0, "nothing is asked of EstateSales.net");
  assert.equal((await shut.X.wkRoute(req({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "t-pro" }), shut.env, url("lat=42.48&lng=-83.47"), "o")).status, 200, "a Pro member (Alerts token)");
  assert.equal((await shut.X.wkRoute(req({}, { email: "pro@example.com", pro: true }), shut.env, url("lat=42.48&lng=-83.47"), "o")).status, 200, "a Pro member (store session)");
  assert.equal((await shut.X.wkRoute(req({}, { email: "free@example.com", pro: false }), shut.env, url("lat=42.48&lng=-83.47"), "o")).status, 403, "a free store session");
  const own = rig({ owner: true });
  assert.equal((await own.X.wkRoute(req(), own.env, url("lat=42.48&lng=-83.47"), "o")).status, 200, "the owner's key");
  const open = rig({ env: { SALES_PUBLIC: "on" } });
  assert.equal((await open.X.wkRoute(req(), open.env, url("lat=42.48&lng=-83.47"), "o")).status, 200, "SALES_PUBLIC=on: anyone");
  assert.equal((await open.X.wkRoute(REQ, open.env, url("lat=abc&lng=1"), "o")).status, 400);
});

test("a sweep reads the list near the point once, then the nearby sales' pages; a sale whose page is gone is dropped", async () => {
  const now = Date.now(), win = W.wkWindow(now, TZ);
  /* the API's own format, built for the coming Saturday so the test holds on any day it runs */
  const sat = (h) => satAt(win, h);
  const mk = (id, name) => sale(id, { name, firstUtcStartDate: sat(14), lastUtcEndDate: sat(20), dates: [{ utcStartDate: sat(14), utcEndDate: sat(20) }] });
  const apiBody = JSON.stringify([mk(3001, "Big house sale"), mk(3002, "Garage full"), mk(3003, "Old link")]);
  const pages = {
    "https://www.estatesales.net/MI/Livonia/48150/3001": { html: salePage(3001, "Rooms of Fire-King jadeite and Pyrex.", [{ description: "Royal Haeger panther" }]) },
    "https://www.estatesales.net/MI/Livonia/48150/3002": { html: salePage(3002, "Tools and more tools.", []) },
    "https://www.estatesales.net/MI/Livonia/48150/3003": { status: 404 },
  };
  const { X, env, kv, fetched } = rig({ env: { SALES_PUBLIC: "on" }, apiBody, pages });
  const r = await X.wkRoute(REQ, env, url("lat=42.4806&lng=-83.4755&tz=America/Detroit&h=" + encodeURIComponent("Royal Haeger panther|fire-king jadeite")), "o");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(fetched[0], "https://www.estatesales.net/api/sale-details?bypass=bycoordinatesanddistance:42.4800_-83.4800_25&include=dates&explicitTypes=DateTime", "the point is rounded to ~1 km before it leaves");
  assert.deepEqual(r.body.picks.map((x) => [x.id, x.match.hunt, x.match.where]), [["3001", "Royal Haeger panther", "a photo caption"]]);
  assert.deepEqual(r.body.rest.map((x) => x.id), ["3002"]);
  assert.ok(!JSON.stringify(r.body).includes("3003"), "a sale whose page is gone is never shown");
  assert.equal(r.body.hunts, 2);
  assert.ok(kv.m.has("wk1:42.48,-83.48:25"), "the list is kept per point");
  assert.equal(JSON.parse(kv.m.get("wkd2:3003")).gone, 1, "a dead link is remembered for a day");
  /* the second look asks EstateSales.net nothing */
  const n = fetched.length;
  const r2 = await X.wkRoute(REQ, env, url("lat=42.48&lng=-83.48&h=pyrex"), "o");
  assert.equal(fetched.length, n);
  assert.deepEqual(r2.body.picks.map((x) => [x.id, x.match.hunt]), [["3001", "pyrex"]]);
});

test("when the list does not answer, the city page stands in; when neither does, 502", async () => {
  const now = Date.now(), win = W.wkWindow(now, TZ), s = new Date(win.from + 86400000 + 14 * 3600000), e = new Date(s.getTime() + 6 * 3600000);
  const city = [{ id: "4400001", name: "Novi sale", url: "https://www.estatesales.net/MI/Novi/48377/4400001", start: s.toISOString(), end: e.toISOString(), city: "Novi", st: "MI", lat: 42.48, lon: -83.47, type: "Estate Sales" },
    { id: "4400002", name: "No link", url: "https://www.estatesales.net/MI/Novi", start: s.toISOString(), end: e.toISOString(), lat: 42.48, lon: -83.47 }];
  const a = rig({ env: { SALES_PUBLIC: "on" }, api: 503, city, pages: { "https://www.estatesales.net/MI/Novi/48377/4400001": { html: "<html></html>" } } });
  const r = await a.X.wkRoute(REQ, a.env, url("lat=42.48&lng=-83.47&city=Novi&st=MI"), "o");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.rest.map((x) => x.id), ["4400001"]);
  assert.equal(r.body.src, "city");
  const b = rig({ env: { SALES_PUBLIC: "on" }, api: 503 });
  assert.equal((await b.X.wkRoute(REQ, b.env, url("lat=42.48&lng=-83.47"), "o")).status, 502);
});

const PRO = { email: "m@example.com", pro: true, hunts: ["Fire-King jadeite"], prefs: { zip: "48375", tz: "America/Detroit" } };
const THU_LOC = { day: "2026-10-29", hour: 7, wday: 4 };

test("the Thursday estate email is due on Thursday morning for every Pro member with a ZIP who has not turned it off", () => {
  const { X } = rig();
  const env = {};
  assert.equal(X.alEstateDue(env, PRO, THU_LOC), true);
  assert.equal(X.alEstateDue(env, PRO, { ...THU_LOC, hour: 6 }), false, "not before 7");
  assert.equal(X.alEstateDue(env, PRO, { ...THU_LOC, hour: 12 }), false, "not after the morning");
  assert.equal(X.alEstateDue(env, PRO, { ...THU_LOC, wday: 3 }), false, "Thursdays only");
  assert.equal(X.alEstateDue(env, { ...PRO, estate: "2026-10-29" }, THU_LOC), false, "once a Thursday");
  assert.equal(X.alEstateDue(env, { ...PRO, pro: false }, THU_LOC), false, "Pro only");
  assert.equal(X.alEstateDue(env, { ...PRO, prefs: { zip: "" } }, THU_LOC), false, "needs a ZIP");
  assert.equal(X.alEstateDue(env, { ...PRO, prefs: { zip: "48375", estate: "off" } }, THU_LOC), false, "turned off");
  assert.equal(X.alEstateDue(env, { ...PRO, mail: "off" }, THU_LOC), false, "emails off");
  assert.equal(X.alEstateDue({ SALES_PUBLIC: "on" }, PRO, THU_LOC), true, "SALES_PUBLIC changes nothing for it");
  assert.equal(X.alEstateDue(env, { ...PRO, email: "other@example.com", prefs: { zip: "10001" } }, THU_LOC), true, "any Pro member, no test list");
  assert.equal(X.alEstateDue(env, { ...PRO, paused: 1 }, { ...THU_LOC, wday: 5 }), false);
  assert.equal(X.alEstateOpen(env, { email: "free@example.com", pro: false }), true, "the Den shows the switch to every member (locked for free)");
  assert.equal(X.alEstateOpen(env, null), false);
});

test("the Thursday email: Top picks with the hunt that matched, every sale linked, a stop link of its own, marked once", async () => {
  const now = Date.now(), win = W.wkWindow(now, TZ);
  const sat = (h) => satAt(win, h);
  const mk = (id, name) => sale(id, { name, firstUtcStartDate: sat(14), lastUtcEndDate: sat(20), dates: [{ utcStartDate: sat(14), utcEndDate: sat(20) }] });
  const apiBody = JSON.stringify([mk(5001, "Jadeite & more"), mk(5002, "Garage full")]);
  const pages = { "https://www.estatesales.net/MI/Livonia/48150/5001": { html: salePage(5001, "Fire King jadeite mixing bowls.", []) },
    "https://www.estatesales.net/MI/Livonia/48150/5002": { html: salePage(5002, "Tools.", []) } };
  const { X, env, sent, merged } = rig({ env: { SALES_PUBLIC: "on" }, apiBody, pages });
  const preview = await X.alEstateSend(env, { ...PRO }, THU_LOC, false);
  assert.equal(preview.subject, "Prowl: 1 estate sale pick \u00b7 Fire-King jadeite");
  assert.equal(sent.length, 0, "a preview sends nothing");
  const sub = { ...PRO };
  assert.equal(await X.alEstateSend(env, sub, THU_LOC, true), "sent");
  const m = sent[0];
  assert.equal(m.to, "m@example.com");
  assert.match(m.html, /Top picks[\s\S]*Your quarry: Fire-King jadeite \u00b7 in the description[\s\S]*Also this weekend[\s\S]*Garage full/);
  assert.match(m.html, /href="https:\/\/www\.estatesales\.net\/MI\/Livonia\/48150\/5001"/);
  assert.match(m.html, /within 25 miles of 48375/);
  assert.match(m.html, /Stop Thursday estate sale emails/);
  assert.equal(m.unsub, "https://w.example/alerts/unsub?e=m@example.com&w=estate");
  assert.match(m.text, /TOP PICKS[\s\S]*https:\/\/www\.estatesales\.net\/MI\/Livonia\/48150\/5001/);
  assert.equal(sub.estate, "2026-10-29"); assert.deepEqual(merged.at(-1), ["estate"]);
});

test("nothing open this weekend: no email, and Thursday is still marked done", async () => {
  const { X, env, sent } = rig({ env: { SALES_PUBLIC: "on" }, apiBody: "[]" });
  const sub = { ...PRO };
  assert.equal(await X.alEstateSend(env, sub, THU_LOC, true), "nothing this weekend");
  assert.equal(sent.length, 0);
  assert.equal(sub.estate, "2026-10-29");
});

test("the member's settings keep estate (off stays off), the unsubscribe link can stop only it, and status says when it can go", () => {
  assert.match(INDEX, /estate: p\.estate === "off" \? "off" : ""/);
  assert.match(INDEX, /if \(p\.w === "estate"\) \{[\s\S]*?estate: "off"/);
  assert.match(INDEX, /estate: alEstateOpen\(env, sub\),/);
  assert.match(INDEX, /if \(estateLeft > 0 && alEstateDue\(env, sub, loc\)\)/);
});

/* ---- Plan my weekend (same PR, still v205): street address, position and cover photo from each sale page; the email's
   thumbnails and its signed "Plan my weekend" link; GET /weekend/plan for the page's planner ---- */
/* a sale page shaped like EstateSales.net's (2026-10-30): og:image tags (the first is the cover), the SaleEvent with its
   PostalAddress, and the app's record with latitude/longitude and showAddress */
function planPage(id, o = {}) {
  const rec = { saleId: id, id, name: "Sale " + id, plainTextDescription: o.desc || "Pyrex and tools.", pictures: [], showAddress: o.hidden ? false : true,
    latitude: o.lat == null ? 42.478986 : o.lat, longitude: o.lng == null ? -83.116174 : o.lng, mainPicture: { thumbnailUrl: "https://picturescdn.estatesales.net/" + id + "/1-2/main.jpg" },
    utcShowAddressAfter: D("Thu 2026-10-29 9:00 AM EDT (UTC-04:00)") };
  const ld = { "@context": "http://schema.org/", "@type": "SaleEvent", url: "https://www.estatesales.net/MI/Royal Oak/48067/traditional/" + id, description: "x",
    location: { "@type": "Place", name: o.hidden ? "Royal Oak, MI 48067" : "2325 Barrett  Royal Oak, MI 48067", address: { "@type": "PostalAddress", streetAddress: o.hidden ? "" : "2325 Barrett ", addressLocality: "Royal Oak", addressRegion: "MI", postalCode: "48067" } } };
  const og = o.noImg ? "" : `<meta property="og:image" content="https://picturescdn.estatesales.net/${id}/1-1/cover-uuid.jpg"><meta property="og:image" content="https://picturescdn.estatesales.net/${id}/1-1/second.jpg">`;
  return `<html><head>${og}</head><script type="application/ld+json">${JSON.stringify(ld)}</script>` +
    `<script id="estatesales-net-state" type="application/json">${JSON.stringify({ NGRX_STATE: { feature: { traditionalSaleViewState: { entitiesById: { [id]: rec } } } } })}</script></html>`;
}

test("a sale page gives its street address, its own position and its cover photo (the first og:image); a hidden address is pending", () => {
  const d = W.wkDetailParse(planPage(5136894), "5136894");
  assert.equal(d.addr, "2325 Barrett");
  assert.equal(d.lat, 42.478986); assert.equal(d.lng, -83.116174);
  assert.equal(d.img, "https://picturescdn.estatesales.net/5136894/1-1/cover-uuid.jpg", "the cover photo, not the second og:image or the thumbnail");
  assert.equal(d.addrAt, 0);
  const h = W.wkDetailParse(planPage(5136895, { hidden: true }), "5136895");
  assert.equal(h.addr, "", "address pending");
  assert.equal(h.addrAt, Date.UTC(2026, 9, 29, 13, 0), "when the company shows it");
  assert.equal(W.wkDetailParse(planPage(5136896, { noImg: true }), "5136896").img, "https://picturescdn.estatesales.net/5136896/1-2/main.jpg", "no og:image: the old picture");
  assert.equal(W.wkDetailParse('<meta property="og:image" content="https://evil.example/x.jpg">', "1"), null, "an image off EstateSales.net's CDN is never kept");
  assert.equal(W.wkDetailParse('<meta property="og:image" content="https://picturescdn.estatesales.net/1/1-1/a.jpg">', "1").img, "https://picturescdn.estatesales.net/1/1-1/a.jpg");
});

test("each sale in the list carries its position (the page's own when read), street address and open days for the planner", () => {
  const win = W.wkWindow(THU, TZ);
  const sales = W.wkFromApi([sale(6001), sale(6002)], NOVI, 25);
  const b = W.wkBuild(sales, { by: { 6001: W.wkDetailParse(planPage(6001), "6001"), 6002: W.wkDetailParse(planPage(6002, { hidden: true }), "6002") }, gone: {} }, [], win, THU, TZ, 12);
  const a = b.rest.find((x) => x.id === "6001"), p = b.rest.find((x) => x.id === "6002");
  assert.equal(a.addr, "2325 Barrett"); assert.equal(a.lat, 42.478986); assert.equal(a.lng, -83.116174);
  assert.deepEqual(a.days, [{ s: Date.UTC(2026, 9, 30, 14, 0), e: Date.UTC(2026, 9, 30, 21, 0) }, { s: Date.UTC(2026, 9, 31, 14, 0), e: Date.UTC(2026, 9, 31, 18, 0) }]);
  assert.equal(a.img, "https://picturescdn.estatesales.net/6001/1-1/cover-uuid.jpg");
  assert.equal(p.addr, "", "address pending"); assert.ok(p.addrAt > 0);
  assert.equal(p.lat, 42.478986, "position kept for the map even while the street is hidden");
  const unread = W.wkBuild(sales, { by: {}, gone: {} }, [], win, THU, TZ, 12).rest[0];
  assert.equal(unread.lat, 42.39, "no page read: the list's position"); assert.equal(unread.addr, "");
});

test("plan links: ids are digits only, at most 12; the URL carries ids, picks, ZIP, expiry and signature; rows keep the link's order", () => {
  assert.deepEqual(W.wkPlanIds("5136894, 12,abc,5136894|5000001"), ["5136894", "5000001"]);
  assert.equal(W.wkPlanIds(Array.from({ length: 20 }, (_, i) => 1000 + i)).length, 12);
  assert.equal(W.wkPlanUrl("https://p.example/pages/prowl-app", ["1001", "1002"], ["1001"], "48375", 1900000000, "sig"),
    "https://p.example/pages/prowl-app?wkplan=1001,1002&wkp=1001&wkzip=48375&wkx=1900000000&wks=sig");
  const win = W.wkWindow(THU, TZ);
  const items = W.wkFromApi([sale(7001), sale(7002), sale(7003, { dates: [{ utcStartDate: D("Thu 2026-10-29 9:00 AM EDT (UTC-04:00)"), utcEndDate: D("Thu 2026-10-29 3:00 PM EDT (UTC-04:00)") }] })], NOVI, 25);
  const r = W.wkPlanRows(items, { by: { 7002: W.wkDetailParse(planPage(7002), "7002") }, gone: {} }, ["7002", "7001", "7003", "7999"], ["7002"], win, THU, TZ);
  assert.deepEqual(r.sales.map((x) => [x.id, x.pick]), [["7002", true], ["7001", false]]);
  assert.equal(r.sales[0].addr, "2325 Barrett");
  assert.deepEqual(r.missing, ["7003", "7999"], "over before the weekend, or no longer listed");
});

test("the Thursday email: each sale's cover photo 120x90 linked to the sale (none when it has none), and a signed Plan my weekend link", async () => {
  const now = Date.now(), win = W.wkWindow(now, TZ);
  const sat = (h) => satAt(win, h);
  const mk = (id, name) => sale(id, { name, firstUtcStartDate: sat(14), lastUtcEndDate: sat(20), dates: [{ utcStartDate: sat(14), utcEndDate: sat(20) }] });
  const apiBody = JSON.stringify([mk(8001, "Jadeite house"), mk(8002, "No photo sale")]);
  const pages = { "https://www.estatesales.net/MI/Livonia/48150/8001": { html: planPage(8001, { desc: "Fire King jadeite bowls." }) },
    "https://www.estatesales.net/MI/Livonia/48150/8002": { html: planPage(8002, { noImg: true }).replace(/"thumbnailUrl":"[^"]+"/, '"thumbnailUrl":""') } };
  const { X, env, sent } = rig({ env: { SALES_PUBLIC: "on", PROWL_SESSION_SECRET: "s3cret" }, apiBody, pages });
  assert.equal(await X.alEstateSend(env, { ...PRO }, THU_LOC, true), "sent");
  const m = sent[0];
  assert.match(m.html, /<a href="https:\/\/www\.estatesales\.net\/MI\/Livonia\/48150\/8001"><img src="https:\/\/picturescdn\.estatesales\.net\/8001\/1-1\/cover-uuid\.jpg" width="120" height="90" alt="Jadeite house"/);
  assert.equal((m.html.match(/<img /g) || []).length, 1, "a sale without a photo shows none");
  const plan = /href="([^"]*wkplan=[^"]*)"[^>]*>[^<]*Plan my weekend/.exec(m.html);
  assert.ok(plan, "a Plan my weekend button");
  const u = new URL(plan[1].replace(/&amp;/g, "&"));
  assert.equal(u.origin + u.pathname, "https://www.owlandtwigvintage.com/pages/prowl-app");
  assert.equal(u.searchParams.get("wkplan"), "8001,8002"); assert.equal(u.searchParams.get("wkp"), "8001"); assert.equal(u.searchParams.get("wkzip"), "48375");
  assert.ok(Number(u.searchParams.get("wkx")) * 1000 > Date.parse(new Date(win.to).toISOString()), "good until after the weekend");
  assert.match(u.searchParams.get("wks"), /^[0-9a-f]{32}$/);
  assert.ok(!/m@example\.com/.test(plan[1]), "no email address in the plan link");
  assert.match(m.text, /Plan my weekend \(a day-by-day route with Maps links\): https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl-app\?wkplan=8001,8002/);
});

test("GET /weekend/plan: the email's signature opens it with no sign-in; a wrong or run-out one does not; sales come back with addresses", async () => {
  const now = Date.now(), win = W.wkWindow(now, TZ);
  const sat = (h) => satAt(win, h);
  const mk = (id) => sale(id, { firstUtcStartDate: sat(14), lastUtcEndDate: sat(20), dates: [{ utcStartDate: sat(14), utcEndDate: sat(20) }] });
  const apiBody = JSON.stringify([mk(9001), mk(9002)]);
  const pages = { "https://www.estatesales.net/MI/Livonia/48150/9001": { html: planPage(9001) }, "https://www.estatesales.net/MI/Livonia/48150/9002": { html: planPage(9002, { hidden: true }) } };
  const { X, env } = rig({ env: { PROWL_SESSION_SECRET: "s3cret" }, apiBody, pages });
  const exp = Math.floor(now / 1000) + 86400, ids = ["9001", "9002", "9003"], picks = ["9001"];
  const sig = await X.wkPlanSig(env, ids, picks, "48375", exp);
  const purl = (q) => new URL("https://w.example/weekend/plan?" + q);
  const r = await X.wkPlanRoute(REQ, env, purl("ids=9001,9002,9003&p=9001&zip=48375&x=" + exp + "&s=" + sig + "&tz=America/Detroit"), "o");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.sales.map((x) => [x.id, x.pick, x.addr]), [["9001", true, "2325 Barrett"], ["9002", false, ""]]);
  assert.deepEqual(r.body.missing, ["9003"]);
  assert.equal(r.body.start.zip, "48375"); assert.equal(r.body.start.town, "Novi, MI"); assert.equal(typeof r.body.start.lat, "number");
  assert.equal((await X.wkPlanRoute(REQ, env, purl("ids=9001,9002&p=9001&zip=48375&x=" + exp + "&s=" + sig), "o")).status, 404, "the ids are covered by the signature");
  assert.equal((await X.wkPlanRoute(REQ, env, purl("ids=9001,9002,9003&p=9001&zip=48376&x=" + exp + "&s=" + sig), "o")).status, 404, "so is the ZIP");
  assert.equal((await X.wkPlanRoute(req(), env, purl("ids=9001&zip=48375&x=" + exp), "o")).status, 401, "no signature, signed out, not public, not the owner");
  MEM(env.PROWL_ALERTS, { email: "free@example.com", tok: "t-free", pro: false });
  assert.equal((await X.wkPlanRoute(req({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "t-free" }), env, purl("ids=9001&zip=48375"), "o")).status, 403, "v205: a free member needs the link");
  MEM(env.PROWL_ALERTS, { email: "pro@example.com", tok: "t-pro", pro: true });
  assert.equal((await X.wkPlanRoute(req({ "X-Prowl-Email": "pro@example.com", "X-Prowl-Tok": "t-pro" }), env, purl("ids=9001&zip=48375"), "o")).status, 200, "v205: a Pro member needs no link");
  assert.equal((await X.wkPlanRoute(req({ "X-Prowl-Email": "free@example.com", "X-Prowl-Tok": "t-free" }), env, purl("ids=9001,9002,9003&p=9001&zip=48375&x=" + exp + "&s=" + sig), "o")).status, 200, "the forwarded link still opens for anyone until it runs out");
  const old = Math.floor(now / 1000) - 60, oldSig = await X.wkPlanSig(env, ["9001"], [], "48375", old);
  assert.equal((await X.wkPlanRoute(REQ, env, purl("ids=9001&zip=48375&x=" + old + "&s=" + oldSig), "o")).status, 410, "a run-out link says so");
  const pub = rig({ env: { SALES_PUBLIC: "on" }, apiBody, pages });
  assert.equal((await pub.X.wkPlanRoute(REQ, pub.env, purl("ids=9001&zip=48375"), "o")).status, 200, "public: no signature needed");
  assert.equal((await pub.X.wkPlanRoute(REQ, pub.env, purl("ids=9001"), "o")).status, 400, "a ZIP is needed");
});

test("a sweep reads the page of every sale it shows, not only the nearest few (the planner needs each address)", async () => {
  const now = Date.now(), win = W.wkWindow(now, TZ);
  const sat = (h) => satAt(win, h);
  const list = Array.from({ length: 5 }, (_, i) => sale(9100 + i, { latitude: 42.48 + i * 0.05, firstUtcStartDate: sat(14), lastUtcEndDate: sat(20), dates: [{ utcStartDate: sat(14), utcEndDate: sat(20) }] }));
  const pages = {}; list.forEach((s) => { pages["https://www.estatesales.net/MI/Livonia/48150/" + s.id] = { html: planPage(s.id) }; });
  const { X, env, fetched } = rig({ env: { SALES_PUBLIC: "on" }, apiBody: JSON.stringify(list), pages });
  const S = await X.wkSweep(env, { lat: 42.48, lng: -83.48 }, 25, [], TZ, null, 2);
  assert.equal(S.rest.length, 5);
  assert.ok(S.rest.every((x) => x.addr === "2325 Barrett"), "every sale shown has its address");
  assert.equal(fetched.filter((u) => /\/MI\/Livonia\//.test(u)).length, 5);
});
