/* ---------- v200: Facebook Marketplace finds through Apify (v202: prices and photos in every shape, fbShape) ----------
   Matt (2026-10-31): "use Apify", for Prowl Pro members, a hard cap of $1 a day. The v94-v177 sweep ran through Matt's
   own Facebook account and was retired in v178 (the security plan: "no session-cookie storage or replay of anyone's
   account"). This one never logs in and never sends a cookie. Apify's actor curious_coder~facebook-marketplace searches
   Marketplace logged out, from its own US proxy, by words and a point. Only the token goes, in the Authorization
   header (never in the address). Pay per event: about $0.0005 a listing, $0.00005 a start; listing details ($0.001)
   stay off. What is kept of a listing: its id, title, price (USD), photo (Facebook's image hosts only), town and the
   link built from the id. Never the seller. Pure helpers; index.js does the KV, Caps, Google and cron work. No imports. */
export const APIFY_FB_ACTOR = "curious_coder~facebook-marketplace";
export const FB_UNIT = 100000;   /* the spend counter's unit, 1/100,000 of a dollar: a listing is 50, a start 5 */
export const FB_ITEM_USD = 0.0005, FB_DETAIL_USD = 0.001, FB_START_USD = 0.00005;
export const FB_RUN_ITEMS = 24, FB_ITEMS_MAX = 60, FB_DAYS = 7, FB_TTL = 8 * 86400, FB_RADIUS_KM = 40, FB_PER_RUN = 2, FB_TIMEOUT_S = 75;
export const FB_ZIP_TTL = 90 * 86400, FB_ZIP_MISS_TTL = 7 * 86400, FB_CELL_DEG = 0.1, FB_TRIES = 2;
/* v203 (Matt, 2026-10-31: "10 a day is fine"; "local plus ship with a radius. All USA."): each Pro member's hunts get up
   to FB_MEMBER_DAY Facebook searches a day, taken in turn; a hunt is two: pickup within the member's radius (or
   FB_USA_MI for an All USA hunt) and the listings that ship (one search a hunt for everyone, FB_SHIP_KM wide). A member's
   one-off searches (the Store's search box) are FB_SEARCH_DAY a day. */
export const FB_MEMBER_DAY = 10, FB_SEARCH_DAY = 5, FB_USA_MI = 500, FB_RADII_MI = [25, 50, 100], FB_SHIP_KM = 805;
const KM_PER_MI = 1.609344;
const FB_IMG = /^https:\/\/([a-z0-9-]+\.)*fbcdn\.net\//i;
const EMAILISH = /[^\s@<>"',;:]+@[^\s@<>"',;:]+/g;

export function fbLive(env) { return String((env && env.FB_LIVE) || "").trim().toLowerCase() === "on"; }
export function fbDayUsd(env) { const n = Number(env && env.FB_DAY_USD); return n > 0 && n <= 20 ? n : 1; }
export function fbCapUnits(env) { return Math.round(fbDayUsd(env) * FB_UNIT); }
export function fbActor(env) { const a = String((env && env.FB_ACTOR) || "").trim(); return /^[A-Za-z0-9_.-]{1,60}~[A-Za-z0-9_.-]{1,80}$/.test(a) ? a : APIFY_FB_ACTOR; }
/* the page's own key for a hunt (as v94's): single spaces, cut to 60 at the last whole word, no half emoji, lowercased */
export function fbTerm(s) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").replace(/^ /, "");
  if (t.length > 60) { const i = t.lastIndexOf(" ", 60); t = i > 0 ? t.slice(0, i) : t.slice(0, 60); }
  return t.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1").trim().toLowerCase().slice(0, 60);
}
/* a member's area: their ZIP's point rounded to a 0.1 degree cell (about 10 km), so neighbours share one search */
export function fbCell(lat, lng) {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  const la = (Math.round(a / FB_CELL_DEG) * FB_CELL_DEG).toFixed(1), lo = (Math.round(b / FB_CELL_DEG) * FB_CELL_DEG).toFixed(1);
  return { lat: Number(la), lng: Number(lo), key: String(Number(la)) + "," + String(Number(lo)) };
}
export function fbKey(term, cell) { return "fb2:" + term + "|" + (cell && cell.key ? cell.key : String(cell || "")); }   /* v200's, read no more */
/* v203: pickup finds within mi miles of a cell, and the hunt's shipping finds (shared by every member: shipping does not
   depend on where you are) */
export function fbPickKey(term, cell, mi) { return "fb3:" + term + "|" + (cell && cell.key ? cell.key : String(cell || "")) + "|" + fbMi(mi); }
export function fbShipKey(term) { return "fb3s:" + term; }
export function fbMi(mi) { const n = Number(mi); return n === FB_USA_MI || FB_RADII_MI.indexOf(n) !== -1 ? n : 50; }
export function fbUnits(usd) { return Math.max(0, Math.round(Number(usd) * FB_UNIT)); }
export function fbItems(n) { return Math.max(1, Math.min(FB_ITEMS_MAX, n | 0)); }   /* maxItems as sent */
export function fbEstimate(n) { return Math.max(0, Number(n) || 0) * FB_ITEM_USD + FB_START_USD; }
/* what a run cost: a start, and each listing it pushed (with details when its charge info says so) */
export function fbCost(raw) {
  let c = FB_START_USD;
  for (const x of Array.isArray(raw) ? raw : []) { const ci = x && typeof x.apify_charge_info === "object" ? x.apify_charge_info : null; c += FB_ITEM_USD + (ci && ci.listing_item_details ? FB_DETAIL_USD : 0); }
  return Math.round(c * 1e6) / 1e6;
}
/* opt (v203): { mi } pickup within mi miles (Facebook's radius is always km), or { ship: true } the listings that ship */
export function fbInput(term, cell, opt) {
  opt = opt || {};
  const o = { searchKeyword: term, latitude: cell.lat, longitude: cell.lng, radiusKm: opt.ship ? FB_SHIP_KM : opt.mi ? Math.round(fbMi(opt.mi) * KM_PER_MI) : FB_RADIUS_KM,
    getListingDetails: false, getAllListingPhotos: false, strictFiltering: true, maxPagesPerUrl: 1, proxy: { useApifyProxy: true, apifyProxyCountry: "US" } };
  if (opt.ship) o.deliveryMethod = "shipping";
  return o;
}
/* one synchronous run: the listings come back in the answer. The token rides in the header only; no cookies, ever.
   maxTotalChargeUsd (review fix): a pay-per-event actor is held to it, not to maxItems, so Apify itself stops at the
   estimate fbCall reserved. */
export function fbRequest(env, token, term, cell, n, opt) {
  const m = fbItems(n);
  return { url: "https://api.apify.com/v2/acts/" + fbActor(env) + "/run-sync-get-dataset-items?timeout=" + FB_TIMEOUT_S + "&maxItems=" + m + "&maxTotalChargeUsd=" + fbEstimate(m).toFixed(5),
    init: { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(fbInput(term, cell, opt)) } };
}
function fbText(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
/* v202: the price and the photo in each shape the actor may send them. v200 read one guessed shape (listing_price with
   currency "USD", primary_listing_photo_url) and Matt's first test (2026-10-31) came back with no prices. Kept only: a
   dollar price ("$40", "Free", or a plain amount when no other currency is named) and a photo on Facebook's image hosts. */
const FB_PRICE = /^\$\s?\d[\d,]*(\.\d{1,2})?$|^free$/i;
function fbObj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
export function fbPrice(x) {
  x = fbObj(x);
  const lp = fbObj(x.listing_price), cur = String(lp.currency || lp.currency_code || x.currency || "").trim().toUpperCase();
  if (cur && cur !== "USD") return "";
  let named = false;   /* a formatted price in another currency ("CA$40", "€40"): the plain amount is not dollars either */
  for (const c of [lp.formatted_amount, lp.formatted_amount_zeros_stripped, typeof x.listing_price === "string" ? x.listing_price : "", x.formatted_price, typeof x.price === "string" ? x.price : ""]) {
    const p = fbText(c, 24);
    if (FB_PRICE.test(p)) return p;
    if (/[A-Za-z]{1,3}\$|[€£¥₹₩]|\b(?!USD\b)[A-Z]{3}\b/.test(p)) named = true;
  }
  if (named) return "";
  const raw = lp.amount != null ? lp.amount : typeof x.price === "number" ? x.price : null;
  const a = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(a) || a < 0 || a >= 1e7) return "";
  if (a === 0) return "Free";
  const s = a % 1 ? a.toFixed(2) : String(a), i = s.indexOf(".");
  return "$" + (i < 0 ? s : s.slice(0, i)).replace(/\B(?=(\d{3})+$)/g, ",") + (i < 0 ? "" : s.slice(i));
}
export function fbPhoto(x) {
  x = fbObj(x);
  const p = fbObj(x.primary_listing_photo), l0 = fbObj(Array.isArray(x.listing_photos) ? x.listing_photos[0] : null), uri = o => fbObj(o.image).uri;
  for (const c of [x.primary_listing_photo_url, uri(p), p.photo_image_url, p.uri, p.url, uri(l0), l0.uri, l0.url,
    typeof x.primary_listing_photo === "string" ? x.primary_listing_photo : "", x.image, x.image_url, x.photo_url, x.photo]) {
    if (typeof c === "string" && c.length < 2000 && FB_IMG.test(c)) return c;
  }
  return "";
}
/* v202, for the admin's Facebook test only: the field names of one raw listing (names and types, never a value), so the
   shape the actor sends can be seen without reading anyone's data. Seller fields show by name only. */
export function fbShape(x) {
  const out = [];
  const walk = (o, pre, d) => {
    if (!o || typeof o !== "object" || d > 3) return;
    if (Array.isArray(o)) { walk(o[0], pre + "[]", d + 1); return; }
    for (const k of Object.keys(o).slice(0, 50)) {
      if (out.length >= 80) return;
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
      const v = o[k], p = pre ? pre + "." + k : k;
      out.push(p + (v && typeof v === "object" ? (Array.isArray(v) ? " (list)" : "") : " (" + (v === null ? "null" : typeof v) + ")"));
      walk(v, p, d + 1);
    }
  };
  walk(x, "", 0);
  return out;
}
/* the fields kept of each listing; sold, pending and hidden ones are dropped; seller fields are never read */
/* v203: a hunt's words, each found at the start of a title word (plurals and longer forms count: "panther" finds
   "Panthers"), so Facebook's "similar items" (a Land Rover for "panther") are dropped, as the email's exact match does */
const FB_STOP = { a: 1, an: 1, and: 1, the: 1, of: 1, for: 1, with: 1, in: 1, on: 1, or: 1 };
function fbStem(w) { return w.length > 4 && /es$/.test(w) && !/ses$/.test(w) ? w.slice(0, -2) : w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w; }
export function fbMatch(term, title) {
  const tw = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const hw = String(term || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(w => w && !FB_STOP[w]);
  if (!hw.length) return true;
  return hw.every(w => { const st = fbStem(w); return tw.some(t => t.indexOf(st) === 0); });
}
/* miles between two points (haversine), rounded */
export function fbMiles(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lng2 - lng1) * r / 2) ** 2;
  return Math.round(3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
/* ctx (v203): { term, lat, lng, mi, ship }: only listings matching the hunt; pickup ones only within mi miles of the
   point (Facebook pads a thin local search with far-away "similar" ones, strict filtering or not), each with its miles;
   shipping ones marked ships. Without ctx, v200's behaviour. */
export function fbClean(raw, day, ctx) {
  const out = [], seen = Object.create(null);
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= FB_ITEMS_MAX) break;
    if (!x || typeof x !== "object" || x.is_sold === true || x.is_pending === true || x.is_hidden === true) continue;
    const id = String(x.id == null ? "" : x.id).trim(), title = fbText(x.marketplace_listing_title || x.custom_title, 160).replace(EMAILISH, "[email]");
    if (!/^\d{5,20}$/.test(id) || seen[id] || !title) continue;
    seen[id] = 1;
    if (ctx && ctx.term && !fbMatch(ctx.term, title)) continue;
    let miles = null;
    if (ctx && Number.isFinite(Number(ctx.lat))) {
      const loc = x.location && typeof x.location === "object" ? x.location : {}, la = Number(loc.latitude), lo = Number(loc.longitude);
      miles = Number.isFinite(la) && Number.isFinite(lo) && la !== 0 && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? fbMiles(Number(ctx.lat), Number(ctx.lng), la, lo) : null;
      if (!ctx.ship && (miles == null || miles > fbMi(ctx.mi) + 5)) continue;   /* +5: the area is a 10 km cell's centre */
    }
    const pr = fbPrice(x), img = fbPhoto(x);
    const rg = x.location && typeof x.location === "object" && x.location.reverse_geocode && typeof x.location.reverse_geocode === "object" ? x.location.reverse_geocode : {};
    const town = [fbText(rg.city, 40), fbText(rg.state, 20)].filter(Boolean).join(", ").replace(EMAILISH, "").replace(/\d[\d\s().-]{4,}\d/g, "").trim();
    const it = { id: id, title: title, price: pr, url: "https://www.facebook.com/marketplace/item/" + id + "/", image: img, location: town, found: day };
    if (miles != null) it.miles = miles;
    if (ctx && ctx.ship) it.ships = true;
    out.push(it);
  }
  return out;
}
/* the week so far (as v94's fbIngest): today's finds first, then the earlier ones still inside FB_DAYS, one per listing */
export function fbMerge(old, fresh, day, updated) {
  const cut = new Date(Date.parse(day) - FB_DAYS * 86400000).toISOString().slice(0, 10), have = Object.create(null), items = [];
  for (const x of (Array.isArray(fresh) ? fresh : []).concat(old && Array.isArray(old.items) ? old.items : [])) {
    if (!x || !x.id || have[x.id] || !(String(x.found || "") > cut)) continue;
    have[x.id] = 1; items.push(x);
  }
  items.sort((a, b) => (a.found < b.found ? 1 : a.found > b.found ? -1 : 0));   /* stable: today's order kept */
  items.length = Math.min(items.length, FB_ITEMS_MAX);
  return { updated: updated || new Date().toISOString(), day: day, items: items };
}
/* one Apify call: { ok, items, raw, cost } or { ok:false, error, cost } (a failed run may still have pushed listings,
   so it is charged at the estimate: the cap errs on the safe side). Errors never carry the token. */
export async function fbRun(env, term, cell, n, f, opt) {
  const tok = String((env && env.APIFY_TOKEN) || "");
  if (!tok) return { ok: false, error: "APIFY_TOKEN not set", cost: 0 };
  const rq = fbRequest(env, tok, term, cell, n, opt), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (FB_TIMEOUT_S + 15) * 1000);
  try {
    const r = await (f || fetch)(rq.url, Object.assign({ signal: ctl.signal }, rq.init));
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !Array.isArray(j)) return { ok: false, status: r.status, error: "apify " + r.status + (j && j.error && j.error.type ? " " + fbText(j.error.type, 40) : ""), cost: fbEstimate(n) };
    return { ok: true, raw: j.length, items: fbClean(j, new Date().toISOString().slice(0, 10), opt ? { term: term, lat: cell.lat, lng: cell.lng, mi: opt.mi, ship: !!opt.ship } : null), cost: fbCost(j), fields: fbShape(j[0]) };   /* v202: fields */
  } catch (e) { return { ok: false, error: e && e.name === "AbortError" ? "apify timed out" : "apify unreachable", cost: fbEstimate(n) }; }
  finally { clearTimeout(timer); }
}

/* v203: what a member sees for a hunt: the pickup finds (nearest first), then the ones that ship, one per listing */
export function fbJoin(pick, ship) {
  const have = Object.create(null), out = [];
  const near = (pick && Array.isArray(pick.items) ? pick.items.slice() : []).sort((a, b) => (a.miles == null ? 1e9 : a.miles) - (b.miles == null ? 1e9 : b.miles));
  for (const x of near.concat(ship && Array.isArray(ship.items) ? ship.items : [])) { if (!x || !x.id || have[x.id]) continue; have[x.id] = 1; out.push(x); }
  const up = [pick && pick.updated, ship && ship.updated].filter(Boolean).sort().pop() || "";
  return { items: out.slice(0, FB_ITEMS_MAX), updated: String(up) };
}
