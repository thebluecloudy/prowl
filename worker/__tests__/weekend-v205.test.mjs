/* v205 estate sales this week: GET /weekend lists the estate sales open in the next 7 days (today through today+6 in the
   caller's time zone; Matt, 2026-10-31: "Estate sales are all week, we can't just look at weekend") within 25 miles of
   a point, from EstateSales.net's list near a point and each nearby sale's own page; sales that mention a hunt are Top
   picks; every sale links to its own page (dead or missing links are dropped); ended sales are hidden; at most 12. All
   Prowl Pro members see it (a session or X-Prowl-Email/X-Prowl-Tok member with sub.pro, the owner key, or everyone while
   SALES_PUBLIC=on). No separate Thursday email (Matt, 2026-10-31: "Can this be part of prowl email?"): the daily Prowl
   email of a Pro member with a ZIP gets an "Estate sales near you" section with the new matching sales, read from KV
   that an earlier clock run filled.
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

test("the window: the next 7 days, today 00:00 to the 7th day after at 00:00, in the caller's time zone; DST is respected", () => {
  const w = W.wkWindow(THU, TZ);
  assert.equal(w.from, Date.UTC(2026, 9, 29, 4, 0), "Thursday 00:00 EDT");
  assert.equal(w.to, Date.UTC(2026, 10, 5, 5, 0), "the next Thursday 00:00 EST (clocks went back on Sunday): Thu through Wed");
  assert.equal(w.tz, TZ);
  assert.deepEqual(W.wkWindow(Date.UTC(2026, 9, 30, 3, 59), TZ), w, "Thursday 11:59 PM: still Thursday's week");
  assert.equal(W.wkWindow(Date.UTC(2026, 9, 30, 4, 0), TZ).from, Date.UTC(2026, 9, 30, 4, 0), "at midnight the week moves on a day");
  const sun = W.wkWindow(Date.UTC(2026, 10, 1, 17, 0), TZ);
  assert.equal(sun.from, Date.UTC(2026, 10, 1, 4, 0), "Sunday Nov 1 starts in EDT"); assert.equal(sun.to, Date.UTC(2026, 10, 8, 5, 0));
  const la = W.wkWindow(THU, "America/Los_Angeles");
  assert.equal(la.from, Date.UTC(2026, 9, 29, 7, 0));
  assert.equal(W.wkWindow(Date.UTC(2026, 9, 29, 5, 0), "America/Los_Angeles").from, Date.UTC(2026, 9, 28, 7, 0), "10 PM Wednesday in LA is still Wednesday there");
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

test("the list: Top picks first with their hunt, then the rest; ended, past-the-week and dead-link sales are left out; at most 12", () => {
  const win = W.wkWindow(THU, TZ);
  const list = [
    sale(1001, { name: "Typewriter heaven" }),
    sale(1002, { latitude: 42.47, longitude: -83.45 }),
    sale(1003, { dates: [{ utcStartDate: D("Wed 2026-10-28 9:00 AM EDT (UTC-04:00)"), utcEndDate: D("Wed 2026-10-28 3:00 PM EDT (UTC-04:00)") }] }),   /* over yesterday */
    sale(1004, { dates: [{ utcStartDate: D("Fri 2026-11-06 9:00 AM EST (UTC-05:00)"), utcEndDate: D("Fri 2026-11-06 3:00 PM EST (UTC-05:00)") }] }),   /* past the 7 days */
    sale(1005),
    sale(1006, { dates: [{ utcStartDate: D("Sat 2026-10-31 9:00 AM EDT (UTC-04:00)"), utcEndDate: D("Sat 2026-10-31 3:00 PM EDT (UTC-04:00)") }] }),
    sale(1007, { name: "Weekday Pyrex sale", dates: [{ utcStartDate: D("Tue 2026-11-03 9:00 AM EST (UTC-05:00)"), utcEndDate: D("Tue 2026-11-03 3:00 PM EST (UTC-05:00)") }] }),   /* a Tuesday: in the week now */
  ];
  const sales = W.wkFromApi(list, NOVI, 25);
  const read = W.wkToRead(sales, win, THU, 16);
  assert.deepEqual(read.map((x) => x.id).sort(), ["1001", "1002", "1005", "1006", "1007"], "only sales open in the next 7 days are read");
  const details = { by: { 1006: { desc: "Pyrex galore. Cash only.", caps: [], img: "" } }, gone: { 1005: 1 } };
  const b = W.wkBuild(sales, details, ["pyrex", "typewriter"], win, THU, TZ, 12);
  assert.deepEqual(b.picks.map((x) => [x.id, x.match.hunt, x.match.where]), [["1001", "typewriter", "the title"], ["1006", "pyrex", "the description"], ["1007", "pyrex", "the title"]]);
  assert.equal(b.picks[2].hours, "Tue Nov 3, 9 AM\u20133 PM", "a weekday sale, soonest first after the weekend's");
  assert.deepEqual(b.rest.map((x) => x.id), ["1002"]);
  assert.equal(b.picks[0].url, "https://www.estatesales.net/MI/Livonia/48150/1001");
  assert.equal(b.picks[1].hours, "Sat Oct 31, 9 AM\u20133 PM");
  assert.equal(b.picks[1].standout, "Pyrex galore.");
  /* Saturday 3:30 PM: Friday is over and 1006 has ended; only the Tuesday sale is left */
  const sat = Date.UTC(2026, 9, 31, 19, 30);
  const later = W.wkBuild(sales, details, ["pyrex"], win, sat, TZ, 12);
  assert.deepEqual(later.picks.concat(later.rest).map((x) => x.id), ["1007"], "every weekend sale here ended by Saturday 3 PM");
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
const CONSTS = [/^const WK_LIST_TTL = .*$/m, /^const AL_ESTATE_KEEP = .*$/m, /^const AL_ESTATE_CALLS = .*$/m, /^const WK_PENDING_TTL = .*$/m, /^const AL_ESTATE_IMG = .*$/m].map((re) => re.exec(INDEX)[0]).join("\n");
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
}
function rig({ api = 200, apiBody = null, pages = {}, env: envExtra = {}, owner = false, city = null, geo = null, deps: depsExtra = {} } = {}) {
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
    gKey: () => "k", G_GEO_PER_DAY: 1000, gGeocode: geo || (async () => ({ lat: 42.47, lng: -83.47, city: "Novi", st: "MI" })),
    alPrefs: (sub) => ({ tz: "", zip: "", estate: "", ...(sub.prefs || {}) }), alPaused: () => false, alActive: (e, sub) => sub.hunts,
    alMailSub: async (e, sub) => ({ ...sub, k: "ticket" }), alUnsubUrl: (sub) => "https://w.example/alerts/unsub?e=" + sub.email, alHomeUrl: () => "https://prowl.example/?alerts=in",
    alEsc: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
    alShell: (e, inner, why, links) => "<html>" + inner + "<p>" + why + "</p><p>" + links + "</p></html>", alFootText: () => "\n--\nfooter",
    alSend: async (e, to, subject, html, text, unsub) => { sent.push({ to, subject, html, text, unsub }); return { ok: true }; },
    alMerge: async (e, sub, f) => { merged.push(f); return sub; },
    console: { log() {}, error() {} },
    alCodeKey: (e) => e.PROWL_SESSION_SECRET || "", PROWL_APP: "https://www.owlandtwigvintage.com/pages/prowl-app", crypto: globalThis.crypto, TextEncoder,
    /* the daily email's own parts (v205: the estate sales section rides in it) */
    alSendDay: () => true, alNow: () => TODAY_LOC(), alLocal: (sub, now) => now, alPicks: async () => [],
    kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)),
    AL_SRC_NAME: { ebay: "eBay" }, AL_PER_HUNT_EMAIL: 6, AL_ALSO: [], epnUrl: (e, u) => u, alDailyUrl: () => "https://prowl.example/?daily=1", alFree: () => 3,
    alUpgradeUrl: () => "https://prowl.example/?upgrade=1", alWhy: () => "You turned on Prowl Alerts.", alLocalNote: () => "", G_ENV: {},
    ...depsExtra,
  };
  const names = ["wkOpen", "wkWho", "fbWho", "wkGet", "wkList", "wkDetails", "wkSweep", "wkRoute", "alEstateOpen", "alEstateOn", "alEstateDue", "alEstateUnsubUrl", "alEstateTried", "wkZipPoint",
    "wkEstKey", "wkEstDone", "wkEstItem", "alEstateReady", "alEstatePrep", "alEstatePicks", "alEstateMark", "alEstateRow", "alEstatePlanBtn", "alEstateSec", "alEstateText", "alEstateSubject",
    "alDigest", "alEmailHtml", "alEmailText", "alSubject", "wkPlanSig", "wkPlanRoute", "pxHmac", "alSame"];
  const keys = Object.keys(deps);
  const X = new Function(...keys, CONSTS + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { X, env, kv, fetched, sent, merged };
}
/* tomorrow (the window's second day), h hours after its start, written the way EstateSales.net writes a date */
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
/* the member's own day today, the way alLocal gives it */
const TODAY_LOC = () => ({ day: new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), hour: 7, wday: 4 });
/* d days after the window's first day, at h o'clock UTC, written the way EstateSales.net writes a date */
function dayAt(win, d, h) {
  const t = new Date(win.from + d * 86400000 + h * 3600000), p2 = (n) => String(n).padStart(2, "0");
  return D(t.getUTCFullYear() + "-" + p2(t.getUTCMonth() + 1) + "-" + p2(t.getUTCDate()) + " " + ((t.getUTCHours() % 12) || 12) + ":" + p2(t.getUTCMinutes()) + " " + (t.getUTCHours() < 12 ? "AM" : "PM") + " UTC (UTC+00:00)");
}
const LIV = (id) => "https://www.estatesales.net/MI/Livonia/48150/" + id;
/* sales open d days from today (14:00-20:00 UTC), named n, their pages saying desc */
function week(rows) {
  const win = W.wkWindow(Date.now(), TZ), list = [], pages = {};
  rows.forEach(([id, d, name, desc]) => {
    list.push(sale(id, { name, latitude: 42.39 + list.length / 1000, firstUtcStartDate: dayAt(win, d, 14), lastUtcEndDate: dayAt(win, d, 20), dates: [{ utcStartDate: dayAt(win, d, 14), utcEndDate: dayAt(win, d, 20) }] }));
    pages[LIV(id)] = { html: planPage(id, { desc: desc || "Tools." }) };
  });
  return { apiBody: JSON.stringify(list), pages, win };
}
const RUN = () => ({ calls: 0, max: 16 });
const PEND = (kv, email, pend) => kv.set("pend:" + email, pend);
const LISTING = { title: "Fire-King jadeite mug", price: "$12", url: "https://www.ebay.com/itm/1", src: "ebay" };

test("the estate sales section is due for a Pro member with a ZIP who has not turned it off, on a send day before the digest goes", () => {
  const { X } = rig(), env = {}, L = TODAY_LOC();
  assert.equal(X.alEstateDue(env, PRO, L), true);
  assert.equal(X.alEstateDue(env, { ...PRO, estate: L.day }, L), false, "today's record is ready already");
  assert.equal(X.alEstateDue(env, { ...PRO, sent: L.day }, L), false, "the digest went today");
  assert.equal(X.alEstateDue(env, { ...PRO, pro: false }, L), false, "Pro only");
  assert.equal(X.alEstateDue(env, { ...PRO, prefs: { zip: "" } }, L), false, "needs a ZIP");
  assert.equal(X.alEstateDue(env, { ...PRO, prefs: { zip: "48375", estate: "off" } }, L), false, "turned off");
  assert.equal(X.alEstateDue(env, { ...PRO, mail: "off" }, L), false, "emails off");
  assert.equal(X.alEstateDue(env, { ...PRO, estateTry: { day: L.day, n: 3 } }, L), false, "tried enough today");
  assert.equal(X.alEstateDue(env, { ...PRO, estateTry: { day: "2020-01-01", n: 3 } }, L), true, "a new day starts again");
  assert.equal(X.alEstateDue({ SALES_PUBLIC: "on" }, PRO, L), true, "SALES_PUBLIC changes nothing for it");
  const off = rig({ deps: { alSendDay: () => false } });
  assert.equal(off.X.alEstateDue(env, PRO, L), false, "not on a day the member gets no email");
  const paused = rig({ deps: { alPaused: () => true } });
  assert.equal(paused.X.alEstateDue(env, PRO, L), false, "paused");
  assert.equal(X.alEstateOpen(env, { email: "free@example.com", pro: false }), true, "the Den shows the switch to every member (locked for free)");
  assert.equal(X.alEstateOpen(env, null), false);
});

test("the daily email gets an Estate sales near you section: new sales that mention a hunt, soonest first, at most 5, each linked, Plan my week, one line for the rest", async () => {
  const W7 = week([[5101, 5, "Jadeite five"], [5102, 1, "Kitchen sale", "Fire King jadeite mixing bowls."], [5103, 2, "Jadeite two"], [5104, 1, "Garage full"], [5105, 3, "Fire-King jadeite trove"],
    [5106, 4, "Jadeite four"], [5107, 6, "Jadeite six", "Fire-King jadeite."], [5108, 6, "Jadeite seven", "More Fire-King jadeite."], [5109, 2, "Tools only"]].map((r) => (r[2].startsWith("Jadeite") ? [r[0], r[1], r[2], r[3] || "Fire-King jadeite and more."] : r)));
  const R = rig({ env: { PROWL_SESSION_SECRET: "s3cret" }, apiBody: W7.apiBody, pages: W7.pages });
  const sub = { ...PRO }, L = TODAY_LOC();
  assert.equal(await R.X.alEstatePrep(R.env, sub, L, RUN()), "ready");
  PEND(R.kv, sub.email, { "Fire-King jadeite": [LISTING] });
  const before = R.fetched.length;
  const r = await R.X.alDigest(R.env, sub, true);
  assert.equal(r.sent, true); assert.equal(r.estate, 5);
  assert.equal(R.fetched.length, before, "the digest asks EstateSales.net nothing: it reads KV");
  const m = R.sent[0];
  assert.equal(m.subject, "Prowl: 1 new · Fire-King jadeite (1) · 5 estate sales");
  assert.match(m.html, /Estate sales near you <span[^>]*>· 5 new · next 7 days/);
  assert.match(m.html, /Within 25 miles of 48375; hours are your local time/);
  const order = ["5102", "5103", "5105", "5106", "5101"].map((id) => m.html.indexOf(LIV(id)));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "soonest first: " + order);
  assert.ok(!m.html.includes(LIV(5107)) && !m.html.includes(LIV(5104)), "at most 5, and only sales that mention a hunt");
  assert.match(m.html, /Your quarry: Fire-King jadeite · in the description/);
  assert.equal((m.html.match(/See the sale on EstateSales\.net/g) || []).length, 5);
  assert.match(m.html, /href="https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl-app\?wk=1"[^>]*>4 more estate sales near you this week/, "the other 4 open this week, in one line");
  assert.match(m.html, /Plan my week<\/a>/);
  assert.match(m.html, /href="https:\/\/w\.example\/alerts\/unsub\?e=m@example\.com&amp;w=estate"[^>]*>Stop estate sales in these emails/, "a stop link of its own in the footer");
  assert.ok(m.html.indexOf("Fire-King jadeite mug") < m.html.indexOf("Estate sales near you"), "after the hunts");
  assert.match(m.text, /ESTATE SALES NEAR YOU \(5 new, next 7 days, within 25 miles of 48375\)[\s\S]*https:\/\/www\.estatesales\.net\/MI\/Livonia\/48150\/5102[\s\S]*Stop estate sales in these emails: https:\/\/w\.example\/alerts\/unsub\?e=m@example\.com&w=estate/);
  assert.deepEqual(Object.keys(sub.estSent).sort(), ["5101", "5102", "5103", "5105", "5106"]);
  assert.ok(Object.values(sub.estSent).every((d) => d === L.day));
  assert.ok(R.merged.some((f) => f.includes("estSent")), "remembered on the member");
  /* the next email: only the two not sent yet, and no listings needed for it to go */
  const r2 = await R.X.alDigest(R.env, sub, true);
  assert.equal(r2.sent, true, "a day with only new estate picks still sends");
  const m2 = R.sent[1];
  assert.equal(m2.subject, "Prowl: 2 estate sale picks · Fire-King jadeite");
  assert.match(m2.html, /2 estate sales worth the drive/);
  assert.ok(m2.html.includes(LIV(5107)) && m2.html.includes(LIV(5108)));
  assert.ok(!m2.html.includes(LIV(5102)), "a sale is never sent twice");
  /* and then nothing new: no email */
  assert.deepEqual(await R.X.alDigest(R.env, sub, true), { sent: false, reason: "nothing new" });
  assert.equal(R.sent.length, 2);
});

test("no section without new matching sales, with the switch off, for a free member, with no ZIP, or before today's record is ready", async () => {
  const W7 = week([[5201, 1, "Jadeite house", "Fire-King jadeite."], [5202, 2, "Garage full"]]);
  const R = rig({ apiBody: W7.apiBody, pages: W7.pages }), L = TODAY_LOC();
  const listing = (sub) => PEND(R.kv, PRO.email, { [(sub || PRO).hunts[0]]: [LISTING] });
  /* not fetched yet: the email goes without it */
  listing();
  let r = await R.X.alDigest(R.env, { ...PRO }, false);
  assert.equal(r.est, null); assert.ok(!/Estate sales near you/.test(r.html));
  assert.deepEqual(await R.X.alDigest(R.env, { ...PRO, hunts: ["Fire-King jadeite"] }, true).then((x) => x.sent), true, "sent without the section");
  assert.ok(!/Estate sales near you|Stop estate sales/.test(R.sent[0].html));
  assert.equal(await R.X.alEstatePrep(R.env, { ...PRO }, L, RUN()), "ready");
  for (const [why, sub] of [["off", { ...PRO, prefs: { ...PRO.prefs, estate: "off" } }], ["free", { ...PRO, pro: false }], ["no ZIP", { ...PRO, prefs: { tz: TZ } }],
    ["no hunt matches", { ...PRO, hunts: ["ceramic panther"] }], ["already sent", { ...PRO, estSent: { 5201: L.day } }]]) {
    listing(sub);
    r = await R.X.alDigest(R.env, sub, false);
    assert.equal(r.est, null, why); assert.ok(!/Estate sales near you/.test(r.html), why);
    R.kv.set("pend:" + PRO.email, {});
    assert.deepEqual(await R.X.alDigest(R.env, sub, true), { sent: false, reason: "nothing new" }, why + ": nothing else new, no email");
  }
  r = await R.X.alDigest(R.env, { ...PRO }, false);
  assert.equal(r.est.picks.length, 1, "with all of it: the section");
});

test("the estate sales link stops only the section, settings keep estate (off stays off), and the Thursday email is gone", () => {
  assert.match(INDEX, /estate: p\.estate === "off" \? "off" : ""/);
  assert.match(INDEX, /if \(p\.w === "estate"\) \{[\s\S]*?Stop estate sales in your Prowl emails\?[\s\S]*?estate: "off"[\s\S]*?Estate sales are off in your emails/);
  assert.match(INDEX, /estate: alEstateOpen\(env, sub\),/);
  assert.ok(!/alEstateSend|Thursday estate|Plan my weekend/.test(INDEX), "no Thursday send, subject or wording left");
});

/* ---- Plan my week (same PR, still v205): street address, position and cover photo from each sale page; the email's
   thumbnails and its signed "Plan my week" link; GET /weekend/plan for the page's planner ---- */
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
  const items = W.wkFromApi([sale(7001), sale(7002), sale(7003, { dates: [{ utcStartDate: D("Wed 2026-10-28 9:00 AM EDT (UTC-04:00)"), utcEndDate: D("Wed 2026-10-28 3:00 PM EDT (UTC-04:00)") }] })], NOVI, 25);
  const r = W.wkPlanRows(items, { by: { 7002: W.wkDetailParse(planPage(7002), "7002") }, gone: {} }, ["7002", "7001", "7003", "7999"], ["7002"], win, THU, TZ);
  assert.deepEqual(r.sales.map((x) => [x.id, x.pick]), [["7002", true], ["7001", false]]);
  assert.equal(r.sales[0].addr, "2325 Barrett");
  assert.deepEqual(r.missing, ["7003", "7999"], "over yesterday, or no longer listed");
});

test("the section: each sale's cover photo 120x90 linked to the sale (none when it has none), and a signed Plan my week link that runs out with the 7 days", async () => {
  const W7 = week([[8001, 1, "Jadeite house", "Fire King jadeite bowls."], [8002, 2, "No photo sale", "Fire-King jadeite."], [8003, 3, "Garage full"]]);
  W7.pages[LIV(8002)] = { html: planPage(8002, { noImg: true, desc: "Fire-King jadeite." }).replace(/"thumbnailUrl":"[^"]+"/, '"thumbnailUrl":""') };
  const R = rig({ env: { PROWL_SESSION_SECRET: "s3cret" }, apiBody: W7.apiBody, pages: W7.pages });
  assert.equal(await R.X.alEstatePrep(R.env, { ...PRO }, TODAY_LOC(), RUN()), "ready");
  assert.equal((await R.X.alDigest(R.env, { ...PRO }, true)).sent, true);
  const m = R.sent[0];
  assert.match(m.html, /<a href="https:\/\/www\.estatesales\.net\/MI\/Livonia\/48150\/8001"><img src="https:\/\/picturescdn\.estatesales\.net\/8001\/1-1\/cover-uuid\.jpg" width="120" height="90" alt="Jadeite house"/);
  assert.equal((m.html.match(/<img /g) || []).length, 1, "a sale without a photo shows none");
  const plan = /href="([^"]*wkplan=[^"]*)"[^>]*>[^<]*Plan my week/.exec(m.html);
  assert.ok(plan, "a Plan my week button");
  const u = new URL(plan[1].replace(/&amp;/g, "&"));
  assert.equal(u.origin + u.pathname, "https://www.owlandtwigvintage.com/pages/prowl-app");
  assert.equal(u.searchParams.get("wkplan"), "8001,8002,8003", "the picks first, then the other sales near them this week"); assert.equal(u.searchParams.get("wkp"), "8001,8002"); assert.equal(u.searchParams.get("wkzip"), "48375");
  assert.equal(Number(u.searchParams.get("wkx")), Math.floor(W7.win.to / 1000), "it runs out when the 7 days end (today + 7, 00:00)");
  assert.match(u.searchParams.get("wks"), /^[0-9a-f]{32}$/);
  assert.ok(!/m@example\.com/.test(plan[1]), "no email address in the plan link");
  assert.match(m.text, /Plan my week \(a day-by-day route with Maps links\): https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl-app\?wkplan=8001,8002,8003/);
  /* the link opens the planner for anyone it is forwarded to */
  const q = "ids=" + u.searchParams.get("wkplan") + "&p=" + u.searchParams.get("wkp") + "&zip=48375&x=" + u.searchParams.get("wkx") + "&s=" + u.searchParams.get("wks") + "&tz=" + TZ;
  const pr = await R.X.wkPlanRoute(req(), R.env, new URL("https://w.example/weekend/plan?" + q), "o");
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.deepEqual(pr.body.sales.map((x) => [x.id, x.pick]), [["8001", true], ["8002", true], ["8003", false]]);
  assert.equal(Date.parse(pr.body.to), W7.win.to, "the planner's window is the same 7 days");
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

/* ---- v205 review fixes, for the 7-day window and the daily email ---- */
test("review: a span-only sale is clipped to the 7 days by whole days, keeping its clock; a span outside the week is dropped", () => {
  const win = W.wkWindow(THU, TZ);
  const span = (a, b) => W.wkFromApi([sale(7001, { dates: [], firstUtcStartDate: D(a), lastUtcEndDate: D(b) })], NOVI, 25)[0];
  const wide = W.wkDaysIn(span("Mon 2026-10-26 9:00 AM EDT (UTC-04:00)", "Sun 2026-11-08 4:00 PM EST (UTC-05:00)"), win, THU);
  assert.deepEqual(wide, [{ s: T("Thu 2026-10-29 9:00 AM EDT (UTC-04:00)"), e: T("Wed 2026-11-04 4:00 PM EST (UTC-05:00)"), span: 1 }], "Mon 9 AM - the Sunday after next 4 PM reads Thu 9 AM - Wed 4 PM, across the clock change");
  assert.equal(W.wkHours(wide, TZ), "Thu Oct 29 9 AM – Wed Nov 4 4 PM");
  const inside = span("Fri 2026-10-30 9:00 AM EDT (UTC-04:00)", "Tue 2026-11-03 3:00 PM EST (UTC-05:00)");
  assert.deepEqual(W.wkDaysIn(inside, win, THU), inside.days, "a span inside the week is left as it is");
  assert.deepEqual(W.wkDaysIn(span("Thu 2026-11-05 9:00 AM EST (UTC-05:00)", "Sat 2026-11-07 4:00 PM EST (UTC-05:00)"), win, THU), [], "starts after the 7 days");
  assert.deepEqual(W.wkDaysIn(span("Mon 2026-10-26 9:00 AM EDT (UTC-04:00)", "Wed 2026-10-28 4:00 PM EDT (UTC-04:00)"), win, THU), [], "over before today");
  assert.deepEqual(W.wkDaysIn(span("Mon 2026-10-26 2:00 PM EDT (UTC-04:00)", "Thu 2026-10-29 1:00 PM EDT (UTC-04:00)"), win, THU), [], "moved onto today by whole days it opens at 2 PM after it closes at 1 PM: nothing left");
  const b = W.wkBuild([span("Wed 2026-10-28 9:00 AM EDT (UTC-04:00)", "Mon 2026-11-09 4:00 PM EST (UTC-05:00)")], { by: {}, gone: {} }, [], win, THU, TZ, 12);
  assert.equal(b.rest[0].at, T("Thu 2026-10-29 9:00 AM EDT (UTC-04:00)"), "the planner's first day is today");
  assert.equal(W.wkHours(Array.from({ length: 6 }, (_, i) => ({ s: THU + i * 86400000, e: THU + i * 86400000 + 3600000 })), TZ).split(" · ").pop(), "+2 more days", "past 4 days, a count");
});

test("review: a fetch counts its outside calls on the run and stops at the reservation; a later run reads the pages it did not reach; then it costs nothing", async () => {
  const W7 = week(Array.from({ length: 30 }, (_, i) => [8000 + i, 1 + (i % 5), "Sale " + i]));
  const R = rig({ apiBody: W7.apiBody, pages: W7.pages }), L = TODAY_LOC();
  const run = RUN();   /* AL_ESTATE_CALLS, as alTick sets it */
  assert.equal(await R.X.alEstatePrep(R.env, { ...PRO }, L, run), "partly ready");
  assert.equal(run.calls, 16, "the geocode, the list and 14 pages: inside AL_ESTATE_CALLS");
  assert.equal(R.fetched.length, 15);
  const key = [...R.kv.m.keys()].find((k) => k.startsWith("wke:"));
  assert.equal(key, "wke:42.47,-83.47:" + L.day, "kept per point and day");
  let rec = JSON.parse(R.kv.m.get(key));
  assert.deepEqual([rec.items.length, rec.unread, rec.pass], [30, 16, 1]);
  assert.equal(await R.X.alEstateReady(R.env, { ...PRO }, L), false);
  const run2 = RUN();
  assert.equal(await R.X.alEstatePrep(R.env, { ...PRO }, L, run2), "ready");
  assert.equal(run2.calls, 16, "the 16 pages left (the ZIP and the list are kept)");
  rec = JSON.parse(R.kv.m.get(key));
  assert.deepEqual([rec.unread, rec.pass], [0, 2]);
  const run3 = RUN(), n = R.fetched.length;
  assert.equal(await R.X.alEstatePrep(R.env, { ...PRO, email: "neighbour@example.com" }, L, run3), "ready", "a member at the same point shares it");
  assert.deepEqual([run3.calls, R.fetched.length], [0, n]);
  assert.equal(await R.X.alEstateReady(R.env, { ...PRO, email: "neighbour@example.com" }, L), true);
  /* the HTTP routes are not counted or capped */
  const r = await R.X.wkRoute(REQ, { ...R.env, SALES_PUBLIC: "on" }, url("lat=42.47&lng=-83.47"), "o");
  assert.equal(r.status, 200);
});

test("review: a ZIP Google cannot place is remembered for a while; a Google outage is only a try", async () => {
  let asked = 0;
  const none = rig({ apiBody: "[]", geo: async (e, q, ans) => { asked++; if (ans) ans.none = true; return null; } });
  const run = RUN();
  assert.equal(await none.X.alEstatePrep(none.env, { ...PRO }, TODAY_LOC(), run), "no place for the ZIP");
  assert.deepEqual(JSON.parse(none.kv.m.get("wkz:48375")), { miss: 1 });
  assert.equal(await none.X.wkZipPoint(none.env, "48375"), null);
  assert.equal(asked, 1, "the miss is kept: Google is not asked again");
  const down = rig({ apiBody: "[]", geo: async () => null });
  assert.equal(await down.X.alEstatePrep(down.env, { ...PRO }, TODAY_LOC(), RUN()), "no point for the ZIP");
  assert.equal(down.kv.m.has("wkz:48375"), false, "an outage is not a miss");
  const t = { ...PRO }, L = TODAY_LOC();
  for (let i = 0; i < 3; i++) { assert.equal(down.X.alEstateDue({}, t, L), true, "try " + (i + 1)); await down.X.alEstateTried({}, t, L); }
  assert.deepEqual(t.estateTry, { day: L.day, n: 3 });
  assert.equal(down.X.alEstateDue({}, t, L), false, "tried enough today");
});

test("review: sent ids are bounded and expire", () => {
  const { X } = rig();
  const old = {}; for (let i = 0; i < 200; i++) old[String(100000 + i)] = i < 20 ? "2026-09-01" : "2026-10-" + String(1 + (i % 30)).padStart(2, "0");
  const sub = { estSent: { ...old, bad: "2026-10-30" } };
  const out = X.alEstateMark(sub, [{ id: "999999" }], "2026-10-31");
  assert.equal(Object.keys(out).length, 150, "at most 150");
  assert.equal(out["999999"], "2026-10-31", "the new one is kept");
  assert.ok(!Object.values(out).some((d) => d < "2026-10-01"), "none older than 30 days");
  assert.ok(!("bad" in out));
  assert.equal(sub.estSent, out);
});

/* alTick itself, with stand-ins for everything but its estate parts */
function tickRig(members, { estateCalls = 14, estateResult = "ready", ready = false, pounceLeft = null, checkN = 0 } = {}) {
  const kv = new FakeKV(), log = { estate: [], pro: [], fb: [], checks: 0 };
  members.forEach((m) => kv.set("sub:" + m.email, m));
  kv.list = async ({ prefix }) => ({ keys: [...kv.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true });
  const NOW = { day: "2026-10-29", hour: 11 };
  const deps = {
    alReady: () => true, alNow: () => NOW, POUNCE_PER_RUN: 30, PJ_RUN: null,
    kvGet: async (e, k, d) => { const v = await kv.get(k, "json"); return v == null ? d : v; },
    alBatch: () => 2, AL_PRO_REFRESH_PER_RUN: 8, AL_LETTERS_PER_RUN: 4, AL_CALLS_PER_HUNT: 9, FB_RUN_CALLS: 50,
    alUrgency: () => 0, memberId: async (s, e) => "M-" + e.length, scrubPII: (x) => x, alTrialPlan: () => null, alTrialNotes: async () => "",
    alLocal: () => THU_LOC, alPaused: () => false, pounceHasPhone: () => false, pounceQuarries: () => ({}),
    alProSet: async (e, sub) => { log.pro.push(sub.email); sub.proDay = NOW.day; sub.pro = !!sub.shopPro; return sub.pro; }, alToken: () => "utok",
    alMerge: async (e, sub, f) => { const cur = await kv.get("sub:" + sub.email, "json"); if (!cur) return null; f.forEach((k) => { cur[k] = sub[k]; }); kv.set("sub:" + sub.email, cur); return cur; },
    alLetterDue: () => false, alLetterSend: async () => "", pounceRetry: async () => {}, pounceCarry: async () => 0,
    alPrefs: (sub) => ({ tz: "", zip: "", estate: "", ...(sub.prefs || {}) }),
    alCheck: async () => { if (pounceLeft != null) deps.PJ_RUN.left = pounceLeft; log.checks++; return checkN; }, alSlotHour: () => 23, alActive: (e, sub) => sub.hunts, alSendDay: () => true, alDigest: async () => ({ sent: false, reason: "nothing new" }),
    alEstateReady: async () => ready,
    alEstatePrep: async (e, sub, loc, run) => { log.estate.push(sub.email); run.calls += estateCalls; return estateResult; },
    fbSweep: async (e, subs, left) => { log.fb.push(left); return { calls: 0, swept: 0, errors: [] }; },
    rosterCounts: () => null, ADMIN_H: 0, console: { log() {}, error() {} },
    Date: { now: () => 0 },   /* the run starts at the first member, so the order is the order given */
  };
  const consts = /^const AL_ESTATE_CALLS = .*$/m.exec(INDEX)[0] + "\n" + /^const AL_ESTATE_KEEP = .*$/m.exec(INDEX)[0];
  const src = ["alTick", "alEstateDue", "alEstateOn", "alEstateTried"].map(indexFn).join("\n");
  const keys = Object.keys(deps).filter((k) => k !== "PJ_RUN");
  const run = new Function(...keys, "let PJ_RUN = null;\n" + consts + "\n" + src + "\nreturn { alTick, get PJ_RUN() { return PJ_RUN; } };")(...keys.map((k) => deps[k]));
  Object.defineProperty(deps, "PJ_RUN", { get: () => run.PJ_RUN });
  return { tick: () => run.alTick({ PROWL_ALERTS: kv }), kv, log };
}
const ZIP = { zip: "48375", tz: "America/Detroit" };
const THU_LOC = { day: "2026-10-29", hour: 7, wday: 4 };
const m = (e, o = {}) => ({ email: e, pro: true, proDay: "2026-10-29", hunts: ["pyrex"], prefs: ZIP, utok: "u", ...o });

test("review: members with no hunts get no estate fetch (nothing to match) and no Pro check for it", async () => {
  const R = tickRig([{ email: "nohunts@example.com", pro: false, shopPro: true, hunts: [], prefs: ZIP, utok: "u" }]);
  await R.tick();
  assert.deepEqual([R.log.pro, R.log.estate, R.log.checks], [[], [], 0]);
});

test("review: the estate fetch's calls go into what the Facebook sweep is left, one fetch a run, none without the room", async () => {
  const R = tickRig([m("a@example.com"), m("b@example.com")], { estateCalls: 14 });
  await R.tick();
  assert.equal(R.log.estate.length, 1, "one a run");
  assert.deepEqual(R.log.fb, [50 - 14], "the fetch's 14 calls are taken off the Facebook share (no email of its own)");
  assert.equal(JSON.parse(R.kv.m.get("sub:a@example.com")).estate, "2026-10-29", "ready: done for today");
  await R.tick();
  assert.deepEqual(R.log.estate, ["a@example.com", "b@example.com"], "the next run does the next member");
  /* Pounce has used its 30 on an earlier member: 20 left, then the hunt check still to come; no room for a fetch */
  const busy = tickRig([m("c@example.com"), m("d@example.com")], { pounceLeft: 0 });
  await busy.tick();
  assert.deepEqual(busy.log.estate, ["c@example.com"], "the first goes before Pounce spends");
  const late = tickRig([m("e@example.com", { estate: "2026-10-29" }), m("g@example.com")], { pounceLeft: 0, checkN: 1 });
  await late.tick();
  assert.deepEqual(late.log.estate, [], "after Pounce's 30 (and a hunt check's share kept), under AL_ESTATE_CALLS: it waits a run");
  const tight = tickRig(Array.from({ length: 9 }, (_, i) => m("p" + i + "@example.com")), { estateCalls: 16 });
  await tight.tick();
  assert.equal(tight.log.estate.length, 1, "still one a run however many are due");
  assert.ok(tight.log.fb[0] >= 0, "the run stays inside its 50: " + tight.log.fb[0]);
});

test("review: a record already there costs no fetch; not on a day the digest went; partly ready waits for the next run; a failed try counts, three a day", async () => {
  const R = tickRig([m("a@example.com"), m("b@example.com")], { ready: true });
  await R.tick();
  assert.deepEqual(R.log.estate, [], "no fetch for either");
  assert.equal(JSON.parse(R.kv.m.get("sub:b@example.com")).estate, "2026-10-29", "both marked ready, past the one-a-run limit");
  const sent = tickRig([m("s@example.com", { sent: "2026-10-29" })]);
  await sent.tick();
  assert.deepEqual(sent.log.estate, [], "today's digest went already");
  const part = tickRig([m("q@example.com")], { estateCalls: 16, estateResult: "partly ready" });
  await part.tick(); await part.tick();
  assert.deepEqual(part.log.estate, ["q@example.com", "q@example.com"], "pages left: read on the next run");
  const rec = JSON.parse(part.kv.m.get("sub:q@example.com"));
  assert.equal(rec.estate, undefined); assert.equal(rec.estateTry, undefined, "not a failed try");
  const F = tickRig([m("f@example.com")], { estateCalls: 2, estateResult: "EstateSales.net did not answer" });
  for (let i = 0; i < 5; i++) await F.tick();
  assert.equal(F.log.estate.length, 3, "tried three times, not every 5 minutes");
  assert.deepEqual(JSON.parse(F.kv.m.get("sub:f@example.com")).estateTry, { day: "2026-10-29", n: 3 });
  const Z = tickRig([m("z@example.com")], { estateCalls: 1, estateResult: "no place for the ZIP" });
  await Z.tick(); await Z.tick();
  assert.equal(Z.log.estate.length, 1, "a ZIP with no place marks the day done");
});
