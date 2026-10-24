/* v168: Saved forever, a Prowl Pro perk (Matt: "Let's build the forever save but a prowl perk and let's trim it to a
   year"). A Pro member's saved finds (Flock › Saved) follow the account and are kept a year from the day each was
   saved, with a copy of the listing's photo, because the marketplace takes its own photo down once the piece sells
   (ShopGoodwill at once, the others in time). Free members keep saving on their device, as before.

   One KV value per member, saved:<email> = { saved: [{url,title,price,image,src,hunt,at,ph}], gone: [{u,at}] }, the
   same shape and rules as the likes sync (v85): each device sends its whole list, per link the newest of saved (at) or
   removed (gone.at) wins, a tie is removed, times are clamped to now. A find older than SAVED_DAYS is dropped, and so is
   its photo. ph=1 marks a find whose photo is in R2 at saved/<sha16(email)>/<sha16(url)>.jpg (prowl-finds; the bucket's
   30-day rule covers finds/ only). This module is pure: index.js does KV, R2, fetch and signing. */

export const SAVED_DAYS = 365;
export const SAVED_MAX = 200;              /* the page keeps 200 (FINDS_MAX) */
export const SAVED_GONE_MAX = 300;
export const SAVED_BODY_MAX = 1 << 20;
export const SAVED_SYNCS_PER_DAY = 300;
export const SAVED_PHOTOS_PER_SYNC = 6;    /* photos copied per sync; the rest on the next one */
export const SAVED_PHOTO_MAX = 1536 * 1024;
export const SAVED_SIG_SECONDS = 86400;    /* a photo link lasts a day; every sync hands out fresh ones */
const DAY = 86400000;

function str(v, n) { return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : ""; }
export function savedAt(v, now) { const t = Math.floor(Number(v) || 0); return t > 0 ? Math.min(t, now) : 0; }
/* a saved find from a device or from KV; null when it is not one. A find saved before v168 has no time: it starts now. */
export function savedItem(f, now) {
  if (!f || typeof f !== "object" || typeof f.url !== "string" || !/^https:\/\//i.test(f.url)) return null;
  const title = str(f.title, 140);
  if (!title) return null;
  return { url: f.url.slice(0, 800), title, price: str(f.price, 24),
    image: typeof f.image === "string" && /^https:\/\//i.test(f.image) ? f.image.slice(0, 800) : "",
    src: str(f.src, 24), hunt: str(f.hunt, 80), at: savedAt(f.at, now) || now, ph: f.ph === 1 ? 1 : 0 };
}
export function savedExpired(f, now) { return !!f && f.at + SAVED_DAYS * DAY <= now; }
/* the day a find leaves, as YYYY-MM-DD */
export function savedUntil(at) { return new Date(at + SAVED_DAYS * DAY).toISOString().slice(0, 10); }

/* had: what KV holds; b: what the device sent. Returns the merged list, the removals, and the finds that left with a
   photo (dropped), so index.js can delete those from R2. Only the stored copy can say a photo is kept (ph). */
export function savedMerge(had, b, now) {
  const lists = [had, b].map((o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {}));
  const keep = new Map(), gone = new Map(), ph = new Set();
  lists.forEach((o, n) => {
    for (const x of Array.isArray(o.saved) ? o.saved.slice(0, 1000) : []) {
      const f = savedItem(x, now);
      if (!f) continue;
      if (n === 0 && f.ph) ph.add(f.url);
      f.ph = 0;
      if (!keep.has(f.url) || f.at > keep.get(f.url).at) keep.set(f.url, f);
    }
    for (const x of Array.isArray(o.gone) ? o.gone.slice(0, 1000) : []) {
      if (!x || typeof x.u !== "string" || !/^https:\/\//i.test(x.u)) continue;
      const u = x.u.slice(0, 800), at = savedAt(x.at, now);
      if (at > (gone.get(u) || 0)) gone.set(u, at);
    }
  });
  const saved = [], left = [], dropped = [];
  for (const f of keep.values()) {
    if (ph.has(f.url)) f.ph = 1;
    if (f.at > (gone.get(f.url) || 0) && !savedExpired(f, now)) saved.push(f);
    else if (f.ph) dropped.push(f.url);
  }
  for (const [u, at] of gone) if (!(keep.has(u) && keep.get(u).at > at) && at + SAVED_DAYS * DAY > now) left.push({ u, at });
  saved.sort((x, y) => y.at - x.at); left.sort((x, y) => y.at - x.at);
  /* past the cap, the oldest go, photo and all */
  for (const f of saved.slice(SAVED_MAX)) if (f.ph) dropped.push(f.url);
  return { saved: saved.slice(0, SAVED_MAX), gone: left.slice(0, SAVED_GONE_MAX), dropped };
}
/* the next finds whose photo should be copied: newest first, an https image, not yet kept */
export function savedToCopy(saved, n) {
  return (Array.isArray(saved) ? saved : []).filter((f) => f && !f.ph && f.image && photoHostOk(f.image)).slice(0, n);
}
/* a photo is fetched only from a named public host over https: no addresses, no local names, no ports */
export function photoHostOk(u) {
  let x;
  try { x = new URL(u); } catch (e) { return false; }
  if (x.protocol !== "https:" || x.port || x.username || x.password) return false;
  const h = x.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return false;   /* IPv4 and IPv6 literals fail here */
  return !/(^|\.)(localhost|local|internal|lan|home|corp|invalid|test|example)$/.test(h);
}
export function photoKey(h, k) { return "saved/" + h + "/" + k + ".jpg"; }
