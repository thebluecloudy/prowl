/* ---------- v78: Prowl admin area (/admin) ----------
   The owner's support and health dashboard. One shared admin key (ADMIN_KEY, or OWNER_KEY) signs in;
   the session is an HMAC-signed expiry in an HttpOnly, Secure, SameSite=Strict cookie scoped to /admin.
   Members appear only as a pseudonymous id (M-xxxxxxxx, a salted hash of the address). Every view is
   built field by field from an allowlist, so an email, token, Shopify id, receipt, ZIP or code can
   never reach a response. H = helpers from index.js (this file never imports index.js). The page
   builders and metrics summaries come from H when present, else load lazily from their own files. */

const COOKIE = "prowl_admin";
const SESSION_S = 43200;                         // 12 hours
const BODY_MAX = 8192;
const ROSTER_MAX = 5000, ROSTER_TTL = 60000;
const ID_RE = /^M-[0-9a-f]{8}$/;
const HIDDEN = "(hidden \u2014 looks personal)";
const ACTIONS = ["signin-link", "refresh-pro", "recheck-today", "resend-today", "mail-on", "mail-off", "unpause", "signout-all", "clear-seen", "delete"];
const CONFIRM = { "signout-all": 1, "clear-seen": 1, "delete": 1 };   // the owner types the member id first
const ISSUE_FLAGS = ["email late", "pro check failing", "sign-in link waiting", "record unreadable"];
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
    .slice(0, n || 160);
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

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
  return "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src https: data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
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
function adminKey(env) { const k = String((env && (env.ADMIN_KEY || env.OWNER_KEY)) || ""); return k.length >= 12 ? k : ""; }
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
/* id -> KV key for every member, cached a minute per isolate. Records and waiting sign-in links load
   only for the list views. Module memory only; nothing here is ever returned. */
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
    R = ROSTER = { kv: kv, salt: c.salt, at: c.nowMs, keys: keys, byId: byId, idOf: idOf, truncated: more, recs: null, signin: null };
  }
  if (withRecs && !R.recs) {
    const recs = new Map(), signin = new Set();
    for (let i = 0; i < R.keys.length; i += 50) {
      const part = R.keys.slice(i, i + 50), got = await Promise.all(part.map(k => c.H.kvGet(c.env, k, null)));
      part.forEach((k, j) => { if (got[j] && typeof got[j] === "object") recs.set(k, got[j]); });
    }
    let cur;
    do {
      const l = await kv.list({ prefix: "in:", cursor: cur, limit: 1000 });
      for (const k of arr(l && l.keys)) signin.add(String(k.name).slice(3));
      cur = l && !l.list_complete ? l.cursor : undefined;
    } while (cur && signin.size < ROSTER_MAX);
    R.recs = recs; R.signin = signin;
  }
  return R;
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
/* An @, 6+ digits in a row, or a phone-like run (7+ digits split by spaces, dots, dashes or parens).
   A run made only of years ("1950-1960", "1960 1970s") is a date range, not a number. */
const YEARS = /^(?:1[89]\d\d|20\d\d)(?:[\s.\/-]+(?:1[89]\d\d|20\d\d))*$/;
function looksPersonal(t) {
  if (/@/.test(t) || /\d{6,}/.test(t)) return true;
  for (const run of t.match(/\d[\d\s.()-]*\d/g) || []) if (run.replace(/\D/g, "").length >= 7 && !YEARS.test(run)) return true;
  return false;
}
export function scrubHunt(h) {
  const t = String(h == null ? "" : h).slice(0, 80);
  return looksPersonal(t) ? { text: HIDDEN, hidden: true } : { text: t, hidden: false };
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
  const sentToday = !!s.sent && s.sent === loc.day;
  return { s: s, hunts: hunts, p: p, loc: loc, active: active, done: done, mailOn: mailOn, paused: paused, working: working, slot: slot,
    due: due, sentToday: sentToday, late: due && !sentToday && num(loc.hour) > slot };
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
  if (s.pro === null || /shopify|error|unreachable|token|fail/i.test(via)) flags.push("pro check failing");
  if (extra && extra.signin) flags.push("sign-in link waiting");
  if (arr(s.prev).length || s.movedAt) flags.push("moved address");
  if (unmuted > st.active.length) flags.push("hunts over plan limit");   // only the first few are checked on the free plan
  return {
    id: "", plan: plan, via: via, hunts: st.hunts.length, active: st.active.length, mail: st.mailOn ? "on" : "off",
    paused: st.paused, pauseUntil: st.paused ? day10(st.p.pause) : "",
    freq: H.alFreeWeekly(s) ? "weekly" : word(st.p.freq, 12), slotHour: st.slot, tz: word(st.p.tz || H.AL_TZ || "", 64),
    created: day10(s.created), lastSent: day10(s.sent), sentToday: st.sentToday, checkedToday: checked,
    activeToday: st.working ? st.active.length : 0, dueToday: st.due, late: st.late, flags: flags
  };
}
function brokenSummary() {
  return { id: "", plan: "free", via: "", hunts: 0, active: 0, mail: "on", paused: false, pauseUntil: "", freq: "", slotHour: 0, tz: "",
    created: "", lastSent: "", sentToday: false, checkedToday: 0, activeToday: 0, dueToday: false, late: false, flags: ["record unreadable"] };
}
function safeSummary(env, sub, H, now, extra) { try { return memberSummary(env, sub, H, now, extra); } catch (e) { return brokenSummary(); } }

export async function memberDetail(env, sub, H, now) {
  const email = String(sub.email || ""), kv = env.PROWL_ALERTS;
  const has = async k => { try { return email !== "" && (await kv.get(k)) != null; } catch (e) { return false; } };
  const [pend, seen, signin, conf, mvf] = email ? await Promise.all([H.kvGet(env, "pend:" + email, {}), H.kvGet(env, "seen:" + email, []),
    has("in:" + email), has("conf:" + email), has("mvf:" + email)]) : [{}, [], false, false, false];
  const st = state(env, sub, H, now), p = st.p, s = st.s, pl = s.plan && typeof s.plan === "object" ? s.plan : {};
  const d = summaryOf(st, H, { signin: signin });
  const mute = arr(p.mute), act = st.active.map(h => h.toLowerCase());
  d.planName = d.plan;
  d.hunts = st.hunts.map(h => {
    const v = scrubHunt(h), l = h.toLowerCase();
    return { text: v.text, hidden: v.hidden, active: act.indexOf(l) !== -1, muted: mute.indexOf(l) !== -1, local: !!H.alNear(s, h), checkedToday: st.done.indexOf(l) !== -1 };
  });
  d.prefs = { freq: d.freq, slotHour: d.slotHour, tz: d.tz, sources: arr(p.sources).map(x => word(x, 20)), maxPrice: num(p.max),
    skipWords: arr(p.skip).map(w => scrubHunt(w).text), filtersApply: !!s.pro, pauseUntil: day10(p.pause), aiOff: !!p.noai,
    zipSet: !!p.zip, radius: num(p.radius), localHunts: arr(p.local).length };
  d.plan = { name: d.planName, via: d.via, trial: !!pl.trial, paidDay: day10(pl.paid), renewsDay: day10(pl.renews), amount: word(pl.amount, 12),
    currency: word(pl.currency, 8), order: word(pl.order, 20), hadPro: !!s.hadPro, checkedDay: day10(s.proDay) };
  const ph = []; let total = 0;
  if (pend && typeof pend === "object" && !Array.isArray(pend)) for (const k of Object.keys(pend).slice(0, 60)) {
    const items = arr(pend[k]); total += items.length;
    ph.push({ text: scrubHunt(k).text, n: items.length, sample: items.slice(0, 3).map(listing) });
  }
  d.pending = { total: total, hunts: ph };
  d.seenCount = arr(seen).filter(u => !/^t:/.test(String(u))).length;   // listings remembered (each also has a title key)
  d.signinWaiting = signin; d.confirmWaiting = conf; d.moveWaiting = mvf;
  d.previousAddresses = arr(s.prev).length; d.movedAt = day10(s.movedAt); d.mailOffDay = day10(s.mailOffAt);
  return d;
}
function summaries(c, R, now) {
  const out = [];
  for (const k of R.keys) {
    const sub = R.recs.get(k); if (!sub) continue;
    const v = safeSummary(c.env, sub, c.H, now, { signin: R.signin.has(k.slice(4)) });
    v.id = R.idOf.get(k); out.push(v);
  }
  return out;
}

/* ---------- metrics views ---------- */
function errView(c, e) {
  e = e || {};
  return { t: num(e.t), r: word(e.r, 40), s: num(e.s), m: clean(e.m, 160), q: c.H.statTerm ? c.H.statTerm(String(e.q || "")) : "" };
}
function auditView(a) {
  a = a || {};
  return { t: num(a.t), action: word(a.action, 30), id: ID_RE.test(String(a.id)) ? a.id : "", ok: !!a.ok, note: clean(a.note, 80) };
}
function upView(u) {
  u = u || {};
  return { source: word(u.source, 20), pct24: u.pct24 == null ? null : num(u.pct24), pct7d: u.pct7d == null ? null : num(u.pct7d),
    checks24: num(u.checks24), checks7d: num(u.checks7d), lastOkAt: u.lastOkAt ? word(u.lastOkAt, 20) : null, lastStatus: num(u.lastStatus),
    lastMs: num(u.lastMs), lastErr: clean(u.lastErr, 160), lastN: num(u.lastN), down: !!u.down };
}
function topView(c, j) {
  const out = [];
  for (const r of arr(j && j.top)) {
    const t = c.H.statTerm ? c.H.statTerm(String((r && r.term) || "")) : "";   // stored terms are scrubbed already; this is the second net
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
async function apiOverview(c) {
  const H = c.H, env = c.env, nowMs = c.nowMs, issues = [];
  const grab = async (what, fn) => { try { return await fn(); } catch (e) { if (issues.indexOf(what) === -1) issues.push(what); return null; } };
  const now = H.alNow(env), today = utcDay(nowMs);
  const capsDay = typeof H.capsDay === "function" ? H.capsDay() : "caps:" + today;
  const pools = arr(H.POOLS);
  const [R, M, peek, topT, topW, lib] = await Promise.all([
    grab("The member list could not be read.", () => roster(c, true)),
    grab("Speed, error and uptime numbers are not available.", () => capsJson(c, "metrics", "mget", { hours: 26, errors: 20, crons: 300, probeDays: 7, audit: 15 })),
    grab("AI usage is not available.", () => capsJson(c, capsDay, "peek", { keys: pools.map(p => p.key) })),
    grab("Search counts are not available.", () => capsJson(c, "stats", "top", { kind: "t", from: today, to: today, limit: 15 })),
    grab("Search counts are not available.", () => capsJson(c, "stats", "top", { kind: "t", from: utcDay(nowMs - 6 * 86400000), to: today, limit: 15 })),
    grab("Speed, error and uptime numbers are not available.", () => metricsLib(H))
  ]);
  let members = null, alerts = null;
  if (R) {
    const list = summaries(c, R, now), n = f => list.filter(f).length, sum = f => list.reduce((t, s) => t + f(s), 0);
    const cut = utcDay(nowMs - 6 * 86400000);
    members = { total: list.length, pro: n(s => s.plan === "pro"), trial: n(s => s.plan === "trial"), free: n(s => s.plan === "free"),
      freeLegacy: n(s => s.plan === "free (legacy)"), mailOff: n(s => s.mail === "off"), paused: n(s => s.paused), noHunts: n(s => !s.hunts),
      new7d: n(s => !!s.created && s.created >= cut), hunts: sum(s => s.hunts), activeHunts: sum(s => s.active), truncated: R.truncated };
    alerts = { dueToday: n(s => s.dueToday), sentToday: n(s => s.sentToday), late: n(s => s.late), checkedToday: sum(s => s.checkedToday),
      huntsLeftToday: sum(s => s.dueToday && !s.sentToday ? Math.max(0, s.activeToday - s.checkedToday) : 0) };
  }
  let traffic = null, uptime = null, errors = null, auditList = null;
  if (M) {
    const crons = arr(M.crons).filter(x => x && typeof x === "object"), c0 = crons[0], day = nowMs - 86400000;
    const recent = crons.filter(x => num(x.t) >= day);
    const cron = {
      lastCron: c0 ? { at: new Date(num(c0.t)).toISOString(), ageMin: Math.max(0, Math.round((nowMs - num(c0.t)) / 60000)), ms: num(c0.ms),
        members: num(c0.members), checked: num(c0.checked), sent: num(c0.sent), failed: num(c0.failed), errors: arr(c0.errors).slice(0, 5).map(e => clean(e, 160)) } : null,
      cronRuns24h: recent.length, cronFails24h: recent.filter(x => num(x.failed) > 0 || arr(x.errors).length > 0).length };
    alerts = Object.assign(alerts || { dueToday: null, sentToday: null, late: null, checkedToday: null, huntsLeftToday: null }, cron);
    if (lib) {
      traffic = await grab("Speed numbers could not be worked out.", async () => lib.summarize(arr(M.buckets), nowMs, 24));
      uptime = await grab("Uptime numbers could not be worked out.", async () => arr(lib.uptimeFrom(arr(M.probes), nowMs)).map(upView));
    }
    errors = arr(M.errors).slice(0, 20).map(e => errView(c, e));
    auditList = arr(M.audit).slice(0, 15).map(auditView);
  } else if (alerts) Object.assign(alerts, { lastCron: null, cronRuns24h: null, cronFails24h: null });
  const values = (peek && peek.values) || {};
  const ai = peek ? { pools: pools.map(p => { const used = num(values[p.key]), limit = num(p.limit); return { name: String(p.name || p.key), used: used, limit: limit, pct: limit ? Math.round(used * 100 / limit) : 0 }; }) } : null;
  let live = [];
  try { live = arr(H.liveSources()).map(s => word(s, 20)); } catch (e) {}
  return jres({
    version: H.WORKER_VERSION, now: { iso: new Date(nowMs).toISOString(), detroitDay: now.day, detroitHour: now.hour },
    members: members, alerts: alerts, traffic: traffic, uptime: uptime, ai: ai, errors: errors,
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
  if (!sub) { await audit(c, { action: "find", ok: false }); return jerr(404, "No member with that email."); }
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
    if (await merge(["pro", "plan", "proDay", "hadPro"])) {
      msg = sub.pro ? (sub.plan && sub.plan.trial ? "Checked the store: they are on the free Prowl Pro month." : "Checked the store: Prowl Pro is active.")
        : "Checked the store: no current Prowl Pro order, so they are on the free plan.";
      if (was !== !!sub.pro) msg += was ? " They were Pro before this check." : " They were not Pro before this check.";
      msg += " If the store could not be reached, nothing changed.";
    }
  } else if (action === "recheck-today" || action === "resend-today") {
    sub.day = ""; sub.done = [];
    const f = ["day", "done"];
    if (action === "resend-today") { sub.sent = ""; f.push("sent"); }
    if (await merge(f)) msg = action === "recheck-today"
      ? "Their hunts will be checked again over the next few runs (every 5 minutes). If today's email has not gone out yet, it includes anything new."
      : "Their hunts will be checked again, then today's email goes out again with anything new since the last one. Listings already sent are not repeated (clear the \"already sent\" memory to include them).";
  } else if (action === "mail-on") {
    sub.mail = "on"; sub.mailOffAt = "";
    if (await merge(["mail", "mailOffAt"])) msg = "Emails are on again. The next one goes out at their usual time on their next email day.";
  } else if (action === "mail-off") {
    sub.mail = "off"; sub.mailOffAt = new Date(c.nowMs).toISOString();
    if (await merge(["mail", "mailOffAt"])) msg = "Emails are off. Their hunts, settings and plan stay; nothing is checked or sent until emails are back on.";
  } else if (action === "unpause") {
    const fresh = await H.kvGet(env, m.k, null), base = fresh && fresh.prefs && typeof fresh.prefs === "object" && !Array.isArray(fresh.prefs) ? fresh.prefs : (sub.prefs && typeof sub.prefs === "object" ? sub.prefs : {});
    sub.prefs = Object.assign({}, base, { pause: "" });
    if (await merge(["prefs"])) msg = "Unpaused. Their hunts are checked again from the next run.";
  } else if (action === "signout-all") {
    sub.tok = H.alToken();
    if (await merge(["tok"])) {
      await kv.delete("in:" + email);   // a waiting sign-in link would let a lost device straight back in
      msg = "Signed out on every phone and computer. They can sign back in with a new sign-in link.";
    }
  } else if (action === "clear-seen") {
    await kv.delete("seen:" + email);
    msg = "Cleared. The next check treats every listing as new, so their next email may repeat listings they already saw.";
  } else if (action === "delete") {
    for (const p of ["sub:", "pend:", "seen:", "mvf:", "in:", "pro:"]) await kv.delete(p + email);
    if (sub.cid) { const cc = await H.kvGet(env, "cid:" + sub.cid, null); if (cc && cc.email === email) await kv.delete("cid:" + sub.cid); }
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
  let term = String(b.term == null ? "" : b.term).replace(/\s+/g, " ").trim().slice(0, 60), m = null;
  if (b.id != null && b.id !== "") { m = await findMember(c, b.id); if (!m) return jerr(404, "No member with that id."); }
  if (b.hunt != null && b.hunt !== "") {
    if (!m) return jerr(400, "Pick a member to check one of their hunts.");
    const i = Number(b.hunt), hs = arr(m.sub.hunts);
    if (!Number.isInteger(i) || i < 0 || i >= hs.length) return jerr(400, "That hunt is not on their list any more.");
    term = String(hs[i]).slice(0, 60);
  }
  if (!term) return jerr(400, "Type a search term, or pick one of a member's hunts.");
  const sub = m && m.sub, p = sub ? H.alPrefs(sub) : null, aiOff = !!(p && p.noai), local = !!(sub && H.alNear(sub, term));
  const live = arr(H.liveSources()).map(String);
  let srcs = arr(b.sources).map(String).filter((s, i, a) => live.indexOf(s) !== -1 && a.indexOf(s) === i);
  if (!srcs.length) srcs = live.slice();
  let seen = new Set();
  if (sub) { const sl = await H.kvGet(env, "seen:" + m.email, []); seen = new Set(arr(sl).map(String)); }
  const why = r => { if (!r) return null; const v = scrubHunt(r); return v.hidden ? "has one of their skip words" : String(r).slice(0, 80); };
  const results = await Promise.all(srcs.map(async src => {
    let r = null;
    try { r = await H.liveFetch(env, src, term); } catch (e) { r = { status: 0, ms: 0, items: null, err: "could not search" }; }
    r = r || {};
    let items = arr(r.items), ai = aiOff ? "off for this member" : "";
    if (items.length && !aiOff) {
      try { const j = await H.jevClean(env, term, items, "shadow"); if (j && Array.isArray(j.items)) items = j.items; ai = word(j && j.info && j.info.status, 40); }
      catch (e) { ai = "AI check failed"; }
    }
    const out = items.slice(0, 40).map(x => {
      x = x || {};
      const tag = typeof x.jev === "string" && x.jev && !aiOff ? word(x.jev, 20) : null;
      return { title: String(x.title || "").slice(0, 160), price: String(x.price || "").slice(0, 40), url: https(x.url), image: https(x.image),
        src: word(x.src || src, 20), ai: tag, aiP: tag && typeof x.jevp === "number" && isFinite(x.jevp) ? x.jevp : null,
        aiDrop: !aiOff && !!H.jevWouldDrop(x), memberDrop: sub ? why(H.memberDropReason(sub, x, local)) : null,
        alreadySent: !!x.url && seen.has(String(x.url)) };
    });
    return { source: src, status: num(r.status), ms: num(r.ms), err: clean(r.err, 160), count: out.length, ai: ai,
      kept: out.filter(x => !x.aiDrop && !x.memberDrop && !x.alreadySent).length, items: out };
  }));
  const sum = f => results.reduce((t, r) => t + r.items.filter(f).length, 0);
  const okN = results.filter(r => r.status === 200 && !r.err).length;
  const shown = scrubHunt(term);
  await audit(c, { action: "diagnose", id: m ? m.id : "", ok: true, note: srcs.length + " sites" });
  return jres({
    term: shown.hidden ? "(hidden)" : shown.text,
    member: m ? { id: m.id, pro: !!sub.pro, aiOff: aiOff, filters: { sources: arr(p.sources).map(x => word(x, 20)), maxPrice: sub.pro ? num(p.max) : 0,
      skipWords: sub.pro ? arr(p.skip).map(w => scrubHunt(w).text) : [] } } : null,
    local: local, results: results,
    summary: { sources: results.length, ok: okN, failed: results.length - okN, items: sum(() => true), aiDropped: sum(x => x.aiDrop),
      memberDropped: sum(x => !!x.memberDrop), alreadySent: sum(x => x.alreadySent) }
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
  return jres({ top: topView(c, j), days: days });
}

const GETS = { overview: apiOverview, members: apiMembers, member: apiMember, errors: apiErrors, searches: apiSearches };
const POSTS = { find: apiFind, "member/action": apiAction, diagnose: apiDiagnose, healthcheck: apiHealth };

/* ---------- sign in / out ---------- */
async function login(c) {
  const H = c.H, req = c.request;
  /* Bad-origin and over-limit tries are refused before any work and not logged, so a flood cannot push real entries out of the audit log. */
  if (!sameOrigin(req, c.url)) return page(H, "login", 403, "That sign-in did not come from this page. Open /admin and try again.");
  if (!(await H.vCount("admlogin:" + H.ipKey(req.headers.get("CF-Connecting-IP")), 10))) return page(H, "login", 429, "Too many sign-in tries from here today. Try again tomorrow.");
  const raw = await readBody(req, 2048);
  if (raw === null) return page(H, "login", 413, "That was too long to be the admin key.");
  let given = "";
  try { given = new URLSearchParams(raw).get("key") || ""; } catch (e) {}
  const ok = await sameSecret(c.key, given);
  await audit(c, { action: "login", ok: ok, note: ok ? "" : "wrong key" });
  if (!ok) return page(H, "login", 401, "That key did not match. Check ADMIN_KEY in Cloudflare and try again.");
  const v = await signSession(c.key, c.nowMs + SESSION_S * 1000);
  return redirect("/admin", COOKIE + "=" + v + "; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_S);
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
async function handle(request, env, ctx, H, url, path, isApi) {
  const key = adminKey(env);
  if (!key) return plain(503, "Admin is not set up: add an ADMIN_KEY secret in Cloudflare (12 characters or more).");
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
