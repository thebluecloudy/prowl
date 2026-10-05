/* Admin area tests: sign-in, sessions, CSRF, PII-free views, member actions, diagnose and overview.
   Run: node --test worker/__tests__/admin.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminFetch, signSession, verifySession, memberId, scrubHunt, memberSummary, memberDetail } from "../admin.js";

const KEY = "test-admin-key-0123456789";
const ORIGIN = "https://prowl.example.workers.dev";
const TODAY = "2026-10-05";

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
  const calls = { caps: [], vCount: [], signin: [], proSet: [], live: [], jev: [] };
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
    alProSet: async (env, sub, force) => { calls.proSet.push(force); if (H.nextPro.pro !== null) { sub.pro = H.nextPro.pro; sub.plan = H.nextPro.plan; } if (sub.pro) sub.hadPro = true; sub.proDay = TODAY; return sub.pro; },
    alMerge: async (env, sub, fields) => { const cur = await H.kvGet(env, "sub:" + sub.email, null); if (!cur) return null; fields.forEach(f => { cur[f] = sub[f]; }); await H.kvPut(env, "sub:" + sub.email, cur); Object.keys(cur).forEach(k => { sub[k] = cur[k]; }); return cur; },
    alSendSignin: async (env, sub) => { calls.signin.push(sub.email); await env.PROWL_ALERTS.put("in:" + sub.email, JSON.stringify({ code: "SIGNIN-CODE-SECRET" })); return H.signinResult || { ok: true }; },
    alToken: () => "fresh-token-" + Math.random().toString(16).slice(2),
    liveSources: () => ["shopgoodwill", "ebay", "etsy"],
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
    capsCall: async (name, op, body) => {
      calls.caps.push({ name, op, body });
      if (H.capsFail.has(name + " " + op) || H.capsFail.has("*")) throw new Error("caps 500");
      const d = H.capsData[name + " " + op];
      if (d !== undefined) return typeof d === "function" ? d(body) : d;
      return { ok: true };
    },
    capsDay: () => "caps:" + TODAY,
    vCount: async (name, limit) => { calls.vCount.push([name, limit]); return !H.deny.has(name.split(":")[0]) && !H.deny.has(name); },
    ipKey: raw => String(raw || "anon").split(",")[0].trim() || "anon",
    alSame: (a, b) => a === b,
    statTerm: raw => { const t = String(raw == null ? "" : raw).toLowerCase().replace(/[^a-z0-9'& ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60); return t.length < 2 || /@|https?|www|\.com/.test(String(raw)) || /\d{6,}/.test(t) ? "" : t; },
    scrubPII: s => String(s),
    summarize: (buckets, nowMs, hours) => ({ routes: buckets.map(b => ({ route: b.route, n: b.n })), series: { hours: [], req: [], err5: [], slow: [] }, totals: { n: buckets.reduce((t, b) => t + b.n, 0) }, live: { n: 0 }, hoursAsked: hours }),
    uptimeFrom: (probes) => probes.map(p => ({ source: p.source, pct24: p.ok ? 100 : 0, pct7d: 90, checks24: 1, checks7d: 7, lastOkAt: p.ok ? p.hour : null, lastStatus: p.status, lastMs: p.ms, lastErr: p.err, lastN: p.n, down: !p.ok })),
    pctFromHist: () => 0,
    pages: {
      loginPage: (nonce, msg) => '<!doctype html><title>Prowl admin</title><style nonce="' + nonce + '"></style><form method="post" action="/admin/login"><input name="key" type="password"></form><p class="msg">' + msg + '</p><script nonce="' + nonce + '"></script>',
      adminPage: (nonce, version) => '<!doctype html><title>Prowl admin</title><style nonce="' + nonce + '"></style><main id="dash" data-v="' + version + '"></main><script nonce="' + nonce + '"></script>'
    },
    WORKER_VERSION: "v78", AL_TZ: "America/Detroit", AL_MAX_HUNTS: 25,
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
    hadPro: true, created: "2026-09-20T08:00:00.000Z", day: TODAY, done: ["roseville vase"], sent: "2026-10-04", mail: "on", proDay: TODAY
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
  kv.set("sub:free.person@example.com", { email: "free.person@example.com", tok: "t2", hunts: ["fiesta"], prefs: {}, created: new Date().toISOString().slice(0, 10), day: TODAY, done: [], sent: TODAY, mail: "on" });
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
  for (const env of [{ PROWL_ALERTS: new FakeKV() }, { PROWL_ALERTS: new FakeKV(), ADMIN_KEY: "short" }]) {
    for (const [m, p] of [["GET", "/admin"], ["GET", "/admin/api/overview"], ["POST", "/admin/login"]]) {
      const res = await adminFetch(new Request(ORIGIN + p, { method: m }), env, ctxOf(), H);
      assert.equal(res.status, 503);
      assert.match(await res.text(), /Admin is not set up: add an ADMIN_KEY secret in Cloudflare/);
      assertBaseHeaders(res);
    }
  }
  const res = await adminFetch(new Request(ORIGIN + "/admin"), { PROWL_ALERTS: new FakeKV(), OWNER_KEY: "owner-key-long-enough" }, ctxOf(), H);
  assert.equal(res.status, 200, "OWNER_KEY works as the admin key");
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
  assert.ok(jane.flags.includes("sign-in link waiting"));
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
  assert.equal(JSON.parse(text).error, "No member with that email.");
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
  assert.deepEqual(j.summary, { sources: 3, ok: 2, failed: 1, items: 5, aiDropped: 1, memberDropped: 0, alreadySent: 0 });
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
  assert.deepEqual(j.members, { total: 5, pro: 1, trial: 0, free: 1, freeLegacy: 3, mailOff: 1, paused: 1, noHunts: 0, new7d: 1, hunts: 9, activeHunts: 8, truncated: false });
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
  const mget = H.calls.caps.find(x => x.op === "mget");
  assert.equal(mget.name, "metrics");
  assert.ok(mget.body.crons >= 288, "enough cron runs for 24 hours of 5-minute runs");
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
