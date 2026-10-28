/* v168: Saved forever, a Prowl Pro perk (Matt: "Let's build the forever save but a prowl perk and let's trim it to a
   year"). A Pro member's saved finds (Flock › Saved) follow the account and are kept a year from the day each was
   saved, with a copy of the listing's photo, because the marketplace takes its own photo down once the piece sells
   (ShopGoodwill at once, the others in time). Free members keep saving on their device, as before.

   One KV value per member, saved:<email> = { saved: [{url,title,price,image,src,hunt,at,ph}], gone: [{u,at}] }, the
   same shape and rules as the likes sync (v85): each device sends its whole list, per link the newest of saved (at) or
   removed (gone.at) wins, a tie is removed, times are clamped to now. A find older than SAVED_DAYS is dropped, and so is
   its photo. ph=1 marks a find whose photo is in R2 at saved/<sha16(email)>/<sha16(url)>.jpg (prowl-finds; the bucket's
   30-day rule covers finds/ only). This module is pure: index.js does KV, R2, fetch and signing.

   v169 (Matt: "build the sold and ended check next"): the alert clock looks at a member's finds about once a day and
   marks the ones whose listing is over: end = { st: "sold" | "ended", at: "YYYY-MM-DD", p: "$45" }. What each marketplace
   says: ShopGoodwill and Salvation Army, ended with bids is sold at the last bid; Etsy, sold out is sold at its price,
   anything else gone is ended; eBay, gone is ended (eBay does not give an ended listing's price). A find is not looked
   at again once it is over. ck is when it was last looked at; ckd is when the member's list was. Like ph, only the
   stored copy can say these.

   v181 (the security and trust plan, 2026-10-28: an email change kept the saved finds behind): a change of address
   carries saved:<old> over to the new one. The photos stay where they are, so a find copied before the change keeps
   hp, the sha16 of the address its photo is kept under; a find without hp is under the member's own address. */

export const SAVED_DAYS = 365;
export const SAVED_MAX = 200;              /* the page keeps 200 (FINDS_MAX) */
export const SAVED_GONE_MAX = 300;
export const SAVED_BODY_MAX = 1 << 20;
export const SAVED_SYNCS_PER_DAY = 300;
export const SAVED_PHOTOS_PER_SYNC = 6;    /* photos copied per sync; the rest on the next one */
export const SAVED_PHOTO_MAX = 1536 * 1024;
export const SAVED_SIG_SECONDS = 86400;    /* a photo link lasts a day; every sync hands out fresh ones */
export const SAVED_CHECK_HOURS = 20;      /* v169: a member's list is looked at once a day, or near it */
export const SAVED_CHECKS_PER_LIST = 15;   /* finds looked at per list per day, the longest unchecked first */
export const SAVED_CHECK_SRC = ["ebay", "etsy", "shopgoodwill", "salvation"];
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
/* v169: a listing's end as stored and handed to the page; null when it is not one */
export function savedEnd(e) {
  if (!e || typeof e !== "object" || (e.st !== "sold" && e.st !== "ended") || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.at || ""))) return null;
  const out = { st: e.st, at: String(e.at) }, p = str(e.p, 24);
  if (p && e.st === "sold") out.p = p;
  return out;
}
export function savedExpired(f, now) { return !!f && f.at + SAVED_DAYS * DAY <= now; }
/* the day a find leaves, as YYYY-MM-DD */
export function savedUntil(at) { return new Date(at + SAVED_DAYS * DAY).toISOString().slice(0, 10); }

/* had: what KV holds; b: what the device sent. Returns the merged list, the removals, and the finds that left with a
   photo (dropped), so index.js can delete those from R2. Only the stored copy can say a photo is kept (ph). */
export function savedMerge(had, b, now) {
  const lists = [had, b].map((o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {}));
  const keep = new Map(), gone = new Map(), ph = new Set(), meta = new Map(), hp = new Map();
  lists.forEach((o, n) => {
    for (const x of Array.isArray(o.saved) ? o.saved.slice(0, 1000) : []) {
      const f = savedItem(x, now);
      if (!f) continue;
      if (n === 0 && f.ph) { ph.add(f.url); if (/^[0-9a-f]{16}$/.test(String(x.hp || ""))) hp.set(f.url, x.hp); }   /* v181 */
      if (n === 0) { const e = savedEnd(x.end), ck = savedAt(x.ck, now); if (e || ck) meta.set(f.url, { end: e, ck: ck }); }   /* v169 */
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
    if (ph.has(f.url)) { f.ph = 1; if (hp.has(f.url)) f.hp = hp.get(f.url); }
    const mt = meta.get(f.url);
    if (mt && mt.end) f.end = mt.end;
    if (mt && mt.ck) f.ck = mt.ck;
    if (f.at > (gone.get(f.url) || 0) && !savedExpired(f, now)) saved.push(f);
    else if (f.ph) dropped.push(f.url);
  }
  for (const [u, at] of gone) if (!(keep.has(u) && keep.get(u).at > at) && at + SAVED_DAYS * DAY > now) left.push({ u, at });
  saved.sort((x, y) => y.at - x.at); left.sort((x, y) => y.at - x.at);
  /* past the cap, the oldest go, photo and all */
  for (const f of saved.slice(SAVED_MAX)) if (f.ph) dropped.push(f.url);
  const out = { saved: saved.slice(0, SAVED_MAX), gone: left.slice(0, SAVED_GONE_MAX), dropped };
  const ckd = savedAt(lists[0].ckd, now);
  if (ckd) out.ckd = ckd;
  return out;
}
/* v181: the hash a stored find's photo is kept under: its hp (copied before a change of address), else h */
export function savedHp(had, u, h) { const f = (had && Array.isArray(had.saved) ? had.saved : []).find((x) => x && x.url === u); return f && /^[0-9a-f]{16}$/.test(String(f.hp || "")) ? f.hp : h; }
/* v169: the marketplace of a find Prowl can look at, or "" */
export function savedSrc(url) {
  let u;
  try { u = new URL(String(url || "")); } catch (e) { return ""; }
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (h === "ebay.com") return "ebay";
  if (h === "etsy.com") return "etsy";
  if (h === "shopgoodwill.com") return "shopgoodwill";
  if (h === "shopthesalvationarmy.com") return "salvation";
  return "";
}
/* the finds to look at today: not over yet, from a marketplace Prowl can read, the longest unchecked first */
export function savedDue(saved, now, n) {
  return (Array.isArray(saved) ? saved : []).filter((f) => f && !f.end && savedSrc(f.url) && !(f.ck && f.ck > now - SAVED_CHECK_HOURS * 3600000))
    .sort((a, b) => (a.ck || 0) - (b.ck || 0)).slice(0, n);
}
/* a list is due when it was not looked at in the last SAVED_CHECK_HOURS */
export function savedListDue(list, now) { return !!list && Array.isArray(list.saved) && list.saved.length > 0 && !(list.ckd && list.ckd > now - SAVED_CHECK_HOURS * 3600000); }
/* what a listing reader's answer means for a saved find: null (could not tell, look again tomorrow), "live", or an end */
export function savedEndFrom(src, r, now) {
  if (!r || r.error) return null;
  if (!r.gone) return "live";
  const day = new Date(now).toISOString().slice(0, 10), price = str(r.price, 24);
  if (src === "etsy") return r.state === "sold_out" ? (price ? { st: "sold", at: day, p: price } : { st: "sold", at: day }) : { st: "ended", at: day };
  if (src === "shopgoodwill" || src === "salvation") return Number(r.bids) > 0 ? (price ? { st: "sold", at: day, p: price } : { st: "sold", at: day }) : { st: "ended", at: day };
  return { st: "ended", at: day };
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
