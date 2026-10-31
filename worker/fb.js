/* ---------- v197: Facebook Marketplace finds through Apify ----------
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
export function fbKey(term, cell) { return "fb2:" + term + "|" + (cell && cell.key ? cell.key : String(cell || "")); }
export function fbUnits(usd) { return Math.max(0, Math.round(Number(usd) * FB_UNIT)); }
export function fbItems(n) { return Math.max(1, Math.min(FB_ITEMS_MAX, n | 0)); }   /* maxItems as sent */
export function fbEstimate(n) { return Math.max(0, Number(n) || 0) * FB_ITEM_USD + FB_START_USD; }
/* what a run cost: a start, and each listing it pushed (with details when its charge info says so) */
export function fbCost(raw) {
  let c = FB_START_USD;
  for (const x of Array.isArray(raw) ? raw : []) { const ci = x && typeof x.apify_charge_info === "object" ? x.apify_charge_info : null; c += FB_ITEM_USD + (ci && ci.listing_item_details ? FB_DETAIL_USD : 0); }
  return Math.round(c * 1e6) / 1e6;
}
export function fbInput(term, cell) {
  return { searchKeyword: term, latitude: cell.lat, longitude: cell.lng, radiusKm: FB_RADIUS_KM, getListingDetails: false, getAllListingPhotos: false,
    strictFiltering: true, maxPagesPerUrl: 1, proxy: { useApifyProxy: true, apifyProxyCountry: "US" } };
}
/* one synchronous run: the listings come back in the answer. The token rides in the header only; no cookies, ever.
   maxTotalChargeUsd (review fix): a pay-per-event actor is held to it, not to maxItems, so Apify itself stops at the
   estimate fbCall reserved. */
export function fbRequest(env, token, term, cell, n) {
  const m = fbItems(n);
  return { url: "https://api.apify.com/v2/acts/" + fbActor(env) + "/run-sync-get-dataset-items?timeout=" + FB_TIMEOUT_S + "&maxItems=" + m + "&maxTotalChargeUsd=" + fbEstimate(m).toFixed(5),
    init: { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json" }, body: JSON.stringify(fbInput(term, cell)) } };
}
function fbText(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
/* the fields kept of each listing; sold, pending and hidden ones are dropped; seller fields are never read */
export function fbClean(raw, day) {
  const out = [], seen = Object.create(null);
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= FB_ITEMS_MAX) break;
    if (!x || typeof x !== "object" || x.is_sold === true || x.is_pending === true || x.is_hidden === true) continue;
    const id = String(x.id == null ? "" : x.id).trim(), title = fbText(x.marketplace_listing_title || x.custom_title, 160).replace(EMAILISH, "[email]");
    if (!/^\d{5,20}$/.test(id) || seen[id] || !title) continue;
    seen[id] = 1;
    const lp = x.listing_price && typeof x.listing_price === "object" ? x.listing_price : {}, pr = fbText(lp.formatted_amount, 24);
    const img = typeof x.primary_listing_photo_url === "string" ? x.primary_listing_photo_url : "";
    const rg = x.location && typeof x.location === "object" && x.location.reverse_geocode && typeof x.location.reverse_geocode === "object" ? x.location.reverse_geocode : {};
    const town = [fbText(rg.city, 40), fbText(rg.state, 20)].filter(Boolean).join(", ").replace(EMAILISH, "").replace(/\d[\d\s().-]{4,}\d/g, "").trim();
    out.push({ id: id, title: title, price: String(lp.currency || "").toUpperCase() === "USD" && /^\$\s?\d[\d,]*(\.\d{1,2})?$|^free$/i.test(pr) ? pr : "",
      url: "https://www.facebook.com/marketplace/item/" + id + "/", image: img.length < 2000 && FB_IMG.test(img) ? img : "", location: town, found: day });
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
export async function fbRun(env, term, cell, n, f) {
  const tok = String((env && env.APIFY_TOKEN) || "");
  if (!tok) return { ok: false, error: "APIFY_TOKEN not set", cost: 0 };
  const rq = fbRequest(env, tok, term, cell, n), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (FB_TIMEOUT_S + 15) * 1000);
  try {
    const r = await (f || fetch)(rq.url, Object.assign({ signal: ctl.signal }, rq.init));
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok || !Array.isArray(j)) return { ok: false, status: r.status, error: "apify " + r.status + (j && j.error && j.error.type ? " " + fbText(j.error.type, 40) : ""), cost: fbEstimate(n) };
    return { ok: true, raw: j.length, items: fbClean(j, new Date().toISOString().slice(0, 10)), cost: fbCost(j) };
  } catch (e) { return { ok: false, error: e && e.name === "AbortError" ? "apify timed out" : "apify unreachable", cost: fbEstimate(n) }; }
  finally { clearTimeout(timer); }
}
