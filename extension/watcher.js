// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
//
// Facebook watches (1.7.0; the Prowl worker's v157). A watch is a saved hunt the member turned on in Prowl's Den.
// This browser runs it: it opens the watch's Marketplace searches the way the browser loads any Facebook page, with
// the member's own Facebook login, reads the listings, and sends the Prowl worker only the listings it has not seen
// for that watch (and the asking prices around them, for the price read). It never reads, keeps or sends a Facebook
// cookie, password or account id; the only thing it ever says about the Facebook account is "not logged in".
// Nothing here matters if lost: the watches and what each has seen come from the worker every cycle.
//
// Pure functions only (tested in __tests__/extension/watcher.test.mjs); service-worker.js does the fetching.

export const API = 'https://prowl.thebluecloud.workers.dev';
export const HOT_MS = 30 * 60 * 1000;            // Hot: every 30 minutes while the browser is open
export const JITTER_MS = 5 * 60 * 1000;          // plus or minus 5 minutes, per watch and per check
export const RETRY_HOT_MS = 30 * 60 * 1000;      // not logged in to Facebook: a Hot watch tries again in 30 minutes
export const RETRY_MS = 3 * 60 * 60 * 1000;      // a Daily or Weekly one in 3 hours
export const ITEMS_MAX = 150;
const DAY = 86400000;

// The worker's WATCH_METROS (place IDs where known, else Facebook's city slug). local = the member's own area.
export const METROS = {
  local: '', nyc: '108424279189115', la: '110970792260960', sf: 'sanfrancisco', chicago: '108659242498155',
  detroit: '151286001683429', dallas: '2181928745183595', houston: '112164325476741', phoenix: '112534082095531',
  miami: '110148382341970', atlanta: 'atlanta', seattle: '110843418940484',
};

// The page's own Facebook link (page fbCityUrl), newest listings first.
export function searchUrl(term, metro) {
  const loc = Object.prototype.hasOwnProperty.call(METROS, metro) ? METROS[metro] : '';
  const q = encodeURIComponent(String(term || '')).replace(/%20/g, '+').replace(/'/g, '%27').replace(/[()]/g, (c) => '%' + c.charCodeAt(0).toString(16));
  return 'https://www.facebook.com/marketplace/' + (loc ? loc + '/' : 'category/') + 'search/?query=' + q + '&sortBy=creation_time_descend&exact=false';
}

// ---------- when a watch is due ----------
// A steady number from 0 to 1 for a watch and a moment, so the jitter is the same however often it is asked.
function unit(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
export function jitter(id, last) { return Math.round((unit(String(id) + ':' + last) * 2 - 1) * JITTER_MS); }
function dayStart(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
function addDays(t, n) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); }   // local midnights, across clock changes

// When the watch's next check is due, from the worker's record of its last one (in this browser's own time zone).
//   not yet active (a new watch, or new filters): now, for its baseline
//   Hot: 30 minutes after the last check, give or take 5
//   Daily: the start of the day after the last check, so the first browser session of a day checks it, and a day
//          missed is caught up on the next one (one check finds everything new since the last)
//   Weekly: the Monday after the last check, so the first session on or after Monday checks it
export function nextDue(w, now) {
  if (!w || w.paused) return Infinity;
  const last = Date.parse(w.checkedAt || '') || 0;
  if (!w.activeAt || !last) return now;
  const tier = w.runs || w.tier;
  if (tier === 'hot') return last + HOT_MS + jitter(w.id, last);
  if (tier === 'daily') return addDays(dayStart(last), 1);
  let t = addDays(dayStart(last), 1);
  while (new Date(t).getDay() !== 1) t = addDays(t, 1);
  return t;
}
// skippedAt: when this browser last found Facebook logged out for the watch; the check waits a retry interval.
export function retryAt(w, skippedAt) {
  if (!skippedAt) return 0;
  return skippedAt + ((w.runs || w.tier) === 'hot' ? RETRY_HOT_MS : RETRY_MS);
}
export function isDue(w, now, skippedAt) { return now >= Math.max(nextDue(w, now), retryAt(w, skippedAt)); }
export function nextCheck(w, now, skippedAt) { const t = nextDue(w, now); return t === Infinity ? t : Math.max(t, retryAt(w, skippedAt)); }

// ---------- reading Marketplace ----------
// Facebook ships each search's listings as JSON inside the page. Every object with a listing title is a listing.
export function cleanPrice(lp) {
  if (!lp || typeof lp !== 'object') return '';
  const f = String(lp.formatted_amount || lp.formatted_amount_zeros_stripped || '').trim();
  if (/^free$/i.test(f) || (lp.amount != null && Number(lp.amount) === 0)) return 'Free';
  const m = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(f);
  if (m) return '$' + m[1];
  const n = Number(lp.amount);
  return n > 0 ? '$' + Math.round(n).toLocaleString('en-US') : '';
}
function listing(o, out, seen) {
  const id = String(o.id == null ? '' : o.id);
  if (!/^\d{5,20}$/.test(id) || seen.has(id) || o.is_sold === true || o.is_pending === true || o.is_hidden === true) return;
  seen.add(id);
  const photo = o.primary_listing_photo || {}, img = (photo.image && photo.image.uri) || (photo.listing_image && photo.listing_image.uri) || '';
  const rg = o.location && o.location.reverse_geocode, place = rg ? [rg.city, rg.state].filter(Boolean).join(', ') : '';
  const listed = Number(o.creation_time) || 0;
  out.push({
    id, title: String(o.marketplace_listing_title).replace(/\s+/g, ' ').trim().slice(0, 160), price: cleanPrice(o.listing_price),
    image: /^https:\/\/([a-z0-9-]+\.)*fbcdn\.net\//i.test(img) ? img : '', location: String(place).slice(0, 60),
    listed: listed > 1e9 && listed < 1e10 ? listed : 0,
  });
}
function walk(o, out, seen, depth) {
  if (!o || typeof o !== 'object' || depth > 80 || out.length >= ITEMS_MAX) return;
  if (Array.isArray(o)) { for (const x of o) walk(x, out, seen, depth + 1); return; }
  if (typeof o.marketplace_listing_title === 'string' && o.marketplace_listing_title) listing(o, out, seen);
  for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === 'object') walk(v, out, seen, depth + 1); }
}
// Logged in or not, from the page alone: Facebook writes the viewer's id into every page, "0" when nobody is logged
// in. Only the yes or no leaves this function; the id itself is never kept or sent.
export function loggedIn(html, finalUrl) {
  if (/\/login(\/|\.php|\?|$)|\/checkpoint\//.test(String(finalUrl || '').replace(/^https:\/\/[^/]+/, ''))) return false;
  const m = /"(?:USER_ID|ACCOUNT_ID|actorID)":"(\d+)"/.exec(html);
  if (m) return m[1] !== '0';
  return !/id="login_form"|name="login"|\/login\/\?next=/.test(html);
}
export function parseMarketplace(html, finalUrl) {
  const s = String(html || ''), items = [], seen = new Set();
  const re = /<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(s)) && items.length < ITEMS_MAX) {
    let j;
    try { j = JSON.parse(m[1]); } catch (e) { continue; }
    walk(j, items, seen, 0);
  }
  return { loggedIn: loggedIn(s, finalUrl), items };
}

// What one watch's check reports: every listing on a baseline, else only those missing from the worker's digest
// (the last 8 digits of each id it has seen), and the asking prices of everything found, for the price read.
export function report(w, items) {
  const seen = new Set(String(w.seen || '').split(',').filter(Boolean)), base = !w.activeAt;
  const comps = [];
  for (const x of items) { const m = /^\$(\d[\d,]*)/.exec(x.price); if (m) comps.push(Number(m[1].replace(/,/g, ''))); }
  return { items: (base ? items : items.filter((x) => !seen.has(x.id.slice(-8)))).slice(0, ITEMS_MAX), comps };
}

// The worker's session token (the page's prowl.session), if it has the right shape and has not run out.
export function sessionOk(s, now) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{10,400}$/.test(s)) return false;
  let raw = '';
  try { raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); } catch (e) { return false; }
  const p = raw.split('.');
  return p.length === 3 && /^\d{1,20}$/.test(p[0]) && /^\d{9,11}$/.test(p[1]) && Number(p[1]) * 1000 > now;
}

// One POST must stay under the worker's 256 KB: results go in batches of at most ~200 KB.
export function batches(results, max = 200000) {
  const out = [];
  let cur = [], size = 0;
  for (const r of results) {
    const n = JSON.stringify(r).length + 1;
    if (cur.length && size + n > max) { out.push(cur); cur = []; size = 0; }
    cur.push(r); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
