/* ---------- v205: estate sales this week (the next 7 days near a point) ----------
   Pure helpers for GET /weekend (the page's NEAR ME > Estate sales list; the route keeps its name) and the "Estate sales
   near you" section of the daily Prowl email. v205 (Matt, 2026-10-31: "Estate sales are all week, we can't just look at
   weekend"): the window is today through today+6 in the caller's time zone, no longer the coming Friday to Sunday.
   EstateSales.net is the only source: its sale list near a point (the JSON its own map asks for,
   /api/sale-details?bypass=bycoordinatesanddistance:LAT_LNG_MILES&include=dates) and, for the nearest sales open this
   week, each sale's own page (description and photo captions, for matching hunts). Every sale shown carries its own
   EstateSales.net link; a sale without one, or whose page answers 404/410, is never shown.
   Times: EstateSales.net's "utc" dates are real instants written as "Fri 2026-10-30 10:00 AM EDT (UTC-04:00)"; its
   "local" dates are shifted and are never used here. Hours are written in the time zone the caller passes. */
import { haversineMi } from "./trip.js";

export const WK_RADIUS_MI = 25, WK_RADIUS_MAX = 50, WK_CAP = 12, WK_DETAIL_MAX = 16, WK_HUNTS_MAX = 30;
export const ES_BASE = "https://www.estatesales.net";
const DAY_MS = 86400000;

const txt = (v, n) => String(v == null ? "" : v).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, n || 120);

/* the list URL for a point; miles 1..WK_RADIUS_MAX */
export function wkApiUrl(pt, miles) {
  const r = Math.max(1, Math.min(WK_RADIUS_MAX, Math.round(Number(miles) || WK_RADIUS_MI)));
  return ES_BASE + "/api/sale-details?bypass=bycoordinatesanddistance:" + Number(pt.lat).toFixed(4) + "_" + Number(pt.lng).toFixed(4) + "_" + r + "&include=dates&explicitTypes=DateTime";
}

/* "Fri 2026-10-30 10:00 AM EDT (UTC-04:00)" (or {_type,_value} around it, or an ISO string) -> ms, 0 when unreadable */
export function wkTime(v) {
  if (v && typeof v === "object") v = v._value || v.value || "";
  const s = String(v || "");
  const m = /(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?[^(]*\(UTC([+-])(\d{2}):?(\d{2})\)/i.exec(s);
  if (m) {
    let h = Number(m[4]) % 12;
    if (!m[6]) h = Number(m[4]); else if (/pm/i.test(m[6])) h += 12;
    const off = (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5])) - off * 60000;
  }
  const t = /Z$|[+-]\d{2}:\d{2}$/.test(s) ? Date.parse(s) : NaN;   /* a bare local time is not an instant */
  return t > 0 ? t : 0;
}

/* a sale's own link on EstateSales.net, or "" (the path must end in the sale's id) */
export function wkOwnUrl(u, id) {
  u = String(u || "").trim();
  if (!id || !/^\d{3,12}$/.test(String(id))) return "";
  if (/^https:\/\/www\.estatesales\.net\//i.test(u)) u = u.replace(/^https:\/\/www\.estatesales\.net/i, "");
  if (!/^\/[A-Za-z]{2}\/[A-Za-z0-9 .'-]{1,60}\/\d{5}\/(?:[a-z-]{1,30}\/)?\d{3,12}\/?$/.test(u)) return "";
  if (!new RegExp("/" + id + "/?$").test(u)) return "";
  return ES_BASE + u.replace(/\/$/, "").replace(/ /g, "-").replace(/'/g, "%27");
}

const TYPE_NAME = { EstateSales: "Estate sale", MovedOffsiteToStore: "Moved to a store", MovedOffsiteToWarehouse: "Moved to a warehouse",
  BuyoutsOrCleanouts: "Buyout or cleanout", Auctions: "Auction", MovingSales: "Moving sale", Liquidations: "Liquidation" };
function typeLabel(t) { t = String(t || ""); return TYPE_NAME[t] || t.replace(/([a-z])([A-Z])/g, "$1 $2").slice(0, 40); }

/* the API's list -> sales within radiusMi of center, in person only, each with its own link and its open days */
/* v205 review 2: nowMs (when given) drops dates that ended more than an hour ago before the 14 are kept, so a long
   multi-session sale keeps this week's dates */
export function wkFromApi(list, center, radiusMi, nowMs) {
  const out = [], seen = Object.create(null), r = Number(radiusMi) || WK_RADIUS_MI;
  for (const s of Array.isArray(list) ? list.slice(0, 600) : []) {
    if (!s || typeof s !== "object") continue;
    const id = String(s.id == null ? "" : s.id);
    if (!/^\d{3,12}$/.test(id) || seen[id]) continue;
    if (s.isMarketplaceSale || /^Online/i.test(String(s.typeName || "")) || s.isPublished === false || s.includeInList === false) continue;
    const url = wkOwnUrl(s.url, id);
    if (!url) continue;   /* no link of its own, never shown */
    const lat = Number(s.latitude), lon = Number(s.longitude);
    if (!isFinite(lat) || !isFinite(lon) || (!lat && !lon)) continue;
    const dist = haversineMi(center, { lat: lat, lng: lon });
    if (!(dist <= r)) continue;
    const past = nowMs ? nowMs - 3600000 : 0;
    let days = (Array.isArray(s.dates) ? s.dates : []).map(d => ({ s: wkTime(d && d.utcStartDate), e: wkTime(d && d.utcEndDate) })).filter(d => d.s && d.e && d.e > d.s && d.e > past);
    if (!days.length) { const a = wkTime(s.firstUtcStartDate), b = wkTime(s.lastUtcEndDate); if (a && b && b > a) days = [{ s: a, e: b, span: 1 }]; }
    if (!days.length) continue;
    days.sort((x, y) => x.s - y.s);
    if (past && !days.some(d => d.e > past)) continue;   /* over */
    seen[id] = 1;
    const co = txt(s.orgName, 80);
    out.push({ id: id, name: txt(s.name, 120) || "Estate sale", url: url, city: txt(s.cityName || s.postalCodeCityName, 40), st: txt(s.stateCode, 2).toUpperCase(),
      co: /^private listing$/i.test(co) ? "" : co, lat: lat, lon: lon, dist: Math.round(dist * 10) / 10, type: typeLabel(s.typeName),
      pics: Number(s.pictureCount) > 0 ? Math.floor(Number(s.pictureCount)) : 0, days: days.slice(0, 14) });
  }
  return out;
}

/* the city-page list (esParse items, v103) in the same shape, for when the list above does not answer */
export function wkFromCity(items, center, radiusMi) {
  const out = [], r = Number(radiusMi) || WK_RADIUS_MI;
  for (const x of Array.isArray(items) ? items : []) {
    if (!x || /^Online/i.test(String(x.type || ""))) continue;
    const url = wkOwnUrl(x.url, x.id);
    if (!url || !(x.lat && x.lon)) continue;
    const dist = haversineMi(center, { lat: x.lat, lng: x.lon });
    if (!(dist <= r)) continue;
    const a = Date.parse(x.start || ""), b = Date.parse(x.end || "");
    if (!(a > 0 && b > a)) continue;
    out.push({ id: String(x.id), name: txt(x.name, 120) || "Estate sale", url: url, city: txt(x.city, 40), st: txt(x.st, 2), co: "", lat: x.lat, lon: x.lon,
      dist: Math.round(dist * 10) / 10, type: txt(x.type, 40), pics: 0, days: [{ s: a, e: b, span: 1 }] });
  }
  return out;
}

/* ---- the week, in a time zone ---- */
function parts(ms, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date(ms));
  const g = t => (p.find(x => x.type === t) || {}).value || "";
  return { y: Number(g("year")), m: Number(g("month")), d: Number(g("day")), h: Number(g("hour")) % 24, mi: Number(g("minute")), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday").slice(0, 3)) };
}
function offsetMs(ms, tz) { const p = parts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000; }
/* the instant of a local clock time in tz */
function localAt(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);   /* again at the answer, for a day that starts on the other side of a clock change */
  return t;
}
function localMidnight(y, m, d, tz) { return localAt(y, m, d, 0, 0, tz); }
/* v205 (Matt, 2026-10-31): the next 7 days, today 00:00 to the 7th day after at 00:00 in tz (today through today+6).
   { from, to, tz } in ms. The name stays from the weekend version. */
export const WK_DAYS = 7;
export function wkWindow(nowMs, tz) {
  const p = parts(nowMs, tz), end = new Date(Date.UTC(p.y, p.m - 1, p.d) + WK_DAYS * DAY_MS);
  return { from: localMidnight(p.y, p.m, p.d, tz), to: localMidnight(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), tz), tz: tz };
}
/* ms with its local clock moved onto the local day of dayMs (both in tz) */
function sameClockOn(ms, dayMs, tz) {
  const c = parts(ms, tz), d = parts(dayMs, tz);
  return localAt(d.y, d.m, d.d, c.h, c.mi, tz);
}
/* the days of a sale still to come inside the window ([] = not open in the next 7 days, or already over). v205 review: a
   sale known only as one span (first start to last end) is clipped to the window by whole local days, so it keeps its
   opening and closing clock (Mon 9 AM to the next Sunday 4 PM, seen on a Thursday, reads Thu 9 AM to Wed 4 PM) and
   never reaches past the 7th day; a span with nothing left inside the window is dropped. */
export function wkDaysIn(sale, win, nowMs) {
  const lo = Math.max(win.from, nowMs || 0), tz = win.tz || "UTC";
  const mins = ms => { const p = parts(ms, tz); return p.h * 60 + p.mi; };
  return (sale.days || []).map(d => {
    if (!d || !d.span) return d;
    let s = d.s, e = d.e;
    if (s < win.from) s = sameClockOn(d.s, win.from, tz);
    /* v205 review 2: the closing clock on day 7, unless that falls at or before the opening (a span ending at midnight,
       or one that opens on day 7 and closes earlier in the day on a later day): then the end of day 7 */
    if (e > win.to) { e = sameClockOn(d.e, win.to - 1, tz); if (e <= s || mins(d.e) <= mins(d.s)) e = win.to - 60000; }
    if (s >= e && s !== d.s) s = win.from;   /* moved onto today it would open after it closes: open from today's start */
    return s === d.s && e === d.e ? d : { s: s, e: e, span: 1 };
  }).filter(d => d && d.e > d.s && d.e > lo && d.s < win.to);
}

const D3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], M3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function clock(p) { const h = p.h % 12 || 12; return h + (p.mi ? ":" + String(p.mi).padStart(2, "0") : "") + " " + (p.h < 12 ? "AM" : "PM"); }
function dayKey(ms, tz) { const p = parts(ms, tz); return p.y + "-" + p.m + "-" + p.d; }
/* the entries of the first WK_DAYS distinct local days (two sessions a day stay together) */
function capDays(days, tz) {
  const seen = Object.create(null), out = [];
  for (const d of days) { const k = dayKey(d.s, tz); if (!seen[k]) { if (Object.keys(seen).length >= WK_DAYS) break; seen[k] = 1; } out.push(d); }
  return out;
}
function dayName(p) { return D3[p.wd] + " " + M3[p.m - 1] + " " + p.d; }
/* "Fri Oct 30, 10 AM–5 PM · Sat Oct 31, 10 AM–2 PM", in tz; a sale known only by its first start and last end reads as a
   span. v205: a week can hold more days; past 4, "· +2 more days" */
export function wkHours(days, tz) {
  const seen = Object.create(null);
  (days || []).slice(0, 4).forEach(d => { seen[dayKey(d.s, tz)] = 1; });
  const more = Object.keys((days || []).slice(4).reduce((o, d) => { const k = dayKey(d.s, tz); if (!seen[k]) o[k] = 1; return o; }, {})).length;
  return (days || []).slice(0, 4).map(d => {
    const a = parts(d.s, tz), b = parts(d.e, tz);
    const same = a.y === b.y && a.m === b.m && a.d === b.d;
    return same ? dayName(a) + ", " + clock(a) + "\u2013" + clock(b) : dayName(a) + " " + clock(a) + " \u2013 " + dayName(b) + " " + clock(b);
  }).join(" \u00b7 ") + (more > 0 ? " \u00b7 +" + more + " more day" + (more === 1 ? "" : "s") : "");
}

/* ---- the sale's own page ---- */
function jsonBlocks(html) {
  const out = [];
  String(html || "").replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, body) => {
    if (/application\/(ld\+)?json/i.test(attrs)) { try { out.push(JSON.parse(body.trim().replace(/^<!--|-->$/g, ""))); } catch (e) {} }
    return m;
  });
  return out;
}
/* { desc, caps, img, addr, lat, lng, addrAt } from a sale page: the app's own record of the sale (plainTextDescription,
   pictures, latitude/longitude) or else its SaleEvent block. caps are the photo captions the seller typed, when there are
   any. v205 (Plan my week): img is the page's own cover photo (its first og:image) when it has one; addr is the
   SaleEvent's location.address.streetAddress ("" while the company keeps it hidden: showAddress false, or not posted
   yet), lat/lng the record's own position, addrAt when the address is due to be shown (ms, 0 unknown). */
const ES_PIC = /^https:\/\/picturescdn\.estatesales\.net\/[^\s"'<>]+$/;
function ogImage(html) {
  const m = /<meta\b[^>]*\bproperty=["']og:image["'][^>]*>/i.exec(String(html || ""));
  const c = m ? /\bcontent=["']([^"']+)["']/i.exec(m[0]) : null;
  const u = c ? c[1].replace(/&amp;/g, "&").trim() : "";
  return ES_PIC.test(u) ? u : "";
}
function num(v) { const n = Number(v); return isFinite(n) && n !== 0 && v !== "" && v != null ? n : null; }
export function wkDetailParse(html, id) {
  const blocks = jsonBlocks(html), og = ogImage(html);
  let rec = null, ld = null;
  const walk = (v, d) => {
    if (rec || d > 10 || v == null || typeof v !== "object") return;
    if (Array.isArray(v)) { v.slice(0, 40).forEach(x => walk(x, d + 1)); return; }
    if (String(v.id) === String(id) && (v.plainTextDescription != null || Array.isArray(v.pictures) || v.htmlDescription != null)) { rec = v; return; }
    if (!ld && /SaleEvent/.test(String(v["@type"] || "")) && new RegExp("/" + id + "/?$").test(String(v.url || ""))) ld = v;
    Object.keys(v).slice(0, 120).forEach(k => walk(v[k], d + 1));
  };
  blocks.forEach(b => walk(b, 0));
  if (!rec && !ld && !og) return null;
  const desc = txt((rec && (rec.plainTextDescription || rec.htmlDescription)) || (ld && ld.description) || "", 1500);
  const caps = [];
  for (const p of (rec && Array.isArray(rec.pictures) ? rec.pictures : []).slice(0, 300)) {
    if (!p || typeof p !== "object") continue;
    for (const k of ["description", "caption", "title", "altText"]) { const c = txt(p[k], 140); if (c && caps.indexOf(c) === -1) { caps.push(c); break; } }
    if (caps.length >= 80) break;
  }
  const img0 = (rec && rec.mainPicture && rec.mainPicture.thumbnailUrl) || (ld && (Array.isArray(ld.image) ? ld.image[0] : ld.image)) || "";
  const img = og || (ES_PIC.test(String(img0)) ? String(img0) : "");
  /* the street address: the SaleEvent's PostalAddress, else the record's own address line; hidden means pending */
  const la = ld && ld.location && typeof ld.location === "object" ? ld.location.address : null;
  const li = rec && rec.locationInfo && typeof rec.locationInfo === "object" ? rec.locationInfo : null;
  let addr = txt((la && typeof la === "object" && la.streetAddress) || (li && li.address && li.address.addressLine1) || "", 90);
  if (!/\d/.test(addr) || !/[A-Za-z]/.test(addr) || (rec && rec.showAddress === false) || (li && li.showAddress === false)) addr = "";
  const geo = ld && ld.geo && typeof ld.geo === "object" ? ld.geo : null;
  let lat = num(rec && rec.latitude), lng = num(rec && rec.longitude);
  if (lat == null || lng == null) { lat = num(li && li.latitude); lng = num(li && li.longitude); }
  if (lat == null || lng == null) { lat = num(geo && geo.latitude); lng = num(geo && geo.longitude); }
  if (lat == null || lng == null || Math.abs(lat) > 90 || Math.abs(lng) > 180) { lat = null; lng = null; }
  const addrAt = wkTime((rec && rec.utcShowAddressAfter) || (li && li.utcShowAddressAfter) || "");
  return { desc: desc, caps: caps, img: img, addr: addr, lat: lat, lng: lng, addrAt: addr ? 0 : addrAt };
}

/* ---- hunts against a sale ---- */
const STOP = { vintage: 1, antique: 1, antiques: 1, old: 1, rare: 1, the: 1, and: 1, of: 1, for: 1, with: 1, a: 1, an: 1, mcm: 1, retro: 1, lot: 1, set: 1, estate: 1, sale: 1, original: 1, authentic: 1, signed: 1, htf: 1, vtg: 1 };
const words = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
/* the words of a hunt that must all be there ("Fire-King jadeite" -> fire, king, jadeite) */
export function wkTerms(hunt) {
  const all = words(hunt).split(" ").filter(Boolean), keep = all.filter(w => !STOP[w] && (w.length > 2 || /\d/.test(w)));
  return (keep.length ? keep : all.filter(w => w.length > 2 && !/^(the|and|for|with)$/.test(w))).slice(0, 6);   /* "vintage" alone still hunts; "the" never does */
}
function has(text, w) {
  const stem = w.replace(/(es|s)$/, "");
  const re = new RegExp("(^| )(" + w + "|" + (stem.length > 2 ? stem + "|" + stem + "s|" + stem + "es" : w) + ")( |$)");
  return re.test(text);
}
/* the first hunt every one of whose words is in the sale's title, description or photo captions: { hunt, where } or null */
export function wkMatch(sale, detail, hunts) {
  const where = [["the title", " " + words(sale.name) + " "], ["the description", " " + words(detail && detail.desc) + " "], ["a photo caption", " " + words(detail && detail.caps && detail.caps.join(" | ")) + " "]];
  for (const h of (Array.isArray(hunts) ? hunts : []).slice(0, WK_HUNTS_MAX)) {
    const t = wkTerms(h);
    if (!t.length) continue;
    const all = " " + where.map(x => x[1]).join(" ") + " ";
    if (!t.every(w => has(all, w))) continue;
    const spot = where.find(x => t.every(w => has(x[1], w))) || where.find(x => has(x[1], t[0]));
    return { hunt: txt(h, 60), where: spot ? spot[0] : "the listing", words: t };
  }
  return null;
}
const GOOD = /\b(vintage|antique|mid[- ]century|mcm|pyrex|fire[- ]?king|sterling|signed|art|pottery|stoneware|glass|crystal|china|jewelry|records|vinyl|toys|primitive|collect|furniture|tools|books|coins|militaria|clocks|lamps|rugs|paintings|designer)/i;
/* a short line that says why a sale is worth the drive: where a hunt matched, else its best sentence */
export function wkStandout(sale, detail, match) {
  const desc = txt(detail && detail.desc, 1500);
  const cut = s => { s = txt(s, 400); return s.length > 110 ? s.slice(0, 108).replace(/\s+\S*$/, "") + "\u2026" : s; };
  if (match && match.where === "a photo caption" && detail && detail.caps) {
    const c = detail.caps.find(x => match.words.every(w => has(" " + words(x) + " ", w)));
    if (c) return cut("Photo: " + c);
  }
  if (desc) {
    const sents = desc.split(/(?<=[.!?])\s+|\s{2,}|\s[\u2022|*]\s/).map(s => s.trim()).filter(s => s.length > 12);
    if (match) {
      const s = sents.find(x => match.words.some(w => has(" " + words(x) + " ", w)));
      if (s) return cut(s);
    }
    const g = sents.find(x => GOOD.test(x) && !/^(cash|credit|terms|please|no early|parking|numbers)/i.test(x));
    if (g || sents[0]) return cut(g || sents[0]);
  }
  return sale.pics ? sale.pics + " photos posted" : (sale.type || "");
}

/* one sale as the page and the email see it. v205 (Plan my week): its position (the page's own when read), street
   address ("" = address pending, with addrAt when it is due), and its open days still to come in the next 7 days (ms) */
export function wkRowOf(s, det, match, days, tz) {
  const addr = (det && det.addr) || "", own = det && typeof det.lat === "number" && typeof det.lng === "number";
  return { id: s.id, name: s.name, url: s.url, city: s.city, st: s.st, co: s.co, dist: s.dist, type: s.type,
    at: days[0].s, start: new Date(days[0].s).toISOString(), hours: wkHours(days, tz), standout: wkStandout(s, det, match), img: (det && det.img) || "",
    match: match ? { hunt: match.hunt, where: match.where } : null,
    lat: own ? det.lat : s.lat, lng: own ? det.lng : s.lon, addr: addr, addrAt: !addr && det && det.addrAt ? det.addrAt : 0,
    days: capDays(days, tz || "UTC").map(d => (d.span ? { s: d.s, e: d.e, span: 1 } : { s: d.s, e: d.e })) };
}
/* the list a person sees: Top picks (a hunt matched) first, then the rest, at most cap in all. sales are already the
   ones open in the window, details is id -> detail (null when not fetched), gone is id -> 1 for dead links. */
export function wkBuild(sales, details, hunts, win, nowMs, tz, cap) {
  cap = cap || WK_CAP;
  const picks = [], rest = [];
  for (const s of sales) {
    if (details && details.gone && details.gone[s.id]) continue;
    const days = wkDaysIn(s, win, nowMs);
    if (!days.length) continue;
    const det = details && details.by ? details.by[s.id] || null : null;
    const match = wkMatch(s, det, hunts);
    (match ? picks : rest).push(wkRowOf(s, det, match, days, tz));
  }
  const by = (a, b) => a.at - b.at || a.dist - b.dist;
  picks.sort(by); rest.sort(by);
  const p = picks.slice(0, cap);
  return { picks: p, rest: rest.slice(0, Math.max(0, cap - p.length)), total: picks.length + rest.length };
}
/* the sales whose pages are worth reading: open in the next 7 days, nearest first */
export function wkToRead(sales, win, nowMs, max) {
  return sales.filter(s => wkDaysIn(s, win, nowMs).length).sort((a, b) => a.dist - b.dist).slice(0, max || WK_DETAIL_MAX);
}
/* hunts as sent by the page (h=a|b|c) or kept on a member: trimmed, no duplicates, at most WK_HUNTS_MAX */
export function wkHunts(v) {
  const list = Array.isArray(v) ? v : String(v || "").split("|"), out = [], seen = Object.create(null);
  for (const h of list) { const t = txt(h, 60); const k = t.toLowerCase(); if (t && !seen[k] && wkTerms(t).length) { seen[k] = 1; out.push(t); } if (out.length >= WK_HUNTS_MAX) break; }
  return out;
}

/* ---- v205: Plan my week ----
   The daily email's "Plan my week" (its estate sales section) opens the Prowl page with the sale ids in its address (no
   app, no sign-in): ?wkplan=<ids>&wkp=<top pick ids>&wkzip=<the ZIP the sweep used>&wkx=<expiry, s>&wks=<signature>. The page asks
   GET /weekend/plan for those sales (wkPlanRows) and plans the days itself. WK_PLAN_MAX ids at most. */
export const WK_PLAN_MAX = 12;
/* "1,2,3" (or an array) -> sale ids, digits only, no repeats, at most WK_PLAN_MAX */
export function wkPlanIds(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(/[,\s|]+/), out = [];
  for (const x of list) { const id = String(x == null ? "" : x).trim(); if (/^\d{3,12}$/.test(id) && out.indexOf(id) === -1) out.push(id); if (out.length >= WK_PLAN_MAX) break; }
  return out;
}
/* what the link's signature covers, in one fixed order */
export function wkPlanMsg(ids, picks, zip, exp) { return "prowl-wkplan-v1|" + String(zip || "") + "|" + ids.join(",") + "|" + picks.join(",") + "|" + exp; }
/* the link itself: base is the Prowl page; sig may be "" (then it opens only while estate sales are public) */
export function wkPlanUrl(base, ids, picks, zip, exp, sig) {
  return base + "?wkplan=" + ids.join(",") + (picks.length ? "&wkp=" + picks.join(",") : "") + (/^\d{5}$/.test(String(zip || "")) ? "&wkzip=" + zip : "") + "&wkx=" + exp + (sig ? "&wks=" + sig : "");
}
/* the sweep's sales for a plan link, in the link's order: { sales, missing } (missing: ended, gone or no longer listed) */
export function wkPlanRows(items, details, ids, picks, win, nowMs, tz) {
  const byId = Object.create(null), sales = [], missing = [];
  for (const s of Array.isArray(items) ? items : []) if (s && s.id) byId[s.id] = s;
  for (const id of ids) {
    const s = byId[id];
    if (!s || (details && details.gone && details.gone[id])) { missing.push(id); continue; }
    const days = wkDaysIn(s, win, nowMs);
    if (!days.length) { missing.push(id); continue; }
    const det = details && details.by ? details.by[id] || null : null;
    const row = wkRowOf(s, det, null, days, tz);
    row.pick = picks.indexOf(id) !== -1;
    sales.push(row);
  }
  return { sales: sales, missing: missing };
}
