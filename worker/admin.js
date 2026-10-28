/* ---------- v78: Prowl admin area (/admin) ----------
   The owner's support and health dashboard. One admin key signs in: ADMIN_KEY, its own secret of 20+ characters.
   OWNER_KEY is never accepted (the public page keeps it in the browser, where any script on the shop can read it);
   the session is an HMAC-signed expiry in an HttpOnly, Secure, SameSite=Strict cookie scoped to /admin.
   Members appear only as a pseudonymous id (M-xxxxxxxx, a salted hash of the address). Every view is
   built field by field from an allowlist, so an email, token, Shopify id, receipt, ZIP or code can
   never reach a response. H = helpers from index.js (this file never imports index.js). The page
   builders and metrics summaries come from H when present, else load lazily from their own files.
   Gift Pro: the owner gives free Pro by typing an address once; only a hash of it is kept (gift:<hash>), and
   index.js alPro checks it (giftPro below) before any Shopify call. */

import { appAsset } from "./admin-app.js";
const COOKIE = "prowl_admin";
const SESSION_S = 43200;                         // 12 hours
const BODY_MAX = 8192;
const ROSTER_MAX = 5000, ROSTER_TTL = 600000;    // 10 minutes: the overview's counts come from the alert clock, not from here
const SLOW_TTL = 600000;                         // the overview's weekly searches, 7-day uptime and 24 h run counts
const KEY_MIN = 20;
/* sign-in limits: every try per address (IPv6: per /64) and per neighbourhood (/24, /48); wrong keys site-wide per
   hour; wrong keys logged one by one only up to a few a day, so a flood cannot push real entries out of the audit log */
const LOGIN_PER_IP = 10, LOGIN_PER_NET = 30, LOGIN_FAILS_PER_HOUR = 30, LOGIN_LOG_PER_DAY = 20;
const ID_RE = /^M-[0-9a-f]{8}$/;
const HIDDEN = "(hidden \u2014 looks personal)";
const ACTIONS = ["signin-link", "refresh-pro", "recheck-today", "resend-today", "mail-on", "mail-off", "unpause", "signout-all", "clear-seen", "delete", "gift-on", "gift-off"];
const CONFIRM = { "signout-all": 1, "clear-seen": 1, "delete": 1 };   // the owner types the member id first
const ISSUE_FLAGS = ["email late", "pro check failing", "record unreadable", "no hunts"];   // the page marks the same ones
const GIFT_MONTHS = [0, 1, 3, 6, 12];            // 0 = no end
const GIFT_MAX = 2000;
const GID_RE = /^[0-9a-f]{10}$/;
const GIFT_MAIL_PER_DAY = 30, GIFT_MAIL_PER_PERSON = 2;   // the "email them how to start" box on a gift
const PRO_FIELDS = ["pro", "plan", "proDay", "hadPro", "proCheck"];
const BASE_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };

/* ---------- small helpers ---------- */
const enc = s => new TextEncoder().encode(String(s));
function b64url(buf) {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(s) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc(s))); }
function ctEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/* Hashing both sides first means neither the content nor the length of the real key leaks through timing. */
async function sameSecret(real, given) {
  if (!given) return false;
  const [x, y] = await Promise.all([sha256(real), sha256(given)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
const day10 = v => { const s = String(v == null ? "" : v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""; };
const word = (v, n) => String(v == null ? "" : v).replace(/[^A-Za-z0-9 ._#:\/+-]/g, "").slice(0, n || 40);
const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const arr = v => Array.isArray(v) ? v : [];
const https = u => typeof u === "string" && u.length <= 2048 && /^https:\/\/[^\s"'<>\\]+$/.test(u) ? u : "";
/* Free text from logs (error messages, probe errors): mask anything shaped like an address, a token or a long number. */
function clean(s, n) {
  return String(s == null ? "" : s)
    .replace(/[^\s@<>"',;:=&?\/]+(@|%40)[^\s@<>"',;:&?\/]+/gi, "[email]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[hidden]")
    .replace(/\d[\d\s().-]{5,}\d/g, "[number]")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "[number]")   // a ZIP code
    .slice(0, n || 160);
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

/* ---------- Gift Pro: the rules index.js alPro uses (pure, so they can be tested) ---------- */
/* A gift counts while its last day ("until", Detroit YYYY-MM-DD) is today or later; "" means no end. A malformed record never counts. */
export function giftActive(g, today) {
  if (!g || typeof g !== "object" || Array.isArray(g)) return false;
  const u = g.until == null ? "" : String(g.until);
  if (u === "") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(u) && u >= String(today == null ? "" : today);
}
/* Free Pro, in alPro's order: the PRO_EMAILS list unless the owner switched it off for that address (giftoff),
   then a gift that has not ended. null = no free Pro, so alPro goes on to the cache and Shopify. */
export function giftPro(listed, off, gift, today) {
  if (listed && !off) return { pro: true, via: "list", plan: { via: "list" } };
  if (giftActive(gift, today)) return { pro: true, via: "gift", plan: { via: "gift", until: String(gift.until == null ? "" : gift.until) } };
  return null;
}
/* "2026-10-05" + 3 months = "2027-01-05"; a day the shorter month lacks becomes its last day (Jan 31 + 1 = Feb 28). */
function addMonths(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return "";
  const y = +m[1], mo = +m[2] - 1 + n, last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, mo, Math.min(+m[3], last))).toISOString().slice(0, 10);
}
const giftMonths = v => { const n = v == null || v === "" ? 0 : Number(v); return GIFT_MONTHS.indexOf(n) === -1 ? -1 : n; };
const monthsWord = n => n ? n + (n === 1 ? " month" : " months") : "no end";
const giftEnds = until => until ? "until " + until : "with no end date";
/* The owner's note on a gift: one line, at most 60 characters, addresses and phone numbers masked. */
const giftNote = v => clean(String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(), 60).trim();

function headers(extra) { return Object.assign({}, BASE_HEADERS, extra || {}); }
function jres(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: headers({ "Content-Type": "application/json; charset=utf-8" }) }); }
/* error and message both carry the text, so the page shows it whichever it reads */
function jerr(status, msg, extra) { return jres(Object.assign({ ok: false, error: msg, message: msg }, extra || {}), status); }
function plain(status, msg) {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prowl admin</title><p>' + esc(msg) + "</p>",
    { status: status, headers: headers({ "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }) });
}
function redirect(to, cookie) {
  const h = headers({ Location: to });
  if (cookie) h["Set-Cookie"] = cookie;
  return new Response(null, { status: 303, headers: h });
}
function csp(nonce) {
  return "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src https: data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self'";
}
async function pageLib(H) { return H && H.pages && typeof H.pages.loginPage === "function" ? H.pages : import("./admin-page.js"); }
async function metricsLib(H) { return H && typeof H.summarize === "function" && typeof H.uptimeFrom === "function" ? H : import("./metrics.js"); }
async function page(H, which, status, message) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));   // fresh per response
  const P = await pageLib(H);
  const body = which === "login" ? P.loginPage(nonce, message || "") : P.adminPage(nonce, H.WORKER_VERSION);
  return new Response(body, { status: status || 200, headers: headers({ "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": csp(nonce) }) });
}
function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return "";
}
/* A page served with Referrer-Policy: no-referrer makes the browser send "Origin: null" on its own form
   posts, so null is accepted only when the browser-set Sec-Fetch-Site also says same-origin. */
function sameOrigin(request, url) {
  const o = request.headers.get("Origin"), sfs = request.headers.get("Sec-Fetch-Site");
  if (sfs && sfs !== "same-origin") return false;
  if (o === null || o === url.origin) return true;
  return o === "null" && sfs === "same-origin";
}
async function readBody(request, max) {
  if (Number(request.headers.get("Content-Length") || 0) > max) return null;
  let t = "";
  try { t = await request.text(); } catch (e) { return ""; }
  return t.length > max ? null : t;
}
function adminKey(env) { const k = String((env && env.ADMIN_KEY) || ""); return k.length >= KEY_MIN ? k : ""; }
/* Why the admin area is off, in words the owner can act on in Cloudflare ("" when ADMIN_KEY is usable). The message
   names a setting and says what is wrong with it; it never shows a secret's value or length. */
function setupProblem(env) {
  const raw = String((env && env.ADMIN_KEY) || "");
  const owner = String((env && env.OWNER_KEY) || "");
  if (!raw) {
    const near = Object.keys(env || {}).find(n => n !== "ADMIN_KEY" && /^\s*admin[\s_-]*key\s*$/i.test(n));
    if (near) return "Admin is not set up: there is a secret named \"" + near + "\", but the name must be exactly ADMIN_KEY (capitals, with the underscore). In Cloudflare, add ADMIN_KEY with the same value and delete \"" + near + "\".";
    return "Admin is not set up: add an ADMIN_KEY secret in Cloudflare (" + KEY_MIN + " characters or more, not the same as OWNER_KEY).";
  }
  if (raw.length < KEY_MIN) return "Admin is not set up: ADMIN_KEY is shorter than " + KEY_MIN + " characters. In Cloudflare, replace it with a key of " + KEY_MIN + " characters or more (not the same as OWNER_KEY).";
  /* OWNER_KEY lives in the public page's browser storage on the shop, so it must never also open the admin area */
  if (owner && ctEq(raw, owner)) return "Admin is not set up: use a different key for ADMIN_KEY than OWNER_KEY. The public Prowl page keeps OWNER_KEY in the browser.";
  return "";
}
/* Audit writes never hold up or fail the owner's request. */
function audit(c, entry) {
  const e = { t: c.nowMs, action: entry.action, id: entry.id || "", ok: !!entry.ok, note: String(entry.note || "").slice(0, 80) };
  const p = Promise.resolve().then(() => c.H.capsCall("metrics", "mrec", { a: [e] })).catch(() => {});
  if (c.ctx && typeof c.ctx.waitUntil === "function") { c.ctx.waitUntil(p); return Promise.resolve(); }
  return p;
}

/* ---------- session ---------- */
async function mac(secret, expMs) {
  const k = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, enc("prowl-admin|" + expMs)));
}
export async function signSession(secret, expMs) { return String(expMs) + "." + await mac(secret, String(expMs)); }
export async function verifySession(secret, value, nowMs) {
  const m = /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(String(value || ""));
  if (!secret || !m) return false;
  const exp = Number(m[1]);
  if (!(exp > nowMs) || exp > nowMs + SESSION_S * 1000 + 300000) return false;   // never longer than 12 hours, whatever it says
  return ctEq(await mac(secret, m[1]), m[2]);
}

/* ---------- member ids ---------- */
export async function memberId(salt, email) {
  const h = await sha256(String(salt) + "|" + String(email));
  return "M-" + Array.from(h.slice(0, 4), x => ("0" + x.toString(16)).slice(-2)).join("");
}
/* id -> KV key for every member, cached 10 minutes per isolate (an action, or the Members tab's Refresh, starts it
   again). Records load only for the list views; the overview's counts normally come from the alert clock's run
   record instead, so the dashboard's minute-by-minute refresh does not read every member from KV (the free plan
   allows 1,000 KV lists and 100,000 reads a day, and the alert clock needs most of them). Waiting sign-in links are
   checked per member in the detail view, not listed here. Module memory only; nothing here is ever returned. */
let ROSTER = null;
async function roster(c, withRecs) {
  const kv = c.env && c.env.PROWL_ALERTS;
  if (!kv) throw new Error("no KV");
  let R = ROSTER;
  if (!R || R.kv !== kv || R.salt !== c.salt || c.nowMs - R.at > ROSTER_TTL || c.nowMs < R.at) {
    const keys = []; let cursor, more = false;
    do {
      const l = await kv.list({ prefix: "sub:", cursor: cursor, limit: 1000 });
      for (const k of arr(l && l.keys)) keys.push(k.name);
      cursor = l && !l.list_complete ? l.cursor : undefined;
      if (keys.length >= ROSTER_MAX) { more = keys.length > ROSTER_MAX || !!cursor; break; }
    } while (cursor);
    keys.length = Math.min(keys.length, ROSTER_MAX);
    const byId = new Map(), idOf = new Map();
    for (let i = 0; i < keys.length; i += 100) {
      const part = keys.slice(i, i + 100), ids = await Promise.all(part.map(k => memberId(c.salt, k.slice(4))));
      part.forEach((k, j) => { idOf.set(k, ids[j]); if (!byId.has(ids[j])) byId.set(ids[j], k); });
    }
    R = ROSTER = { kv: kv, salt: c.salt, at: c.nowMs, keys: keys, byId: byId, idOf: idOf, truncated: more, recs: null, giftOf: null };
  }
  if (withRecs && !R.recs) {
    const recs = new Map();
    for (let i = 0; i < R.keys.length; i += 50) {
      const part = R.keys.slice(i, i + 50), got = await Promise.all(part.map(k => c.H.kvGet(c.env, k, null)));
      part.forEach((k, j) => { if (got[j] && typeof got[j] === "object") recs.set(k, got[j]); });
    }
    R.recs = recs;
  }
  return R;
}
/* gift hash -> KV key for every member, worked out once per roster (the gift list shows who a gift belongs to). */
async function giftIndex(c, R) {
  if (!R.giftOf) {
    const m = new Map();
    for (let i = 0; i < R.keys.length; i += 100) {
      const part = R.keys.slice(i, i + 100), hs = await Promise.all(part.map(k => c.H.giftHash(k.slice(4))));
      part.forEach((k, j) => m.set(String(hs[j]), k));
    }
    R.giftOf = m;
  }
  return R.giftOf;
}
async function findMember(c, id) {
  id = String(id || "");
  if (!ID_RE.test(id)) return null;
  let R = await roster(c, false), k = R.byId.get(id);
  if (!k) { ROSTER = null; R = await roster(c, false); k = R.byId.get(id); }   // joined in the last minute
  if (!k) return null;
  const sub = await c.H.kvGet(c.env, k, null);
  return sub && typeof sub === "object" ? { id: id, k: k, email: k.slice(4), sub: sub } : null;
}

/* ---------- PII-free views ---------- */
/* An @, 6+ digits in a row, or a phone-like run (7+ digits split by spaces, dots, slashes, underscores, dashes or
   parens). A run made only of years ("1950-1960", "1960 1970s") is a date range, not a number. index.js also uses
   this on search terms before keeping them. */
const YEARS = /^(?:1[89]\d\d|20\d\d)(?:[\s.\/_-]+(?:1[89]\d\d|20\d\d))*$/;
export function looksPersonal(t) {
  t = String(t == null ? "" : t);
  if (/@/.test(t) || /\d{6,}/.test(t)) return true;
  for (const run of t.match(/\d[\d\s.\/_()-]*\d/g) || []) if (run.replace(/\D/g, "").length >= 7 && !YEARS.test(run)) return true;
  return false;
}
/* The member's own ZIP code (from their settings) as a whole number anywhere in their text: a hunt like
   "estate sale 48375" would show it. Other 5-digit numbers (model and pattern numbers) stay visible. */
function hasZip(t, zip) { zip = String(zip == null ? "" : zip); return /^\d{5}$/.test(zip) && new RegExp("(^|\\D)" + zip + "(\\D|$)").test(t); }
export function scrubHunt(h, zip) {
  const t = String(h == null ? "" : h).slice(0, 80);
  return looksPersonal(t) || hasZip(t, zip) ? { text: HIDDEN, hidden: true } : { text: t, hidden: false };
}
/* alPrefs turns skip words into plain lower-case words ("jane.doe@x.com" -> "jane doe x com"), which drops the @
   that gives an address away. So a word is also hidden when the member's own typing of it looked personal. */
const plainWords = s => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function skipView(sub, words, zip) {
  const raw = sub && sub.prefs && Array.isArray(sub.prefs.skip) ? sub.prefs.skip : [];
  const bad = raw.map(r => String(r == null ? "" : r).slice(0, 200)).filter(looksPersonal).map(plainWords).filter(Boolean);
  return arr(words).map(w => {
    const t = plainWords(w);
    return scrubHunt(w, zip).hidden || (t && bad.some(b => b.indexOf(t) === 0)) ? HIDDEN : String(w).slice(0, 40);
  });
}
/* The sites their emails search: their chosen ones that are still live search sources (Depop is off for everyone since
   v76, but alPrefs still lists it, and index.js alHunt skips it). */
function emailSources(H, p) {
  let live = null;
  try { live = arr(H.liveSources()).map(String); } catch (e) { live = null; }
  const s = arr(p.sources).map(x => word(x, 20));
  return live && live.length ? s.filter(x => live.indexOf(x) !== -1) : s;
}
/* The listings waiting for the member's next email (pend:<email>), by URL. A check remembers what it finds in the
   "already sent" memory (seen:) straight away, so these are in it too, but they have not been emailed yet. */
function waitingUrls(pend) {
  const s = new Set();
  if (pend && typeof pend === "object" && !Array.isArray(pend)) for (const k of Object.keys(pend).slice(0, 60)) for (const x of arr(pend[k])) if (x && typeof x.url === "string" && x.url) s.add(x.url);
  return s;
}
function listing(x) {
  x = x || {};
  return { title: String(x.title || "").slice(0, 160), price: String(x.price || "").slice(0, 40), src: word(x.src, 20), url: https(x.url) };
}
/* Everything the views need, worked out the way the alert clock does it. Internal only. */
function state(env, sub, H, now) {
  const s = Array.isArray(sub.hunts) ? sub : Object.assign({}, sub, { hunts: [] });
  const hunts = s.hunts.map(String), p = H.alPrefs(s), loc = H.alLocal(s, now) || now;
  const active = hunts.length ? arr(H.alActive(env, s)).map(String) : [];
  const done = s.day === now.day ? arr(s.done).map(String) : [];
  const mailOn = s.mail !== "off", paused = !!H.alPaused(s, loc);
  const working = hunts.length > 0 && mailOn && !paused;        // the alert clock checks this member today
  const slot = num(H.alSlotHour(env, s));
  const due = working && !!H.alSendDay(s, loc);
  /* sent = the member-local day today's run finished (an email went, or nothing was new, or they turned emails back
     on); mailed (v78) = the day an email really went out. Only mailed counts as "sent" or "last email". */
  const doneToday = !!s.sent && s.sent === loc.day, mailedToday = !!s.mailed && s.mailed === loc.day;
  return { s: s, now: now, hunts: hunts, p: p, loc: loc, active: active, done: done, mailOn: mailOn, paused: paused, working: working, slot: slot,
    due: due, doneToday: doneToday, mailedToday: mailedToday, late: due && !doneToday && !mailedToday && num(loc.hour) > slot };
}
export function memberSummary(env, sub, H, now, extra) { return summaryOf(state(env, sub, H, now), H, extra); }
function summaryOf(st, H, extra) {
  const s = st.s, pl = s.plan && typeof s.plan === "object" ? s.plan : {};
  const via = word(pl.via, 30), mute = arr(st.p.mute);
  const plan = s.pro ? (pl.trial ? "trial" : "pro") : (H.alLegacyFree(s) ? "free (legacy)" : "free");
  const checked = st.active.filter(h => st.done.indexOf(h.toLowerCase()) !== -1).length;
  const unmuted = st.hunts.filter(h => mute.indexOf(h.toLowerCase()) === -1).length;
  const flags = [];
  if (!st.mailOn) flags.push("emails off");
  if (st.paused) flags.push("paused");
  if (!st.hunts.length) flags.push("no hunts");
  if (st.late) flags.push("email late");
  if (s.pro === null || (s.proCheck && String(s.proCheck).length) || /shopify|error|unreachable|token|fail/i.test(via)) flags.push("pro check failing");   // v78: proCheck = last failed Shopify check
  if (extra && extra.signin) flags.push("sign-in link waiting");
  if (arr(s.prev).length || s.movedAt) flags.push("moved address");
  if (unmuted > st.active.length) flags.push("hunts over plan limit");   // only the first few are checked on the free plan
  const until = day10(pl.until);
  if (s.pro && pl.via === "gift" && until && st.now && until < String(st.now.day || "")) flags.push("gift ended");   // until the daily Pro check catches up
  return {
    id: "", plan: plan, via: via, hunts: st.hunts.length, active: st.active.length, mail: st.mailOn ? "on" : "off",
    paused: st.paused, pauseUntil: st.paused ? day10(st.p.pause) : "",
    freq: H.alFreeWeekly(s) ? "weekly" : word(st.p.freq, 12), slotHour: st.slot, tz: word(st.p.tz || H.AL_TZ || "", 64),
    created: day10(s.created), lastSent: day10(s.mailed), sentToday: st.mailedToday, doneToday: st.doneToday, checkedToday: checked,
    activeToday: st.working ? st.active.length : 0, dueToday: st.due, late: st.late, flags: flags
  };
}
function brokenSummary() {
  return { id: "", plan: "free", via: "", hunts: 0, active: 0, mail: "on", paused: false, pauseUntil: "", freq: "", slotHour: 0, tz: "",
    created: "", lastSent: "", sentToday: false, doneToday: false, checkedToday: 0, activeToday: 0, dueToday: false, late: false, flags: ["record unreadable"] };
}
function safeSummary(env, sub, H, now, extra) { try { return memberSummary(env, sub, H, now, extra); } catch (e) { return brokenSummary(); } }

/* Free Pro for one member: the gift record (note, dates) and whether the PRO_EMAILS list counts for them. */
function giftInfo(listed, gift, off, today) {
  const g = gift && typeof gift === "object" && !Array.isArray(gift) ? gift : null, on = giftActive(g, today), viaList = !!listed && !off;
  return { active: viaList || on, source: viaList ? "list" : on ? "gift" : null, until: g ? day10(g.until) : "", note: g ? giftNote(g.note) : "",
    added: g ? day10(g.added) : "", ended: !!g && !on, listed: !!listed, listOff: !!listed && !!off };
}
/* Free Pro for a member: their own address first, then up to two earlier ones (as index.js alProSet checks them).
   The first that gives free Pro is shown, marked earlier when it is an old address; the address itself never is. */
async function giftOf(env, H, email, prev, today) {
  if (!email || typeof H.giftHash !== "function") return null;
  const addrs = [email].concat(arr(prev).map(String).filter(Boolean).slice(0, 2));
  const infos = await Promise.all(addrs.map(async a => {
    const gh = String(await H.giftHash(a));
    const [g, off] = await Promise.all([H.kvGet(env, "gift:" + gh, null), H.kvGet(env, "giftoff:" + gh, null)]);
    return giftInfo(!!(typeof H.proListHas === "function" && H.proListHas(env, a)), g, off, today);
  }));
  const i = Math.max(0, infos.findIndex(x => x.active));
  return Object.assign(infos[i], { earlier: i > 0 });
}
export async function memberDetail(env, sub, H, now) {
  const email = String(sub.email || ""), kv = env.PROWL_ALERTS;
  const has = async k => { try { return email !== "" && (await kv.get(k)) != null; } catch (e) { return false; } };
  const [pend, seen, signin, conf, mvf] = email ? await Promise.all([H.kvGet(env, "pend:" + email, {}), H.kvGet(env, "seen:" + email, []),
    has("in:" + email), has("conf:" + email), has("mvf:" + email)])
    : [{}, [], false, false, false];
  const st = state(env, sub, H, now), p = st.p, s = st.s, pl = s.plan && typeof s.plan === "object" ? s.plan : {}, zip = p.zip;
  const d = summaryOf(st, H, { signin: signin });
  const mute = arr(p.mute), act = st.active.map(h => h.toLowerCase());
  d.planName = d.plan;
  d.hunts = st.hunts.map(h => {
    const v = scrubHunt(h, zip), l = h.toLowerCase();
    return { text: v.text, hidden: v.hidden, active: act.indexOf(l) !== -1, muted: mute.indexOf(l) !== -1, local: !!H.alNear(s, h), checkedToday: st.done.indexOf(l) !== -1 };
  });
  d.prefs = { freq: d.freq, slotHour: d.slotHour, tz: d.tz, sources: emailSources(H, p), maxPrice: num(p.max),
    skipWords: skipView(s, p.skip, zip), filtersApply: !!s.pro, pauseUntil: day10(p.pause), aiOff: !!p.noai,
    zipSet: !!p.zip, radius: num(p.radius), localHunts: arr(p.local).length };
  d.plan = { name: d.planName, via: d.via, trial: !!pl.trial, paidDay: day10(pl.paid), renewsDay: day10(pl.renews), amount: word(pl.amount, 12),
    currency: word(pl.currency, 8), order: word(pl.order, 20), hadPro: !!s.hadPro, checkedDay: day10(s.proDay) };
  const ph = []; let total = 0;
  if (pend && typeof pend === "object" && !Array.isArray(pend)) for (const k of Object.keys(pend).slice(0, 60)) {
    const items = arr(pend[k]); total += items.length;
    ph.push({ text: scrubHunt(k, zip).text, n: items.length, sample: items.slice(0, 3).map(listing) });
  }
  d.pending = { total: total, hunts: ph };
  const queued = waitingUrls(pend);
  d.seenCount = arr(seen).filter(u => !/^t:/.test(String(u)) && !queued.has(String(u))).length;   // listings emailed (each also has a title key); not the ones still waiting
  d.signinWaiting = signin; d.confirmWaiting = conf; d.moveWaiting = mvf;
  d.previousAddresses = arr(s.prev).length; d.movedAt = day10(s.movedAt); d.mailOffDay = day10(s.mailOffAt);
  d.plan.until = day10(pl.until);
  d.gift = await giftOf(env, H, email, s.prev, day10(now && now.day) || utcDay(Date.now()));
  return d;
}
function summaries(c, R, now) {
  const out = [];
  for (const k of R.keys) {
    const sub = R.recs.get(k); if (!sub) continue;
    const v = safeSummary(c.env, sub, c.H, now);
    v.id = R.idOf.get(k); out.push(v);
  }
  return out;
}
/* The overview's member and alert-email numbers (counts only, nothing personal). The alert clock (index.js alTick)
   works them out from the records it has already read and sends them with its run record; apiOverview falls back
   to reading the members itself only when no recent run carried them. */
function countsFrom(list, nowMs) {
  const n = f => list.filter(f).length, sum = f => list.reduce((t, s) => t + f(s), 0), cut = utcDay(nowMs - 6 * 86400000);
  return { total: list.length, pro: n(s => s.plan === "pro"), gifted: n(s => (s.plan === "pro" || s.plan === "trial") && (s.via === "gift" || s.via === "list")),
    trial: n(s => s.plan === "trial"), free: n(s => s.plan === "free"), freeLegacy: n(s => s.plan === "free (legacy)"), mailOff: n(s => s.mail === "off"),
    paused: n(s => s.paused), noHunts: n(s => !s.hunts), new7d: n(s => !!s.created && s.created >= cut), hunts: sum(s => s.hunts), activeHunts: sum(s => s.active),
    dueToday: n(s => s.dueToday), sentToday: n(s => s.sentToday), late: n(s => s.late), checkedToday: sum(s => s.checkedToday),
    huntsLeftToday: sum(s => s.dueToday && !s.doneToday ? Math.max(0, s.activeToday - s.checkedToday) : 0) };
}
export function rosterCounts(env, subs, H, now, nowMs) {
  const list = [];
  for (const sub of arr(subs)) if (sub && typeof sub === "object") list.push(safeSummary(env, sub, H, now));
  return countsFrom(list, num(nowMs) || Date.now());
}

/* ---------- metrics views ---------- */
/* A search term from the logs: statTerm turns "555-123-4567" into "555 123 4567" and keeps it, so the
   phone-number rule runs on its answer too. */
function termView(c, raw) {
  const t = c.H.statTerm ? c.H.statTerm(String(raw == null ? "" : raw)) : "";
  return t && !looksPersonal(t) ? t : "";
}
function errView(c, e) {
  e = e || {};
  return { t: num(e.t), r: word(e.r, 40), s: num(e.s), m: clean(e.m, 160), q: termView(c, e.q) };
}
function auditView(a) {
  a = a || {};
  return { t: num(a.t), action: word(a.action, 30), id: ID_RE.test(String(a.id)) || GID_RE.test(String(a.id)) ? a.id : "", ok: !!a.ok, note: clean(a.note, 80) };
}
function upView(u) {
  u = u || {};
  return { source: word(u.source, 20), pct24: u.pct24 == null ? null : num(u.pct24), pct7d: u.pct7d == null ? null : num(u.pct7d),
    checks24: num(u.checks24), checks7d: num(u.checks7d), lastOkAt: u.lastOkAt ? word(u.lastOkAt, 20) : null, lastStatus: num(u.lastStatus),
    lastMs: num(u.lastMs), lastAt: num(u.lastAt), lastErr: clean(u.lastErr, 160), lastN: num(u.lastN), down: !!u.down };
}
function topView(c, j) {
  const out = [];
  for (const r of arr(j && j.top)) {
    const t = termView(c, r && r.term);   // stored terms are scrubbed already; this is the second net
    if (t) out.push({ term: t, visitors: num(r.visitorDays), requests: num(r.requests) });
  }
  return out;
}
async function capsJson(c, name, op, q) {
  const j = await c.H.capsCall(name, op, q);
  if (!j || typeof j !== "object" || j.error) throw new Error("caps " + op);
  return j;
}
const utcDay = ms => new Date(ms).toISOString().slice(0, 10);

/* ---------- API ---------- */
const MSG_METRICS = "Speed, error and uptime numbers are not available.", MSG_SEARCH = "Search counts are not available.";
const MEMBER_KEYS = ["total", "pro", "gifted", "trial", "free", "freeLegacy", "mailOff", "paused", "noHunts", "new7d", "hunts", "activeHunts"];
const ALERT_KEYS = ["dueToday", "sentToday", "late", "checkedToday", "huntsLeftToday"];
const pickNums = (o, keys) => { const r = {}; for (const k of keys) r[k] = num(o && o[k]); return r; };
/* The parts of the overview that change slowly (the week's top searches, 7 days of hourly uptime checks, the day's
   alert runs) are read at most every 10 minutes per isolate, not on every 60-second refresh: each read lists
   thousands of Durable Object rows, and the free plan allows 5 million row reads a day for the whole site. */
let SLOW = null;
async function slowParts(c, grab) {
  const kept = SLOW && SLOW.h === c.H && c.nowMs >= SLOW.at && c.nowMs - SLOW.at < SLOW_TTL ? SLOW : null;
  const today = utcDay(c.nowMs);
  const [M2, topW] = await Promise.all([   // a part that failed is asked again on the next refresh
    kept && kept.M2 ? kept.M2 : grab(MSG_METRICS, () => capsJson(c, "metrics", "mget", { hours: 0, errors: 0, crons: 300, probeDays: 7, audit: 0 })),
    kept && kept.topW ? kept.topW : grab(MSG_SEARCH, () => capsJson(c, "stats", "top", { kind: "t", from: utcDay(c.nowMs - 6 * 86400000), to: today, limit: 15 }))]);
  if (kept) { kept.M2 = M2; kept.topW = topW; return kept; }
  return (SLOW = { h: c.H, at: c.nowMs, M2: M2, topW: topW });
}
const COUNTS_FRESH_MS = 30 * 60000;   // a newer alert run carries newer counts; older than this, the members are read here
async function apiOverview(c) {
  const H = c.H, env = c.env, nowMs = c.nowMs, issues = [];
  const grab = async (what, fn) => { try { return await fn(); } catch (e) { if (issues.indexOf(what) === -1) issues.push(what); return null; } };
  const now = H.alNow(env), today = utcDay(nowMs);
  const capsDay = typeof H.capsDay === "function" ? H.capsDay() : "caps:" + today;
  const pools = arr(H.POOLS);
  const [M, peek, topT, lib, slow] = await Promise.all([
    grab(MSG_METRICS, () => capsJson(c, "metrics", "mget", { hours: 26, errors: 20, crons: 1, probeDays: 0, audit: 15 })),
    grab("AI usage is not available.", () => capsJson(c, capsDay, "peek", { keys: pools.map(p => p.key) })),
    grab(MSG_SEARCH, () => capsJson(c, "stats", "top", { kind: "t", from: today, to: today, limit: 15 })),
    grab(MSG_METRICS, () => metricsLib(H)),
    slowParts(c, grab)
  ]);
  const M2 = slow.M2, topW = slow.topW;
  const c0 = M ? arr(M.crons).filter(x => x && typeof x === "object")[0] : null;
  let members = null, alerts = null, countsAt = null;
  if (c0 && c0.counts && typeof c0.counts === "object" && nowMs - num(c0.t) < COUNTS_FRESH_MS) {
    members = Object.assign(pickNums(c0.counts, MEMBER_KEYS), { truncated: false });
    alerts = pickNums(c0.counts, ALERT_KEYS);
    countsAt = new Date(num(c0.t)).toISOString();
  } else {
    const R = await grab("The member list could not be read.", () => roster(c, true));
    if (R) {
      const k = countsFrom(summaries(c, R, now), nowMs);
      members = Object.assign(pickNums(k, MEMBER_KEYS), { truncated: R.truncated });
      alerts = pickNums(k, ALERT_KEYS);
      countsAt = new Date(R.at).toISOString();
    }
  }
  let traffic = null, uptime = null, errors = null, auditList = null;
  if (M) {   // the newest run comes from the fresh read; the day's run counts from the slow one (null when it failed)
    const crons = M2 ? arr(M2.crons).filter(x => x && typeof x === "object") : [], day = nowMs - 86400000;
    const recent = crons.filter(x => num(x.t) >= day);
    const cron = {
      lastCron: c0 ? { at: new Date(num(c0.t)).toISOString(), ageMin: Math.max(0, Math.round((nowMs - num(c0.t)) / 60000)), ms: num(c0.ms),
        members: num(c0.members), checked: num(c0.checked), sent: num(c0.sent), failed: num(c0.failed), errors: arr(c0.errors).slice(0, 5).map(e => clean(e, 160)) } : null,
      cronRuns24h: M2 ? recent.length : null, cronFails24h: M2 ? recent.filter(x => num(x.failed) > 0 || arr(x.errors).length > 0).length : null };
    alerts = Object.assign(alerts || { dueToday: null, sentToday: null, late: null, checkedToday: null, huntsLeftToday: null }, cron);
    if (lib) traffic = await grab("Speed numbers could not be worked out.", async () => lib.summarize(arr(M.buckets), nowMs, 24));
    errors = arr(M.errors).slice(0, 20).map(e => errView(c, e));
    auditList = arr(M.audit).slice(0, 15).map(auditView);
  } else if (alerts) Object.assign(alerts, { lastCron: null, cronRuns24h: null, cronFails24h: null });
  if (lib && M2) uptime = await grab("Uptime numbers could not be worked out.", async () => arr(lib.uptimeFrom(arr(M2.probes), nowMs)).map(upView));
  const values = (peek && peek.values) || {};
  const ai = peek ? { pools: pools.map(p => { const used = num(values[p.key]), limit = num(p.limit); return { name: String(p.name || p.key), used: used, limit: limit, pct: limit ? Math.round(used * 100 / limit) : 0 }; }) } : null;
  let live = [];
  try { live = arr(H.liveSources()).map(s => word(s, 20)); } catch (e) {}
  return jres({
    version: H.WORKER_VERSION, now: { iso: new Date(nowMs).toISOString(), detroitDay: now.day, detroitHour: now.hour },
    members: members, alerts: alerts, countsAt: countsAt, traffic: traffic, uptime: uptime, ai: ai, errors: errors,
    searches: topT || topW ? { today: topT ? topView(c, topT) : null, week: topW ? topView(c, topW) : null } : null,
    audit: auditList, liveSources: live, issues: issues
  });
}

const FILTERS = {
  all: () => true, pro: s => s.plan === "pro", trial: s => s.plan === "trial", free: s => s.plan === "free" || s.plan === "free (legacy)",
  late: s => s.late, mailoff: s => s.mail === "off", paused: s => s.paused, issues: s => s.flags.some(f => ISSUE_FLAGS.indexOf(f) !== -1)
};
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const SORTS = { created: (a, b) => byStr(b.created, a.created), hunts: (a, b) => b.hunts - a.hunts, lastSent: (a, b) => byStr(b.lastSent, a.lastSent) };
async function apiMembers(c) {
  if (c.url.searchParams.get("fresh") === "1") ROSTER = null;   // the page's Refresh button: read every member again now
  const R = await roster(c, true), now = c.H.alNow(c.env);
  const f = c.url.searchParams.get("filter"), o = c.url.searchParams.get("sort");
  const filter = Object.prototype.hasOwnProperty.call(FILTERS, f) ? f : "all", sort = Object.prototype.hasOwnProperty.call(SORTS, o) ? o : "created";
  const all = summaries(c, R, now);
  const list = all.filter(FILTERS[filter]).sort((a, b) => SORTS[sort](a, b) || byStr(a.id, b.id));
  return jres({ members: list, total: all.length, shown: list.length, truncated: R.truncated, filter: filter, sort: sort });
}

async function apiFind(c) {
  if (!(await c.H.vCount("admfind", 300))) return jerr(429, "Too many look-ups today. Try again tomorrow.");
  const email = String(c.body.email == null ? "" : c.body.email).trim().toLowerCase();
  if (!email || email.length > 120 || !/^[^\s@]+@[^\s@]+$/.test(email)) return jerr(400, "Type the member's whole email address.");
  let target = email, moved = false;
  let sub = await c.H.kvGet(c.env, "sub:" + email, null);
  if (!sub) {   // an address they moved away from still finds them
    const mv = await c.H.kvGet(c.env, "moved:" + email, null), to = mv && typeof mv.to === "string" ? mv.to.trim().toLowerCase() : "";
    if (to) { sub = await c.H.kvGet(c.env, "sub:" + to, null); if (sub) { target = to; moved = true; } }
  }
  if (!sub) {
    /* the usual "I signed up but get nothing": they never tapped the confirm link, so only conf:<email> exists */
    const waiting = !!(await c.H.kvGet(c.env, "conf:" + email, null));
    await audit(c, { action: "find", ok: false, note: waiting ? "confirm link waiting" : "" });
    return jerr(404, waiting ? "Not a member yet: they started signing up but have not tapped the confirm link we emailed them (it works for 2 days). Ask them to look in spam for the Prowl email and tap \u201cYes, email me\u201d. Then they show up here."
      : "No member with that email. Check the spelling; they may have signed up with a different address.");
  }
  const id = await memberId(c.salt, target);
  await audit(c, { action: "find", id: id, ok: true, note: moved ? "found by an earlier address" : "" });
  return jres(moved ? { id: id, moved: true } : { id: id });
}

async function apiMember(c) {
  const m = await findMember(c, c.url.searchParams.get("id"));
  if (!m) return jerr(404, "No member with that id. They may have deleted their account.");
  const d = await memberDetail(c.env, m.sub, c.H, c.H.alNow(c.env));
  d.id = m.id;
  return jres(d);
}

/* ---------- Gift Pro ---------- */
const todayOf = c => day10(c.H.alNow(c.env).day) || utcDay(c.nowMs);   // Detroit day, as alPro counts it
/* A paid (or free-month) Prowl Pro order in the shop: a gift does not cancel it, so the owner is told. A free month
   keeps running under the gift, and Prowl still emails them 3 days before its first charge (index.js alTrialPlan). */
const paidPro = sub => !!sub.pro && !!sub.plan && typeof sub.plan === "object" && sub.plan.via === "order";
const SUB_NOTE = " They also have a Prowl Pro subscription in the shop; the gift does not cancel it, so cancel it there if they should not be charged.";
/* index.js counts any Pro as their one free month (hadPro), so the page then offers the paid plan, not a free month */
const FIRST_NOTE = " This counts as their one free Prowl Pro month: after the gift ends, the Prowl page offers them the paid plan rather than a free month.";
/* Writes (or renews) the gift for one address and clears a PRO_EMAILS switch-off. Only the hash is stored.
   An empty note keeps the note already on the gift. paid: they paid for Pro in the shop when gifted; kept on the
   gift, because the gift then replaces the shop plan on their record, so a later Gift Pro cannot see it. */
async function saveGift(c, email, months, rawNote, paid) {
  const H = c.H, gh = String(await H.giftHash(email)), until = months ? addMonths(todayOf(c), months) : "";
  const old = await H.kvGet(c.env, "gift:" + gh, null), n = giftNote(rawNote), o = old && typeof old === "object" ? old : {};
  const rec = { note: n || giftNote(o.note), added: new Date(c.nowMs).toISOString(), until: until, by: "admin" };
  if (paid || o.paid === true) rec.paid = true;
  await H.kvPut(c.env, "gift:" + gh, rec);
  await c.env.PROWL_ALERTS.delete("giftoff:" + gh);
  return { gh: gh, gid: gh.slice(0, 10), until: until, paid: !!rec.paid };
}
/* The member an address moved to, following up to three moves (as alProSet checks up to two earlier addresses). */
async function movedMember(c, email) {
  let a = email;
  for (let i = 0; i < 3; i++) {
    const mv = await c.H.kvGet(c.env, "moved:" + a, null), to = mv && typeof mv.to === "string" ? mv.to.trim().toLowerCase() : "";
    if (!to || to === email || to === a) return null;
    const s = await c.H.kvGet(c.env, "sub:" + to, null);
    if (s && typeof s === "object") return { email: to, sub: s };
    a = to;
  }
  return null;
}
/* The how-to email for a gift, when the owner ticks "Email them". Never to a member who turned Prowl emails off or
   whose Pro did not switch on; at most GIFT_MAIL_PER_DAY a day and GIFT_MAIL_PER_PERSON a day to one person (counted
   by gift id, so no address goes into a counter), and only emails that went out are counted. The mail service's own
   error is never shown: it can quote the address. paid: they also pay for Pro in the shop, so the email says the gift
   does not cancel that. Returns the owner's words, starting with a space. */
async function giftMail(c, email, gid, until, sub, paid) {
  const H = c.H, dayKey = "admgiftmail", oneKey = "admgiftmail:" + gid;
  if (typeof H.alSendGift !== "function") return { sent: false, text: " No email was sent: this worker cannot send gift emails." };
  if (sub && sub.mail === "off") return { sent: false, text: " No email was sent: they have turned Prowl emails off." };
  if (sub && !sub.pro) return { sent: false, text: " No email was sent, because Pro is not on for them yet." };
  const [all, one] = await Promise.all([peekCount(c, dayKey), peekCount(c, oneKey)]);
  if (all === null || one === null) return { sent: false, text: " No email was sent: the daily email count did not answer. Try again in a minute." };
  if (all >= GIFT_MAIL_PER_DAY) return { sent: false, text: " No email was sent: that is " + GIFT_MAIL_PER_DAY + " gift emails today. Try again tomorrow." };
  if (one >= GIFT_MAIL_PER_PERSON) return { sent: false, text: " No email was sent: they already got " + GIFT_MAIL_PER_PERSON + " gift emails today." };
  let r = null;
  try { r = await H.alSendGift(c.env, email, until, sub || null, { paid: !!paid }); } catch (e) { r = null; }
  if (r && r.ok) {
    await Promise.all([take(c, dayKey, GIFT_MAIL_PER_DAY), take(c, oneKey, GIFT_MAIL_PER_PERSON)]);
    return { sent: true, text: sub ? " We emailed them that Pro is on, with a link that opens Prowl signed in." + (paid ? " The email also says a shop subscription keeps going until it is cancelled." : "")
      : " We emailed them how to start, with a one-tap link that signs them up (it works for 14 days)." };
  }
  const why = r && r.why;
  return { sent: false, text: why === "stopped" ? " No email was sent: this address used the link in an earlier gift email to stop gift emails."
    : why === "off" ? " No email was sent: Prowl Alerts is switched off (ALERTS in Cloudflare)."
    : why === "nomail" ? " No email was sent: Prowl email is not set up (RESEND_API_KEY in Cloudflare)."
    : why === "nokey" ? " No email was sent: the start link could not be made (ADMIN_KEY)."
    : " The email to them did not send, but the gift still counts. To try again, gift them again with the same length." };
}
const wantsMail = b => b.tell === true;
async function listKeys(kv, prefix, max) {
  const names = []; let cursor, more = false;
  do {
    const l = await kv.list({ prefix: prefix, cursor: cursor, limit: 1000 });
    for (const k of arr(l && l.keys)) names.push(String(k.name));
    cursor = l && !l.list_complete ? l.cursor : undefined;
    if (names.length >= max) { more = names.length > max || !!cursor; names.length = max; break; }
  } while (cursor);
  return { names: names, more: more };
}
async function apiGifts(c) {
  const H = c.H, env = c.env, kv = env.PROWL_ALERTS, today = todayOf(c);
  const [G, O] = await Promise.all([listKeys(kv, "gift:", GIFT_MAX), listKeys(kv, "giftoff:", GIFT_MAX)]);
  const recs = [];
  for (let i = 0; i < G.names.length; i += 50) recs.push.apply(recs, await Promise.all(G.names.slice(i, i + 50).map(k => H.kvGet(env, k, null))));
  let R = null, idx = null;
  try { R = await roster(c, false); idx = await giftIndex(c, R); } catch (e) { idx = null; }   // the list still shows, just without member links
  const rows = G.names.map((k, i) => {
    const hash = k.slice(5), g = recs[i] && typeof recs[i] === "object" && !Array.isArray(recs[i]) ? recs[i] : {}, mk = idx && idx.get(hash);
    const until = day10(g.until), active = giftActive(g, today);
    return { at: String(g.added || ""), v: { gid: hash.slice(0, 10), memberId: mk ? R.idOf.get(mk) || null : null, note: giftNote(g.note), added: day10(g.added),
      until: until, active: active, expired: !!until && until < today } };
  });
  rows.sort((a, b) => byStr(b.at, a.at) || byStr(a.v.gid, b.v.gid));   // newest first
  return jres({ gifts: rows.map(r => r.v), listCount: num(typeof H.proListCount === "function" ? H.proListCount(env) : 0), listOff: O.names.length,
    truncated: G.more, today: today });
}
async function apiGiftAdd(c) {
  const H = c.H, env = c.env;
  if (!(await H.vCount("admgift", 100))) return jerr(429, "That is a lot of gifts today. Try again tomorrow.");
  const email = H.alEmail(String(c.body.email == null ? "" : c.body.email));   // used for the hash only: never echoed, logged or stored
  if (!email) return jerr(400, "Type the person's whole email address.");
  const months = giftMonths(c.body.months);
  if (months < 0) return jerr(400, "Pick how long: forever, 1, 3, 6 or 12 months.");
  let sub = await H.kvGet(env, "sub:" + email, null), target = email, moved = false;
  if (!sub || typeof sub !== "object") {   // an address a member moved away from: the gift goes to the member's own address
    const mm = await movedMember(c, email);
    if (mm) { sub = mm.sub; target = mm.email; moved = true; } else sub = null;
  }
  const paid = !!sub && paidPro(sub);
  const g = await saveGift(c, target, months, c.body.note, paid);
  let id = null, gone = false, msg = "Gift saved. Prowl Pro is free for this person " + giftEnds(g.until) + ", starting as soon as they sign up for Prowl Alerts with that email.";
  if (sub) {
    id = await memberId(c.salt, target);
    const first = !sub.hadPro;
    await H.alProSet(env, sub, false);   // the gift check comes before any Shopify call
    const r = await H.alMerge(env, sub, PRO_FIELDS);
    ROSTER = null;
    msg = !r ? "Gift saved. That member deleted their account a moment ago; the gift still applies if they sign up again with that email."
      : r.pro ? "Prowl Pro is now free for " + id + " " + giftEnds(g.until) + "." + (r.plan && r.plan.via === "list" ? " (They also get it from the PRO_EMAILS list in Cloudflare.)" : "")
      : "Gift saved for " + id + ", but Pro did not switch on yet. Press Re-check Pro on their page in a minute.";
    if (r && moved) msg += " That address moved to " + id + ", so the gift follows them there.";
    if (r && paid) msg += SUB_NOTE;
    if (r && r.pro && first) msg += FIRST_NOTE;
    gone = !r;
  }
  let mailed = false;
  if (wantsMail(c.body) && !gone) { const m = await giftMail(c, target, g.gid, g.until, sub, g.paid); msg += m.text; mailed = m.sent; }
  await audit(c, { action: "gift-add", id: id || g.gid, ok: true, note: monthsWord(months) + (mailed ? ", emailed" : "") });
  return jres({ ok: true, message: msg, gid: g.gid, memberId: id, emailed: mailed });
}
async function apiGiftRemove(c) {
  const H = c.H, env = c.env, kv = env.PROWL_ALERTS;
  if (!(await H.vCount("admgift", 100))) return jerr(429, "That is a lot of gift changes today. Try again tomorrow.");
  const gid = String(c.body.gid == null ? "" : c.body.gid).trim().toLowerCase();
  if (!GID_RE.test(gid)) return jerr(400, "That gift id is not right. Reload the page and try again.");
  const l = await kv.list({ prefix: "gift:" + gid, limit: 2 }), names = arr(l && l.keys).map(k => String(k.name));
  if (!names.length) return jerr(404, "No gift with that id. It may have been turned off already.");
  if (names.length > 1) return jerr(409, "Two gifts share that id, so nothing changed. Turn it off from the member's page instead.");
  const hash = names[0].slice(5);
  await kv.delete(names[0]);
  let id = null, k = null, R = null, msg = "Gift turned off. This person had not signed up yet, so nothing else changed. If you emailed them a start link, it now says the gift has ended.";
  try {
    const cached = ROSTER;
    R = await roster(c, false); k = (await giftIndex(c, R)).get(hash) || null;
    if (!k && R === cached) { ROSTER = null; R = await roster(c, false); k = (await giftIndex(c, R)).get(hash) || null; }   // they may have joined since the cached list was made
  } catch (e) { k = null; }
  const sub = k ? await H.kvGet(env, k, null) : null;
  if (sub && typeof sub === "object") {
    id = R.idOf.get(k) || null;
    await H.alProSet(env, sub, false);
    const r = await H.alMerge(env, sub, PRO_FIELDS);
    ROSTER = null;
    msg = !r ? "Gift turned off." : r.pro && r.plan && r.plan.via === "list" ? "Gift turned off. " + id + " still gets free Pro from the PRO_EMAILS list in Cloudflare; turn that off from their member page."
      : r.pro ? "Gift turned off. " + id + " still has Prowl Pro because they pay for it in the shop."
      : "Gift turned off. " + id + " is on the free plan now unless they pay.";
  }
  await audit(c, { action: "gift-remove", id: id || gid, ok: true });
  return jres({ ok: true, message: msg, gid: gid, memberId: id });
}

/* "Send today's email again": index.js alDigest keeps what today's email carried for two days (last:<email>). It goes
   back with the listings waiting for the next email (already-sent listings are never found again by the checks), so
   the re-sent email really holds them. Returns how many listings came back (0 = no email went out today). */
async function restoreLast(c, sub, email) {
  const H = c.H, env = c.env, now = H.alNow(env), loc = H.alLocal(sub, now) || now;
  const last = await H.kvGet(env, "last:" + email, null), lp = last && typeof last === "object" ? last.pend : null;
  if (!lp || typeof lp !== "object" || Array.isArray(lp) || String(last.day || "") !== String(loc.day || "")) return 0;
  const cur = await H.kvGet(env, "pend:" + email, {}), pend = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
  const cap = 2 * (num(H.AL_PEND_CAP) || 30);
  let n = 0;
  for (const h of Object.keys(lp).slice(0, 60)) {
    const back = arr(lp[h]).filter(x => x && typeof x === "object"), urls = new Set(), out = [];
    for (const x of back.concat(arr(pend[h]))) { const u = String(x.url || ""); if (u && urls.has(u)) continue; if (u) urls.add(u); out.push(x); }
    n += back.length;
    pend[h] = out.slice(0, cap);
  }
  if (n) await H.kvPut(env, "pend:" + email, pend);
  return n;
}
/* "Sign out all devices" (and its cancelling of a waiting change of email address) is index.js alSignOutAll since v184,
   shared with the member's own Sign out every other device. */
async function apiAction(c) {
  const H = c.H, env = c.env, kv = env.PROWL_ALERTS;
  if (!(await H.vCount("admact", 300))) return jerr(429, "That is a lot of changes today. Try again tomorrow.");
  const action = String(c.body.action || ""), id = String(c.body.id || "");
  if (ACTIONS.indexOf(action) === -1) return jerr(400, "That action is not one this page knows.");
  const m = await findMember(c, id);
  if (!m) return jerr(404, "No member with that id. They may have deleted their account.");
  if (CONFIRM[action] && String(c.body.confirm || "").trim().toUpperCase() !== id.toUpperCase()) {
    await audit(c, { action: action, id: id, ok: false, note: "not confirmed" });
    return jerr(400, "To do this, type the member id " + id + " in the box first.", { needsConfirm: true });
  }
  const sub = m.sub, email = m.email;
  let ok = true, msg = "", note = "";
  const merge = async f => { const r = await H.alMerge(env, sub, f); if (!r) { ok = false; msg = "That member deleted their account a moment ago, so nothing changed."; } return r; };
  const refresh = async () => { await H.alProSet(env, sub, false); return merge(PRO_FIELDS); };   // free Pro is checked before any Shopify call
  if (action === "signin-link") {
    if (!(await H.vCount("admsig:" + id, 5))) return jerr(429, "This member already got 5 sign-in links from here today. Ask them to use the newest one, or check spam.");
    const r = await H.alSendSignin(env, sub);
    ok = !!(r && r.ok);
    msg = ok ? "Sign-in link sent. It works once, for 24 hours. Ask them to check spam if it does not arrive in a few minutes."
      : "Could not send the sign-in email (" + (clean(r && r.error, 80) || "the mail service did not answer") + "). Try again in a few minutes.";
    if (!ok) note = "send failed";
  } else if (action === "refresh-pro") {
    const was = !!sub.pro;
    await H.alProSet(env, sub, true);
    if (await merge(PRO_FIELDS)) {
      const pl = sub.plan && typeof sub.plan === "object" ? sub.plan : {};
      if (sub.proCheck) {   // the shop was asked and did not answer (or is not set up): say so, not "checked"
        ok = false; note = "shop not reached";
        msg = (String(sub.proCheck) === "no token" ? "The shop is not connected (set SHOPIFY_ORDERS_CLIENT_ID and SHOPIFY_ORDERS_CLIENT_SECRET in Cloudflare), so Prowl could not check it."
          : "Could not reach the shop just now (" + clean(sub.proCheck, 40) + ").") +
          (was && !sub.pro ? " Their free Pro has ended, so they are on the free plan for now." : " Nothing changed.") + " Try again in a few minutes.";
      } else if (sub.pro && pl.via === "gift") msg = "They have free Pro from your gift (" + giftEnds(day10(pl.until)) + "), so the shop was not asked.";
      else if (sub.pro && pl.via === "list") msg = "They have free Pro from the PRO_EMAILS list in Cloudflare, so the shop was not asked.";
      else {
        msg = sub.pro ? (pl.trial ? "Checked the shop: they are on the free Prowl Pro month." : "Checked the shop: Prowl Pro is active.")
          : "Checked the shop: no current Prowl Pro order, so they are on the free plan.";
        if (was !== !!sub.pro) msg += was ? " They were Pro before this check." : " They were not Pro before this check.";
      }
    }
  } else if (action === "recheck-today" || action === "resend-today") {
    const again = action === "resend-today" ? await restoreLast(c, sub, email) : 0;
    sub.day = ""; sub.done = [];
    const f = ["day", "done"];
    if (action === "resend-today") { sub.sent = ""; f.push("sent"); }
    if (await merge(f)) msg = action === "recheck-today"
      ? "Their hunts will be checked again over the next few runs (every 5 minutes). If today's email has not gone out yet, it includes anything new."
      : again ? "Today's email (" + again + (again === 1 ? " listing" : " listings") + ") goes out again in a few minutes, once their hunts are checked again. Anything new since is added."
      : "No email went out to them today, so there is nothing to send again. Their hunts are checked again: anything new goes in today's email, and if nothing new turns up, no email is sent.";
    if (action === "resend-today") note = again ? "resent " + again : "nothing to resend";
  } else if (action === "mail-on") {
    /* as when they turn emails on themselves: today counts as done, so the next email is on their next email day */
    sub.mail = "on"; sub.mailOffAt = ""; sub.sent = (H.alLocal(sub, H.alNow(env)) || H.alNow(env)).day;
    if (await merge(["mail", "mailOffAt", "sent"])) msg = "Emails are on again. The next one goes out at their usual time on their next email day after today.";
  } else if (action === "mail-off") {
    sub.mail = "off"; sub.mailOffAt = new Date(c.nowMs).toISOString();
    if (await merge(["mail", "mailOffAt"])) {
      await kv.delete("pend:" + email);   // as when they turn emails off themselves: held listings would be stale by the time emails are back on
      msg = "Emails are off. Their hunts, settings and plan stay; listings that were waiting for their next email are dropped, and nothing is checked or sent until emails are back on.";
    }
  } else if (action === "unpause") {
    const fresh = await H.kvGet(env, m.k, null), base = fresh && fresh.prefs && typeof fresh.prefs === "object" && !Array.isArray(fresh.prefs) ? fresh.prefs : (sub.prefs && typeof sub.prefs === "object" ? sub.prefs : {});
    sub.prefs = Object.assign({}, base, { pause: "" });
    if (await merge(["prefs"])) msg = "Unpaused. Their hunts are checked again from the next run.";
  } else if (action === "signout-all") {
    const r = await H.alSignOutAll(env, sub, email);   // v184: new token, sessFrom (store sessions end too), in:/code:/conf: go, a waiting move is cancelled
    if (!r) { ok = false; msg = "That member deleted their account a moment ago, so nothing changed."; }
    else {
      const moved = r.moved;
      msg = "Signed out of Prowl on every phone and computer, and the store sessions Prowl made end. Prowl cannot end their Owl & Twig shop login: a device still logged in to the shop can sign back in through it, so on a lost device they should log out of the shop or change their store password. They can sign back in with a new sign-in link." +   // v185: say what it cannot do
        (moved ? " A waiting change of email address was cancelled too; they can ask for it again once signed back in." : "");
      if (moved) note = "address change cancelled";
    }
  } else if (action === "clear-seen") {
    await kv.delete("seen:" + email);
    msg = "Cleared. The next check treats every listing as new, so their next email may repeat listings they already saw.";
  } else if (action === "gift-on") {
    const months = giftMonths(c.body.months);
    if (months < 0) return jerr(400, "Pick how long: forever, 1, 3, 6 or 12 months.");
    const paid = paidPro(sub), first = !sub.hadPro, g = await saveGift(c, email, months, c.body.note, paid);
    note = monthsWord(months);
    if (await refresh()) {
      msg = !sub.pro ? "The gift is saved, but Pro did not switch on yet. Press Re-check Pro in a minute."
        : sub.plan && sub.plan.via === "list" ? "Prowl Pro is free for this member from the PRO_EMAILS list in Cloudflare again. The gift (" + giftEnds(g.until) + ") is saved too, in case they leave that list."
        : "Prowl Pro is now free for this member " + giftEnds(g.until) + ".";
      if (paid) msg += SUB_NOTE;
      if (sub.pro && first) msg += FIRST_NOTE;
      if (wantsMail(c.body)) { const gm = await giftMail(c, email, g.gid, g.until, sub, g.paid); msg += gm.text; if (gm.sent) note += ", emailed"; }
    }
  } else if (action === "gift-off") {
    /* their own address and up to two earlier ones, as index.js alProSet checks them for free Pro */
    const addrs = [email].concat(arr(sub.prev).map(String).filter(Boolean).slice(0, 2));
    let had = false, listedAny = false, allOff = true, earlier = false;
    for (let i = 0; i < addrs.length; i++) {
      const gh = String(await H.giftHash(addrs[i])), listed = !!(typeof H.proListHas === "function" && H.proListHas(env, addrs[i]));
      const [g, off] = await Promise.all([H.kvGet(env, "gift:" + gh, null), H.kvGet(env, "giftoff:" + gh, null)]);
      if (g) { had = true; if (i) earlier = true; await kv.delete("gift:" + gh); }
      if (listed) {   // the PRO_EMAILS list no longer counts for that address
        listedAny = true; if (!off) { allOff = false; if (i) earlier = true; }
        await H.kvPut(env, "giftoff:" + gh, { at: new Date(c.nowMs).toISOString() });
      }
    }
    const nothing = !had && (!listedAny || allOff);
    if (await refresh()) {
      msg = nothing ? "This member had no free Pro to turn off, so nothing changed."
        : sub.pro ? "Free Pro is off. They still have Prowl Pro because they pay for it in the shop."
        : sub.proCheck ? "Free Pro is off. The shop could not be checked for a paid plan just now, so they are on the free plan; press Re-check Pro later if they pay."
        : "Free Pro is off. They are on the free plan unless they pay.";
      if (!nothing && earlier) msg += " It came from an email address they used before.";
      if (listedAny && !nothing) msg += " Their address is still in the PRO_EMAILS list in Cloudflare, but it no longer gives them Pro. Gift Pro turns it back on.";
    }
    if (nothing) note = "nothing to turn off";
  } else if (action === "delete") {
    await H.alPurge(env, email, sub);   // index.js alPurge: the one list Delete in Prowl uses too (gifts stay)
    ROSTER = null;
    await audit(c, { action: action, id: id, ok: true });
    return jres({ ok: true, message: "Deleted. Their hunts, settings and saved listings are gone. A Prowl Pro subscription is billed by the store, so cancel it there if needed.", member: null });
  }
  ROSTER = null;   // the lists show the change straight away
  await audit(c, { action: action, id: id, ok: ok, note: note });
  const fresh = await H.kvGet(env, m.k, null);
  let member = null;
  if (fresh && typeof fresh === "object") {
    member = await memberDetail(env, fresh, H, H.alNow(env)); member.id = id;
    if (ok && (action === "recheck-today" || action === "resend-today")) {
      if (member.mail === "off") msg += " Emails are off for this member, so nothing goes out until they are back on.";
      else if (member.paused) msg += " They are paused until " + member.pauseUntil + ".";
      else if (action === "resend-today" && !member.dueToday) msg += " Today is not one of their email days, so it goes out on the next one.";
    }
  }
  return jres({ ok: ok, message: msg, member: member });
}

async function apiDiagnose(c) {
  const H = c.H, env = c.env, b = c.body;
  if (!(await H.vCount("admdiag", 150))) return jerr(429, "That is a lot of checks today. Try again tomorrow.");
  let term = String(b.term == null ? "" : b.term).replace(/\s+/g, " ").trim().slice(0, 60), m = null, huntIdx = -1;
  if (b.id != null && b.id !== "") { m = await findMember(c, b.id); if (!m) return jerr(404, "No member with that id."); }
  if (b.hunt != null && b.hunt !== "") {
    if (!m) return jerr(400, "Pick a member to check one of their hunts.");
    const i = Number(b.hunt), hs = arr(m.sub.hunts);
    if (!Number.isInteger(i) || i < 0 || i >= hs.length) return jerr(400, "That hunt is not on their list any more.");
    term = String(hs[i]).slice(0, 60); huntIdx = i;
  }
  if (!term) return jerr(400, "Type a search term, or pick one of a member's hunts.");
  const sub = m && m.sub, p = sub ? H.alPrefs(sub) : null, aiOff = !!(p && p.noai), local = !!(sub && H.alNear(sub, term)), zip = p ? p.zip : "";
  /* Whether the AI really hides anything: live results only when JEV_RESULTS is "on"; a member's emails also need
     ALERT_JEV not "off" and their own AI switch on (index.js alHunt). Otherwise it only labels listings. */
  const mode = typeof H.jevResultsMode === "function" ? String(H.jevResultsMode(env) || "off") : "off";
  const alertsAi = String((env && env.ALERT_JEV) || "on").toLowerCase() !== "off";
  const aiLive = mode === "on" && (!sub || (alertsAi && !aiOff));
  /* a member's hunt that their emails never search: muted, or past their plan's number of hunts */
  let hunt = null;
  if (huntIdx >= 0) {
    const l = term.toLowerCase();
    hunt = arr(p.mute).indexOf(l) !== -1 ? "muted" : arr(H.alActive(env, sub)).map(x => String(x).toLowerCase()).indexOf(l) === -1 ? "over plan limit" : "active";
  }
  const live = arr(H.liveSources()).map(String);
  let srcs = arr(b.sources).map(String).filter((s, i, a) => live.indexOf(s) !== -1 && a.indexOf(s) === i);
  if (!srcs.length) srcs = live.slice();
  /* a local hunt's emails search eBay only, near their ZIP code (alHunt), so that is what runs here */
  const localOnly = local && typeof H.liveFetchLocal === "function";
  if (localOnly) srcs = live.indexOf("ebay") !== -1 ? ["ebay"] : [];
  let seen = new Set(), queued = new Set();
  if (sub) {
    const [sl, pd] = await Promise.all([H.kvGet(env, "seen:" + m.email, []), H.kvGet(env, "pend:" + m.email, {})]);
    seen = new Set(arr(sl).map(String)); queued = waitingUrls(pd);
  }
  const titleKey = typeof H.alTitleKey === "function" ? H.alTitleKey : null;   // a relisted piece is remembered by its title too
  /* memberDropReason says "not in their sites", "over their max price $N" or 'has skip word "w"'; only the word can be personal */
  const why = r => {
    if (!r) return null;
    const s = String(r).slice(0, 80), w = /^has skip word "(.*)"$/.exec(s);
    if (w) return skipView(sub, [w[1]], zip)[0] === HIDDEN ? "has one of their skip words" : s;
    if (s === "not in their sites" || /^over their max price \$\d+$/.test(s)) return s;
    return scrubHunt(s, zip).hidden ? "filtered out by their settings" : s;
  };
  const results = await Promise.all(srcs.map(async src => {
    let r = null;
    try { r = localOnly ? await H.liveFetchLocal(env, sub, term) : await H.liveFetch(env, src, term); } catch (e) { r = { status: 0, ms: 0, items: null, err: "could not search" }; }
    r = r || {};
    let items = arr(r.items), ai = aiOff ? "off for this member" : "";
    if (items.length && !aiOff) {
      try { const j = await H.jevClean(env, term, items, "shadow"); if (j && Array.isArray(j.items)) items = j.items; ai = word(j && j.info && j.info.status, 40); }
      catch (e) { ai = "AI check failed"; }
    }
    const out = items.slice(0, 40).map(x => {
      x = x || {};
      const tag = typeof x.jev === "string" && x.jev && !aiOff ? word(x.jev, 20) : null, would = !aiOff && !!H.jevWouldDrop(x);
      /* already found by a check and queued for their next email: it goes out with it, so it is not "already emailed" */
      const waiting = !!x.url && queued.has(String(x.url));
      const sent = !waiting && !!x.url && (seen.has(String(x.url)) || (!!titleKey && seen.has(String(titleKey(Object.assign({ src: src }, x))))));
      return { title: String(x.title || "").slice(0, 160), price: String(x.price || "").slice(0, 40), url: https(x.url), image: https(x.image),
        src: word(x.src || src, 20), ai: tag, aiP: tag && typeof x.jevp === "number" && isFinite(x.jevp) ? x.jevp : null,
        aiWould: would, aiDrop: aiLive && would, memberDrop: sub ? why(H.memberDropReason(sub, x, local)) : null, alreadySent: sent, waiting: waiting };
    });
    return { source: src, status: num(r.status), ms: num(r.ms), err: clean(r.err, 160), count: out.length, ai: ai, aiAllFlagged: false, items: out };
  }));
  /* the AI never empties a list: when it flags every listing it hides none. Emails ask it once for the whole hunt,
     live results once per marketplace. */
  for (const g of sub ? [results] : results.map(r => [r])) {
    const all = [].concat.apply([], g.map(r => r.items));
    if (all.length && all.every(x => x.aiDrop)) { all.forEach(x => { x.aiDrop = false; }); g.forEach(r => { r.aiAllFlagged = r.items.length > 0; }); }
  }
  /* v98: an email keeps only the exact matches (every word of the hunt in the title) when the hunt has any; Diagnose
     says so, over all the member's sites together as the email does, after the AI and their filters */
  if (sub && typeof H.alExact === "function") {
    const left = [].concat.apply([], results.map(r => r.items)).filter(x => !x.aiDrop && !x.memberDrop);
    const ex = new Set(H.alExact(left, term));
    if (ex.size < left.length) left.forEach(x => { if (!ex.has(x)) x.notExact = true; });
  }
  results.forEach(r => { r.kept = r.items.filter(x => !x.aiDrop && !x.memberDrop && !x.notExact && !x.alreadySent).length; });
  const sum = f => results.reduce((t, r) => t + r.items.filter(f).length, 0);
  const okN = results.filter(r => r.status === 200 && !r.err).length;
  const shown = scrubHunt(term, zip);
  await audit(c, { action: "diagnose", id: m ? m.id : "", ok: true, note: srcs.length + " sites" });
  return jres({
    term: shown.hidden ? "(hidden)" : shown.text,
    member: m ? { id: m.id, pro: !!sub.pro, aiOff: aiOff, filters: { sources: emailSources(H, p), maxPrice: sub.pro ? num(p.max) : 0,
      skipWords: sub.pro ? skipView(sub, p.skip, zip) : [] } } : null,
    local: local, localOnly: localOnly, hunt: hunt, ai: { mode: word(mode, 10), alerts: alertsAi, live: aiLive }, results: results,
    summary: { sources: results.length, ok: okN, failed: results.length - okN, items: sum(() => true), aiDropped: sum(x => x.aiDrop), aiWould: sum(x => x.aiWould),
      memberDropped: sum(x => !!x.memberDrop), notExact: sum(x => !!x.notExact), alreadySent: sum(x => x.alreadySent), waiting: sum(x => x.waiting) }
  });
}

async function apiHealth(c) {
  if (!(await c.H.vCount("admhealth", 60))) return jerr(429, "That is a lot of health checks today. Try again tomorrow.");
  const results = arr(await c.H.runProbes(c.env)).map(p => {
    p = p || {};
    return { t: num(p.t) || c.nowMs, source: word(p.source, 20), ok: !!p.ok, status: num(p.status), n: num(p.n), ms: num(p.ms), err: clean(p.err, 160) };
  });
  try { await c.H.capsCall("metrics", "mrec", { p: results }); } catch (e) {}
  await audit(c, { action: "healthcheck", ok: results.every(r => r.ok), note: results.filter(r => !r.ok).length + " down" });
  return jres({ results: results });
}

/* v99: can a Worker read the garage-sale finders? (build plan item 5: decides whether Prowl can show their sales) */
async function apiSalesCheck(c) {
  if (!(await c.H.vCount("admsales", 30))) return jerr(429, "That is a lot of checks today. Try again tomorrow.");
  const results = arr(await c.H.salesProbe()).map(p => {
    p = p || {};
    let shape = "";
    try { if (p.shape) shape = clean(JSON.stringify(p.extract ? { extract: p.extract, shape: p.shape } : p.shape, null, 1), 8000); } catch (e) {}   /* v102: public listing data, phone numbers and the like masked; v103: + what the extractor gets */
    return { name: word(p.name, 30), url: https(p.url), status: num(p.status), ms: num(p.ms), bytes: num(p.bytes), wall: !!p.wall, readable: !!p.readable, err: clean(p.err, 120), shape: shape };
  });
  await audit(c, { action: "salescheck", ok: true, note: results.filter(r => r.readable).length + " of " + results.length + " readable" });
  return jres({ results: results });
}

async function apiErrors(c) {
  const lim = Math.min(500, Math.max(1, Math.floor(num(c.url.searchParams.get("limit")) || 100)));
  let j;
  try { j = await capsJson(c, "metrics", "mget", { hours: 1, errors: lim, crons: 1, probeDays: 1, audit: 1 }); }
  catch (e) { return jerr(503, "The error log is not available right now."); }
  return jres({ errors: arr(j.errors).slice(0, lim).map(e => errView(c, e)) });
}

async function apiSearches(c) {
  const days = Math.min(30, Math.max(1, Math.floor(num(c.url.searchParams.get("days")) || 7)));
  let j;
  try { j = await capsJson(c, "stats", "top", { kind: "t", from: utcDay(c.nowMs - (days - 1) * 86400000), to: utcDay(c.nowMs), limit: 50 }); }
  catch (e) { return jerr(503, "Search counts are not available right now."); }
  let trips = null;   /* v176: road trip destinations; a failure here leaves the searches list standing */
  try { trips = topView(c, await capsJson(c, "stats", "top", { kind: "r", from: utcDay(c.nowMs - (days - 1) * 86400000), to: utcDay(c.nowMs), limit: 50 })); } catch (e) {}
  return jres({ top: topView(c, j), trips: trips, days: days });
}
/* v127: Visitors (moved here from the page's Den › Stats, which showed it to the owner key: admin only now). 14 UTC days of
   people searching (distinct daily-salted address hashes, never stored raw) and searches, and where the page's visitors
   came from for the last 7 days (Cloudflare Web Analytics through H.cfReferrers; { off } until its three secrets are set).
   Read when the Searches tab opens, not on the overview's 60-second refresh: each read lists Durable Object rows. */
async function apiUsage(c) {
  const H = c.H, issues = [], days = [];
  for (let i = 13; i >= 0; i--) days.push(utcDay(c.nowMs - i * 86400000));
  const grab = async (what, fn) => { try { return await fn(); } catch (e) { if (issues.indexOf(what) === -1) issues.push(what); return null; } };
  const [U, T, R] = await Promise.all([
    grab(MSG_SEARCH, () => capsJson(c, "stats", "days", { kind: "u", from: days[0], to: days[13] })),
    grab(MSG_SEARCH, () => capsJson(c, "stats", "days", { kind: "t", from: days[0], to: days[13] })),
    typeof H.cfReferrers === "function" ? H.cfReferrers(c.env, days[7], days[13]).catch(() => ({ error: "Cloudflare analytics could not be reached." })) : { off: true }]);
  const u = (U && U.days) || {}, t = (T && T.days) || {};
  const per = U || T ? days.map(d => ({ day: d, people: num(u[d] && u[d].v), searches: num(u[d] && u[d].r), terms: num(t[d] && t[d].n) })) : null;
  const refs = R && R.off ? { off: true } : R && R.error ? { error: clean(R.error, 200) }
    : { list: arr(R && R.list).slice(0, 12).map(x => ({ host: word(x && x.host, 80), views: num(x && x.views) })) };
  return jres({ days: per, refs: refs, issues: issues });
}

/* ---------- affiliates (v89) ----------
   One switch per affiliate program. index.js keeps the list (AFF_PROGRAMS) and reads KV aff:on before building any
   link; GET /aff tells the Prowl page within about 5 minutes. */
async function affView(c) {
  const H = c.H, on = await H.affLoad(c.env, true), ids = H.affIdsClean(await H.kvGet(c.env, H.AFF_IDS_KEY, null), c.env);
  return H.AFF_PROGRAMS.map(p => ({ id: p.id, name: p.name, net: p.net, mail: p.mail === true, on: on[p.id] === true, def: p.def === true, ready: H.affReady(ids, p),
    fields: p.fields.map(x => ({ k: x.k, label: x.label, hint: x.hint, value: ids[p.id][x.k] || "" })) }));
}
async function apiAffiliates(c) { return jres({ programs: await affView(c) }); }
async function apiAffiliateSet(c) {
  const H = c.H, env = c.env, id = String(c.body.id == null ? "" : c.body.id), want = c.body.on;
  const prog = H.AFF_PROGRAMS.find(p => p.id === id);
  if (!prog) return jerr(400, "That affiliate is not on the list. Reload the page and try again.");
  if (typeof want !== "boolean") return jerr(400, "Say on or off.");
  if (!(await H.vCount("admaff", 100))) return jerr(429, "That is a lot of affiliate changes today. Try again tomorrow.");
  if (want && !H.affReady(H.affIdsClean(await H.kvGet(env, H.AFF_IDS_KEY, null), env), prog)) return jerr(400, "Fill in and save " + prog.name + "'s IDs first.");
  const cur = await H.kvGet(env, H.AFF_KEY, null), next = {};
  for (const p of H.AFF_PROGRAMS) if (cur && typeof cur === "object" && typeof cur[p.id] === "boolean") next[p.id] = cur[p.id];
  next[id] = want;
  await H.kvPut(env, H.AFF_KEY, next);
  await audit(c, { action: want ? "aff-on" : "aff-off", id: id, ok: true });
  const msg = prog.name + " links are " + (want ? "tagged now (" + prog.net + ")" : "plain now, with no affiliate tag") +
    ". The Prowl page picks this up within about 5 minutes" + (prog.mail === true ? "; alert emails from the next one on." : ". Alert emails keep plain " + prog.name + " links.");
  return jres({ ok: true, message: msg, programs: await affView(c) });
}

/* v90: a program's IDs. Each value must match its field's format (or be empty, which clears it); a program whose
   IDs are no longer complete is switched off in the same step. */
async function apiAffiliateIds(c) {
  const H = c.H, env = c.env, id = String(c.body.id == null ? "" : c.body.id), vals = c.body.values;
  const prog = H.AFF_PROGRAMS.find(p => p.id === id);
  if (!prog) return jerr(400, "That affiliate is not on the list. Reload the page and try again.");
  if (!vals || typeof vals !== "object" || Array.isArray(vals)) return jerr(400, "Nothing to save.");
  const save = {};
  for (const x of prog.fields) {
    const v = typeof vals[x.k] === "string" ? vals[x.k].trim() : "";
    if (v && !x.re.test(v)) return jerr(400, x.label + " is not in the right form (" + x.hint + "). Nothing was saved.");
    save[x.k] = v;
  }
  if (!(await H.vCount("admaff", 100))) return jerr(429, "That is a lot of affiliate changes today. Try again tomorrow.");
  const cur = await H.kvGet(env, H.AFF_IDS_KEY, null), next = {};
  for (const p of H.AFF_PROGRAMS) if (cur && typeof cur === "object" && !Array.isArray(cur) && cur[p.id] && typeof cur[p.id] === "object") next[p.id] = cur[p.id];
  const was = H.affReady(H.affIdsClean(next, env), prog);
  next[id] = save;
  const ready = H.affReady(H.affIdsClean(next, env), prog);
  /* incomplete IDs: the switch goes off too, so it stays off once the IDs are filled in again. v95: and IDs complete for
     the first time never switch a program on by themselves (a switch left in KV says nothing about today): it is on only
     once the owner presses Turn on. The switch is written first, so no reader ever sees complete IDs with an old "on". */
  if (!ready || !was) {
    const on = await H.kvGet(env, H.AFF_KEY, null);
    if (!on || on[id] !== false) { const o = on && typeof on === "object" && !Array.isArray(on) ? Object.assign({}, on) : {}; o[id] = false; await H.kvPut(env, H.AFF_KEY, o); }
  }
  await H.kvPut(env, H.AFF_IDS_KEY, next);
  await audit(c, { action: "aff-ids", id: id, ok: true });
  const isOn = (await H.affLoad(env, true))[id] === true;
  const msg = prog.name + " IDs saved. " + (!ready ? "They are not complete, so " + prog.name + " is off."
    : isOn ? "Links use them within about 5 minutes." : "Press Turn on when you want " + prog.name + " links tagged.");
  return jres({ ok: true, message: msg, programs: await affView(c) });
}

const GETS = { overview: apiOverview, members: apiMembers, member: apiMember, errors: apiErrors, searches: apiSearches, usage: apiUsage, gifts: apiGifts, affiliates: apiAffiliates };
const POSTS = { find: apiFind, "member/action": apiAction, diagnose: apiDiagnose, healthcheck: apiHealth, salescheck: apiSalesCheck, gift: apiGiftAdd, "gift/remove": apiGiftRemove, affiliate: apiAffiliateSet, "affiliate/ids": apiAffiliateIds };

/* ---------- sign in / out ---------- */
const capsDayOf = c => typeof c.H.capsDay === "function" ? c.H.capsDay() : "caps:" + utcDay(c.nowMs);
/* A daily counter that tells "over the limit" (false) from "the counter did not answer" (null). vCount alone says
   false for both, which would tell the owner to wait until tomorrow when the counter only hiccuped. */
async function take(c, k, lim) {
  let j;
  try { j = await c.H.capsCall(capsDayOf(c), "take", { k: k, lim: lim }); } catch (e) { return null; }
  if (j == null) return !!(await c.H.vCount(k, lim));   // no Durable Object binding: vCount's own fallback counter
  return typeof j === "object" && typeof j.left === "number" ? j.left >= 0 : null;
}
async function peekCount(c, k) {
  let j;
  try { j = await c.H.capsCall(capsDayOf(c), "peek", { keys: [k] }); } catch (e) { return null; }
  return j && typeof j === "object" && j.values && typeof j.values === "object" ? num(j.values[k]) : 0;
}
async function login(c) {
  const H = c.H, req = c.request;
  /* Bad-origin and over-limit tries are refused before the key is even compared, and are not logged. */
  if (!sameOrigin(req, c.url)) return page(H, "login", 403, "That sign-in did not come from this page. Open /admin and try again.");
  const ip = H.ipKey(req.headers.get("CF-Connecting-IP")), net = typeof H.ipNet === "function" ? H.ipNet(ip) : ip;
  const failKey = "admloginfail:" + new Date(c.nowMs).toISOString().slice(0, 13);   // wrong keys site-wide, this UTC hour
  const busy = () => page(H, "login", 503, "Sign-in is briefly unavailable (the sign-in counter did not answer). Try again in a minute.");
  const perIp = await take(c, "admlogin:" + ip, LOGIN_PER_IP);
  if (perIp === null) return busy();
  if (!perIp) return page(H, "login", 429, "Too many sign-in tries from here today. Try again tomorrow.");
  const perNet = await take(c, "admlogin:n:" + net, LOGIN_PER_NET);
  if (perNet === null) return busy();
  if (!perNet) return page(H, "login", 429, "Too many sign-in tries from this network today. Try again tomorrow.");
  /* guesses spread over many addresses still meet this; a lock-out it causes ends with the hour, and a signed-in session is not affected */
  const fails = await peekCount(c, failKey);
  if (fails === null) return busy();
  if (fails >= LOGIN_FAILS_PER_HOUR) return page(H, "login", 429, "Sign-in is paused for the rest of this hour because many wrong keys were tried. Try again after the hour, or keep using a page that is already signed in.");
  const raw = await readBody(req, 2048);
  if (raw === null) return page(H, "login", 413, "That was too long to be the admin key.");
  let given = "";
  try { given = new URLSearchParams(raw).get("key") || ""; } catch (e) {}
  const ok = await sameSecret(c.key, given);
  if (ok) await audit(c, { action: "login", ok: true });
  else {
    await take(c, failKey, 1000000);
    /* one audit row per wrong key only for the first few each day, so a flood cannot push real entries out of the log */
    if ((await take(c, "admloginlog", LOGIN_LOG_PER_DAY)) === true) await audit(c, { action: "login", ok: false, note: "wrong key" });
  }
  if (!ok) return page(H, "login", 401, "That key did not match. Check ADMIN_KEY in Cloudflare and try again.");
  const v = await signSession(c.key, c.nowMs + SESSION_S * 1000);
  return redirect("/admin", COOKIE + "=" + v + "; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_S);
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
async function handle(request, env, ctx, H, url, path, isApi) {
  const asset = appAsset(path, request.method);   // v120: phone app files, no sign-in needed
  if (asset) return asset;
  const problem = setupProblem(env);
  if (problem) return plain(503, problem);
  const key = adminKey(env);
  const c = { request: request, env: env, ctx: ctx, H: H, url: url, key: key, salt: String(env.MEMBER_ID_SALT || key), nowMs: Date.now(), body: {} };
  const authed = await verifySession(key, readCookie(request, COOKIE), c.nowMs);
  const method = request.method;
  if (path === "/admin" || path === "/admin/") {
    if (method !== "GET" && method !== "HEAD") return plain(405, "Not allowed.");
    return authed ? page(H, "admin", 200) : page(H, "login", 200, "");
  }
  if (path === "/admin/login") return method === "POST" ? login(c) : redirect("/admin");
  if (path === "/admin/logout") {
    if (method !== "POST") return redirect("/admin");
    if (!sameOrigin(request, url)) return plain(403, "Sign out from the admin page.");
    return redirect("/admin", COOKIE + "=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
  }
  if (!isApi) return plain(404, "Not found.");
  const route = path.slice("/admin/api/".length);
  const fn = method === "GET" && own(GETS, route) ? GETS[route] : method === "POST" && own(POSTS, route) ? POSTS[route] : null;
  if (!authed) return jerr(401, "Your admin session ended. Sign in again.", { login: true });
  if (!fn) return own(GETS, route) || own(POSTS, route) ? jerr(405, "Not allowed.") : jerr(404, "Not found.");
  if (method === "POST") {
    /* The custom header forces a CORS preflight that this route never answers, so another site cannot send it. */
    if (request.headers.get("X-Prowl-Admin") !== "1" || !sameOrigin(request, url)) return jerr(403, "That request did not come from the admin page.");
    const raw = await readBody(request, BODY_MAX);
    if (raw === null) return jerr(413, "That request is too large.");
    if (raw.trim()) {
      let o = null;
      try { o = JSON.parse(raw); } catch (e) { return jerr(400, "That request could not be read."); }
      if (o && typeof o === "object" && !Array.isArray(o)) c.body = o;
    }
  }
  return fn(c);
}

export async function adminFetch(request, env, ctx, H) {
  const url = new URL(request.url), path = url.pathname;
  if (path !== "/admin" && !path.startsWith("/admin/")) return null;
  const isApi = path.startsWith("/admin/api/");
  try {
    return await handle(request, env, ctx, H, url, path, isApi);
  } catch (e) {
    console.error("admin", clean(e && e.message || e, 200));   // message only; a stack trace never leaves the worker
    return isApi ? jerr(500, "Something went wrong on the server. Try again in a minute.") : plain(500, "Something went wrong on the server. Try again in a minute.");
  }
}
