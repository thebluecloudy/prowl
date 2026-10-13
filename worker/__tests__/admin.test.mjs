/* Admin area tests: sign-in, sessions, CSRF, PII-free views, member actions, diagnose and overview.
   Run: node --test worker/__tests__/admin.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { adminFetch, signSession, verifySession, memberId, scrubHunt, memberSummary, memberDetail, giftActive, giftPro, looksPersonal } from "../admin.js";

const KEY = "test-admin-key-0123456789";
const ORIGIN = "https://prowl.example.workers.dev";
const TODAY = "2026-10-05";

/* index.js needs the Workers runtime to import, so its small Gift Pro helpers (and alPro / alProSet) are lifted
   out of the source and run here on their own, with stubs for what they call. */
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;   // a one-line function
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
function fromIndex(names, deps = {}) {
  const keys = Object.keys(deps);
  return new Function(...keys, names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map(k => deps[k]));
}
const IX = fromIndex(["giftHash", "proList", "proListHas", "proListCount", "alEmail"]);
/* v83: the shared purge, as index.js has it */
const PURGE = fromIndex(["pushHash", "pushId", "pushList", "pushPurge", "alPurge"], { kvGet: async (env, k, d) => { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; }, console: { log() {} } });
const giftHashOf = email => createHash("sha256").update("prowl-gift|" + email).digest("hex");

/* ---------- fakes ---------- */
class FakeKV {
  constructor() { this.m = new Map(); this.failList = false; }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  async list({ prefix = "", cursor, limit = 1000 } = {}) {
    if (this.failList) throw new Error("kv down");
    const names = [...this.m.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0, page = names.slice(start, start + limit);
    const done = start + limit >= names.length;
    return { keys: page.map(name => ({ name })), list_complete: done, cursor: done ? undefined : String(start + limit) };
  }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
}

const SOURCES = ["shopgoodwill", "ebay", "etsy", "chairish", "poshmark", "vinted", "grailed"];
function prefsOf(sub) {
  const p = (sub && sub.prefs) || {};
  return {
    freq: ["daily", "mwf", "weekly"].includes(p.freq) ? p.freq : "daily",
    sources: Array.isArray(p.sources) && p.sources.length ? p.sources.filter(s => SOURCES.includes(s)) : SOURCES.slice(),
    noai: p.noai ? 1 : 0,
    mute: Array.isArray(p.mute) ? p.mute.map(h => String(h).toLowerCase()) : [],
    max: Number(p.max) > 0 ? Math.floor(Number(p.max)) : 0,
    skip: Array.isArray(p.skip) ? p.skip.map(w => String(w).toLowerCase()) : [],
    pause: /^\d{4}-\d{2}-\d{2}$/.test(String(p.pause || "")) ? String(p.pause) : "",
    slot: [6, 7, 12, 18].includes(Number(p.slot)) ? Number(p.slot) : 0,
    tz: typeof p.tz === "string" ? p.tz : "",
    zip: /^\d{5}$/.test(String(p.zip || "")) ? String(p.zip) : "",
    radius: [25, 50, 100].includes(Number(p.radius)) ? Number(p.radius) : 50,
    local: Array.isArray(p.local) ? p.local.map(h => String(h).toLowerCase()) : []
  };
}
const legacy = sub => !sub.created || String(sub.created) < "2026-10-04";

function makeH(kvOf, over = {}) {
  const calls = { caps: [], vCount: [], signin: [], proSet: [], live: [], jev: [], giftMail: [] };
  const H = {
    calls,
    deny: new Set(),          // vCount names that answer "over the limit"
    capsFail: new Set(),      // "name op" pairs that throw
    capsData: {},             // "name op" -> answer
    nextPro: { pro: true, plan: { via: "order", order: "#1001", paid: "2026-10-01T10:00:00Z", renews: "2026-11-01T10:00:00Z", amount: "7.00", currency: "USD", receipt: "https://store.example/orders/RECEIPT-SECRET-xyz" } },
    kvGet: async (env, k, d) => { try { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; } catch (e) { return d; } },
    kvPut: async (env, k, v) => env.PROWL_ALERTS.put(k, JSON.stringify(v)),
    alNow: () => ({ day: TODAY, hour: 10, wday: 1 }),
    alLocal: (sub, now) => now,
    alPrefs: prefsOf,
    alActive: (env, sub) => { const mute = prefsOf(sub).mute, hs = sub.hunts.filter(h => !mute.includes(h.toLowerCase())); return sub.pro ? hs.slice(0, 25) : hs.slice(0, legacy(sub) ? 3 : 1); },
    alSlotHour: (env, sub) => prefsOf(sub).slot || 7,
    alSendDay: (sub, now) => ({ daily: [0, 1, 2, 3, 4, 5, 6], mwf: [1, 3, 5], weekly: [1] })[(!sub.pro && !legacy(sub)) ? "weekly" : prefsOf(sub).freq].includes(now.wday),
    alPaused: (sub, now) => { const p = prefsOf(sub).pause; return !!p && now.day < p; },
    alFree: (env, sub) => legacy(sub) ? 3 : 1,
    alFreeWeekly: sub => !!sub && !sub.pro && !legacy(sub),
    alLegacyFree: legacy,
    alUrgency: () => 1000,
    /* like index.js: free Pro (list, then gift) on their address or an earlier one before the shop's answer (H.nextPro);
       a gift or list Pro ends with them */
    alProSet: async (env, sub, force) => {
      calls.proSet.push(force);
      let free = null;
      for (const a of [sub.email].concat(Array.isArray(sub.prev) ? sub.prev.slice(0, 2) : [])) {
        const gh = await IX.giftHash(a), off = await H.kvGet(env, "giftoff:" + gh, null), gift = await H.kvGet(env, "gift:" + gh, null);
        free = giftPro(IX.proListHas(env, a), !!off, gift, TODAY); if (free) break;
      }
      const p = free || H.nextPro;
      if (p.pro === null && sub.plan && (sub.plan.via === "gift" || sub.plan.via === "list")) { sub.pro = false; sub.plan = null; }
      if (p.pro !== null) { sub.pro = p.pro; sub.plan = p.plan; }
      sub.proCheck = p.pro === null ? String(p.via || "check failed") : "";
      if (sub.pro) sub.hadPro = true; sub.proDay = TODAY; return sub.pro;
    },
    alPurge: (env, email, sub) => PURGE.alPurge(env, email, sub),
    alMerge: async (env, sub, fields) => { const cur = await H.kvGet(env, "sub:" + sub.email, null); if (!cur) return null; fields.forEach(f => { cur[f] = sub[f]; }); await H.kvPut(env, "sub:" + sub.email, cur); Object.keys(cur).forEach(k => { sub[k] = cur[k]; }); return cur; },
    alSendSignin: async (env, sub) => { calls.signin.push(sub.email); await env.PROWL_ALERTS.put("in:" + sub.email, JSON.stringify({ code: "SIGNIN-CODE-SECRET" })); return H.signinResult || { ok: true }; },
    alToken: () => "fresh-token-" + Math.random().toString(16).slice(2),
    /* index.js alSendGift: the gift's how-to email (H.giftMailResult / H.giftMailThrow steer it) */
    alSendGift: async (env, email, until, sub, opts) => {
      calls.giftMail.push([email, until, sub ? sub.email : null, sub ? !!sub.pro : null, !!(opts && opts.paid)]);
      if (H.giftMailThrow) throw new Error("send failed for " + email);
      return H.giftMailResult || { ok: true };
    },
    liveSources: () => ["shopgoodwill", "ebay", "etsy"],
    jevMode: "on",
    jevResultsMode: () => H.jevMode,
    alTitleKey: x => "t:" + String(x.src || "") + "|" + String(x.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    /* a local hunt: eBay near the member's ZIP only */
    liveFetchLocal: async (env, sub, term) => {
      calls.live.push(["ebay-local", term]);
      return { source: "ebay", status: 200, ms: 300, err: "", items: [{ title: "Pyrex bowl pickup", price: "$12", url: "https://ebay.example/itm/near1", image: "", src: "ebay" }] };
    },
    liveFetch: async (env, source, term) => {
      calls.live.push([source, term]);
      if (source === "etsy") return { source, status: 0, ms: 12000, items: null, err: "timed out for buyer@example.com" };
      if (source === "shopgoodwill") return { source, status: 200, ms: 800, items: [
        { title: "Roseville vase blue", price: "$40", url: "https://sgw.example/item/1", image: "https://img.example/1.jpg", src: source },
        { title: "Roseville vase lot of 3", price: "$900", url: "https://sgw.example/item/2", image: "javascript:alert(1)", src: source }
      ], err: "" };
      return { source, status: 200, ms: 400, items: [
        { title: "Roseville phone case", price: "$9", url: "https://ebay.example/itm/3", image: "https://img.example/3.jpg", src: source },
        { title: "Roseville vase cracked", price: "$25", url: "http://ebay.example/itm/4", image: "", src: source },
        { title: "Roseville pinecone vase", price: "$60", url: "https://ebay.example/itm/5", image: "https://img.example/5.jpg", src: source }
      ], err: "" };
    },
    jevClean: async (env, term, items, mode) => {
      calls.jev.push([term, items.length, mode]);
      return { items: items.map(x => Object.assign({}, x, /case/.test(x.title) ? { jev: "wrong_item", jevp: 0.92 } : /lot/.test(x.title) ? { jev: "lot", jevp: 0.8 } : { jev: "match", jevp: 0.95 })), info: { mode, status: "tagged", n: items.length, dropped: 0, ms: 5 } };
    },
    jevWouldDrop: x => !!x && (x.jev === "wrong_item" || x.jev === "part") && x.jevp >= 0.7,
    memberDropReason: (sub, x, local) => {
      const p = prefsOf(sub);
      if (!local && !p.sources.includes(x.src)) return "not in their sites";
      if (sub.pro && p.max) { const n = Number(String(x.price).replace(/[^\d.]/g, "")); if (n > p.max) return "over their max price $" + p.max; }
      if (sub.pro && p.skip.length) for (const w of p.skip) if (x.title.toLowerCase().includes(w)) return "has skip word \"" + w + "\"";
      return null;
    },
    alNear: (sub, term) => !!sub && !!sub.pro && !!prefsOf(sub).zip && prefsOf(sub).local.includes(String(term).toLowerCase()),
    runProbes: async () => [{ t: 1, source: "ebay", ok: true, status: 200, n: 12, ms: 300, err: "" }, { t: 1, source: "etsy", ok: false, status: 0, n: 0, ms: 12000, err: "no answer for jane@example.com" }],
    salesProbe: async () => [{ name: "craigslist-gms", url: "https://detroit.craigslist.org/search/gms", status: 200, ms: 400, bytes: 90000, wall: false, readable: true },
      { name: "yardsalesearch", url: "https://www.yardsalesearch.com/", status: 403, ms: 200, bytes: 5000, wall: true, readable: false, err: "<script>x</script> for jane@example.com" }],
    capsCall: async (name, op, body) => {
      calls.caps.push({ name, op, body });
      if (H.capsFail.has(name + " " + op) || H.capsFail.has("*")) throw new Error("caps 500");
      const d = H.capsData[name + " " + op];
      if (d !== undefined) return typeof d === "function" ? d(body) : d;
      if (op === "take") return { left: (await H.vCount(body.k, body.lim)) ? 0 : -1 };   // the daily counters, as vCount sees them
      return { ok: true };
    },
    capsDay: () => "caps:" + TODAY,
    vCount: async (name, limit) => { calls.vCount.push([name, limit]); return !H.deny.has(name.split(":")[0]) && !H.deny.has(name); },
    ipKey: raw => String(raw || "anon").split(",")[0].trim() || "anon",
    ipNet: key => /^\d+\.\d+\.\d+\.\d+$/.test(key) ? key.split(".").slice(0, 3).join(".") + ".0/24" : key,
    alSame: (a, b) => a === b,
    statTerm: raw => { const t = String(raw == null ? "" : raw).toLowerCase().replace(/[^a-z0-9'& ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60); return t.length < 2 || /@|https?|www|\.com/.test(String(raw)) || /\d{6,}/.test(t) ? "" : t; },
    scrubPII: s => String(s),
    summarize: (buckets, nowMs, hours) => ({ routes: buckets.map(b => ({ route: b.route, n: b.n })), series: { hours: [], req: [], err5: [], slow: [] }, totals: { n: buckets.reduce((t, b) => t + b.n, 0) }, live: { n: 0 }, hoursAsked: hours }),
    uptimeFrom: (probes) => probes.map(p => ({ source: p.source, pct24: p.ok ? 100 : 0, pct7d: 90, checks24: 1, checks7d: 7, lastOkAt: p.ok ? p.hour : null, lastStatus: p.status, lastMs: p.ms, lastErr: p.err, lastN: p.n, down: !p.ok })),
    pctFromHist: () => 0,
    giftHash: IX.giftHash, alEmail: IX.alEmail, proListHas: IX.proListHas, proListCount: IX.proListCount,
    pages: {
      loginPage: (nonce, msg) => '<!doctype html><title>Prowl admin</title><style nonce="' + nonce + '"></style><form method="post" action="/admin/login"><input name="key" type="password"></form><p class="msg">' + msg + '</p><script nonce="' + nonce + '"></script>',
      adminPage: (nonce, version) => '<!doctype html><title>Prowl admin</title><style nonce="' + nonce + '"></style><main id="dash" data-v="' + version + '"></main><script nonce="' + nonce + '"></script>'
    },
    WORKER_VERSION: "v78", AL_TZ: "America/Detroit", AL_MAX_HUNTS: 25, AL_PEND_CAP: 30,
    POOLS: [{ key: "all", name: "Fair price checks", limit: 400 }, { key: "jr:all", name: "AI sorting of results", limit: 3000 }],
    PAGE_URL: "https://shop.example/pages/prowl"
  };
  return Object.assign(H, over);
}

/* The PII fixture: every one of these values must stay out of every response. */
const EMAIL = "jane.doe@example.com";
const SECRETS = [EMAIL, "jane.doe", "old.address@example.org", "older@example.net", "TOKEN-SECRET-abc123def456", "UTOK-SECRET-987zyx",
  "gid://shopify/Customer/7712345678901", "7712345678901", "48375", "RECEIPT-SECRET-xyz", "CONF-CODE-SECRET", "SIGNIN-CODE-SECRET", "new.place@example.com", "MOVE-CODE-SECRET"];
function janeRecord(over = {}) {
  return Object.assign({
    email: EMAIL, tok: "TOKEN-SECRET-abc123def456", utok: "UTOK-SECRET-987zyx", cid: "gid://shopify/Customer/7712345678901",
    prev: ["old.address@example.org", "older@example.net"], movedAt: "2026-10-02T12:00:00.000Z",
    hunts: ["Roseville vase", "call me 555-123-4567", "pyrex", "mccoy planter"],
    prefs: { freq: "daily", sources: ["shopgoodwill", "ebay"], zip: "48375", radius: 25, local: ["pyrex"], max: 500, skip: ["cracked", "jane@example.com"], mute: ["mccoy planter"], tz: "America/Detroit", slot: 7 },
    pro: true, plan: { via: "order", order: "#1001", paid: "2026-10-01T10:00:00Z", renews: "2026-11-01T10:00:00Z", amount: "7.00", currency: "USD", receipt: "https://store.example/orders/RECEIPT-SECRET-xyz", trial: false },
    hadPro: true, created: "2026-09-20T08:00:00.000Z", day: TODAY, done: ["roseville vase"], sent: "2026-10-04", mailed: "2026-10-04", mail: "on", proDay: TODAY
  }, over);
}
function makeEnv(extra = {}) {
  const kv = new FakeKV();
  kv.set("sub:" + EMAIL, janeRecord());
  kv.set("pend:" + EMAIL, { "Roseville vase": [{ title: "Roseville vase blue", price: "$40", url: "https://sgw.example/item/1", image: "https://img.example/1.jpg", src: "shopgoodwill" }, { title: "Second", price: "$5", url: "javascript:alert(1)", src: "ebay" }], "call me 555-123-4567": [{ title: "Phone thing", price: "$1", url: "https://x.example/2", src: "ebay" }] });
  kv.set("seen:" + EMAIL, ["https://ebay.example/itm/5", "t:ebay|roseville pinecone vase", "https://old.example/1"]);
  kv.set("in:" + EMAIL, { code: "SIGNIN-CODE-SECRET" });
  kv.set("conf:" + EMAIL, { code: "CONF-CODE-SECRET", hunts: [] });
  kv.set("mvf:" + EMAIL, { to: "new.place@example.com" });
  kv.set("mv:new.place@example.com", { code: "MOVE-CODE-SECRET", from: EMAIL });
  kv.set("cid:gid://shopify/Customer/7712345678901", { email: EMAIL });
  kv.set("moved:old.address@example.org", { to: EMAIL, tok: "TOKEN-SECRET-abc123def456", at: 1 });
  kv.set("pro:" + EMAIL, { pro: true, at: 1, plan: { receipt: "https://store.example/orders/RECEIPT-SECRET-xyz" } });
  // a free member, a paused one, a member with emails off and a late one
  kv.set("sub:free.person@example.com", { email: "free.person@example.com", tok: "t2", hunts: ["fiesta"], prefs: {}, created: new Date().toISOString().slice(0, 10), day: TODAY, done: [], sent: TODAY, mailed: TODAY, mail: "on" });
  kv.set("sub:paused@example.com", { email: "paused@example.com", tok: "t3", hunts: ["hull"], prefs: { pause: "2026-10-20" }, created: "2026-08-01", mail: "on" });
  kv.set("sub:quiet@example.com", { email: "quiet@example.com", tok: "t4", hunts: ["kron"], prefs: {}, created: "2026-07-01", mail: "off", mailOffAt: "2026-10-01T00:00:00Z" });
  kv.set("sub:late@example.com", { email: "late@example.com", tok: "t5", hunts: ["weller", "frankoma"], prefs: { slot: 6 }, created: "2026-05-01", pro: false, day: TODAY, done: ["weller"], sent: "2026-10-04", mail: "on" });
  return Object.assign({ PROWL_ALERTS: kv, ADMIN_KEY: KEY }, extra);
}
function noPII(text, label) {
  for (const s of SECRETS) assert.ok(!String(text).includes(s), (label || "response") + " leaked " + s);
}
const ctxOf = () => { const pending = []; return { pending, waitUntil(p) { pending.push(p); }, async settle() { await Promise.all(pending); } }; };
async function cookieFor(key = KEY, exp = Date.now() + 3600000) { return "prowl_admin=" + await signSession(key, exp); }
async function call(env, H, method, path, { body, headers = {}, cookie = true, ctx } = {}) {
  const h = Object.assign({}, headers);
  if (cookie === true) h.Cookie = await cookieFor();
  else if (cookie) h.Cookie = cookie;
  if (method === "POST" && body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
  const req = new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const c = ctx || ctxOf();
  const res = await adminFetch(req, env, c, H);
  await c.settle();
  return res;
}
const apiPost = (env, H, path, body, extra = {}) => call(env, H, "POST", path, Object.assign({ body, headers: Object.assign({ "X-Prowl-Admin": "1", Origin: ORIGIN }, extra.headers || {}) }, extra.opts || {}));
async function idOf(env, email) { return memberId(env.MEMBER_ID_SALT || env.ADMIN_KEY, email); }
function assertBaseHeaders(res) {
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  for (const [k] of res.headers) assert.ok(!/^access-control-/i.test(k), "CORS header " + k);
}

/* ---------- sessions ---------- */
test("session: sign and verify, tampered, expired, wrong key, malformed", async () => {
  const now = Date.now(), exp = now + 3600000;
  const v = await signSession(KEY, exp);
  assert.match(v, /^\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifySession(KEY, v, now), true);
  const [e, m] = v.split(".");
  const flip = m.slice(0, -1) + (m.slice(-1) === "A" ? "B" : "A");
  assert.equal(await verifySession(KEY, e + "." + flip, now), false, "tampered MAC");
  assert.equal(await verifySession(KEY, (Number(e) + 1000) + "." + m, now), false, "tampered expiry");
  assert.equal(await verifySession(KEY, v, exp + 1), false, "expired");
  assert.equal(await verifySession(KEY, v, exp), false, "expires exactly at exp");
  assert.equal(await verifySession("another-admin-key-123", v, now), false, "wrong key");
  for (const bad of ["", null, undefined, "abc", e, e + ".", "." + m, e + "." + m + "x", "x" + e + "." + m]) assert.equal(await verifySession(KEY, bad, now), false, "malformed " + bad);
  assert.equal(await verifySession("", v, now), false, "no secret");
  const far = await signSession(KEY, now + 30 * 86400000);
  assert.equal(await verifySession(KEY, far, now), false, "a cookie never claims more than 12 hours");
});

test("admin key missing or short: every /admin route answers 503", async () => {
  const H = makeH();
  const cases = [
    [{ PROWL_ALERTS: new FakeKV() }, /Admin is not set up: add an ADMIN_KEY secret in Cloudflare/],
    [{ PROWL_ALERTS: new FakeKV(), ADMIN_KEY: "short" }, /ADMIN_KEY is shorter than 20 characters\. In Cloudflare, replace it/]
  ];
  for (const [env, says] of cases) {
    for (const [m, p] of [["GET", "/admin"], ["GET", "/admin/api/overview"], ["POST", "/admin/login"]]) {
      const res = await adminFetch(new Request(ORIGIN + p, { method: m }), env, ctxOf(), H);
      assert.equal(res.status, 503);
      const t = await res.text();
      assert.match(t, says);
      assertBaseHeaders(res);
    }
  }
  /* OWNER_KEY sits in the public page's browser storage, so it never opens the admin area */
  let res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), OWNER_KEY: "owner-key-long-enough-0123" }, ctxOf(), H);
  assert.equal(res.status, 503, "OWNER_KEY alone is not an admin key");
  assert.match(await res.text(), /add an ADMIN_KEY secret/);
  res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), ADMIN_KEY: "same-key-for-both-0123", OWNER_KEY: "same-key-for-both-0123" }, ctxOf(), H);
  assert.equal(res.status, 503);
  assert.match(await res.text(), /use a different key for ADMIN_KEY than OWNER_KEY/);
  res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), ADMIN_KEY: "only-19-characters!" }, ctxOf(), H);
  assert.equal(res.status, 503, "at least 20 characters");
  let t = await res.text();
  assert.match(t, /shorter than 20 characters/);
  assert.ok(!t.includes("only-19-characters!") && !/\b19\b/.test(t), "neither the key nor its length is shown");
  /* a near-miss name (wrong case, a space or dash) is named so the owner can fix it; its value is never shown */
  for (const name of ["admin_key", "ADMIN KEY", "Admin-Key", "ADMINKEY", "ADMIN_KEY "]) {
    res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), [name]: "misnamed-but-long-enough-0123" }, ctxOf(), H);
    assert.equal(res.status, 503, name);
    t = await res.text();
    assert.match(t, /the name must be exactly ADMIN_KEY/, name);
    assert.ok(t.includes("&quot;" + name + "&quot;"), name);
    assert.ok(!t.includes("misnamed-but-long-enough"), "the misnamed secret's value is never shown");
  }
  /* other settings are never mistaken for a misnamed admin key */
  res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), ADMIN_KEYS: "x", MY_ADMIN_KEY_OLD: "y", OWNER_KEY: "owner-key-long-enough-0123" }, ctxOf(), H);
  assert.match(await res.text(), /add an ADMIN_KEY secret/);
  res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), ADMIN_KEY: KEY, OWNER_KEY: "owner-key-long-enough-0123" }, ctxOf(), H);
  assert.equal(res.status, 200, "ADMIN_KEY works when it differs from OWNER_KEY");
  res = await call(makeEnv({ OWNER_KEY: "owner-key-long-enough-0123" }), H, "POST", "/admin/login", { cookie: false, body: "key=owner-key-long-enough-0123",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN } });
  assert.equal(res.status, 401, "OWNER_KEY does not sign in");
});

test("paths outside /admin are not handled", async () => {
  const H = makeH(), env = makeEnv();
  for (const p of ["/", "/administrator", "/adminx", "/alerts/admin", "/admin-page"]) assert.equal(await adminFetch(new Request(ORIGIN + p), env, ctxOf(), H), null, p);
});

/* ---------- pages, login, logout ---------- */
test("GET /admin without a session shows the login page with nonce-matched CSP and safety headers", async () => {
  const H = makeH(), env = makeEnv();
  const res = await call(env, H, "GET", "/admin", { cookie: false });
  assert.equal(res.status, 200);
  assertBaseHeaders(res);
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.match(res.headers.get("Content-Type"), /text\/html/);
  const cspH = res.headers.get("Content-Security-Policy"), html = await res.text();
  const n = /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(cspH)[1];
  assert.ok(n.length >= 16);
  assert.ok(cspH.includes("style-src 'nonce-" + n + "'"));
  for (const part of ["default-src 'none'", "img-src https: data:", "connect-src 'self'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"]) assert.ok(cspH.includes(part), part);
  assert.ok(html.includes('<script nonce="' + n + '">') && html.includes('<style nonce="' + n + '">'), "page carries the same nonce");
  assert.ok(html.includes('name="key"'), "login form");
  const res2 = await call(env, H, "GET", "/admin", { cookie: false });
  assert.notEqual(/nonce-([A-Za-z0-9_-]+)/.exec(res2.headers.get("Content-Security-Policy"))[1], n, "fresh nonce per response");
});

test("login success sets the session cookie with every attribute; the dashboard then loads", async () => {
  const H = makeH(), env = makeEnv(), ctx = ctxOf();
  const res = await call(env, H, "POST", "/admin/login", { cookie: false, ctx, body: "key=" + encodeURIComponent(KEY), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9" } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/admin");
  assertBaseHeaders(res);
  const sc = res.headers.get("Set-Cookie");
  const parts = sc.split(";").map(s => s.trim());
  assert.match(parts[0], /^prowl_admin=\d+\.[A-Za-z0-9_-]{43}$/);
  for (const a of ["Path=/admin", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=43200"]) assert.ok(parts.includes(a), a);
  assert.ok(!sc.includes(KEY), "cookie never holds the key");
  const value = parts[0].slice("prowl_admin=".length);
  assert.equal(await verifySession(KEY, value, Date.now()), true);
  const exp = Number(value.split(".")[0]);
  assert.ok(Math.abs(exp - (Date.now() + 43200000)) < 5000, "expires in 12 hours");
  assert.deepEqual(H.calls.vCount[0], ["admlogin:203.0.113.9", 10]);
  const a = H.calls.caps.find(x => x.op === "mrec" && x.body.a);
  assert.equal(a.body.a[0].action, "login");
  assert.equal(a.body.a[0].ok, true);
  assert.ok(!JSON.stringify(a.body).includes(KEY), "audit holds no key material");
  const dash = await call(env, H, "GET", "/admin", { cookie: parts[0] });
  assert.equal(dash.status, 200);
  const html = await dash.text();
  assert.ok(html.includes('id="dash"') && html.includes('data-v="v78"'), "dashboard with version");
});

test("login with a wrong key is 401 with the login page and an audit entry", async () => {
  const H = makeH(), env = makeEnv();
  for (const key of ["wrong-key-wrong-key", "", KEY + "x", KEY.slice(0, -1)]) {
    H.calls.caps.length = 0;
    const res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + encodeURIComponent(key), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN } });
    assert.equal(res.status, 401, "key " + key);
    assert.equal(res.headers.get("Set-Cookie"), null);
    assert.match(await res.text(), /did not match/);
    assert.ok(res.headers.get("Content-Security-Policy").includes("nonce-"));
    const a = H.calls.caps.find(x => x.op === "mrec" && x.body.a).body.a[0];
    assert.equal(a.action, "login"); assert.equal(a.ok, false);
    assert.ok(!JSON.stringify(a).includes(key) || key === "", "no key material in audit");
  }
});

test("login rate limit, origin checks and body size", async () => {
  const H = makeH(), env = makeEnv();
  const form = { "Content-Type": "application/x-www-form-urlencoded" };
  H.deny.add("admlogin");
  let res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + KEY, headers: Object.assign({ Origin: ORIGIN }, form) });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Set-Cookie"), null, "even the right key is refused once over the limit");
  H.deny.clear();
  res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + KEY, headers: Object.assign({ Origin: "https://evil.example" }, form) });
  assert.equal(res.status, 403);
  res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + KEY, headers: Object.assign({ Origin: ORIGIN, "Sec-Fetch-Site": "cross-site" }, form) });
  assert.equal(res.status, 403);
  res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + KEY, headers: Object.assign({ Origin: "null" }, form) });
  assert.equal(res.status, 403, "Origin: null alone is not enough");
  res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + KEY, headers: Object.assign({ Origin: "null", "Sec-Fetch-Site": "same-origin" }, form) });
  assert.equal(res.status, 303, "a no-referrer page's own form says Origin: null with Sec-Fetch-Site: same-origin");
  res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + KEY, headers: form });
  assert.equal(res.status, 303, "no Origin header at all is allowed");
  res = await call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + "k".repeat(3000), headers: Object.assign({ Origin: ORIGIN }, form) });
  assert.equal(res.status, 413);
  res = await call(env, H, "GET", "/admin/login", { cookie: false });
  assert.equal(res.status, 303, "GET /admin/login just goes back to /admin");
});

test("logout clears the cookie", async () => {
  const H = makeH(), env = makeEnv();
  const res = await call(env, H, "POST", "/admin/logout", { headers: { Origin: ORIGIN } });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/admin");
  const sc = res.headers.get("Set-Cookie");
  assert.match(sc, /^prowl_admin=;/);
  for (const a of ["Path=/admin", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=0"]) assert.ok(sc.includes(a), a);
  const bad = await call(env, H, "POST", "/admin/logout", { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.status, 403);
});

/* ---------- API guards ---------- */
test("API without a valid session is 401 JSON", async () => {
  const H = makeH(), env = makeEnv();
  const cases = [false, "prowl_admin=garbage", await cookieFor("someone-elses-key-123"), await cookieFor(KEY, Date.now() - 1000)];
  for (const cookie of cases) {
    for (const p of ["/admin/api/overview", "/admin/api/members", "/admin/api/member?id=M-00000000"]) {
      const res = await call(env, H, "GET", p, { cookie });
      assert.equal(res.status, 401, p + " " + cookie);
      assertBaseHeaders(res);
      const j = await res.json();
      assert.ok(j.error && j.login === true);
    }
    const res = await call(env, H, "POST", "/admin/api/find", { cookie, body: { email: EMAIL }, headers: { "X-Prowl-Admin": "1", Origin: ORIGIN } });
    assert.equal(res.status, 401);
  }
  assert.equal(H.calls.caps.filter(x => x.op === "mget").length, 0, "nothing was read");
});

test("POST guards: X-Prowl-Admin header, same origin, body size, bad JSON, wrong method, unknown route", async () => {
  const H = makeH(), env = makeEnv();
  let res = await call(env, H, "POST", "/admin/api/find", { body: { email: EMAIL }, headers: { Origin: ORIGIN } });
  assert.equal(res.status, 403, "missing X-Prowl-Admin");
  res = await call(env, H, "POST", "/admin/api/find", { body: { email: EMAIL }, headers: { "X-Prowl-Admin": "yes", Origin: ORIGIN } });
  assert.equal(res.status, 403, "X-Prowl-Admin must be 1");
  res = await apiPost(env, H, "/admin/api/find", { email: EMAIL }, { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403, "cross-origin");
  res = await apiPost(env, H, "/admin/api/find", { email: EMAIL }, { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(res.status, 403, "Sec-Fetch-Site cross-site");
  res = await apiPost(env, H, "/admin/api/member/action", { id: "M-00000000", action: "delete", confirm: "x".repeat(9000) });
  assert.equal(res.status, 413);
  res = await apiPost(env, H, "/admin/api/find", "{not json");
  assert.equal(res.status, 400);
  res = await call(env, H, "GET", "/admin/api/find");
  assert.equal(res.status, 405);
  res = await apiPost(env, H, "/admin/api/overview", {});
  assert.equal(res.status, 405);
  res = await call(env, H, "GET", "/admin/api/constructor");
  assert.equal(res.status, 404);
  res = await call(env, H, "GET", "/admin/api/nope");
  assert.equal(res.status, 404);
  res = await call(env, H, "GET", "/admin/elsewhere");
  assert.equal(res.status, 404);
  assert.equal(H.calls.vCount.filter(x => x[0] === "admfind").length, 0, "refused requests never reached the handler");
});

/* ---------- ids and scrubbing ---------- */
test("memberId is stable, salted and short", async () => {
  const a = await memberId("salt-one", EMAIL), b = await memberId("salt-one", EMAIL), c = await memberId("salt-two", EMAIL), d = await memberId("salt-one", "other@example.com");
  assert.match(a, /^M-[0-9a-f]{8}$/);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  const { createHash } = await import("node:crypto");
  assert.equal(a, "M-" + createHash("sha256").update("salt-one|" + EMAIL).digest("hex").slice(0, 8));
});

test("scrubHunt hides hunts that look personal", () => {
  const hidden = ["jane@example.com", "call 555-123-4567", "(313) 555 0199", "555.123.4567", "order 1234567", "zip 483750", "tel 5551234", "(313) 555-1999", "555 1234", "1960 555 1234"];
  for (const h of hidden) assert.deepEqual(scrubHunt(h), { text: "(hidden — looks personal)", hidden: true }, h);
  for (const h of ["roseville vase", "1950s pyrex", "mccoy 12345", "lot of 3", "Kron lamp 1960 1970s", "1950-1960 lamp", "pyrex 1960 - 1975"]) assert.deepEqual(scrubHunt(h), { text: h, hidden: false }, h);
  assert.deepEqual(scrubHunt(null), { text: "", hidden: false });
});

/* ---------- PII-free views ---------- */
test("memberSummary and memberDetail never contain PII and describe the member", async () => {
  const H = makeH(), env = makeEnv(), now = H.alNow();
  const sub = janeRecord();
  const s = memberSummary(env, sub, H, now);
  noPII(JSON.stringify(s), "summary");
  assert.equal(s.plan, "pro");
  assert.equal(s.via, "order");
  assert.equal(s.hunts, 4);
  assert.equal(s.active, 3, "one hunt muted");
  assert.equal(s.mail, "on");
  assert.equal(s.checkedToday, 1);
  assert.equal(s.activeToday, 3);
  assert.equal(s.dueToday, true);
  assert.equal(s.late, true, "10am, their hour is 7, not sent today");
  assert.equal(s.created, "2026-09-20");
  assert.equal(s.lastSent, "2026-10-04");
  assert.ok(s.flags.includes("email late") && s.flags.includes("moved address"));
  const d = await memberDetail(env, sub, H, now);
  const dj = JSON.stringify(d);
  noPII(dj, "detail");
  for (const k of ["email", "tok", "utok", "cid", "prev", "receipt", "zip"]) assert.ok(!(k in d), "no field " + k);
  assert.equal(d.plan.name, "pro"); assert.equal(d.planName, "pro");
  assert.equal(d.plan.order, "#1001"); assert.equal(d.plan.paidDay, "2026-10-01"); assert.equal(d.plan.renewsDay, "2026-11-01");
  assert.ok(!("receipt" in d.plan));
  assert.equal(d.hunts.length, 4);
  assert.deepEqual(d.hunts[1], { text: "(hidden — looks personal)", hidden: true, active: true, muted: false, local: false, checkedToday: false });
  assert.equal(d.hunts[0].checkedToday, true);
  assert.equal(d.hunts[2].local, true, "pyrex is a local hunt");
  assert.equal(d.hunts[3].muted, true);
  assert.equal(d.prefs.zipSet, true); assert.equal(d.prefs.radius, 25); assert.equal(d.prefs.localHunts, 1);
  assert.deepEqual(d.prefs.skipWords, ["cracked", "(hidden — looks personal)"]);
  assert.equal(d.prefs.maxPrice, 500);
  assert.equal(d.pending.total, 3);
  assert.equal(d.pending.hunts[1].text, "(hidden — looks personal)");
  assert.equal(d.pending.hunts[0].sample[1].url, "", "non-https links dropped");
  assert.equal(d.seenCount, 2, "title keys are not counted");
  assert.equal(d.signinWaiting, true); assert.equal(d.confirmWaiting, true); assert.equal(d.moveWaiting, true);
  assert.equal(d.previousAddresses, 2); assert.equal(d.movedAt, "2026-10-02");
  assert.ok(d.flags.includes("sign-in link waiting"));
});

test("plans and flags: trial, free, legacy, paused, emails off, no hunts, broken records", async () => {
  const H = makeH(), env = makeEnv(), now = H.alNow();
  assert.equal(memberSummary(env, janeRecord({ plan: { via: "order", trial: true } }), H, now).plan, "trial");
  const free = memberSummary(env, { email: "a@b.c", hunts: ["x", "y"], created: "2026-10-05", pro: false }, H, now);
  assert.equal(free.plan, "free"); assert.equal(free.freq, "weekly"); assert.ok(free.flags.includes("hunts over plan limit"));
  assert.equal(memberSummary(env, { email: "a@b.c", hunts: [], created: "2026-01-01" }, H, now).plan, "free (legacy)");
  const paused = memberSummary(env, { email: "a@b.c", hunts: ["x"], prefs: { pause: "2026-12-01" } }, H, now);
  assert.equal(paused.paused, true); assert.equal(paused.pauseUntil, "2026-12-01"); assert.equal(paused.dueToday, false); assert.equal(paused.activeToday, 0);
  const off = memberSummary(env, { email: "a@b.c", hunts: ["x"], mail: "off" }, H, now);
  assert.ok(off.flags.includes("emails off")); assert.equal(off.mail, "off"); assert.equal(off.late, false);
  const none = memberSummary(env, { email: "a@b.c", hunts: "not a list" }, H, now);
  assert.ok(none.flags.includes("no hunts"));
  const failing = memberSummary(env, janeRecord({ pro: null }), H, now);
  assert.ok(failing.flags.includes("pro check failing"));
});

test("members list: ids, filters, sorts, PII-free, salted by MEMBER_ID_SALT", async () => {
  const H = makeH(), env = makeEnv({ MEMBER_ID_SALT: "separate-salt" });
  const res = await call(env, H, "GET", "/admin/api/members");
  assert.equal(res.status, 200);
  assertBaseHeaders(res);
  const text = await res.text(); noPII(text, "members");
  for (const e of ["free.person@example.com", "paused@example.com", "quiet@example.com", "late@example.com"]) assert.ok(!text.includes(e));
  const j = JSON.parse(text);
  assert.equal(j.total, 5); assert.equal(j.truncated, false);
  const janeId = await memberId("separate-salt", EMAIL);
  assert.notEqual(janeId, await memberId(KEY, EMAIL));
  const jane = j.members.find(m => m.id === janeId);
  assert.ok(jane, "id uses MEMBER_ID_SALT");
  assert.ok(!jane.flags.includes("sign-in link waiting"), "the list does not list waiting sign-in links (the detail view shows them)");
  assert.deepEqual(j.members.map(m => m.created), j.members.map(m => m.created).slice().sort().reverse(), "newest first by default");
  const get = async q => (await (await call(env, H, "GET", "/admin/api/members?" + q)).json());
  assert.deepEqual((await get("filter=pro")).members.map(m => m.plan), ["pro"]);
  assert.equal((await get("filter=free")).members.length, 4);
  assert.equal((await get("filter=paused")).members.length, 1);
  assert.equal((await get("filter=mailoff")).members.length, 1);
  const late = await get("filter=late");
  assert.equal(late.members.length, 2, "jane and the late member");
  assert.equal((await get("filter=issues")).members.length, 2);
  assert.equal((await get("filter=bogus")).filter, "all");
  const byHunts = await get("sort=hunts");
  assert.equal(byHunts.members[0].hunts, 4);
  const bySent = await get("sort=lastSent");
  assert.ok(bySent.members[0].lastSent >= bySent.members[bySent.members.length - 1].lastSent);
});

test("find: by email, by an earlier address, 404, rate limit; the email is never echoed", async () => {
  const H = makeH(), env = makeEnv();
  let res = await apiPost(env, H, "/admin/api/find", { email: "  Jane.Doe@Example.com " });
  assert.equal(res.status, 200);
  let text = await res.text(); noPII(text, "find");
  assert.deepEqual(JSON.parse(text), { id: await idOf(env, EMAIL) });
  res = await apiPost(env, H, "/admin/api/find", { email: "old.address@example.org" });
  text = await res.text(); noPII(text, "find moved");
  assert.deepEqual(JSON.parse(text), { id: await idOf(env, EMAIL), moved: true });
  res = await apiPost(env, H, "/admin/api/find", { email: "nobody@example.com" });
  assert.equal(res.status, 404);
  text = await res.text();
  assert.ok(!text.includes("nobody"));
  assert.match(JSON.parse(text).error, /^No member with that email\. Check the spelling/);
  /* someone who signed up but never tapped the confirm link: only conf:<email> exists */
  env.PROWL_ALERTS.set("conf:waiting.person@example.com", { code: "CONF-CODE-SECRET", hunts: ["pyrex"] });
  res = await apiPost(env, H, "/admin/api/find", { email: "Waiting.Person@example.com" });
  assert.equal(res.status, 404);
  text = await res.text(); noPII(text, "find waiting");
  assert.ok(!text.includes("waiting.person"));
  assert.match(JSON.parse(text).error, /not tapped the confirm link/); assert.match(JSON.parse(text).error, /spam/);
  res = await apiPost(env, H, "/admin/api/find", { email: "not an email" });
  assert.equal(res.status, 400);
  const audits = H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => JSON.stringify(x.body));
  assert.ok(audits.length >= 3);
  for (const a of audits) { noPII(a, "find audit"); assert.ok(!a.includes("nobody")); }
  H.deny.add("admfind");
  res = await apiPost(env, H, "/admin/api/find", { email: EMAIL });
  assert.equal(res.status, 429);
});

test("member detail by id; unknown and malformed ids are 404", async () => {
  const H = makeH(), env = makeEnv();
  const id = await idOf(env, EMAIL);
  let res = await call(env, H, "GET", "/admin/api/member?id=" + id);
  assert.equal(res.status, 200);
  const text = await res.text(); noPII(text, "member");
  const d = JSON.parse(text);
  assert.equal(d.id, id); assert.equal(d.hunts.length, 4);
  for (const bad of ["M-00000000", "M-XYZ", "", "sub:" + EMAIL, EMAIL]) {
    res = await call(env, H, "GET", "/admin/api/member?id=" + encodeURIComponent(bad));
    assert.equal(res.status, 404, bad);
    noPII(await res.text());
  }
});

/* ---------- member actions ---------- */
async function act(env, H, email, action, confirm) {
  const id = await idOf(env, email);
  const res = await apiPost(env, H, "/admin/api/member/action", confirm === undefined ? { id, action } : { id, action, confirm });
  const text = await res.text();
  noPII(text, action);
  return { res, j: JSON.parse(text), id };
}
const rec = (env, email = EMAIL) => env.PROWL_ALERTS.json("sub:" + email);

test("action recheck-today and resend-today", async () => {
  const H = makeH(), env = makeEnv();
  let { res, j, id } = await act(env, H, EMAIL, "recheck-today");
  assert.equal(res.status, 200); assert.equal(j.ok, true); assert.match(j.message, /checked again/);
  assert.equal(j.member.id, id);
  let r = rec(env);
  assert.equal(r.day, ""); assert.deepEqual(r.done, []); assert.equal(r.sent, "2026-10-04", "recheck keeps sent");
  assert.equal(r.tok, "TOKEN-SECRET-abc123def456", "other fields untouched");
  ({ j } = await act(env, H, EMAIL, "resend-today"));
  r = rec(env);
  assert.equal(j.ok, true); assert.equal(r.sent, ""); assert.equal(r.day, ""); assert.deepEqual(r.done, []);
  ({ j } = await act(env, H, "quiet@example.com", "resend-today"));
  assert.match(j.message, /Emails are off/);
});

test("action mail-off, mail-on and unpause", async () => {
  const H = makeH(), env = makeEnv();
  let { j } = await act(env, H, EMAIL, "mail-off");
  let r = rec(env);
  assert.equal(r.mail, "off"); assert.match(r.mailOffAt, /^\d{4}-\d{2}-\d{2}T/); assert.equal(j.member.mail, "off");
  ({ j } = await act(env, H, EMAIL, "mail-on"));
  r = rec(env);
  assert.equal(r.mail, "on"); assert.equal(r.mailOffAt, ""); assert.equal(j.ok, true);
  ({ j } = await act(env, H, "paused@example.com", "unpause"));
  r = rec(env, "paused@example.com");
  assert.equal(r.prefs.pause, ""); assert.equal(j.member.paused, false);
  const env2 = makeEnv();
  env2.PROWL_ALERTS.set("sub:" + EMAIL, janeRecord({ prefs: Object.assign({}, janeRecord().prefs, { pause: "2026-12-01" }) }));
  await act(env2, H, EMAIL, "unpause");
  r = rec(env2);
  assert.equal(r.prefs.pause, ""); assert.equal(r.prefs.zip, "48375", "other prefs kept"); assert.equal(r.prefs.max, 500);
});

test("action signout-all needs the id typed, then rotates the token and drops the waiting link", async () => {
  const H = makeH(), env = makeEnv();
  let { res, j, id } = await act(env, H, EMAIL, "signout-all");
  assert.equal(res.status, 400); assert.equal(j.needsConfirm, true); assert.match(j.error, /type the member id/);
  assert.equal(rec(env).tok, "TOKEN-SECRET-abc123def456");
  ({ res } = await act(env, H, EMAIL, "signout-all", "M-00000000"));
  assert.equal(res.status, 400);
  ({ res, j } = await act(env, H, EMAIL, "signout-all", " " + id.toLowerCase() + " "));
  assert.equal(res.status, 200); assert.equal(j.ok, true);
  const r = rec(env);
  assert.notEqual(r.tok, "TOKEN-SECRET-abc123def456"); assert.match(r.tok, /^fresh-token-/);
  assert.equal(r.utok, "UTOK-SECRET-987zyx", "unsubscribe token kept");
  assert.equal(env.PROWL_ALERTS.m.has("in:" + EMAIL), false);
  assert.equal(env.PROWL_ALERTS.m.has("conf:" + EMAIL), false, "a waiting confirm link signs in as the member too (v85)");
  noPII(JSON.stringify(j));
  assert.ok(!JSON.stringify(j).includes(r.tok), "new token never returned");
});

test("action clear-seen needs the id typed, then deletes the seen list", async () => {
  const H = makeH(), env = makeEnv();
  let { res, id } = await act(env, H, EMAIL, "clear-seen", "nope");
  assert.equal(res.status, 400);
  assert.ok(env.PROWL_ALERTS.m.has("seen:" + EMAIL));
  let j;
  ({ res, j } = await act(env, H, EMAIL, "clear-seen", id));
  assert.equal(res.status, 200); assert.equal(j.member.seenCount, 0);
  assert.equal(env.PROWL_ALERTS.m.has("seen:" + EMAIL), false);
  assert.ok(env.PROWL_ALERTS.m.has("sub:" + EMAIL));
});

test("action delete needs the id typed, removes every key including the matching cid, and keeps someone else's cid", async () => {
  const H = makeH(), env = makeEnv();
  let { res, id } = await act(env, H, EMAIL, "delete");
  assert.equal(res.status, 400);
  assert.ok(env.PROWL_ALERTS.m.has("sub:" + EMAIL));
  let j;
  ({ res, j } = await act(env, H, EMAIL, "delete", id));
  assert.equal(res.status, 200); assert.equal(j.ok, true); assert.equal(j.member, null);
  for (const k of ["sub:", "pend:", "seen:", "mvf:", "in:", "pro:"]) assert.equal(env.PROWL_ALERTS.m.has(k + EMAIL), false, k);
  assert.equal(env.PROWL_ALERTS.m.has("cid:gid://shopify/Customer/7712345678901"), false);
  assert.ok(env.PROWL_ALERTS.m.has("sub:late@example.com"), "other members untouched");
  const gone = await call(env, H, "GET", "/admin/api/member?id=" + id);
  assert.equal(gone.status, 404);
  const list = await (await call(env, H, "GET", "/admin/api/members")).json();
  assert.equal(list.total, 4, "the list forgets them straight away");
  const env2 = makeEnv();
  env2.PROWL_ALERTS.set("cid:gid://shopify/Customer/7712345678901", { email: "someone.else@example.com" });
  await act(env2, H, EMAIL, "delete", id);
  assert.ok(env2.PROWL_ALERTS.m.has("cid:gid://shopify/Customer/7712345678901"), "a cid now pointing elsewhere is kept");
});

test("action signin-link, refresh-pro, audit entries, unknown action and rate limits", async () => {
  const H = makeH(), env = makeEnv();
  let { res, j, id } = await act(env, H, EMAIL, "signin-link");
  assert.equal(res.status, 200); assert.equal(j.ok, true); assert.match(j.message, /Sign-in link sent/);
  assert.deepEqual(H.calls.signin, [EMAIL]);
  H.signinResult = { ok: false, error: "resend 500 for jane.doe@example.com" };
  ({ j } = await act(env, H, EMAIL, "signin-link"));
  assert.equal(j.ok, false); assert.match(j.message, /Could not send/);
  H.nextPro = { pro: false, plan: null };
  ({ j } = await act(env, H, EMAIL, "refresh-pro"));
  assert.deepEqual(H.calls.proSet, [true]);
  let r = rec(env);
  assert.equal(r.pro, false); assert.equal(r.proDay, TODAY); assert.equal(j.member.plan.name, "free (legacy)");
  assert.match(j.message, /no current Prowl Pro order/); assert.match(j.message, /were Pro before/);
  H.nextPro = { pro: true, plan: { via: "order", trial: true, receipt: "https://store.example/orders/RECEIPT-SECRET-xyz" } };
  ({ j } = await act(env, H, EMAIL, "refresh-pro"));
  assert.equal(rec(env).pro, true); assert.equal(j.member.plan.name, "trial"); assert.match(j.message, /free Prowl Pro month/);
  ({ res, j } = await act(env, H, EMAIL, "make-coffee"));
  assert.equal(res.status, 400);
  res = await apiPost(env, H, "/admin/api/member/action", { id: "M-00000000", action: "mail-off" });
  assert.equal(res.status, 404);
  const audits = H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => x.body.a[0]);
  assert.deepEqual(audits.map(a => a.action), ["signin-link", "signin-link", "refresh-pro", "refresh-pro"]);
  assert.deepEqual(audits.map(a => a.ok), [true, false, true, true]);
  for (const a of audits) { assert.equal(a.id, id); assert.ok(typeof a.t === "number"); noPII(JSON.stringify(a), "audit"); }
  H.deny.add("admact");
  ({ res } = await act(env, H, EMAIL, "mail-off"));
  assert.equal(res.status, 429);
  H.deny.clear(); H.deny.add("admsig");
  ({ res } = await act(env, H, EMAIL, "signin-link"));
  assert.equal(res.status, 429, "a few sign-in links per member per day");
});

test("action on a member deleted meanwhile reports it", async () => {
  const H = makeH(), env = makeEnv();
  const merge = H.alMerge;
  H.alMerge = async (e, sub, f) => { await e.PROWL_ALERTS.delete("sub:" + sub.email); return merge(e, sub, f); };
  const { j } = await act(env, H, EMAIL, "mail-off");
  assert.equal(j.ok, false); assert.match(j.message, /deleted their account/); assert.equal(j.member, null);
});

/* ---------- diagnose ---------- */
test("diagnose a typed term: every live source, AI tags, https-only links, failures reported", async () => {
  const H = makeH(), env = makeEnv();
  const res = await apiPost(env, H, "/admin/api/diagnose", { term: "  roseville   vase " });
  assert.equal(res.status, 200);
  const text = await res.text(); noPII(text, "diagnose");
  const j = JSON.parse(text);
  assert.equal(j.term, "roseville vase"); assert.equal(j.member, null); assert.equal(j.local, false);
  assert.deepEqual(j.results.map(r => r.source), ["shopgoodwill", "ebay", "etsy"]);
  const sgw = j.results[0], ebay = j.results[1], etsy = j.results[2];
  assert.equal(sgw.count, 2); assert.equal(sgw.items[1].image, "", "javascript: image dropped");
  assert.equal(sgw.items[1].ai, "lot"); assert.equal(sgw.items[1].aiP, 0.8); assert.equal(sgw.items[1].aiDrop, false);
  assert.equal(ebay.items[0].ai, "wrong_item"); assert.equal(ebay.items[0].aiDrop, true);
  assert.equal(ebay.items[1].url, "", "http link dropped");
  assert.equal(ebay.kept, 2);
  assert.equal(etsy.status, 0); assert.equal(etsy.count, 0); assert.ok(etsy.err.includes("[email]"), "error text scrubbed");
  for (const r of j.results) for (const it of r.items) { assert.equal(it.memberDrop, null); assert.equal(it.alreadySent, false); }
  assert.deepEqual(j.summary, { sources: 3, ok: 2, failed: 1, items: 5, aiDropped: 1, aiWould: 1, memberDropped: 0, notExact: 0, alreadySent: 0, waiting: 0 });
  assert.deepEqual(j.ai, { mode: "on", alerts: true, live: true });
  assert.equal(H.calls.jev.length, 2, "AI only for sources that returned listings");
  assert.ok(H.calls.jev.every(c => c[2] === "shadow"));
});

test("diagnose a member's hunt: their filters, already-sent, hidden term; AI off is skipped", async () => {
  const H = makeH(), env = makeEnv();
  const id = await idOf(env, EMAIL);
  let res = await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 0, sources: ["ebay", "shopgoodwill", "ebay", "amazon"] });
  let text = await res.text(); noPII(text, "diagnose member");
  let j = JSON.parse(text);
  assert.equal(j.term, "Roseville vase");
  assert.deepEqual(j.results.map(r => r.source), ["ebay", "shopgoodwill"], "only live sources, no repeats");
  assert.deepEqual(j.member, { id, pro: true, aiOff: false, filters: { sources: ["shopgoodwill", "ebay"], maxPrice: 500, skipWords: ["cracked", "(hidden — looks personal)"] } });
  const ebay = j.results[0], sgw = j.results[1];
  assert.equal(ebay.items[1].memberDrop, "has skip word \"cracked\"");
  assert.equal(ebay.items[2].alreadySent, true);
  assert.equal(sgw.items[1].memberDrop, "over their max price $500");
  assert.equal(j.summary.alreadySent, 1); assert.equal(j.summary.memberDropped, 2);
  res = await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 1 });
  text = await res.text(); noPII(text, "hidden hunt");
  j = JSON.parse(text);
  assert.equal(j.term, "(hidden)");
  assert.ok(!text.includes("555-123-4567"));
  const env2 = makeEnv();
  env2.PROWL_ALERTS.set("sub:" + EMAIL, janeRecord({ prefs: Object.assign({}, janeRecord().prefs, { noai: 1 }) }));
  H.calls.jev.length = 0;
  j = await (await apiPost(env2, H, "/admin/api/diagnose", { id, hunt: 0 })).json();
  assert.equal(H.calls.jev.length, 0, "member has AI off");
  assert.equal(j.member.aiOff, true);
  for (const r of j.results) { assert.ok(r.ai === "off for this member"); for (const it of r.items) { assert.equal(it.ai, null); assert.equal(it.aiDrop, false); } }
  j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 2 })).json();
  assert.equal(j.local, true, "pyrex is their local hunt");
});

test("skip words stay hidden after alPrefs strips the @; a $100000 max price is not mistaken for one", async () => {
  /* index.js stores skip words as alWords(vClean(w, 24)): lower-case words with every other character turned into a space */
  const norm = w => String(w).replace(/\s+/g, " ").trim().slice(0, 24).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const realish = sub => { const p = prefsOf(sub); p.skip = (Array.isArray(sub.prefs && sub.prefs.skip) ? sub.prefs.skip : []).map(norm).filter(Boolean); return p; };
  const H = makeH(undefined, { alPrefs: realish }), env = makeEnv();
  H.memberDropReason = (sub, x) => {
    const p = realish(sub), n = Number(String(x.price).replace(/[^\d.]/g, ""));
    if (p.max && n > p.max) return "over their max price $" + p.max;
    const t = " " + x.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
    for (const w of p.skip) if (t.includes(" " + w + " ")) return "has skip word \"" + w + "\"";
    return null;
  };
  H.liveFetch = async (e, source) => ({ source, status: 200, ms: 5, err: "", items: [
    { title: "Lamp jane doe example com", price: "$5", url: "https://ebay.example/itm/9", src: source },
    { title: "Big lamp", price: "$250000", url: "https://ebay.example/itm/10", src: source },
    { title: "Cracked lamp", price: "$5", url: "https://ebay.example/itm/11", src: source }] });
  env.PROWL_ALERTS.set("sub:" + EMAIL, janeRecord({ prefs: Object.assign({}, janeRecord().prefs, { max: 100000, skip: ["cracked", "Jane.Doe@Example.com", "someone.with.a.long.name@example.org", "555-123-4567"] }) }));
  const leaks = ["jane doe", "example com", "someone with", "555 123"];
  const id = await idOf(env, EMAIL), HID = "(hidden — looks personal)";
  const d = JSON.parse(await (await call(env, H, "GET", "/admin/api/member?id=" + id)).text());
  assert.deepEqual(d.prefs.skipWords, ["cracked", HID, HID, HID]);
  const j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 0, sources: ["ebay"] })).json();
  const mine = JSON.stringify([d, j.member, j.results.map(r => r.items.map(x => x.memberDrop))]);   // listing titles are the marketplace's, not the member's
  for (const s of leaks) assert.ok(!mine.includes(s), "leaked " + s);
  assert.deepEqual(j.member.filters.skipWords, ["cracked", HID, HID, HID]);
  assert.deepEqual(j.results[0].items.map(x => x.memberDrop), ["has one of their skip words", "over their max price $100000", "has skip word \"cracked\""]);
  H.capsData["metrics mget"] = { errors: [{ t: 1, r: "live:ebay", s: 502, m: "bad filter pickupPostalCode:48375 for 48375-1234", q: "" }] };
  const errs = await (await call(env, H, "GET", "/admin/api/errors")).text();
  assert.ok(!errs.includes("48375"), "ZIP codes in log text are masked");
});

test("diagnose input checks and rate limit", async () => {
  const H = makeH(), env = makeEnv();
  const id = await idOf(env, EMAIL);
  assert.equal((await apiPost(env, H, "/admin/api/diagnose", {})).status, 400);
  assert.equal((await apiPost(env, H, "/admin/api/diagnose", { hunt: 0 })).status, 400);
  assert.equal((await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 9 })).status, 400);
  assert.equal((await apiPost(env, H, "/admin/api/diagnose", { id: "M-00000000", hunt: 0 })).status, 404);
  H.deny.add("admdiag");
  assert.equal((await apiPost(env, H, "/admin/api/diagnose", { term: "pyrex" })).status, 429);
});

/* ---------- overview, health, errors, searches ---------- */
function metricsData(H, nowMs) {
  H.capsData["metrics mget"] = {
    buckets: [{ hour: "2026-10-05T10", route: "live:ebay", n: 10 }],
    errors: [{ t: nowMs - 1000, r: "live:ebay", s: 502, m: "upstream said no to jane.doe@example.com token abcdefabcdefabcdefabcdefabcdef", q: "roseville" }],
    crons: [{ t: nowMs - 4 * 60000, ms: 2100, members: 5, checked: 4, sent: 1, failed: 0, errors: [] }, { t: nowMs - 9 * 60000, ms: 2000, members: 5, checked: 2, sent: 0, failed: 1, errors: ["oops"] }, { t: nowMs - 30 * 3600000, failed: 1 }],
    probes: [{ hour: "2026-10-05T10", source: "ebay", ok: true, status: 200, n: 12, ms: 300, err: "" }, { hour: "2026-10-05T10", source: "etsy", ok: false, status: 0, n: 0, ms: 12000, err: "timeout at 5551234567" }],
    audit: [{ t: nowMs - 5000, action: "mail-off", id: "M-12345678", ok: true, note: "" }, { t: 1, action: "x", id: "jane@example.com", ok: true, note: "jane@example.com" }]
  };
  H.capsData["caps:" + TODAY + " peek"] = { values: { all: 380, "jr:all": 30 } };
  H.capsData["stats top"] = q => ({ top: [{ term: "roseville", visitorDays: q.from === q.to ? 3 : 12, requests: 20 }, { term: "jane@example.com", visitorDays: 1, requests: 1 }] });
}

test("overview: full shape, PII-free", async () => {
  const H = makeH(), env = makeEnv();
  metricsData(H, Date.now());
  const res = await call(env, H, "GET", "/admin/api/overview");
  assert.equal(res.status, 200);
  assertBaseHeaders(res);
  const text = await res.text(); noPII(text, "overview");
  const j = JSON.parse(text);
  assert.equal(j.version, "v78");
  assert.equal(j.now.detroitDay, TODAY); assert.equal(j.now.detroitHour, 10); assert.match(j.now.iso, /Z$/);
  assert.deepEqual(j.members, { total: 5, pro: 1, gifted: 0, trial: 0, free: 1, freeLegacy: 3, mailOff: 1, paused: 1, noHunts: 0, new7d: 1, hunts: 9, activeHunts: 8, truncated: false });
  assert.equal(j.alerts.late, 2); assert.equal(j.alerts.dueToday, 3); assert.equal(j.alerts.sentToday, 1); assert.equal(j.alerts.checkedToday, 2);
  assert.equal(j.alerts.huntsLeftToday, 3, "jane 3-1 and the late member 2-1; the free member's email already went");
  assert.equal(j.alerts.lastCron.ageMin, 4); assert.equal(j.alerts.lastCron.sent, 1);
  assert.equal(j.alerts.cronRuns24h, 2); assert.equal(j.alerts.cronFails24h, 1);
  assert.deepEqual(j.traffic.routes, [{ route: "live:ebay", n: 10 }]);
  assert.equal(j.traffic.hoursAsked, 24);
  assert.equal(j.uptime.length, 2); assert.equal(j.uptime[1].down, true); assert.ok(!j.uptime[1].lastErr.includes("5551234567"));
  assert.deepEqual(j.ai.pools, [{ name: "Fair price checks", used: 380, limit: 400, pct: 95 }, { name: "AI sorting of results", used: 30, limit: 3000, pct: 1 }]);
  assert.equal(j.errors.length, 1); assert.equal(j.errors[0].s, 502); assert.ok(j.errors[0].m.includes("[email]") && j.errors[0].m.includes("[hidden]"));
  assert.deepEqual(j.searches.today, [{ term: "roseville", visitors: 3, requests: 20 }]);
  assert.deepEqual(j.searches.week, [{ term: "roseville", visitors: 12, requests: 20 }]);
  assert.equal(j.audit.length, 2); assert.equal(j.audit[1].id, "", "a bad id in the log is not passed on");
  assert.deepEqual(j.liveSources, ["shopgoodwill", "ebay", "etsy"]);
  assert.deepEqual(j.issues, []);
  const mgets = H.calls.caps.filter(x => x.op === "mget");
  assert.ok(mgets.every(x => x.name === "metrics"));
  assert.ok(mgets.some(x => x.body.crons >= 288 && x.body.probeDays === 7), "enough cron runs for 24 hours of 5-minute runs, and a week of uptime checks");
  assert.ok(mgets.some(x => x.body.crons === 1 && x.body.probeDays === 0 && x.body.hours === 26), "the minute-by-minute part reads only the newest run");
  const peek = H.calls.caps.find(x => x.op === "peek");
  assert.equal(peek.name, "caps:" + TODAY); assert.deepEqual(peek.body.keys, ["all", "jr:all"]);
});

test("overview tolerates failing data sources", async () => {
  const H = makeH(), env = makeEnv();
  H.capsFail.add("*");
  let res = await call(env, H, "GET", "/admin/api/overview");
  assert.equal(res.status, 200);
  let j = await res.json();
  assert.ok(j.members && j.members.total === 5, "members still shown");
  assert.equal(j.traffic, null); assert.equal(j.uptime, null); assert.equal(j.errors, null); assert.equal(j.ai, null); assert.equal(j.searches, null); assert.equal(j.audit, null);
  assert.equal(j.alerts.lastCron, null); assert.equal(j.alerts.late, 2);
  assert.equal(j.issues.length, 3);
  const H2 = makeH(), env2 = makeEnv();
  metricsData(H2, Date.now());
  env2.PROWL_ALERTS.failList = true;
  H2.capsData["metrics mget"] = null;   // a missing CAPS binding answers null
  H2.summarize = () => { throw new Error("boom"); };
  res = await call(env2, H2, "GET", "/admin/api/overview");
  j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.members, null); assert.equal(j.alerts, null); assert.equal(j.traffic, null);
  assert.ok(j.ai && j.searches);
  assert.ok(j.issues.some(s => /member list/i.test(s)) && j.issues.some(s => /Speed/.test(s)));
  const H3 = makeH(), env3 = makeEnv();
  metricsData(H3, Date.now());
  H3.summarize = () => { throw new Error("boom"); };
  j = await (await call(env3, H3, "GET", "/admin/api/overview")).json();
  assert.equal(j.traffic, null); assert.ok(j.uptime && j.errors); assert.ok(j.issues.some(s => /Speed numbers/.test(s)));
});

test("healthcheck runs the probes, records them and scrubs errors", async () => {
  const H = makeH(), env = makeEnv();
  const res = await apiPost(env, H, "/admin/api/healthcheck", undefined);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.results.length, 2); assert.equal(j.results[1].ok, false); assert.ok(j.results[1].err.includes("[email]"));
  const rec2 = H.calls.caps.find(x => x.op === "mrec" && x.body.p);
  assert.deepEqual(rec2.body.p, j.results);
  H.deny.add("admhealth");
  assert.equal((await apiPost(env, H, "/admin/api/healthcheck", {})).status, 429);
});

test("salescheck asks the garage-sale sites, says which a Worker can read, scrubs errors and has its own limit", async () => {
  const H = makeH(), env = makeEnv();
  const res = await apiPost(env, H, "/admin/api/salescheck", {});
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.results.map((r) => [r.name, r.readable, r.wall, r.status]), [["craigslist-gms", true, false, 200], ["yardsalesearch", false, true, 403]]);
  assert.ok(!/jane@example\.com/.test(JSON.stringify(j)) && /\[email\]/.test(j.results[1].err), "errors are cleaned like the health check's (the page shows them as text)");
  H.deny.add("admsales");
  assert.equal((await apiPost(env, H, "/admin/api/salescheck", {})).status, 429);
});

test("errors and searches endpoints clamp their inputs", async () => {
  const H = makeH(), env = makeEnv();
  metricsData(H, Date.now());
  let j = await (await call(env, H, "GET", "/admin/api/errors?limit=99999")).json();
  assert.equal(j.errors.length, 1);
  assert.equal(H.calls.caps.find(x => x.op === "mget").body.errors, 500);
  j = await (await call(env, H, "GET", "/admin/api/searches?days=400")).json();
  assert.equal(j.days, 30);
  const top = H.calls.caps.find(x => x.op === "top").body;
  assert.equal(top.to, new Date().toISOString().slice(0, 10));
  assert.equal(top.from, new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  assert.deepEqual(j.top, [{ term: "roseville", visitors: 12, requests: 20 }]);
  j = await (await call(env, H, "GET", "/admin/api/searches?days=abc")).json();
  assert.equal(j.days, 7);
  H.capsFail.add("*");
  assert.equal((await call(env, H, "GET", "/admin/api/errors")).status, 503);
  assert.equal((await call(env, H, "GET", "/admin/api/searches")).status, 503);
});

test("an unexpected failure is a plain 500 without a stack trace", async () => {
  const H = makeH(), env = makeEnv();
  H.alNow = () => { throw new Error("secret detail jane.doe@example.com at foo.js:1:2"); };
  const orig = console.error; const logged = []; console.error = (...a) => logged.push(a.join(" "));
  try {
    const res = await call(env, H, "GET", "/admin/api/overview");
    assert.equal(res.status, 500);
    assertBaseHeaders(res);
    const text = await res.text();
    assert.ok(!/secret detail|foo\.js|at /.test(text.replace("at a minute", "")), text);
    noPII(text);
    const page = await adminFetch(new Request(ORIGIN + "/admin"), env, ctxOf(), Object.assign(makeH(), { pages: { loginPage: () => { throw new Error("page broke"); }, adminPage: () => "" } }));
    assert.equal(page.status, 500);
    assert.ok(!(await page.text()).includes("page broke"));
    noPII(logged.join("\n"), "log");
  } finally { console.error = orig; }
});

/* ---------- Gift Pro ---------- */
const FRIEND = "gift.friend@example.com";   // gifted before they sign up
/* the stored gift values (their keys are gift:<64-hex hash>, never an address) */
function allGiftRecords(env) {
  const E = [...env.PROWL_ALERTS.m.entries()].filter(([k]) => k.startsWith("gift:") || k.startsWith("giftoff:"));
  for (const [k] of E) assert.match(k, /^gift(off)?:[0-9a-f]{64}$/);
  return E.map(([, v]) => v).join("\n");
}
function noAddress(text, label, emails) {
  for (const e of emails.concat([FRIEND, "Gift.Friend@Example.com", "gift.friend"])) assert.ok(!String(text).includes(e), (label || "response") + " leaked " + e);
  for (const e of emails.concat([FRIEND])) assert.ok(!String(text).includes(giftHashOf(e)), (label || "response") + " leaked a full gift hash");
}

test("giftActive and giftPro: the PRO_EMAILS list first unless switched off, then a gift that has not ended", () => {
  assert.equal(giftActive({ until: "" }, TODAY), true, "no end");
  assert.equal(giftActive({ note: "x" }, TODAY), true, "no until field = no end");
  assert.equal(giftActive({ until: TODAY }, TODAY), true, "the last day still counts");
  assert.equal(giftActive({ until: "2026-10-04" }, TODAY), false, "ended yesterday");
  assert.equal(giftActive({ until: "2027-01-05" }, TODAY), true);
  for (const bad of [null, undefined, "gift", [], { until: "soon" }, { until: "2026-1-5" }, { until: 20270105 }]) assert.equal(giftActive(bad, TODAY), false, JSON.stringify(bad));
  const gift = { note: "", added: "2026-10-01T00:00:00Z", until: "2026-12-01", by: "admin" };
  assert.deepEqual(giftPro(true, false, null, TODAY), { pro: true, via: "list", plan: { via: "list" } });
  assert.deepEqual(giftPro(true, false, gift, TODAY), { pro: true, via: "list", plan: { via: "list" } }, "the list wins over a gift");
  assert.equal(giftPro(true, true, null, TODAY), null, "switched off in the admin area");
  assert.deepEqual(giftPro(true, true, gift, TODAY), { pro: true, via: "gift", plan: { via: "gift", until: "2026-12-01" } }, "a gift still counts when the list is off");
  assert.deepEqual(giftPro(false, false, { until: "" }, TODAY), { pro: true, via: "gift", plan: { via: "gift", until: "" } });
  assert.equal(giftPro(false, false, { until: "2026-09-30" }, TODAY), null, "an ended gift falls through to the shop");
  assert.equal(giftPro(false, false, null, TODAY), null);
});

test("index.js Gift Pro helpers: giftHash, the PRO_EMAILS list and alEmail", async () => {
  assert.equal(await IX.giftHash(FRIEND), giftHashOf(FRIEND));
  assert.match(await IX.giftHash(FRIEND), /^[0-9a-f]{64}$/);
  assert.notEqual(await IX.giftHash(FRIEND), createHash("sha256").update(FRIEND).digest("hex"), "prefixed, so it is not the plain address hash");
  const env = { PRO_EMAILS: " A@x.com, b@y.org\nc@z.net,,a@x.com " };
  assert.equal(IX.proListHas(env, "a@x.com"), true); assert.equal(IX.proListHas(env, "B@Y.org"), true); assert.equal(IX.proListHas(env, "d@x.com"), false);
  assert.equal(IX.proListCount(env), 3, "repeats count once");
  assert.equal(IX.proListCount({}), 0); assert.equal(IX.proListHas(undefined, "a@x.com"), false);
  assert.equal(IX.alEmail("  Gift.Friend@Example.COM "), FRIEND);
  assert.equal(IX.alEmail("not an email"), ""); assert.equal(IX.alEmail("a@b"), "");
});

/* alPro and alProSet straight from index.js, with KV and the shop stubbed */
function realPro(env, shop) {
  const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
  const calls = { shop: 0 };
  const fetch = async () => { calls.shop++; if (!shop) throw new Error("offline"); return { status: 200, json: async () => ({ data: { orders: { nodes: shop } } }) }; };
  const deps = { kvGet, kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)), giftHash: IX.giftHash, giftPro, proListHas: IX.proListHas,
    alNow: () => ({ day: TODAY, hour: 10, wday: 1 }), PRO_SKU: "PROWL-PRO-MONTHLY", PRO_DAYS: 35, PRO_TRIAL_CODE: "PROWLMONTH", PRO_NO_CACHE_MS: 10 * 60 * 1000, fetch };
  const fns = fromIndex(["shopHost", "shopCanToken", "shopToken", "alFreePro", "alProShop", "alPro", "alProSet"], deps);
  return Object.assign(fns, { calls });
}
test("index.js alPro: the list, then a gift, both before the cache and Shopify; switching the list off falls through", async () => {
  const kv = new FakeKV(), L = "listed@example.com", G = FRIEND, P = "payer@example.com";
  const env = { PROWL_ALERTS: kv, PRO_EMAILS: L + ", someone@example.com", SHOPIFY_ORDERS_TOKEN: "shpat_test" };
  const order = { name: "#1001", createdAt: "2026-10-01T10:00:00Z", cancelledAt: null, displayFinancialStatus: "PAID", email: P, statusPageUrl: "https://store.example/r", discountCodes: [],
    totalPriceSet: { shopMoney: { amount: "7.00", currencyCode: "USD" } }, lineItems: { nodes: [{ sku: "PROWL-PRO-MONTHLY", customAttributes: [] }] } };
  const X = realPro(env, [order]);
  assert.deepEqual(await X.alPro(env, L, true), { pro: true, via: "list", plan: { via: "list" } });
  kv.set("gift:" + giftHashOf(G), { note: "", added: "2026-10-05T12:00:00Z", until: "2027-01-05", by: "admin" });
  assert.deepEqual(await X.alPro(env, G, true), { pro: true, via: "gift", plan: { via: "gift", until: "2027-01-05" } }, "even a forced check takes the gift");
  assert.equal(X.calls.shop, 0, "free Pro never asks Shopify");
  kv.set("giftoff:" + giftHashOf(L), { at: "2026-10-05T12:00:00Z" });
  const off = await X.alPro(env, L, true);
  assert.equal(off.via, "orders"); assert.equal(off.pro, false, "the list no longer counts; the shop has no order for them");
  assert.equal(X.calls.shop, 2, "both shop look-ups ran");
  kv.set("gift:" + giftHashOf(L), { until: "" });
  assert.equal((await X.alPro(env, L, false)).via, "gift", "a gift still counts with the list switched off");
  kv.set("gift:" + giftHashOf(G), { until: "2026-10-04" });
  kv.set("pro:" + G, { pro: false, at: Date.now(), plan: null });
  assert.deepEqual(await X.alPro(env, G, false), { pro: false, via: "cache", plan: null }, "an ended gift falls through to the cache");
  const paid = await X.alPro(env, P, true);
  assert.equal(paid.pro, true); assert.equal(paid.via, "orders"); assert.equal(paid.plan.order, "#1001");
  const env2 = { PROWL_ALERTS: kv, PRO_EMAILS: "" };
  assert.deepEqual(await realPro(env2, null).alPro(env2, "nobody@example.com", false), { pro: null, via: "no token" });
});

test("index.js alProSet: free Pro from a gift or the list ends with it, even when the shop cannot be asked", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv };   // no Shopify token: every shop check answers null
  const X = realPro(env, null);
  const gifted = { email: FRIEND, pro: true, plan: { via: "gift", until: "2026-10-01" }, hadPro: true };
  assert.equal(await X.alProSet(env, gifted, false), false);
  assert.equal(gifted.plan, null); assert.equal(gifted.proCheck, "no token"); assert.equal(gifted.hadPro, true);
  const payer = { email: "payer@example.com", pro: true, plan: { via: "order", order: "#1" } };
  assert.equal(await X.alProSet(env, payer, false), true, "a shop error never downgrades a paying member");
  assert.equal(payer.plan.order, "#1");
  kv.set("gift:" + giftHashOf(FRIEND), { until: "" });
  const back = { email: FRIEND, pro: false, plan: null };
  assert.equal(await X.alProSet(env, back, false), true);
  assert.deepEqual(back.plan, { via: "gift", until: "" }); assert.equal(back.proCheck, ""); assert.equal(back.hadPro, true);
});

test("gift for someone not signed up yet: stored by hash only, note masked, length, input checks, guards and rate limit", async () => {
  const H = makeH(), env = makeEnv();
  let res = await apiPost(env, H, "/admin/api/gift", { email: "  Gift.Friend@Example.com ", note: "my niece, jane@example.com 555-123-4567, zip 48375", months: 3 });
  assert.equal(res.status, 200);
  let text = await res.text(); noAddress(text, "gift add", []); noPII(text, "gift add");
  let j = JSON.parse(text);
  const gh = giftHashOf(FRIEND);
  assert.deepEqual(j, { ok: true, message: j.message, gid: gh.slice(0, 10), memberId: null, emailed: false });
  assert.doesNotMatch(j.message, /emailed them|email was sent|did not send/, "no email unless the box is ticked");
  assert.match(j.message, /until 2027-01-05/); assert.match(j.message, /sign up/);
  const g = env.PROWL_ALERTS.json("gift:" + gh);
  assert.deepEqual(Object.keys(g).sort(), ["added", "by", "note", "until"]);
  assert.equal(g.until, "2027-01-05"); assert.equal(g.by, "admin"); assert.match(g.added, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(g.note.length <= 60);
  assert.ok(g.note.startsWith("my niece, [email] [number]"), g.note);
  for (const s of ["jane@", "555-123", "48375"]) assert.ok(!g.note.includes(s), "note keeps " + s);
  noAddress(allGiftRecords(env), "stored gift", []);
  const a = H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => x.body.a[0]).find(x => x.action === "gift-add");
  assert.deepEqual([a.id, a.ok, a.note], [gh.slice(0, 10), true, "3 months"]);
  noAddress(JSON.stringify(a), "audit", []);
  // renewing keeps the note when none is typed; forever = no end; a waiting giftoff is cleared
  env.PROWL_ALERTS.set("giftoff:" + gh, { at: "x" });
  j = await (await apiPost(env, H, "/admin/api/gift", { email: FRIEND, months: 0 })).json();
  assert.match(j.message, /with no end date/);
  assert.equal(env.PROWL_ALERTS.json("gift:" + gh).until, ""); assert.ok(env.PROWL_ALERTS.json("gift:" + gh).note.startsWith("my niece"));
  assert.equal(env.PROWL_ALERTS.m.has("giftoff:" + gh), false);
  j = await (await apiPost(env, H, "/admin/api/gift", { email: FRIEND, months: "12", note: "" })).json();
  assert.equal(env.PROWL_ALERTS.json("gift:" + gh).until, "2027-10-05", "a select sends the months as text");
  for (const [body, why] of [[{ email: "not an email", months: 1 }, "bad email"], [{ months: 1 }, "no email"], [{ email: FRIEND, months: 2 }, "2 months is not offered"],
    [{ email: FRIEND, months: -1 }, "negative"], [{ email: FRIEND, months: "forever" }, "words"]]) {
    res = await apiPost(env, H, "/admin/api/gift", body);
    assert.equal(res.status, 400, why);
    noAddress(await res.text(), why, []);
  }
  assert.equal((await call(env, H, "POST", "/admin/api/gift", { body: { email: FRIEND }, headers: { Origin: ORIGIN } })).status, 403, "missing X-Prowl-Admin");
  assert.equal((await apiPost(env, H, "/admin/api/gift", { email: FRIEND }, { headers: { Origin: "https://evil.example" } })).status, 403, "cross-origin");
  for (const p of ["/admin/api/gifts"]) assert.equal((await call(env, H, "GET", p, { cookie: false })).status, 401);
  assert.equal((await call(env, H, "POST", "/admin/api/gift/remove", { cookie: false, body: { gid: gh.slice(0, 10) }, headers: { "X-Prowl-Admin": "1", Origin: ORIGIN } })).status, 401);
  assert.equal((await call(env, H, "GET", "/admin/api/gift")).status, 405);
  H.deny.add("admgift");
  assert.equal((await apiPost(env, H, "/admin/api/gift", { email: FRIEND, months: 1 })).status, 429);
  assert.equal((await apiPost(env, H, "/admin/api/gift/remove", { gid: gh.slice(0, 10) })).status, 429);
});

test("gift for a member switches Pro on now; the gift list shows member, dates and status; remove switches it off", async () => {
  const H = makeH(), env = makeEnv({ PRO_EMAILS: "quiet@example.com, someone.else@example.com, third@example.com" });
  H.nextPro = { pro: false, plan: null };   // the shop has no order for them
  const L = "late@example.com", lateId = await idOf(env, L);
  let j = await (await apiPost(env, H, "/admin/api/gift", { email: L, note: "beta tester", months: 1 })).json();
  assert.equal(j.memberId, lateId); assert.match(j.message, new RegExp("free for " + lateId + " until 2026-11-05"));
  assert.deepEqual(H.calls.proSet, [false], "a normal (cached) check: the gift comes before Shopify");
  let r = rec(env, L);
  assert.equal(r.pro, true); assert.deepEqual(r.plan, { via: "gift", until: "2026-11-05" }); assert.equal(r.hadPro, true); assert.equal(r.proCheck, "");
  // a second earlier, so "newest first" does not hang on two gifts saved in the same millisecond
  const gl = env.PROWL_ALERTS.json("gift:" + giftHashOf(L));
  env.PROWL_ALERTS.set("gift:" + giftHashOf(L), Object.assign(gl, { added: new Date(Date.parse(gl.added) - 1000).toISOString() }));
  // jane pays in the shop: the owner is told a gift does not cancel that
  j = await (await apiPost(env, H, "/admin/api/gift", { email: EMAIL, months: 0 })).json();
  assert.match(j.message, /subscription in the shop/);
  noPII(JSON.stringify(j), "gift for jane");
  // an older gift that has ended, for someone who never signed up
  env.PROWL_ALERTS.set("gift:" + giftHashOf(FRIEND), { note: "old promo", added: "2026-08-01T09:00:00.000Z", until: "2026-09-01", by: "admin" });
  env.PROWL_ALERTS.set("giftoff:" + giftHashOf("quiet@example.com"), { at: "2026-10-01T00:00:00Z" });
  const res = await call(env, H, "GET", "/admin/api/gifts");
  assert.equal(res.status, 200); assertBaseHeaders(res);
  const text = await res.text(); noPII(text, "gifts"); noAddress(text, "gifts", [L, "quiet@example.com"]);
  j = JSON.parse(text);
  assert.equal(j.listCount, 3); assert.equal(j.listOff, 1); assert.equal(j.truncated, false);
  assert.equal(j.gifts.length, 3);
  const [newest, , oldest] = j.gifts;
  assert.equal(oldest.note, "old promo"); assert.equal(oldest.memberId, null, "not signed up yet");
  assert.deepEqual([oldest.added, oldest.until, oldest.active, oldest.expired], ["2026-08-01", "2026-09-01", false, true]);
  const late = j.gifts.find(g => g.memberId === lateId);
  assert.deepEqual(late, { gid: giftHashOf(L).slice(0, 10), memberId: lateId, note: "beta tester", added: late.added, until: "2026-11-05", active: true, expired: false });
  assert.match(late.added, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(newest.memberId, await idOf(env, EMAIL), "newest first"); assert.equal(newest.until, ""); assert.equal(newest.active, true);
  // members list and overview see the gift
  const list = await (await call(env, H, "GET", "/admin/api/members?filter=pro")).json();
  const lm = list.members.find(m => m.id === lateId);
  assert.equal(lm.plan, "pro"); assert.equal(lm.via, "gift");
  const ov = await (await call(env, H, "GET", "/admin/api/overview")).json();
  assert.equal(ov.members.gifted, 2); assert.equal(ov.members.pro, 2);
  // turning it off from the list
  j = await (await apiPost(env, H, "/admin/api/gift/remove", { gid: late.gid })).json();
  assert.equal(j.ok, true); assert.equal(j.memberId, lateId); assert.match(j.message, /free plan now/);
  r = rec(env, L);
  assert.equal(r.pro, false); assert.equal(r.plan, null);
  assert.equal(env.PROWL_ALERTS.m.has("gift:" + giftHashOf(L)), false);
  j = await (await apiPost(env, H, "/admin/api/gift/remove", { gid: oldest.gid.toUpperCase() })).json();
  assert.match(j.message, /had not signed up/);
  const audits = H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => x.body.a[0]);
  assert.deepEqual(audits.filter(a => /^gift/.test(a.action)).map(a => [a.action, a.id]),
    [["gift-add", lateId], ["gift-add", await idOf(env, EMAIL)], ["gift-remove", lateId], ["gift-remove", oldest.gid]]);
  noAddress(JSON.stringify(audits), "audit", [L]);
  // the overview's admin activity keeps a gift id but nothing else that is not a member id
  H.capsData["metrics mget"] = { audit: [{ t: 1, action: "gift-remove", id: oldest.gid, ok: true, note: "" }, { t: 1, action: "gift-add", id: giftHashOf(FRIEND), ok: true, note: "" }] };
  const ov2 = await (await call(env, H, "GET", "/admin/api/overview")).json();
  assert.deepEqual(ov2.audit.map(a => a.id), [oldest.gid, ""]);
});

test("gift remove: bad id 400, unknown 404, two gifts sharing the id 409", async () => {
  const H = makeH(), env = makeEnv();
  for (const gid of ["", "xyz", "abcdef012", "abcdef01234", "gift:abcdef0123", null]) assert.equal((await apiPost(env, H, "/admin/api/gift/remove", { gid })).status, 400, String(gid));
  assert.equal((await apiPost(env, H, "/admin/api/gift/remove", { gid: "0123456789" })).status, 404);
  env.PROWL_ALERTS.set("gift:abcdef0123" + "a".repeat(54), { until: "" });
  env.PROWL_ALERTS.set("gift:abcdef0123" + "b".repeat(54), { until: "" });
  const res = await apiPost(env, H, "/admin/api/gift/remove", { gid: "abcdef0123" });
  assert.equal(res.status, 409);
  assert.equal([...env.PROWL_ALERTS.m.keys()].filter(k => k.startsWith("gift:")).length, 2, "nothing deleted");
});

test("member actions gift-on and gift-off; a PRO_EMAILS member is switched off and back on without touching Cloudflare", async () => {
  const H = makeH(), env = makeEnv({ PRO_EMAILS: "quiet@example.com" });
  H.nextPro = { pro: false, plan: null };
  const F = "free.person@example.com";
  let { res, j, id } = await act(env, H, F, "gift-on");
  assert.equal(res.status, 200); assert.equal(j.ok, true);
  assert.match(j.message, /^Prowl Pro is now free for this member with no end date\./);
  assert.deepEqual(rec(env, F).plan, { via: "gift", until: "" });
  assert.equal(j.member.plan.name, "pro"); assert.equal(j.member.via, "gift");
  assert.deepEqual(j.member.gift, { active: true, source: "gift", until: "", note: "", added: new Date().toISOString().slice(0, 10), ended: false, listed: false, listOff: false, earlier: false });
  // a length from the member page
  ({ res, j } = await act2(env, H, F, "gift-on", { months: 6, note: "thanks for the feedback" }));
  assert.match(j.message, /until 2027-04-05/); assert.equal(j.member.gift.note, "thanks for the feedback"); assert.equal(j.member.gift.until, "2027-04-05");
  ({ res } = await act2(env, H, F, "gift-on", { months: 5 }));
  assert.equal(res.status, 400);
  // off: the gift goes, and with no paid order they are free again
  ({ j } = await act(env, H, F, "gift-off"));
  assert.equal(j.ok, true); assert.match(j.message, /^Free Pro is off\. They are on the free plan unless they pay\.$/);
  assert.equal(env.PROWL_ALERTS.m.has("gift:" + giftHashOf(F)), false);
  assert.equal(env.PROWL_ALERTS.m.has("giftoff:" + giftHashOf(F)), false, "not on the list, so no switch-off is stored");
  let r = rec(env, F);
  assert.equal(r.pro, false); assert.equal(r.plan, null); assert.equal(j.member.gift.source, null);
  ({ j } = await act(env, H, F, "gift-off"));
  assert.match(j.message, /had no free Pro/);
  // the PRO_EMAILS member
  const Q = "quiet@example.com";
  ({ j, id } = await act(env, H, Q, "refresh-pro"));
  assert.deepEqual(rec(env, Q).plan, { via: "list" });
  assert.deepEqual([j.member.gift.source, j.member.gift.listed, j.member.gift.listOff], ["list", true, false]);
  ({ j } = await act(env, H, Q, "gift-off"));
  assert.match(j.message, /^Free Pro is off\./); assert.match(j.message, /still in the PRO_EMAILS list/);
  assert.match(env.PROWL_ALERTS.json("giftoff:" + giftHashOf(Q)).at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rec(env, Q).pro, false);
  assert.deepEqual([j.member.gift.active, j.member.gift.source, j.member.gift.listOff], [false, null, true]);
  // the shop cannot be reached: free Pro still ends, and the failed check is shown
  ({ j } = await act(env, H, Q, "gift-on"));
  assert.match(j.message, /from the PRO_EMAILS list in Cloudflare again/);
  assert.equal(env.PROWL_ALERTS.m.has("giftoff:" + giftHashOf(Q)), false, "Gift Pro clears the switch-off");
  H.nextPro = { pro: null, via: "shopify unreachable" };
  ({ j } = await act(env, H, Q, "gift-off"));
  assert.match(j.message, /could not be checked/);
  assert.equal(rec(env, Q).pro, false); assert.ok(j.member.flags.includes("pro check failing"));
  // a payer keeps Pro
  H.nextPro = { pro: true, plan: { via: "order", order: "#1001" } };
  await act(env, H, F, "gift-on");
  ({ j } = await act(env, H, F, "gift-off"));
  assert.match(j.message, /pay for it in the shop/); assert.equal(rec(env, F).pro, true);
  const audits = H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => x.body.a[0]).filter(a => /^gift/.test(a.action));
  assert.deepEqual(audits.slice(0, 2).map(a => [a.action, a.note]), [["gift-on", "no end"], ["gift-on", "6 months"]]);
  noAddress(JSON.stringify(audits), "audit", [F, Q]);
  noAddress(allGiftRecords(env), "stored gifts", [F, Q]);
});
async function act2(env, H, email, action, extra) {
  const id = await idOf(env, email);
  const res = await apiPost(env, H, "/admin/api/member/action", Object.assign({ id, action }, extra));
  const text = await res.text();
  noPII(text, action);
  return { res, j: JSON.parse(text), id };
}

test("member detail and summary: gift fields, plan badge via gift or list, an ended gift is flagged; no address anywhere", async () => {
  const H = makeH(), env = makeEnv({ PRO_EMAILS: EMAIL }), now = H.alNow();
  env.PROWL_ALERTS.set("gift:" + giftHashOf(EMAIL), { note: "launch helper", added: "2026-09-01T10:00:00.000Z", until: "2026-12-31", by: "admin" });
  const d = await memberDetail(env, janeRecord({ plan: { via: "list" } }), H, now);
  noPII(JSON.stringify(d), "detail"); noAddress(JSON.stringify(d), "detail", [EMAIL]);
  assert.deepEqual(d.gift, { active: true, source: "list", until: "2026-12-31", note: "launch helper", added: "2026-09-01", ended: false, listed: true, listOff: false, earlier: false });
  assert.equal(d.plan.via, "list"); assert.equal(d.planName, "pro");
  env.PROWL_ALERTS.set("giftoff:" + giftHashOf(EMAIL), { at: "2026-10-01T00:00:00Z" });
  assert.equal((await memberDetail(env, janeRecord(), H, now)).gift.source, "gift", "the list is off, the gift still counts");
  env.PROWL_ALERTS.set("gift:" + giftHashOf(EMAIL), { note: "", added: "2026-08-01T10:00:00.000Z", until: "2026-10-04", by: "admin" });
  const ended = await memberDetail(env, janeRecord({ plan: { via: "gift", until: "2026-10-04" } }), H, now);
  assert.deepEqual([ended.gift.active, ended.gift.ended, ended.gift.source, ended.gift.listOff], [false, true, null, true]);
  assert.equal(ended.plan.until, "2026-10-04");
  assert.ok(ended.flags.includes("gift ended"), "shown until the daily Pro check catches up");
  const s = memberSummary(env, janeRecord({ plan: { via: "gift", until: "" } }), H, now);
  assert.deepEqual([s.plan, s.via], ["pro", "gift"]); assert.ok(!s.flags.includes("gift ended"));
  assert.deepEqual([memberSummary(env, janeRecord({ plan: { via: "list" } }), H, now).plan, memberSummary(env, janeRecord({ plan: { via: "list" } }), H, now).via], ["pro", "list"]);
  const plain = await memberDetail(env, { email: "free.person@example.com", hunts: [] }, H, now);
  assert.deepEqual(plain.gift, { active: false, source: null, until: "", note: "", added: "", ended: false, listed: false, listOff: false, earlier: false });
  // the API answer for a member is just as clean
  const t = await (await call(env, H, "GET", "/admin/api/member?id=" + await idOf(env, EMAIL))).text();
  noPII(t, "member"); noAddress(t, "member", [EMAIL]);
});

/* ---------- review fixes (v78) ---------- */
const FORM = { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN };
const login = (env, H, key, ip = "203.0.113.9") => call(env, H, "POST", "/admin/login", { cookie: false, body: "key=" + encodeURIComponent(key), headers: Object.assign({ "CF-Connecting-IP": ip }, FORM) });
const auditsOf = H => H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => x.body.a[0]);

test("login: per-address and per-network limits, a site-wide hourly budget of wrong keys, and no 'tomorrow' when the counter fails", async () => {
  const H = makeH(), env = makeEnv();
  let res = await login(env, H, KEY);
  assert.equal(res.status, 303);
  assert.deepEqual(H.calls.vCount.slice(0, 2), [["admlogin:203.0.113.9", 10], ["admlogin:n:203.0.113.0/24", 30]], "every try counts per address and per network");
  H.deny.add("admlogin:n:203.0.113.0/24");
  res = await login(env, H, KEY, "203.0.113.77");
  assert.equal(res.status, 429, "a fresh address on a busy network is refused too");
  assert.match(await res.text(), /from this network/);
  H.deny.clear();
  // wrong keys count site-wide for the hour; once the budget is used, even the right key waits
  H.calls.caps.length = 0;
  res = await login(env, H, "wrong-key-wrong-key-0");
  assert.equal(res.status, 401);
  const failTake = H.calls.caps.find(x => x.op === "take" && /^admloginfail:\d{4}-\d{2}-\d{2}T\d{2}$/.test(x.body.k));
  assert.ok(failTake, "a wrong key takes one from this hour's site-wide budget");
  H.capsData["caps:" + TODAY + " peek"] = q => ({ values: { [q.keys[0]]: /^admloginfail:/.test(q.keys[0]) ? 30 : 0 } });
  res = await login(env, H, KEY, "198.51.100.4");
  assert.equal(res.status, 429); assert.equal(res.headers.get("Set-Cookie"), null);
  assert.match(await res.text(), /paused for the rest of this hour/);
  delete H.capsData["caps:" + TODAY + " peek"];
  // the counter not answering is "try again in a minute", never "tomorrow", and the key is not compared
  H.capsFail.add("caps:" + TODAY + " take");
  res = await login(env, H, KEY, "198.51.100.5");
  assert.equal(res.status, 503);
  const t = await res.text();
  assert.match(t, /briefly unavailable/); assert.ok(!/tomorrow/.test(t));
  assert.equal(res.headers.get("Set-Cookie"), null);
  H.capsFail.clear();
  H.capsFail.add("caps:" + TODAY + " peek");
  assert.equal((await login(env, H, KEY, "198.51.100.6")).status, 503);
});

test("login: wrong keys are logged one by one only up to a small daily budget, so a flood cannot empty the audit log", async () => {
  const H = makeH(), env = makeEnv();
  await login(env, H, "wrong-key-wrong-key-1");
  assert.deepEqual(auditsOf(H).map(a => [a.action, a.ok, a.note]), [["login", false, "wrong key"]]);
  assert.ok(H.calls.vCount.some(x => x[0] === "admloginlog" && x[1] === 20));
  H.deny.add("admloginlog");   // today's budget of logged wrong keys is used up
  H.calls.caps.length = 0;
  assert.equal((await login(env, H, "wrong-key-wrong-key-2")).status, 401);
  assert.equal(auditsOf(H).length, 0, "not logged one by one any more");
  assert.equal((await login(env, H, KEY)).status, 303);
  assert.deepEqual(auditsOf(H).map(a => [a.action, a.ok]), [["login", true]], "a real sign-in is always logged");
});

test("signout-all also cancels a waiting change of address and retires the old address's forwarding token", async () => {
  const H = makeH(), env = makeEnv(), id = await idOf(env, EMAIL);
  const { j } = await act(env, H, EMAIL, "signout-all", id);
  assert.equal(j.ok, true); assert.match(j.message, /change of email address was cancelled/);
  assert.equal(env.PROWL_ALERTS.m.has("mvf:" + EMAIL), false);
  assert.equal(env.PROWL_ALERTS.m.has("mv:new.place@example.com"), false, "the confirm link in the other inbox no longer works");
  const fw = env.PROWL_ALERTS.json("moved:old.address@example.org");
  assert.equal(fw.to, EMAIL, "the owner can still find them by the old address");
  assert.notEqual(fw.tok, "TOKEN-SECRET-abc123def456", "the old token no longer reveals their address");
  assert.notEqual(fw.tok, rec(env).tok);
  assert.equal(auditsOf(H).pop().note, "address change cancelled");
  assert.deepEqual(await (await apiPost(env, H, "/admin/api/find", { email: "old.address@example.org" })).json(), { id, moved: true });
  // a move someone else asked for (mv: from another address) is left alone; nothing waiting = nothing said
  const env2 = makeEnv();
  env2.PROWL_ALERTS.set("mv:new.place@example.com", { code: "MOVE-CODE-SECRET", from: "someone.else@example.com" });
  const r2 = await act(env2, H, EMAIL, "signout-all", id);
  assert.ok(env2.PROWL_ALERTS.m.has("mv:new.place@example.com"));
  assert.equal(env2.PROWL_ALERTS.m.has("mvf:" + EMAIL), false);
  const env3 = makeEnv(); env3.PROWL_ALERTS.delete("mvf:" + EMAIL);
  assert.doesNotMatch((await act(env3, H, EMAIL, "signout-all", id)).j.message, /cancelled/);
  assert.ok(r2.j.ok);
});

test("a member's own ZIP code and slash-separated phone numbers are hidden in hunts, waiting listings, skip words and Diagnose", async () => {
  assert.equal(scrubHunt("555/123/4567").hidden, true);
  assert.equal(scrubHunt("call 555_123_4567").hidden, true);
  assert.equal(scrubHunt("pyrex 48375", "48375").hidden, true);
  assert.equal(scrubHunt("estate sale 48375-1234", "48375").hidden, true);
  assert.equal(scrubHunt("pyrex 48375").hidden, false, "without their ZIP a 5-digit number is a model number");
  assert.equal(scrubHunt("mccoy 12345", "48375").hidden, false);
  assert.equal(scrubHunt("lot 148375", "48375").hidden, true, "6 digits in a row");
  for (const h of ["1950/1960 lamp", "pyrex 443/444", "1960_1970 vase"]) assert.equal(scrubHunt(h).hidden, false, h);
  const H = makeH(), env = makeEnv();
  env.PROWL_ALERTS.set("sub:" + EMAIL, janeRecord({ hunts: ["pyrex 48375", "555/123/4567", "lamp"],
    prefs: Object.assign({}, janeRecord().prefs, { skip: ["48375", "cracked"], local: [], mute: [] }) }));
  env.PROWL_ALERTS.set("pend:" + EMAIL, { "pyrex 48375": [{ title: "Bowl", price: "$5", url: "https://x.example/1", src: "ebay" }] });
  const id = await idOf(env, EMAIL);
  const text = await (await call(env, H, "GET", "/admin/api/member?id=" + id)).text();
  noPII(text, "member with ZIP hunts"); assert.ok(!text.includes("555/123"));
  const d = JSON.parse(text);
  assert.deepEqual(d.hunts.map(x => x.hidden), [true, true, false]);
  assert.equal(d.pending.hunts[0].text, "(hidden — looks personal)");
  assert.deepEqual(d.prefs.skipWords, ["(hidden — looks personal)", "cracked"]);
  const dj = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 0 })).text();
  noPII(dj, "diagnose ZIP hunt");
  assert.equal(JSON.parse(dj).term, "(hidden)");
});

test("phone numbers in search terms never reach the Errors and Top searches views; 5-digit numbers in anonymous searches stay", async () => {
  const H = makeH(), env = makeEnv();
  H.capsData["metrics mget"] = { errors: [{ t: 1, r: "live:ebay", s: 502, m: "upstream", q: "call me 555-123-4567" }, { t: 2, r: "live:ebay", s: 502, m: "upstream", q: "roseville" }] };
  H.capsData["stats top"] = { top: [{ term: "call me 555-123-4567", visitorDays: 9, requests: 9 }, { term: "(313) 555-0199 lamp", visitorDays: 8, requests: 8 },
    { term: "lego 10179", visitorDays: 2, requests: 2 }, { term: "roseville", visitorDays: 1, requests: 1 }] };
  const e = await (await call(env, H, "GET", "/admin/api/errors")).json();
  assert.deepEqual(e.errors.map(x => x.q), ["", "roseville"]);
  const s = await (await call(env, H, "GET", "/admin/api/searches?days=7")).json();
  assert.deepEqual(s.top.map(x => x.term), ["lego 10179", "roseville"]);
  const ov = await (await call(env, H, "GET", "/admin/api/overview")).text();
  /* the phone numbers themselves, not any "555": the overview carries the current time, whose digits can read 555 */
  assert.doesNotMatch(ov, /555-123-4567|555-0199|\(313\)/, "overview errors and searches too");
});

test("Re-check Pro says when the shop could not be asked, and that free Pro needs no shop check", async () => {
  const H = makeH(), env = makeEnv();
  H.nextPro = { pro: null, via: "shopify unreachable" };
  let { j } = await act(env, H, EMAIL, "refresh-pro");
  assert.equal(j.ok, false); assert.match(j.message, /^Could not reach the shop just now \(shopify unreachable\)\. Nothing changed\./);
  assert.ok(!/Checked the shop/.test(j.message));
  assert.equal(rec(env).pro, true, "a paying member keeps Pro");
  H.nextPro = { pro: null, via: "no token" };
  ({ j } = await act(env, H, EMAIL, "refresh-pro"));
  assert.match(j.message, /SHOPIFY_ORDERS_CLIENT_ID/); assert.equal(j.ok, false);
  env.PROWL_ALERTS.set("gift:" + giftHashOf(EMAIL), { note: "", added: "2026-10-01T00:00:00Z", until: "2027-01-05", by: "admin" });
  ({ j } = await act(env, H, EMAIL, "refresh-pro"));
  assert.equal(j.ok, true); assert.match(j.message, /free Pro from your gift \(until 2027-01-05\), so the shop was not asked/);
  assert.equal(auditsOf(H).filter(a => a.action === "refresh-pro").map(a => a.ok).join(), "false,false,true");
});

test("Send today's email again really resends today's listings; with no email today it says nothing will be resent", async () => {
  const H = makeH(), env = makeEnv();
  const item = n => ({ title: "Sent " + n, price: "$" + n, url: "https://sgw.example/sent/" + n, src: "shopgoodwill" });
  env.PROWL_ALERTS.set("sub:" + EMAIL, janeRecord({ sent: TODAY, mailed: TODAY, day: TODAY, done: ["roseville vase", "call me 555-123-4567", "pyrex"] }));
  env.PROWL_ALERTS.set("last:" + EMAIL, { day: TODAY, pend: { "Roseville vase": [item(1), item(2)], "pyrex": [item(3)] } });
  env.PROWL_ALERTS.set("pend:" + EMAIL, { "Roseville vase": [item(2), item(9)] });
  const { j } = await act(env, H, EMAIL, "resend-today");
  assert.equal(j.ok, true); assert.match(j.message, /^Today's email \(3 listings\) goes out again/);
  const pend = env.PROWL_ALERTS.json("pend:" + EMAIL);
  assert.deepEqual(pend["Roseville vase"].map(x => x.title), ["Sent 1", "Sent 2", "Sent 9"], "today's listings first, then new ones, no repeats");
  assert.deepEqual(pend.pyrex.map(x => x.title), ["Sent 3"]);
  const r = rec(env);
  assert.equal(r.sent, ""); assert.equal(r.day, ""); assert.equal(r.mailed, TODAY);
  assert.equal(j.member.late, false, "an email already went today, so the resend is not 'late'");
  assert.equal(j.member.sentToday, true);
  // yesterday's email, or none at all: nothing to resend, and it says so
  const env2 = makeEnv();
  env2.PROWL_ALERTS.set("last:" + EMAIL, { day: "2026-10-04", pend: { "Roseville vase": [item(1)] } });
  const r2 = await act(env2, H, EMAIL, "resend-today");
  assert.match(r2.j.message, /^No email went out to them today, so there is nothing to send again\./);
  assert.match(r2.j.message, /if nothing new turns up, no email is sent/);
  assert.equal(env2.PROWL_ALERTS.json("pend:" + EMAIL)["Roseville vase"].length, 2, "the waiting listings are untouched");
  // deleting a member removes the kept email too
  await act(env, H, EMAIL, "delete", await idOf(env, EMAIL));
  assert.equal(env.PROWL_ALERTS.m.has("last:" + EMAIL), false);
});

test("'Emails sent today' and 'Last email' count only emails that went out, not days with nothing new", async () => {
  const H = makeH(), env = makeEnv(), now = H.alNow();
  // today's run finished with nothing new: sent is today, but no email went
  const quietDay = memberSummary(env, janeRecord({ sent: TODAY, mailed: "2026-09-01" }), H, now);
  assert.equal(quietDay.sentToday, false); assert.equal(quietDay.doneToday, true); assert.equal(quietDay.lastSent, "2026-09-01");
  assert.equal(quietDay.late, false, "today's run is done, so not late");
  const never = memberSummary(env, janeRecord({ sent: TODAY, mailed: undefined }), H, now);
  assert.equal(never.lastSent, ""); assert.equal(never.sentToday, false);
  const mailed = memberSummary(env, janeRecord({ sent: TODAY, mailed: TODAY }), H, now);
  assert.equal(mailed.sentToday, true); assert.equal(mailed.lastSent, TODAY);
  env.PROWL_ALERTS.set("sub:free.person@example.com", { email: "free.person@example.com", tok: "t2", hunts: ["fiesta"], prefs: {}, created: "2026-10-05", day: TODAY, done: [], sent: TODAY, mail: "on" });
  metricsData(H, Date.now());
  const ov = await (await call(env, H, "GET", "/admin/api/overview")).json();
  assert.equal(ov.alerts.sentToday, 0, "nothing new is not an email");
});

test("admin mail-on and mail-off behave like the member's own switch", async () => {
  const H = makeH(), env = makeEnv();
  let { j } = await act(env, H, EMAIL, "mail-off");
  assert.equal(env.PROWL_ALERTS.m.has("pend:" + EMAIL), false, "listings held for the next email are dropped");
  assert.match(j.message, /listings that were waiting for their next email are dropped/);
  ({ j } = await act(env, H, EMAIL, "mail-on"));
  assert.equal(rec(env).sent, TODAY, "today counts as done, so the next email is on their next email day");
  assert.equal(j.member.late, false, "not flagged late the moment emails are back on");
  assert.match(j.message, /next email day after today/);
});

test("overview: member numbers come from the alert clock's run record (no KV reads); slow parts are read at most every 10 minutes", async () => {
  const H = makeH(), env = makeEnv(), nowMs = Date.now();
  metricsData(H, nowMs);
  const counts = { total: 42, pro: 7, gifted: 2, trial: 1, free: 30, freeLegacy: 4, mailOff: 3, paused: 2, noHunts: 1, new7d: 5, hunts: 80, activeHunts: 60,
    dueToday: 20, sentToday: 9, late: 1, checkedToday: 33, huntsLeftToday: 4 };
  const base = H.capsData["metrics mget"];
  H.capsData["metrics mget"] = Object.assign({}, base, { crons: [Object.assign({ counts: counts }, base.crons[0])].concat(base.crons.slice(1)) });
  let lists = 0;
  const list = env.PROWL_ALERTS.list.bind(env.PROWL_ALERTS);
  env.PROWL_ALERTS.list = async o => { lists++; return list(o); };
  let j = await (await call(env, H, "GET", "/admin/api/overview")).json();
  assert.equal(lists, 0, "no member list read");
  assert.deepEqual(j.members, { total: 42, pro: 7, gifted: 2, trial: 1, free: 30, freeLegacy: 4, mailOff: 3, paused: 2, noHunts: 1, new7d: 5, hunts: 80, activeHunts: 60, truncated: false });
  assert.deepEqual([j.alerts.dueToday, j.alerts.sentToday, j.alerts.late, j.alerts.checkedToday, j.alerts.huntsLeftToday], [20, 9, 1, 33, 4]);
  assert.equal(j.alerts.lastCron.ageMin, 4); assert.equal(j.alerts.cronRuns24h, 2);
  assert.equal(Date.parse(j.countsAt), base.crons[0].t);
  const slow = () => H.calls.caps.filter(x => x.op === "mget" && x.body.probeDays === 7).length;
  const weekTop = () => H.calls.caps.filter(x => x.op === "top" && x.body.from !== x.body.to).length;
  assert.equal(slow(), 1); assert.equal(weekTop(), 1);
  await call(env, H, "GET", "/admin/api/overview");
  assert.equal(slow(), 1, "the week of uptime checks and cron runs is not read again within 10 minutes"); assert.equal(weekTop(), 1);
  assert.equal(H.calls.caps.filter(x => x.op === "mget" && x.body.crons === 1).length, 2, "the newest run, errors and traffic are");
  // counts from an old run: the members are read here instead
  H.capsData["metrics mget"] = Object.assign({}, base, { crons: [{ t: nowMs - 3 * 3600000, counts: counts }] });
  j = await (await call(env, H, "GET", "/admin/api/overview")).json();
  assert.equal(j.members.total, 5); assert.ok(lists > 0);
});

test("members list: read again only on Refresh (fresh=1) within 10 minutes, and without listing sign-in links", async () => {
  const H = makeH(), env = makeEnv();
  const prefixes = [];
  const list = env.PROWL_ALERTS.list.bind(env.PROWL_ALERTS);
  env.PROWL_ALERTS.list = async o => { prefixes.push(o.prefix); return list(o); };
  await call(env, H, "GET", "/admin/api/members");
  await call(env, H, "GET", "/admin/api/members?filter=late");
  assert.deepEqual(prefixes, ["sub:"], "cached; no in: listing");
  await call(env, H, "GET", "/admin/api/members?fresh=1");
  assert.deepEqual(prefixes, ["sub:", "sub:"]);
  const d = await (await call(env, H, "GET", "/admin/api/member?id=" + await idOf(env, EMAIL))).json();
  assert.ok(d.flags.includes("sign-in link waiting") && d.signinWaiting, "the detail view still shows it");
});

test("Diagnose follows what really happens: AI hiding only when switched on, local hunts on eBay only, title keys, muted hunts", async () => {
  const H = makeH(), env = makeEnv(), id = await idOf(env, EMAIL);
  H.jevMode = "shadow";
  let j = await (await apiPost(env, H, "/admin/api/diagnose", { term: "roseville vase" })).json();
  assert.deepEqual(j.ai, { mode: "shadow", alerts: true, live: false });
  const ebay = j.results.find(r => r.source === "ebay");
  assert.equal(ebay.items[0].aiWould, true); assert.equal(ebay.items[0].aiDrop, false, "not hidden: AI sorting only labels in shadow mode");
  assert.equal(ebay.kept, 3); assert.equal(j.summary.aiDropped, 0); assert.equal(j.summary.aiWould, 1);
  H.jevMode = "on";
  j = await (await apiPost(makeEnv({ ALERT_JEV: "off" }), H, "/admin/api/diagnose", { id, hunt: 0, sources: ["ebay"] })).json();
  assert.equal(j.ai.live, false, "emails skip the AI when ALERT_JEV is off");
  assert.ok(j.results[0].items.every(x => !x.aiDrop));
  j = await (await apiPost(makeEnv({ ALERT_JEV: "off" }), H, "/admin/api/diagnose", { term: "roseville" })).json();
  assert.equal(j.ai.live, true, "live results do not read ALERT_JEV");
  // the AI never empties a list: every listing flagged = none hidden
  H.liveFetch = async (e, source) => ({ source, status: 200, ms: 5, err: "", items: [{ title: "Roseville phone case", price: "$5", url: "https://ebay.example/itm/c1", src: source }, { title: "Roseville case two", price: "$6", url: "https://ebay.example/itm/c2", src: source }] });
  j = await (await apiPost(env, H, "/admin/api/diagnose", { term: "roseville", sources: ["ebay"] })).json();
  assert.equal(j.results[0].aiAllFlagged, true); assert.ok(j.results[0].items.every(x => x.aiWould && !x.aiDrop));
  H.liveFetch = makeH().liveFetch;
  // a local hunt: only eBay near their ZIP, whatever boxes were ticked
  H.calls.live.length = 0;
  j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 2, sources: ["shopgoodwill", "ebay", "etsy"] })).json();
  assert.equal(j.local, true); assert.equal(j.localOnly, true);
  assert.deepEqual(j.results.map(r => r.source), ["ebay"]);
  assert.deepEqual(H.calls.live, [["ebay-local", "pyrex"]]);
  noPII(JSON.stringify(j), "local diagnose");
  // a listing a check already found is waiting for their next email (it is in the "already sent" memory too, but not emailed yet)
  env.PROWL_ALERTS.set("seen:" + EMAIL, ["https://sgw.example/item/1", "t:shopgoodwill|roseville vase blue"]);
  j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 0, sources: ["shopgoodwill"] })).json();
  assert.equal(j.results[0].items[0].waiting, true); assert.equal(j.results[0].items[0].alreadySent, false, "waiting, not already emailed");
  assert.equal(j.summary.waiting, 1); assert.equal(j.summary.alreadySent, 0); assert.equal(j.results[0].kept, 1);
  // once that email has gone (nothing waiting), it is already sent, also by title key (a relisted piece); and the hunt's state
  env.PROWL_ALERTS.set("pend:" + EMAIL, {});
  env.PROWL_ALERTS.set("seen:" + EMAIL, ["t:shopgoodwill|roseville vase blue"]);
  j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 0, sources: ["shopgoodwill"] })).json();
  assert.equal(j.results[0].items[0].alreadySent, true); assert.equal(j.results[0].items[0].waiting, false); assert.equal(j.hunt, "active");
  j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 3, sources: ["shopgoodwill"] })).json();
  assert.equal(j.hunt, "muted");
  j = await (await apiPost(env, H, "/admin/api/diagnose", { term: "pyrex" })).json();
  assert.equal(j.hunt, null);
});

test("free Pro from an earlier address shows on the member page and can be turned off there; a first gift says it uses the free month", async () => {
  const H = makeH(), env = makeEnv({ PRO_EMAILS: "old.address@example.org" });
  H.nextPro = { pro: false, plan: null };
  let { j } = await act(env, H, EMAIL, "refresh-pro");
  assert.deepEqual(rec(env).plan, { via: "list" });
  assert.deepEqual([j.member.gift.active, j.member.gift.source, j.member.gift.earlier], [true, "list", true]);
  noAddress(JSON.stringify(j), "earlier-address gift", ["old.address@example.org"]);
  ({ j } = await act(env, H, EMAIL, "gift-off"));
  assert.match(j.message, /^Free Pro is off\./); assert.match(j.message, /email address they used before/);
  assert.ok(env.PROWL_ALERTS.m.has("giftoff:" + giftHashOf("old.address@example.org")));
  assert.equal(rec(env).pro, false);
  // a member who never had Pro: the gift is their one free month
  ({ j } = await act(env, H, "late@example.com", "gift-on"));
  assert.match(j.message, /one free Prowl Pro month/);
  ({ j } = await act(env, H, EMAIL, "gift-on"));
  assert.doesNotMatch(j.message, /one free Prowl Pro month/, "jane had Pro before");
});

/* index.js functions lifted out with stubs, for the parts of the fixes that live there */
test("index.js alProSet: free Pro on an earlier address counts even when the shop cannot be asked; a free month under a gift keeps its reminder", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv, PRO_EMAILS: "old@example.com" };   // no Shopify token
  const X = realPro(env, null);
  const moved = { email: "new@example.com", prev: ["old@example.com"], pro: true, plan: { via: "list" } };
  assert.equal(await X.alProSet(env, moved, false), true, "before v78's fix this member lost Pro whenever the shop was unreachable");
  assert.deepEqual(moved.plan, { via: "list" }); assert.equal(moved.proCheck, ""); assert.equal(X.calls.shop, 0);
  const renews = new Date(Date.now() + 10 * 86400000).toISOString();
  const trial = { email: FRIEND, pro: true, plan: { via: "order", trial: true, order: "#77", renews: renews, amount: "0.00", receipt: "https://store.example/r" } };
  kv.set("gift:" + giftHashOf(FRIEND), { until: "" });
  await X.alProSet(env, trial, false);
  assert.deepEqual(trial.plan, { via: "gift", until: "", shop: { trial: true, order: "#77", renews: renews, next: "7.00" } });
  const T = fromIndex(["alTrialPlan"]);
  assert.deepEqual(T.alTrialPlan(trial), trial.plan.shop, "the reminder before the first charge still goes");
  assert.equal(T.alTrialPlan({ pro: true, plan: { via: "gift", until: "" } }), null);
  assert.equal(T.alTrialPlan({ pro: true, plan: { via: "order", trial: true, order: "#1" } }).order, "#1");
  await X.alProSet(env, trial, false);
  assert.equal(trial.plan.shop.order, "#77", "kept on the next daily check");
  const past = { email: FRIEND, pro: true, plan: { via: "order", trial: true, order: "#78", renews: "2020-01-01T00:00:00Z" } };
  await X.alProSet(env, past, false);
  assert.equal(past.plan.shop, undefined, "a free month that has already renewed is not kept");
});

test("index.js alCheck: a reset or a cleared 'already sent' memory made while the run searched is not undone", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, E = "m@example.com", now = { day: TODAY, hour: 9, wday: 1 };
  kv.set("sub:" + E, { email: E, hunts: ["a", "b", "c"], day: TODAY, done: ["a"], prefs: {} });
  kv.set("seen:" + E, ["https://old/1", "t:x|old"]);
  kv.set("pend:" + E, { a: [{ url: "https://p/0" }] });
  const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
  const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
  const deps = { kvGet, kvPut, alActive: (e, s) => s.hunts, alExact: a => a, alPrefs: () => ({ freq: "daily" }), AL_PEND_CAP: 30, AL_SEEN_CAP: 6000,
    alTitleKey: x => "t:" + x.src + "|" + x.title,
    alHunt: async (e, h) => {
      if (h === "b") {   // the owner presses "Re-check hunts today" and "Clear already sent" while this hunt is being searched
        const cur = kv.json("sub:" + E); cur.day = ""; cur.done = []; kv.set("sub:" + E, cur);
        await kv.delete("seen:" + E);
        kv.set("pend:" + E, { a: [{ url: "https://p/0" }], c: [{ url: "https://p/back" }] });   // and today's email is put back
      }
      return [{ url: "https://new/" + h, title: "new " + h, src: "ebay" }];
    } };
  const X = fromIndex(["alMerge", "alPendAdd", "alPendCap", "alCheck"], deps);
  const sub = kv.json("sub:" + E);
  assert.equal(await X.alCheck(env, sub, 2, now), 2);
  assert.deepEqual(kv.json("seen:" + E), ["https://new/b", "t:ebay|new b", "https://new/c", "t:ebay|new c"], "the cleared memory stays cleared, plus what this run found");
  const r = kv.json("sub:" + E);
  assert.equal(r.day, TODAY); assert.deepEqual(r.done, ["b", "c"], "after the reset only the hunts checked since count as done, so 'a' is checked again");
  assert.deepEqual(kv.json("pend:" + E), { a: [{ url: "https://p/0" }], c: [{ url: "https://p/back" }, { url: "https://new/c", title: "new c", src: "ebay" }],
    b: [{ url: "https://new/b", title: "new b", src: "ebay" }] }, "listings put back meanwhile are kept");
});

test("index.js alCheck: after the 'already sent' memory is cleared, a re-check does not add listings that are already waiting", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, E = "m@example.com", now = { day: TODAY, hour: 9, wday: 1 };
  kv.set("sub:" + E, { email: E, hunts: ["a"], day: "", done: [], prefs: {} });   // the owner pressed "Re-check hunts today"
  kv.set("pend:" + E, { a: [{ url: "https://x/1", title: "one", src: "ebay" }, { url: "https://x/2", title: "two", src: "ebay" }] });   // and "Clear already sent" (no seen:)
  const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
  const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
  const deps = { kvGet, kvPut, alActive: (e, s) => s.hunts, alExact: a => a, alPrefs: () => ({ freq: "daily" }), AL_PEND_CAP: 30, AL_SEEN_CAP: 6000,
    alTitleKey: x => "t:" + x.src + "|" + x.title,
    alHunt: async () => [{ url: "https://x/1", title: "one", src: "ebay" }, { url: "https://x/2", title: "two", src: "ebay" }, { url: "https://x/3", title: "three", src: "ebay" }] };
  const X = fromIndex(["alMerge", "alPendAdd", "alPendCap", "alCheck"], deps);
  assert.equal(await X.alCheck(env, kv.json("sub:" + E), 5, now), 1);
  assert.deepEqual(kv.json("pend:" + E).a.map(x => x.url), ["https://x/1", "https://x/2", "https://x/3"], "each listing once in the next email");
  assert.equal(kv.json("seen:" + E).length, 6, "all three are remembered again (url and title)");
});

test("index.js statTick: a search that is a phone number split by dashes or dots is never stored in the search counts", async () => {
  const ticks = [];
  const X = fromIndex(["statTerm", "statTick"], { looksPersonal, ipKey: x => x, sha16: async () => "h", capsCall: async (n, op, q) => { ticks.push(q.term); } });
  const req = { headers: { get: () => "203.0.113.5" } };
  for (const t of ["call 555-201-7788", "248.555.0199 clock", "(248) 555 0199", "jane@example.com", "pyrex 1950-1960", "Fire-King jadeite"]) await X.statTick(req, {}, "t", t);
  assert.deepEqual(ticks, ["pyrex 1950 1960", "fire king jadeite"]);
});

test("index.js: hourly probes have their own cron trigger, and search terms in error records go through the phone-number rule", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const crons = JSON.parse(/^crons = (\[.*\])$/m.exec(toml)[1]);
  const probe = /^const PROBE_CRON = "([^"]+)";$/m.exec(INDEX)[1];
  assert.ok(crons.includes("*/5 * * * *") && crons.includes(probe) && probe !== "*/5 * * * *");
  const sched = INDEX.slice(INDEX.indexOf("async scheduled(event, env, ctx) {"), INDEX.indexOf("async fetch(request, env, ctx) {"));
  assert.match(sched, /if \(event && event\.cron === PROBE_CRON\) \{[^\n]*runProbes\(env\)[^\n]*return; \}/);
  assert.doesNotMatch(sched, /getUTCMinutes/, "the alert clock's run no longer starts the probes");
  assert.match(INDEX, /ev\.q = q && !looksPersonal\(q\) \? q : "";/);
  assert.match(INDEX, /const MBUF = new MetricsBuffer\(\{ maxAgeMs: 120000 \}\);/);
});

test("overview: when only the minute-by-minute read fails, uptime still shows and no 'no alert run yet' is claimed", async () => {
  const H = makeH(), env = makeEnv();
  metricsData(H, Date.now());
  const data = H.capsData["metrics mget"];
  H.capsData["metrics mget"] = q => q.crons === 1 ? null : data;   // a missing answer for the fresh read only
  const j = await (await call(env, H, "GET", "/admin/api/overview")).json();
  assert.equal(j.traffic, null); assert.equal(j.errors, null);
  assert.equal(j.uptime.length, 2, "the 7-day checks come from their own read");
  assert.equal(j.alerts.lastCron, null); assert.equal(j.alerts.cronRuns24h, null, "unknown, not zero");
  assert.ok(j.issues.includes("Speed, error and uptime numbers are not available."));
});

test("member page and Diagnose list only the sites their emails search: a site switched off for everyone (Depop) is left out", async () => {
  const H = makeH(undefined, { alPrefs: sub => Object.assign(prefsOf(sub), { sources: ["shopgoodwill", "depop", "ebay"] }) }), env = makeEnv();
  const id = await idOf(env, EMAIL);
  const d = await (await call(env, H, "GET", "/admin/api/member?id=" + id)).json();
  assert.deepEqual(d.prefs.sources, ["shopgoodwill", "ebay"]);
  const j = await (await apiPost(env, H, "/admin/api/diagnose", { id, hunt: 0, sources: ["ebay"] })).json();
  assert.deepEqual(j.member.filters.sources, ["shopgoodwill", "ebay"]);
  H.liveSources = () => { throw new Error("no list"); };   // without the live list, their saved sites show as they are
  const d2 = await (await call(env, H, "GET", "/admin/api/member?id=" + id)).json();
  assert.deepEqual(d2.prefs.sources, ["shopgoodwill", "depop", "ebay"]);
});

test("member page: 'Listings already emailed' leaves out the ones still waiting for the next email", async () => {
  const H = makeH(), env = makeEnv(), id = await idOf(env, EMAIL);
  env.PROWL_ALERTS.set("seen:" + EMAIL, ["https://sgw.example/item/1", "t:shopgoodwill|roseville vase blue", "https://x.example/2", "https://old.example/1"]);
  const d = await (await call(env, H, "GET", "/admin/api/member?id=" + id)).json();
  assert.equal(d.seenCount, 1, "two of the three remembered listings are waiting in pend:");
  assert.equal(d.pending.total, 3);
});


/* ---------- v78c: Gift Pro can email the person how to start ---------- */
const auditOf = (H, action) => H.calls.caps.filter(x => x.op === "mrec" && x.body.a).map(x => x.body.a[0]).filter(x => x.action === action).pop();
const capsOps = (H, op) => H.calls.caps.filter(x => x.op === op);

test("gift with 'Email them': someone not signed up gets the start email, a member the Pro-is-on email; only a ticked box (true) sends; only sent emails are counted", async () => {
  const H = makeH(), env = makeEnv();
  let res = await apiPost(env, H, "/admin/api/gift", { email: " Gift.Friend@Example.com ", months: 3, tell: true });
  let text = await res.text(); noAddress(text, "gift + email", []); noPII(text, "gift + email");
  let j = JSON.parse(text);
  assert.equal(res.status, 200); assert.equal(j.emailed, true); assert.equal(j.memberId, null);
  assert.match(j.message, /until 2027-01-05.*We emailed them how to start, with a one-tap link that signs them up \(it works for 14 days\)\.$/);
  assert.deepEqual(H.calls.giftMail, [[FRIEND, "2027-01-05", null, null, false]], "sent to the cleaned address, with the gift's end, as someone not signed up");
  assert.equal(auditOf(H, "gift-add").note, "3 months, emailed"); noAddress(JSON.stringify(auditOf(H, "gift-add")), "audit", []);
  const gid = giftHashOf(FRIEND).slice(0, 10);
  assert.deepEqual(capsOps(H, "peek").map(x => x.body.keys[0]).sort(), ["admgiftmail", "admgiftmail:" + gid], "both caps are looked at first");
  assert.deepEqual(capsOps(H, "take").filter(x => /^admgiftmail/.test(x.body.k)).map(x => [x.body.k, x.body.lim]).sort(), [["admgiftmail", 30], ["admgiftmail:" + gid, 2]], "and counted once it went out");
  assert.ok(!H.calls.caps.some(x => JSON.stringify(x.body).includes("@")), "no address in a counter");
  assert.equal([...env.PROWL_ALERTS.m.keys()].filter(k => k.includes("gift.friend")).length, 0, "nothing keyed by their address is stored");

  for (const tell of [false, "true", 1, "1", undefined]) {
    H.calls.giftMail.length = 0;
    j = await (await apiPost(env, H, "/admin/api/gift", { email: FRIEND, months: 1, tell })).json();
    assert.equal(j.emailed, false, String(tell)); assert.equal(H.calls.giftMail.length, 0, String(tell));
    assert.doesNotMatch(j.message, /emailed them|email was sent|did not send/);
  }

  H.calls.giftMail.length = 0;
  const F = "free.person@example.com";
  H.nextPro = { pro: false, plan: null };
  res = await apiPost(env, H, "/admin/api/gift", { email: F, months: 0, tell: true });
  text = await res.text(); noAddress(text, "member gift + email", [F]); noPII(text, "member gift + email");
  j = JSON.parse(text);
  assert.match(j.message, /^Prowl Pro is now free for M-[0-9a-f]{8} with no end date\..* We emailed them that Pro is on, with a link that opens Prowl signed in\.$/);
  assert.doesNotMatch(j.message, /shop subscription/);
  assert.deepEqual(H.calls.giftMail, [[F, "", F, true, false]]);
  assert.equal(j.emailed, true); assert.equal(auditOf(H, "gift-add").note, "no end, emailed");
});

test("gift email to someone who pays in the shop says the gift does not cancel it: from the form, their member page, and on a later gift", async () => {
  const H = makeH(), env = makeEnv();
  let j = await (await apiPost(env, H, "/admin/api/gift", { email: EMAIL, months: 1, tell: true })).json();
  assert.match(j.message, /the gift does not cancel it, so cancel it there.*We emailed them that Pro is on, with a link that opens Prowl signed in\. The email also says a shop subscription keeps going until it is cancelled\./);
  assert.deepEqual(H.calls.giftMail.pop(), [EMAIL, "2026-11-05", EMAIL, true, true], "paid is worked out before the gift replaces their plan");
  assert.equal(env.PROWL_ALERTS.json("gift:" + giftHashOf(EMAIL)).paid, true, "kept on the gift (no address, just that they paid)");
  assert.equal(rec(env, EMAIL).plan.via, "gift", "their record no longer shows the shop plan");
  // a later gift (a retry after a failed email, or a new length) still knows
  j = await (await apiPost(env, H, "/admin/api/gift", { email: EMAIL, months: 3, tell: true })).json();
  assert.deepEqual(H.calls.giftMail.pop(), [EMAIL, "2027-01-05", EMAIL, true, true]);
  assert.match(j.message, /The email also says a shop subscription keeps going until it is cancelled\./);
  ({ j } = await act2(env, H, EMAIL, "gift-on", { months: 6, tell: true }));
  assert.deepEqual(H.calls.giftMail.pop(), [EMAIL, "2027-04-05", EMAIL, true, true], "from the member page too");
  const H2 = makeH(), env2 = makeEnv();
  ({ j } = await act2(env2, H2, EMAIL, "gift-on", { months: 3, tell: true }));
  assert.deepEqual(H2.calls.giftMail.pop(), [EMAIL, "2027-01-05", EMAIL, true, true]);
  assert.match(j.message, /The email also says a shop subscription keeps going until it is cancelled\./);
  // someone who never paid: no paid mark on the gift, no note
  const H3 = makeH(), env3 = makeEnv(), F = "free.person@example.com";
  H3.nextPro = { pro: false, plan: null };
  await apiPost(env3, H3, "/admin/api/gift", { email: F, tell: true });
  assert.equal(H3.calls.giftMail.pop()[4], false);
  assert.deepEqual(Object.keys(env3.PROWL_ALERTS.json("gift:" + giftHashOf(F))).sort(), ["added", "by", "note", "until"]);
});

test("gift to an address a member moved away from (up to three moves) is kept on the member's own address and emailed there as the Pro-is-on email", async () => {
  const H = makeH(), env = makeEnv(), OLD = "old.address@example.org";
  env.PROWL_ALERTS.set("moved:" + OLD, { to: EMAIL, tok: "TOKEN-SECRET-abc123def456", at: 1 });
  const res = await apiPost(env, H, "/admin/api/gift", { email: OLD, months: 6, tell: true });
  const text = await res.text(); noAddress(text, "moved", [OLD, EMAIL]); noPII(text, "moved");
  const j = JSON.parse(text);
  assert.equal(j.memberId, await idOf(env, EMAIL));
  assert.equal(j.gid, giftHashOf(EMAIL).slice(0, 10));
  assert.match(j.message, /That address moved to M-[0-9a-f]{8}, so the gift follows them there\./);
  assert.deepEqual(H.calls.giftMail, [[EMAIL, "2027-04-05", EMAIL, true, true]], "the member version, to their current address");
  assert.ok(env.PROWL_ALERTS.json("gift:" + giftHashOf(EMAIL)), "the gift is on the member's own address, so the gift list and Turn off find them");
  assert.equal(env.PROWL_ALERTS.json("gift:" + giftHashOf(OLD)), null);
  assert.equal(rec(env, OLD), null, "no second account");
  // two moves: a@ -> b@ (b@ moved on) -> the member
  const H2 = makeH(), env2 = makeEnv();
  env2.PROWL_ALERTS.set("moved:a@example.com", { to: "b@example.com" });
  env2.PROWL_ALERTS.set("moved:b@example.com", { to: EMAIL });
  const j2 = await (await apiPost(env2, H2, "/admin/api/gift", { email: "a@example.com", tell: true })).json();
  assert.equal(j2.memberId, await idOf(env2, EMAIL)); assert.equal(H2.calls.giftMail[0][0], EMAIL);
  // a forwarding record whose member is gone, or a loop: they count as not signed up
  for (const [k, v] of [["moved:gone@example.com", { to: "nobody@example.com" }], ["moved:loop@example.com", { to: "loop@example.com" }]]) {
    const H3 = makeH(), env3 = makeEnv(); env3.PROWL_ALERTS.set(k, v);
    const who = k.slice(6);
    const j3 = await (await apiPost(env3, H3, "/admin/api/gift", { email: who, tell: true })).json();
    assert.equal(j3.memberId, null); assert.deepEqual(H3.calls.giftMail, [[who, "", null, null, false]]);
  }
});

test("gift email is skipped, with plain words for the owner: emails off, Pro not on, caps, a counter that does not answer, and every kind of failed send", async () => {
  const F = "free.person@example.com";
  const run = async (prep, body = { email: FRIEND, months: 1, tell: true }) => {
    const H = makeH(), env = makeEnv(); H.nextPro = { pro: false, plan: null };
    await prep(H, env);
    const res = await apiPost(env, H, "/admin/api/gift", body);
    const text = await res.text(); noAddress(text, "skip", [F]); noPII(text, "skip");
    const j = JSON.parse(text);
    assert.equal(res.status, 200); assert.equal(j.ok, true, "the gift itself always saves");
    return { H, env, j };
  };
  let { H, j, env } = await run(async (H, env) => env.PROWL_ALERTS.set("sub:" + F, Object.assign(rec(env, F), { mail: "off" })), { email: F, months: 1, tell: true });
  assert.match(j.message, / No email was sent: they have turned Prowl emails off\.$/); assert.equal(H.calls.giftMail.length, 0);
  assert.equal(rec(env, F).plan.via, "gift"); assert.equal(auditOf(H, "gift-add").note, "1 month");
  ({ H, j } = await run(async H => { H.alProSet = async (e, sub) => { sub.pro = false; sub.plan = null; return false; }; }, { email: F, months: 1, tell: true }));
  assert.match(j.message, /Pro did not switch on yet.* No email was sent, because Pro is not on for them yet\.$/); assert.equal(H.calls.giftMail.length, 0);

  const gid = giftHashOf(FRIEND).slice(0, 10);
  const peekAs = (all, one) => H => { H.capsData["caps:" + TODAY + " peek"] = q => ({ values: { [q.keys[0]]: q.keys[0] === "admgiftmail" ? all : one } }); };
  ({ H, j } = await run(peekAs(30, 0)));
  assert.match(j.message, / No email was sent: that is 30 gift emails today\. Try again tomorrow\.$/); assert.equal(H.calls.giftMail.length, 0);
  ({ H, j } = await run(peekAs(3, 2)));
  assert.match(j.message, / No email was sent: they already got 2 gift emails today\.$/); assert.equal(H.calls.giftMail.length, 0);
  ({ H, j } = await run(peekAs(29, 1)));
  assert.equal(j.emailed, true, "under both caps it sends");
  ({ H, j } = await run(async H => { H.capsFail.add("caps:" + TODAY + " peek"); }));
  assert.match(j.message, / No email was sent: the daily email count did not answer\. Try again in a minute\.$/); assert.equal(H.calls.giftMail.length, 0);

  const said = {
    stopped: / No email was sent: this address used the link in an earlier gift email to stop gift emails\.$/,
    off: / No email was sent: Prowl Alerts is switched off \(ALERTS in Cloudflare\)\.$/,
    nomail: / No email was sent: Prowl email is not set up \(RESEND_API_KEY in Cloudflare\)\.$/,
    nokey: / No email was sent: the start link could not be made \(ADMIN_KEY\)\.$/,
    send: / The email to them did not send, but the gift still counts\. To try again, gift them again with the same length\.$/
  };
  for (const why of Object.keys(said)) {
    ({ H, j } = await run(async H => { H.giftMailResult = { ok: false, why, error: "resend 422 Invalid `to` field: " + FRIEND }; }));
    assert.match(j.message, said[why], why); assert.equal(j.emailed, false);
    assert.doesNotMatch(j.message, /resend 422|Invalid/);
    assert.equal(capsOps(H, "take").filter(x => /^admgiftmail/.test(x.body.k)).length, 0, why + ": a send that did not go out is not counted");
  }
  ({ H, j } = await run(async H => { H.giftMailThrow = true; }));
  assert.match(j.message, said.send); assert.equal(capsOps(H, "take").filter(x => /^admgiftmail/.test(x.body.k)).length, 0);
  ({ j } = await run(async H => { delete H.alSendGift; }));
  assert.match(j.message, / No email was sent: this worker cannot send gift emails\.$/);
});

test("member action gift-on: 'Email them that Pro is on' sends only when ticked and Pro is on; the audit says emailed", async () => {
  const H = makeH(), env = makeEnv(), F = "free.person@example.com";
  H.nextPro = { pro: false, plan: null };
  let { res, j } = await act2(env, H, F, "gift-on", { months: 3, tell: true });
  assert.equal(res.status, 200);
  assert.match(j.message, /^Prowl Pro is now free for this member until 2027-01-05\. .*We emailed them that Pro is on, with a link that opens Prowl signed in\.$/);
  assert.deepEqual(H.calls.giftMail, [[F, "2027-01-05", F, true, false]]);
  assert.equal(auditOf(H, "gift-on").note, "3 months, emailed");
  ({ j } = await act2(env, H, F, "gift-on", { months: 3 }));
  assert.equal(H.calls.giftMail.length, 1, "no box, no email");
  assert.doesNotMatch(j.message, /emailed them|email was sent/);
  assert.equal(auditOf(H, "gift-on").note, "3 months");
  env.PROWL_ALERTS.set("sub:" + F, Object.assign(rec(env, F), { mail: "off" }));
  ({ j } = await act2(env, H, F, "gift-on", { months: 1, tell: true }));
  assert.match(j.message, / No email was sent: they have turned Prowl emails off\.$/); assert.equal(H.calls.giftMail.length, 1);
});

/* index.js alSendGift, alGiftStart and alGiftStop, lifted out with the real email shell and signing, and stubs for KV and mail */
const hmacHex = (k, m) => createHmac("sha256", k).update(m).digest("hex");
const giftSigOf = (kv, what) => hmacHex(kv.json("giftkey:v1"), what);
function giftIndexFns(over = {}) {
  const sent = [], free = { v: { pro: true, via: "gift", plan: { via: "gift", until: "" } } };
  const deps = Object.assign({
    kvGet: async (e, k, d) => { try { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; } catch (x) { return d; } },
    kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)), alToken: () => "NEW-TOK",
    WORKER_BASE: "https://prowl.example.workers.dev", PROWL_PAGE: "https://shop.example/pages/prowl", PRO_MANAGE_URL: "https://www.owlandtwigvintage.com/account",
    GIFT_LINK_DAYS: 14, AL_MAX_HUNTS: 25, AL_SRC_NAME: { shopgoodwill: "ShopGoodwill", ebay: "eBay", etsy: "Etsy", vinted: "Vinted" }, GIFT_KEY_RE: /^[0-9a-f]{64}$/,
    AL_MONTH_NAMES: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    liveSources: () => ["shopgoodwill", "ebay", "etsy", "vinted"], alHomeUrl: sub => "https://shop.example/pages/prowl-app?alerts=in#e=" + encodeURIComponent(sub.email) + "&t=" + sub.tok,
    scrubPII: v => String(v).replace(/[^\s@:]+@[^\s@]+/g, "[email]"), alEmail: IX.alEmail,
    alSend: async (e, to, subject, html, text, unsub) => { sent.push({ to, subject, html, text, unsub }); return over.sendResult || { ok: true }; },
    alFreePro: async () => free.v, alProSet: async (e, sub) => { sub.pro = !!free.v; sub.plan = free.v ? free.v.plan : null; return sub.pro; },
    alPage: (t, m) => new Response("PAGE|" + t + "|" + m, { status: 200 }), alGate: (t, m, b) => new Response("GATE|" + t + "|" + m + "|" + b, { status: 200 }),
    affNote: () => "Some links earn a commission."   /* v84 footer line; v89 built from the switches */
  }, over.deps || {});
  const X = fromIndex(["alSendGift", "alGiftStart", "alGiftStop", "alBadLink", "alMovedTo", "giftKey", "giftSig", "giftLinks", "pxHmac", "giftHash", "alLongDay", "alAndList",
    "alReady", "alMode", "alShell", "alCopy", "alAddr", "alEsc", "alSame"], deps);
  return Object.assign(X, { sent, free });
}
const giftEnv = (kv, extra = {}) => Object.assign({ PROWL_ALERTS: kv, ALERTS: "public", RESEND_API_KEY: "re_test", ADMIN_KEY: "an-admin-key-of-24-chars" }, extra);
const linkIn = (text, path) => { const m = new RegExp("https://prowl\\.example\\.workers\\.dev" + path + "\\?[^\\s\"<]+").exec(text); return m ? new URL(m[0].replace(/&amp;/g, "&")) : null; };

test("index.js alSendGift: signed start and stop links for someone new (only the link key is stored); a signed-in link for a member, with the shop note when they pay", async () => {
  const kv = new FakeKV(), env = giftEnv(kv), X = giftIndexFns();
  const writes = []; const put = kv.put.bind(kv); kv.put = async (k, v, o) => { writes.push(k); return put(k, v, o); };
  const t0 = Date.now();
  assert.deepEqual(await X.alSendGift(env, FRIEND, "2027-01-05", null), { ok: true });
  assert.deepEqual(writes, ["giftkey:v1"], "the first gift email makes the link key; nothing holding their address is stored");
  assert.match(kv.json("giftkey:v1"), /^[0-9a-f]{64}$/);
  let m = X.sent[0];
  assert.equal(m.to, FRIEND); assert.equal(m.subject, "A gift from Owl & Twig Vintage: free Prowl Pro");
  const start = linkIn(m.text, "/alerts/gift"), stop = linkIn(m.text, "/alerts/giftstop");
  assert.equal(start.searchParams.get("e"), FRIEND);
  const x = Number(start.searchParams.get("x"));
  assert.ok(x >= t0 + 14 * 86400000 && x <= Date.now() + 14 * 86400000, "good for 14 days");
  assert.equal(start.searchParams.get("s"), giftSigOf(kv, "start|" + FRIEND + "|" + x), "signed with the kept key");
  assert.equal(stop.searchParams.get("s"), giftSigOf(kv, "stop|" + FRIEND));
  assert.equal(m.unsub, stop.href, "List-Unsubscribe is the stop link");
  assert.ok(m.html.includes('href="' + start.href.replace(/&/g, "&amp;") + '"')); assert.ok(m.html.includes('href="' + stop.href.replace(/&/g, "&amp;") + '"'));
  assert.ok(m.text.includes("Start Prowl: " + start.href)); assert.ok(m.text.includes("Stop gift emails to this address: " + stop.href));
  assert.match(m.html, /Owl &amp; Twig Vintage has given you Prowl Pro, free until January 5, 2027\./);
  assert.match(m.html, /Prowl searches ShopGoodwill, eBay, Etsy and Vinted at once/);
  assert.match(m.html, /<b>How to start<\/b>/); assert.match(m.html, />Start Prowl<\/a>/);
  assert.match(m.html, /The button works for 14 days\. Already started on another phone or computer\? Open Prowl there and use Sign in with this address\./);
  assert.match(m.html, /gave this address free Prowl Pro\. You are not on a mailing list\./);
  assert.doesNotMatch(m.html + m.text, /Nothing else will be sent|You turned on Prowl Alerts|shop subscription|still pay|undefined|null|NaN/);
  assert.doesNotMatch(m.text, /\n\n\n/);
  // the next one reuses the key, and a new ADMIN_KEY (or none) changes nothing
  writes.length = 0; X.sent.length = 0;
  await X.alSendGift(giftEnv(kv, { ADMIN_KEY: undefined }), FRIEND, "", null);
  assert.deepEqual(writes, []);
  assert.equal(linkIn(X.sent[0].text, "/alerts/giftstop").href, stop.href, "the same stop link every time");

  X.sent.length = 0;
  assert.deepEqual(await X.alSendGift(env, EMAIL, "2026-12-31", { email: EMAIL, tok: "TOKEN-SECRET-abc123def456", pro: true, plan: { via: "gift", until: "2026-12-31" } }), { ok: true });
  m = X.sent[0];
  assert.ok(m.html.includes(">Open Prowl</a>")); assert.ok(m.text.includes("Open Prowl: https://shop.example/pages/prowl-app?alerts=in#e="));
  assert.equal(m.unsub, ""); assert.doesNotMatch(m.html + m.text, /giftstop|How to start|Start Prowl|works for 14 days|still pay/);
  assert.match(m.html, /free until December 31, 2026\./); assert.match(m.html, /already on for your account: up to 25 hunts/);
  for (const [sub, opts] of [[{ email: EMAIL, tok: "T", pro: true, plan: { via: "gift" } }, { paid: true }], [{ email: EMAIL, tok: "T", pro: true, plan: { via: "gift", shop: { trial: true, order: "#77" } } }, {}]]) {
    X.sent.length = 0;
    await X.alSendGift(env, EMAIL, "", sub, opts);
    assert.match(X.sent[0].html, /If you still pay for Prowl Pro in the Owl &amp; Twig shop, that subscription is separate: this gift does not cancel it\. To stop being charged, cancel it in your Owl &amp; Twig account under Subscriptions: <a href="https:\/\/www\.owlandtwigvintage\.com\/account"/);
    assert.match(X.sent[0].text, /this gift does not cancel it\. .* https:\/\/www\.owlandtwigvintage\.com\/account/);
  }

  X.sent.length = 0;
  assert.equal((await X.alSendGift(giftEnv(kv, { ALERTS: "off" }), FRIEND, "", null)).why, "off");
  assert.equal((await X.alSendGift(giftEnv(kv, { RESEND_API_KEY: "" }), FRIEND, "", null)).why, "nomail");
  const broken = new FakeKV(); broken.get = async () => { throw new Error("kv down"); }; broken.put = async () => { throw new Error("kv down"); };
  await assert.rejects(X.alSendGift(giftEnv(broken), FRIEND, "", null), /kv down/, "KV down: nothing can be signed, so nothing is sent (admin reports it as not sent)");
  assert.equal(X.sent.length, 0);
  const Y = giftIndexFns({ sendResult: { ok: false, error: "resend 422 bad to: x@example.com" } });
  assert.deepEqual(await Y.alSendGift(env, "x@example.com", "", null), { ok: false, why: "send", error: "resend 422 bad to: [email]" });
  assert.equal(X.alLongDay("2027-02-03"), "February 3, 2027"); assert.equal(X.alLongDay("2027-13-01"), ""); assert.equal(X.alLongDay(""), "");
  assert.equal(X.alAndList(["A"]), "A"); assert.equal(X.alAndList(["A", "B"]), "A and B"); assert.equal(X.alAndList(["A", "B", "C"]), "A, B and C");
});

test("index.js alGiftStart: one tap starts a member with Pro and signs in; never twice, never for a moved address, an ended gift, an old or forged link", async () => {
  const kv = new FakeKV(), env = giftEnv(kv), X = giftIndexFns();
  await X.alSendGift(env, FRIEND, "", null);
  const start = linkIn(X.sent[0].text, "/alerts/gift");
  const tap = async (u, method = "GET", e = env) => { const r = await X.alGiftStart(new Request(u.href, { method }), e, u); return { r, t: await r.clone().text().catch(() => "") }; };
  let { r, t } = await tap(start);
  assert.equal(t, "GATE|Start Prowl|One tap signs you in to Prowl as " + FRIEND + ", with free Prowl Pro. Prowl only emails you once you save a hunt, and you can turn emails off any time.|Start Prowl");
  assert.equal(kv.json("sub:" + FRIEND), null, "opening the link (or a mail scanner fetching it) changes nothing");
  ({ t } = await tap(start, "GET", giftEnv(kv, { ADMIN_KEY: "a-brand-new-admin-key-123" })));
  assert.match(t, /^GATE\|Start Prowl\|/, "a new ADMIN_KEY does not break links already emailed");
  ({ r } = await tap(start, "POST"));
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://shop.example/pages/prowl?alerts=in#e=" + encodeURIComponent(FRIEND) + "&t=NEW-TOK");
  const sub = kv.json("sub:" + FRIEND);
  assert.deepEqual([sub.email, sub.hunts, sub.pro, sub.tok, typeof sub.utok], [FRIEND, [], true, "NEW-TOK", "string"]);
  // a second tap (another device, the same email again): no token, no rebuilt record
  kv.set("sub:" + FRIEND, Object.assign(sub, { mail: "off", prev: ["older@example.com"], hunts: ["pyrex"] }));
  for (const method of ["GET", "POST"]) {
    ({ r, t } = await tap(start, method));
    assert.equal(r.status, 200); assert.equal(r.headers.get("Location"), null);
    assert.equal(t, "PAGE|You already have Prowl|This address already has Prowl, with your free Pro. On another phone or computer, open Prowl and use Sign in with this email address.");
    assert.ok(!t.includes("NEW-TOK"));
  }
  assert.deepEqual(kv.json("sub:" + FRIEND).prev, ["older@example.com"]); assert.equal(kv.json("sub:" + FRIEND).mail, "off");
  kv.delete("sub:" + FRIEND);
  // the address moved to a membership that still exists, after one move or three
  kv.set("moved:" + FRIEND, { to: "new@example.com" }); kv.set("sub:new@example.com", { email: "new@example.com", hunts: [] });
  ({ t } = await tap(start, "POST"));
  assert.match(t, /^PAGE\|This address moved\|.*your free Pro is there too\.$/); assert.equal(kv.json("sub:" + FRIEND), null);
  kv.delete("sub:new@example.com"); kv.set("moved:new@example.com", { to: "newer@example.com" }); kv.set("moved:newer@example.com", { to: "newest@example.com" }); kv.set("sub:newest@example.com", { email: "newest@example.com", hunts: [] });
  ({ t } = await tap(start, "POST"));
  assert.match(t, /^PAGE\|This address moved\|/, "followed through three moves"); assert.equal(kv.json("sub:" + FRIEND), null);
  // a forwarding record that leads nowhere does not block them: the link starts a membership as promised
  kv.delete("sub:newest@example.com");
  ({ r } = await tap(start, "POST"));
  assert.equal(r.status, 302); assert.equal(kv.json("sub:" + FRIEND).email, FRIEND);
  kv.delete("sub:" + FRIEND); kv.delete("moved:" + FRIEND);
  // the owner turned the gift off
  X.free.v = null;
  ({ t } = await tap(start, "POST"));
  assert.match(t, /^PAGE\|This gift has ended\|/); assert.equal(kv.json("sub:" + FRIEND), null);
  X.free.v = { pro: true, via: "gift", plan: { via: "gift", until: "" } };
  // past its 14 days, signed by us: the gift is still waiting
  const old = new URL(start.href); const x = String(Date.now() - 1000);
  old.searchParams.set("x", x); old.searchParams.set("s", giftSigOf(kv, "start|" + FRIEND + "|" + x));
  ({ t } = await tap(old, "POST"));
  assert.match(t, /^PAGE\|This link has ended\|Your free Prowl Pro is still waiting\./); assert.equal(kv.json("sub:" + FRIEND), null);
  // forged, cut short, for another address, or after the link key was deleted: 400, and nothing is said about any gift
  const forged = [];
  for (const [k, v] of [["s", "0".repeat(64)], ["e", "someone.else@example.com"], ["x", String(Number(start.searchParams.get("x")) + 1)], ["s", ""], ["x", "soon"]]) {
    const u = new URL(start.href); u.searchParams.set(k, v); forged.push(u);
  }
  const cut = new URL(start.href); cut.searchParams.delete("s"); forged.push(cut);
  for (const u of forged) {
    ({ r, t } = await tap(u, "POST"));
    assert.equal(r.status, 400, u.search);
    assert.equal(t, "PAGE|This link does not work|It may be cut short, or out of date. Open Prowl and sign up for Prowl Alerts with your email address.", u.search);
  }
  const kv2 = new FakeKV();
  ({ r, t } = await tap(start, "POST", giftEnv(kv2)));
  assert.equal(r.status, 400); assert.equal(kv2.json("giftkey:v1"), null, "checking a link never makes a key");
  assert.equal([...kv.m.keys()].filter(k => k.startsWith("sub:") && k !== "sub:new@example.com").length, 0, "none of these started a membership");
});

test("index.js alGiftStop: the stop link (and one-click List-Unsubscribe) keeps a hash only, works after ADMIN_KEY changes, and later gift emails to that address are refused", async () => {
  const kv = new FakeKV(), env = giftEnv(kv), X = giftIndexFns();
  await X.alSendGift(env, FRIEND, "", null);
  const stop = linkIn(X.sent[0].text, "/alerts/giftstop");
  let r = await X.alGiftStop(new Request(stop.href), env, stop);
  assert.equal(await r.text(), "GATE|Stop gift emails|One tap and no more Prowl gift emails come to " + FRIEND + ".|Stop them");
  assert.equal(kv.json("giftnomail:" + giftHashOf(FRIEND)), null, "a GET (a mail scanner) does not stop anything");
  const rotated = giftEnv(kv, { ADMIN_KEY: "a-brand-new-admin-key-123" });
  r = await X.alGiftStop(new Request(stop.href, { method: "POST", body: "List-Unsubscribe=One-Click" }), rotated, stop);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /^PAGE\|Done\|No more Prowl gift emails will come to this address\./);
  const rec = kv.json("giftnomail:" + giftHashOf(FRIEND));
  assert.deepEqual(Object.keys(rec), ["at"]);
  assert.ok([...kv.m.keys()].every(k => !k.includes("gift.friend")), "kept by hash, not by address");
  X.sent.length = 0;
  assert.deepEqual(await X.alSendGift(env, FRIEND, "", null), { ok: false, why: "stopped", error: "they stopped gift emails" });
  assert.equal(X.sent.length, 0);
  assert.deepEqual(await X.alSendGift(env, FRIEND, "", { email: FRIEND, tok: "T", pro: true }), { ok: true }, "once they are a member, their own email settings decide");
  const bad = new URL(stop.href); bad.searchParams.set("e", "other@example.com");
  r = await X.alGiftStop(new Request(bad.href, { method: "POST" }), env, bad);
  assert.equal(r.status, 400, "a one-click unsubscribe that could not be done is not answered as done");
  assert.match(await r.text(), /^PAGE\|This link does not work\|/);
  assert.equal(kv.json("giftnomail:" + giftHashOf("other@example.com")), null);
});

test("index.js routes /alerts/gift and /alerts/giftstop; metrics counts them as their own alert routes", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/alerts\/gift"\) return alGiftStart\(request, env, url\);/);
  assert.match(INDEX, /if \(url\.pathname === "\/alerts\/giftstop"\) return alGiftStop\(request, env, url\);/);
  assert.match(INDEX, /alProSet, alMerge, alSendSignin[\s\S]*?giftHash, alEmail, proListHas, proListCount, alSendGift,/);
  assert.doesNotMatch(INDEX.slice(INDEX.indexOf("async function alSendGift"), INDEX.indexOf("async function alGiftStart")), /conf:/, "the gift email writes no confirm record");
});

test("gift remove: someone who joined after the member list was cached is still found, so their Pro is switched off now", async () => {
  const H = makeH(), env = makeEnv(), N = "new.joiner@example.com";
  H.nextPro = { pro: false, plan: null };
  await apiPost(env, H, "/admin/api/gift", { email: N, months: 1 });
  await call(env, H, "GET", "/admin/api/members");   // the member list is cached now, without them
  env.PROWL_ALERTS.set("sub:" + N, { email: N, tok: "T-NEW", hunts: [], pro: true, plan: { via: "gift", until: "2026-11-05" }, created: "2026-10-05T09:00:00.000Z" });
  const j = await (await apiPost(env, H, "/admin/api/gift/remove", { gid: giftHashOf(N).slice(0, 10) })).json();
  assert.match(j.message, /^Gift turned off\. M-[0-9a-f]{8} is on the free plan now unless they pay\./);
  assert.equal(rec(env, N).pro, false);
});
