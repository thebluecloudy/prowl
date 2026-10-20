/* v132: NEAR ME on the worker. Around You (the shops near where you stand) and Road Trip (the shops worth a stop
   between here and a destination), the group trip record and the finds feed. This module is pure: no fetch, no env,
   no KV. index.js talks to Google (Places, Routes, Geocoding) and R2 and hands the answers here.

   Ranking (the spec, §3): a size signal first (square feet, dealer or booth count, "mall"/"warehouse" in the name),
   then the rating weighted by how many reviews it rests on, then distance (Around You) or detour (Road Trip).
   Hours are never copy: the page gets each place's weekly periods and UTC offset and works out OPEN NOW / CLOSED when
   it draws the card; hoursForDay and openAt here are the same arithmetic, for the worker's own answer and the tests.
   Road Trip clusters the stops of one town into one route anchor (the strongest stop) with the rest nested under it,
   and the Maps export carries the anchors only, with the origin as a town name, never a street. */

export const DETOUR_MIN = 10;            /* a stop may cost this many minutes off the route (internal, never shown) */
export const DETOUR_KMH = 40;            /* the speed assumed off the highway, for turning distance into minutes */
export const MAPS_WAYPOINTS = 9;         /* Google Maps directions links take about nine waypoints */
export const FINDS_GRACE_DAYS = 7;       /* find photos live this long after the trip closes (the spec's default) */
export const TRIP_DAYS_MAX = 14;         /* a trip day may be at most this far ahead */
export const CLUSTER_WALK_KM = 0.6;      /* shops this close are one walkable cluster even across a town line */
export const CORRIDOR_STEP_KM = 50;      /* the corridor is searched in circles this far apart ... */
export const CORRIDOR_RADIUS_M = 30000;  /* ... each this wide (Google's circle bias caps at 50 km); one search a circle */
/* v135 (the owner: "maybe someone wants to see records, toys, antique or thrift stores"): what to look for, as the
   chips on the page. The default is the spec's three. One Google text query a circle carries every picked kind. */
export const CATS = { antiques: "antique stores and antique malls", vintage: "vintage stores", thrift: "thrift stores", records: "record stores", books: "used book stores", toys: "vintage toy and collectibles shops", flea: "flea markets" };
export const CATS_DEFAULT = ["antiques", "vintage", "thrift"];
export function catsParse(s) {
  const want = String(s || "").toLowerCase().split(/[\s,]+/).filter(Boolean), out = Object.keys(CATS).filter((k) => want.indexOf(k) !== -1);
  return out.length ? out : CATS_DEFAULT.slice();
}
/* the picked kinds as n query strings (Around You asks twice, a trip circle once) */
export function catsQueries(cats, n) {
  const phrases = catsParse(cats.join ? cats.join(",") : cats).map((k) => CATS[k]), out = [];
  n = Math.max(1, Math.min(n || 1, phrases.length));
  for (let i = 0; i < n; i++) out.push(phrases.filter((p, j) => j % n === i).join(", "));
  return out;
}
export const NEAR_RADIUS_M = 15000, NEAR_KEEP_KM = 40, CORRIDOR_CENTERS_MAX = 24;   /* Around You: Google answers beyond the circle; keep only what is really near */
export const TRIP_STOPS_MAX = 40, TRIP_NESTED_MAX = 6, NEAR_MAX = 24;
export const FIND_IMG_MAX = 600 * 1024;  /* a find photo arrives already downscaled by the page; refuse anything bigger */
export const FINDS_MAX = 200;            /* finds kept per trip */
export const TRIP_MEMBERS_MAX = 24;

/* ---------- geometry ---------- */
export function haversineKm(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
/* Google's encoded polyline -> [{ lat, lng }] */
export function decodePolyline(str) {
  const out = []; let i = 0, lat = 0, lng = 0;
  str = String(str || "");
  while (i < str.length) {
    for (const which of ["lat", "lng"]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= str.length);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (which === "lat") lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}
/* the route point closest to p: its index (progress along the route) and the distance to it */
export function nearestOnRoute(route, p) {
  let best = { idx: -1, km: Infinity };
  for (let i = 0; i < route.length; i++) {
    const km = haversineKm(route[i], p);
    if (km < best.km) best = { idx: i, km: km };
  }
  return best;
}
export function detourMinutes(km) { return Math.round(km * 2 / DETOUR_KMH * 60 * 10) / 10; }
/* circles to search along the route, one every CORRIDOR_STEP_KM, the first and last included */
export function corridorCenters(route, stepKm) {
  stepKm = stepKm || CORRIDOR_STEP_KM;
  const out = []; let acc = stepKm;
  for (let i = 0; i < route.length; i++) {
    if (i > 0) acc += haversineKm(route[i - 1], route[i]);
    if (acc >= stepKm) { out.push({ lat: route[i].lat, lng: route[i].lng }); acc = 0; }
  }
  const last = route[route.length - 1];
  if (last && (!out.length || haversineKm(out[out.length - 1], last) > stepKm / 2)) out.push({ lat: last.lat, lng: last.lng });
  return out;
}

/* ---------- places ---------- */
/* v133 (the owner, on a thrift "market" ranked above the malls: "big antique stores, good to stop at"): only the words
   that mean a big antiques place count; "market" or "gallery" alone do not */
const SIZE_WORD = /\b(antiques?\s+(mall|center|centre|gallery|warehouse|emporium|market|exchange|village|barn|district|row)|vintage\s+(mall|market|warehouse|emporium)|flea\s+market|antiques?\s+(&|and)\s+collectibles\s+mall|emporium|warehouse|co-?op)\b/i;
const THRIFT = /\b(thrift|goodwill|salvation\s+army|value\s+world|savers|st\.?\s+vincent|resale|habitat\s+restore|restore)\b/i;
export function isThrift(place) { return /thrift/i.test(String(place.kind || "")) || THRIFT.test(String(place.name || "")); }
const DEALERS = /(\d{2,4})\+?\s*(dealers?|vendors?|booths?|shops?|consignors?|sellers?)/i;
const SQFT = /([\d,]{4,7})\s*(sq\.?\s*ft|square\s*f(ee|oo)t)/i;
/* 0: a shop; 1: reads like a mall or warehouse; 2: tens of dealers or 10,000+ sq ft; 3: a hundred dealers or 30,000+ sq ft */
export function sizeTier(place) {
  const text = [place.name, place.summary].filter(Boolean).join(" . ");
  let tier = SIZE_WORD.test(text) ? 1 : 0;
  const d = DEALERS.exec(text); if (d) { const n = Number(d[1]); if (n >= 100) tier = Math.max(tier, 3); else if (n >= 20) tier = Math.max(tier, 2); else tier = Math.max(tier, 1); }
  const s = SQFT.exec(text); if (s) { const n = Number(String(s[1]).replace(/,/g, "")); if (n >= 30000) tier = Math.max(tier, 3); else if (n >= 10000) tier = Math.max(tier, 2); else if (n >= 3000) tier = Math.max(tier, 1); }
  /* no number in the text: a crowd of reviews is the size signal Google does give, for an antiques or vintage place
     (a thrift chain draws reviews for being a chain, not for being a destination) */
  if (!isThrift(place)) { const n = Number(place.n) || 0; if (n >= 1000) tier = Math.max(tier, 2); else if (n >= 300) tier = Math.max(tier, 1); }
  return tier;
}
/* the one-line differentiator on a card: "120 dealers", "28,000 sq ft", "Antique mall", or the category */
export function differentiator(place) {
  const text = [place.name, place.summary].filter(Boolean).join(" . ");
  const d = DEALERS.exec(text); if (d) return d[1] + " " + (/^booth/i.test(d[2]) ? "booths" : "dealers");
  const s = SQFT.exec(text); if (s) return Number(String(s[1]).replace(/,/g, "")).toLocaleString("en-US") + " sq ft";
  if (/antique\s+mall/i.test(text)) return "Antique mall";
  if (/warehouse/i.test(text)) return "Warehouse";
  return place.kind || "";
}
/* a rating on few reviews pulls toward 4.0; 4.8 on 900 reviews beats 5.0 on 3 */
export function ratingScore(rating, n) {
  rating = Number(rating) || 0; n = Number(n) || 0;
  if (!rating) return 0;
  return Math.round((rating * n + 4.0 * 20) / (n + 20) * 100) / 100;
}
/* size, then rating weighted by reviews, then the near measure (km, or detour minutes) ascending */
export function rankPlaces(list) {
  return list.slice().sort((a, b) => {
    const ta = sizeTier(a), tb = sizeTier(b);
    if (ta !== tb) return tb - ta;
    const ra = ratingScore(a.rating, a.n), rb = ratingScore(b.rating, b.n);
    if (Math.abs(ra - rb) >= 0.1) return rb - ra;
    return (a.near == null ? 1e9 : a.near) - (b.near == null ? 1e9 : b.near);
  });
}
/* the town and state out of Google address components (Places New: { longText, shortText, types }; Geocoding:
   { long_name, short_name, types }). Never a street. */
export function townOf(components) {
  let town = "", state = "", fallback = "";
  for (const c of Array.isArray(components) ? components : []) {
    const types = c.types || [], long = c.longText || c.long_name || "", short = c.shortText || c.short_name || "";
    if (types.indexOf("locality") !== -1 || types.indexOf("postal_town") !== -1) town = town || long;
    else if (!fallback && (types.indexOf("sublocality_level_1") !== -1 || types.indexOf("administrative_area_level_3") !== -1 || types.indexOf("neighborhood") !== -1)) fallback = long;
    if (types.indexOf("administrative_area_level_1") !== -1) state = short || long;
  }
  return { town: town || fallback, state: state };
}
export function townLabel(t) { return t && t.town ? t.town + (t.state ? ", " + t.state : "") : (t && t.state) || ""; }
/* "123 Main St, Maumee, OH 43537, USA" -> "Maumee, OH" (the last resort when there are no components) */
export function townFromAddress(addr) {
  const parts = String(addr || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  let i = parts.length - 1;
  if (/^(usa|united states|us|canada)$/i.test(parts[i])) i--;
  if (i < 1) return "";
  const st = parts[i].replace(/\s*\d{5}(-\d{4})?\s*$/, "").trim(), town = parts[i - 1];
  if (/^\d/.test(town)) return "";
  return st ? town + ", " + st : town;
}
/* a Places (New) result -> Prowl's place. Only what a card needs; the photo is a name the worker serves by proxy. */
export function normalizePlace(p) {
  if (!p || typeof p !== "object" || !p.id) return null;
  const t = townOf(p.addressComponents), loc = p.location || {};
  const town = t.town || townFromAddress(p.formattedAddress || p.shortFormattedAddress).split(",")[0] || "";
  const hours = p.regularOpeningHours || null;
  const photo = Array.isArray(p.photos) && p.photos[0] && p.photos[0].name ? String(p.photos[0].name) : "";
  const label = String(p.primaryTypeDisplayName && p.primaryTypeDisplayName.text || "") + " " + String(p.primaryType || "") + " " + String(p.displayName && p.displayName.text || "");
  const kind = /antique/i.test(label) ? "Antiques" : /thrift|goodwill|salvation/i.test(label) ? "Thrift" : /record|vinyl/i.test(label) ? "Records" : /\bbook/i.test(label) ? "Books"
    : /\btoy/i.test(label) ? "Toys" : /flea/i.test(label) ? "Flea market" : /vintage/i.test(label) ? "Vintage" : String(p.primaryTypeDisplayName && p.primaryTypeDisplayName.text || "");
  return {
    id: String(p.id), name: String(p.displayName && p.displayName.text || "").slice(0, 120),
    town: town, state: t.state || (townFromAddress(p.formattedAddress).split(", ")[1] || ""),
    lat: Number(loc.latitude), lng: Number(loc.longitude),
    rating: Number(p.rating) || 0, n: Number(p.userRatingCount) || 0,
    summary: String((p.editorialSummary && p.editorialSummary.text) || (p.generativeSummary && p.generativeSummary.overview && p.generativeSummary.overview.text) || "").slice(0, 300),
    kind: kind, photo: photo, url: /^https:\/\/(www\.)?google\.com\/maps\//.test(String(p.googleMapsUri || "")) ? String(p.googleMapsUri) : "",
    hours: hours ? { periods: Array.isArray(hours.periods) ? hours.periods.map(cleanPeriod).filter(Boolean) : [], days: Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions.map((s) => String(s).slice(0, 80)) : [], offset: Number.isFinite(Number(p.utcOffsetMinutes)) ? Number(p.utcOffsetMinutes) : null } : null,
  };
}
function cleanPeriod(pr) {
  if (!pr || !pr.open) return null;
  const pt = (x) => x && Number.isFinite(Number(x.day)) ? { day: Number(x.day), hour: Number(x.hour) || 0, minute: Number(x.minute) || 0 } : null;
  const o = pt(pr.open); if (!o) return null;
  return { open: o, close: pt(pr.close) };
}
/* a place's row of cards, the fields the page draws (and nothing a member typed) */
export function placeCard(p, near) {
  return { id: p.id, name: p.name, town: townLabel(p), why: differentiator(p), rating: p.rating, n: p.n, photo: p.photo ? "/pp?n=" + encodeURIComponent(p.photo) : "",
    url: pinUrl(p), lat: p.lat, lng: p.lng, hours: p.hours, near: near == null ? (p.near == null ? null : p.near) : near };
}
export function pinUrl(p) {
  if (p.url) return p.url;
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(p.name + (p.town ? " " + p.town : "")) + "&query_place_id=" + encodeURIComponent(p.id);
}

/* ---------- hours ---------- */
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function fmtTime(h, m) { const ap = h >= 12 ? "PM" : "AM", hh = h % 12 || 12; return hh + (m ? ":" + String(m).padStart(2, "0") : "") + " " + ap; }
/* the hours for one weekday (0 = Sunday): open there at all, and the text to print. A period that opens on that day
   counts; a period with no close is open around the clock. */
export function hoursForDay(hours, day) {
  if (!hours || !Array.isArray(hours.periods)) return { open: null, text: "" };
  day = ((Number(day) % 7) + 7) % 7;
  const ps = hours.periods.filter((p) => p.open && p.open.day === day);
  if (!ps.length) {
    if (hours.periods.length === 1 && !hours.periods[0].close) return { open: true, text: "Open 24 hours" };
    const d = (hours.days || []).find((s) => new RegExp("^" + DAY_NAMES[day], "i").test(s));
    return { open: false, text: d ? d.replace(/^[A-Za-z]+:\s*/, "") : "Closed" };
  }
  const d = (hours.days || []).find((s) => new RegExp("^" + DAY_NAMES[day], "i").test(s));
  if (d) return { open: true, text: d.replace(/^[A-Za-z]+:\s*/, "").replace(/ | /g, " ") };
  return { open: true, text: ps.map((p) => fmtTime(p.open.hour, p.open.minute) + (p.close ? "–" + fmtTime(p.close.hour, p.close.minute) : "")).join(", ") };
}
/* open at this instant? null when the hours or the offset are unknown. Overnight closes (Fri 22:00 -> Sat 02:00) count. */
export function openAt(hours, when) {
  if (!hours || !Array.isArray(hours.periods) || !hours.periods.length || hours.offset == null) return null;
  const local = new Date((when instanceof Date ? when.getTime() : Number(when)) + hours.offset * 60000);
  const day = local.getUTCDay(), mins = local.getUTCHours() * 60 + local.getUTCMinutes();
  for (const p of hours.periods) {
    if (!p.close) return true;
    const o = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let c = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    let t = day * 1440 + mins;
    if (c <= o) c += 7 * 1440;                 /* wraps past Saturday night */
    if (t < o) t += 7 * 1440;
    if (t >= o && t < c) return true;
  }
  return false;
}

/* ---------- Road Trip ---------- */
/* the places inside the detour budget, each with its progress along the route and its detour in minutes */
export function alongRoute(places, route, budgetMin) {
  budgetMin = budgetMin || DETOUR_MIN;
  const out = [];
  for (const p of places) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const n = nearestOnRoute(route, p);
    const det = detourMinutes(n.km);
    if (det <= budgetMin) out.push(Object.assign({}, p, { near: det, prog: n.idx }));
  }
  return out;
}
/* one anchor per town (the strongest stop), the rest nested; walkable neighbours join the cluster whatever their
   town says; clusters in drive order */
export function clusterStops(places) {
  const groups = [];
  const key = (p) => (p.town + "|" + p.state).toLowerCase();
  for (const p of rankPlaces(places)) {
    let g = groups.find((x) => key(x.anchor) === key(p) && p.town);
    if (!g) g = groups.find((x) => haversineKm(x.anchor, p) <= CLUSTER_WALK_KM);
    if (g) g.nested.push(p); else groups.push({ anchor: p, nested: [] });
  }
  groups.sort((a, b) => (a.anchor.prog || 0) - (b.anchor.prog || 0) || (a.anchor.near || 0) - (b.anchor.near || 0));
  return groups.map((g) => Object.assign(placeCard(g.anchor), { nested: g.nested.slice(0, TRIP_NESTED_MAX).map((p) => placeCard(p)) }));
}
/* the one directions link: origin town, anchors as waypoints in drive order (nine at most), destination */
export function mapsDirUrl(originTown, anchors, destination) {
  const wp = (anchors || []).slice(0, MAPS_WAYPOINTS).map((a) => a.name + (a.town ? ", " + a.town : "")).join("|");
  return "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=" + encodeURIComponent(String(originTown || "")) +
    "&destination=" + encodeURIComponent(String(destination || "")) + (wp ? "&waypoints=" + encodeURIComponent(wp) : "");
}
/* does a piece of text carry a street address? (shared artifacts must not) */
export function hasStreet(s) { return /\b\d{1,6}\s+[A-Za-z0-9.'-]+(\s+[A-Za-z0-9.'-]+){0,3}\s+(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|ct|court|way|hwy|highway|pkwy|parkway|pl|place|trail|trl|cir|circle)\b\.?/i.test(String(s || "")); }

/* ---------- the trip record (KV, trip:<id>) ---------- */
export function tripDay(s, now) {
  const today = new Date(now || Date.now()).toISOString().slice(0, 10);
  s = String(s || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
  const d = Date.parse(s + "T12:00:00Z"), t = Date.parse(today + "T12:00:00Z");
  if (!(d >= t - 86400000 && d <= t + TRIP_DAYS_MAX * 86400000)) return today;
  return s;
}
export function weekdayOf(day) { return new Date(day + "T12:00:00Z").getUTCDay(); }
/* when a trip closes: the end of its day (UTC + a day, so a late evening anywhere in the US is still inside) */
export function tripCloses(day) { return new Date(Date.parse(day + "T00:00:00Z") + 2 * 86400000).toISOString(); }
export function tripExpires(closes) { return new Date(Date.parse(closes) + FINDS_GRACE_DAYS * 86400000).toISOString(); }
export function tripExpired(trip, now) { return !!trip && Date.parse(trip.expires || tripExpires(trip.closes)) <= (now || Date.now()); }
/* what is stored and what every member sees: the organizer, the members, the origin town, the destination, the
   stops in drive order. Never a street for the origin. */
export function tripRecord(id, org, built, day, now) {
  const stops = (built.stops || []).slice(0, TRIP_STOPS_MAX).map((a) => stopRef(a));
  return { id: id, org: String(org), members: [String(org)], created: new Date(now || Date.now()).toISOString(), cats: catsParse((built.cats || []).join(",")),
    day: day, closes: tripCloses(day), expires: tripExpires(tripCloses(day)),
    origin: String(built.origin && built.origin.town || "").slice(0, 80), dest: { name: String(built.dest && built.dest.name || "").slice(0, 120), town: String(built.dest && built.dest.town || "").slice(0, 80), id: String(built.dest && built.dest.id || "") },
    route: built.route || null, stops: stops };
}
function stopRef(a) {
  return { id: a.id, name: a.name, town: a.town, lat: a.lat, lng: a.lng, why: a.why, url: a.url, photo: a.photo,
    nested: (a.nested || []).map((n) => ({ id: n.id, name: n.name, town: n.town, lat: n.lat, lng: n.lng, why: n.why, url: n.url, photo: n.photo })) };
}
export function tripMember(trip, cid) { return !!trip && Array.isArray(trip.members) && trip.members.indexOf(String(cid)) !== -1; }
/* the trip as the page gets it: the record, plus the hours now known for each stop (hoursById: id -> hours) */
export function tripView(trip, hoursById) {
  const h = (p) => Object.assign({}, p, { hours: (hoursById && hoursById[p.id]) || null });
  return { id: trip.id, mine: false, org: false, day: trip.day, closes: trip.closes, origin: trip.origin, dest: trip.dest, route: trip.route, members: trip.members.length, cats: trip.cats || CATS_DEFAULT.slice(),
    stops: trip.stops.map((a) => Object.assign(h(a), { nested: (a.nested || []).map(h) })),
    maps: mapsDirUrl(trip.origin, trip.stops, trip.dest.name + (trip.dest.town ? ", " + trip.dest.town : "")) };
}
/* a find as posted: the photo is checked by the caller; this keeps the lines */
export function findRecord(id, cid, by, b, now) {
  const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n).replace(/[^\s@<>"',;:]+@[^\s@<>"',;:]+/g, "");
  const price = clean(b.price, 24);
  return { id: id, by: String(cid), name: clean(by, 24) || "A member", at: new Date(now || Date.now()).toISOString(),
    item: clean(b.item, 160), price: /^\$?\s?\d[\d,]*(\.\d{1,2})?$|^free$/i.test(price) ? price : "", verdict: clean(b.verdict, 40), fair: clean(b.fair, 40),
    stop: clean(b.stop, 120), town: clean(b.town, 80) };
}
