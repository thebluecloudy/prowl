/* ---------- v210: live Shopify listings in hunts, through Shopify's Global Catalog ----------
   GET /shop-live?term=<hunt>&max=<1-12> answers { on: true, term, items: [ { title, price, currency, img, shop, url,
   secondhand? } ], why? } from Shopify's Global Catalog (the Catalogs API for agents: one search across every Shopify
   store), or { off: true } while the two secrets are not set. The page shows them as a "Shopify" strip in the hunt.

   Shopify's own docs, checked 2026-11-01 (the Shopify docs search, then shopify.dev and the live discovery documents):
   - Credentials: a Catalogs API key in the Shopify Dev Dashboard (Catalogs) gives a client ID and a client secret
     (shopify.dev/docs/apps/build/dev-dashboard/catalogs). They live in the Worker secrets SHOPIFY_CATALOG_CLIENT_ID and
     SHOPIFY_CATALOG_CLIENT_SECRET, never in the repo or the page.
   - Token: POST JSON { client_id, client_secret, grant_type: "client_credentials" } to the token endpoint
     https://api.shopify.com/auth/access_token (shopify.dev/docs/agents/get-started/authentication; the endpoint is the
     token_endpoint of https://api.shopify.com/.well-known/oauth-authorization-server, which
     https://catalog.shopify.com/.well-known/oauth-protected-resource names). A JWT with a 60-minute TTL, sent as
     Authorization: Bearer. Kept in this isolate's memory until a minute before it expires, never in KV.
   - Search: JSON-RPC 2.0 tools/call search_catalog at https://catalog.shopify.com/api/ucp/mcp
     (shopify.dev/docs/agents/catalog/global-catalog) with meta["ucp-agent"].profile, the URL of the agent profile this
     worker serves at /ucp/profile.json (catalog search and lookup plus Shopify's dev.shopify.catalog.global extension),
     and catalog { query, context, filters { available, ships_to: { country }, condition: ["secondhand"] }, pagination }.
     Results: result.structuredContent.products[], each with title, media[] (cdn.shopify.com) and variants[] (url,
     price { amount in minor units, currency }, availability, condition[], seller { name, url, domain }).
   - Rules (shopify.dev/docs/agents/catalog, Usage guidelines): "Don't cache search results" (so nothing is kept, not
     even a short cache: every answer is no-store; the page reuses an answer only a minute, for one view's redraws), "Don't cache or re-use images" (the page loads them straight from
     Shopify's CDN; the worker never fetches one). Rate limit: 5 requests a second per API client by default
     (shopify.dev/docs/agents/profiles/auth-and-rate-limiting); a 429 is honoured with its Retry-After.
   What is sent: the hunt's words, "US" and the filters. No member, no email, no IP (no buyer signals), no user agent.

   Vintage first: a secondhand search, then, when it leaves fewer than max listings with the hunt's words, one search
   without the condition filter; secondhand listings stay first. Titles must carry every word of the hunt (sgwExact,
   the ShopGoodwill rule). Owl & Twig's own products are dropped (they already show in Found on the Prowl).
   Caps: SHOPCAT_PER_IP asks a day per IP key and SHOPCAT_PER_DAY catalog calls a day for the whole site (vCount).

   Everything here takes D, the helpers index.js hands in (shopDeps there): { vCount, ipKey, json, sgwExact, fetch? },
   so the module never imports index.js and the tests can run it with fakes. */

export const SHOPCAT_TOKEN_URL = "https://api.shopify.com/auth/access_token";
export const SHOPCAT_MCP_URL = "https://catalog.shopify.com/api/ucp/mcp";
export const SHOPCAT_UCP_VERSION = "2026-08-25";
export const SHOPCAT_PROFILE_PATH = "/ucp/profile.json";
export const SHOPCAT_MAX = 12, SHOPCAT_PAGE = 30, SHOPCAT_TERM_MAX = 80;
export const SHOPCAT_PER_IP = 200, SHOPCAT_PER_DAY = 10000;
export const SHOPCAT_TIMEOUT_MS = 8000, SHOPCAT_TOKEN_TTL_MS = 60 * 60000, SHOPCAT_TOKEN_EARLY_MS = 60000, SHOPCAT_BUSY_MAX_S = 300;
/* Owl & Twig's own store: its domain and both of its myshopify names */
export const SHOPCAT_OWN = ["owlandtwigvintage.com", "tz7xkc-du.myshopify.com", "owlandtwigvintage-store.myshopify.com"];
const ZERO_DEC = { JPY: 1, KRW: 1, VND: 1, CLP: 1, ISK: 1, UGX: 1, XAF: 1, XOF: 1, PYG: 1, RWF: 1, KMF: 1, GNF: 1, DJF: 1, BIF: 1, VUV: 1, XPF: 1 };

/* in this isolate only: the token, and how long Shopify asked us to wait after a 429.
   v211: fp = a fingerprint of the credentials the failure or the token belongs to (FNV-1a of the id and the secret,
   memory only), so a new key in the Worker secrets is tried at once instead of after the 5-minute wait; method = the
   token_endpoint_auth_method that worked ("post": the JSON body, "basic": HTTP Basic), tried first next time;
   last = the latest exchange's outcome, as the admin's Diagnose card shows it (never the secret or the token). */
const S = { tok: "", exp: 0, id: "", p: null, busyUntil: 0, failUntil: 0, fp: "", failFp: "", method: "", last: null };
export function shopcatReset() { S.tok = ""; S.exp = 0; S.id = ""; S.p = null; S.busyUntil = 0; S.failUntil = 0; S.fp = ""; S.failFp = ""; S.method = ""; S.last = null; }
export const SHOPCAT_DEADLINE_MS = 15000, SHOPCAT_SECOND_PASS_MS = 9000;   /* review fix: a whole request's limit; no fallback search past 9 s */

export function shopcatOn(env) { return !!(env && String(env.SHOPIFY_CATALOG_CLIENT_ID || "").trim() && String(env.SHOPIFY_CATALOG_CLIENT_SECRET || "").trim()); }

/* The agent profile Shopify reads to agree what this agent may call (UCP negotiation): catalog search and lookup, and
   the Global Catalog extension for the seller fields. Mirrors the catalog part of Shopify's hosted example profile. */
export function shopcatProfile() {
  const v = SHOPCAT_UCP_VERSION, ucp = "https://ucp.dev/" + v;
  return { ucp: { version: v,
    services: { "dev.ucp.shopping": [{ version: v, spec: ucp + "/specification/overview", transport: "mcp", schema: ucp + "/services/shopping/mcp.openrpc.json" }] },
    capabilities: {
      "dev.ucp.shopping.catalog.search": [{ version: v, spec: ucp + "/specification/catalog/search", schema: ucp + "/schemas/shopping/catalog_search.json" }],
      "dev.ucp.shopping.catalog.lookup": [{ version: v, spec: ucp + "/specification/catalog/lookup", schema: ucp + "/schemas/shopping/catalog_lookup.json" }],
      "dev.shopify.catalog.global": [{ version: v, spec: "https://shopify.dev/docs/agents/catalog/global-catalog",
        schema: "https://shopify.dev/ucp/schemas/" + v + "/shopify_catalog_global.json", extends: ["dev.ucp.shopping.catalog.lookup", "dev.ucp.shopping.catalog.search"] }]
    },
    payment_handlers: {} } };
}
export function shopcatProfileUrl(env, origin) {
  const o = String((env && env.SHOPIFY_CATALOG_PROFILE) || "").trim();
  return /^https:\/\/[^\s]+$/.test(o) ? o : String(origin || "").replace(/\/$/, "") + SHOPCAT_PROFILE_PATH;
}

/* the hunt as Shopify gets it: words and spaces only, cut at a whole word */
export function shopcatTerm(v) {
  let t = String(v || "").replace(/[\u0000-\u001f\u007f<>"`{}\\]+/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > SHOPCAT_TERM_MAX) { t = t.slice(0, SHOPCAT_TERM_MAX + 1); const i = t.lastIndexOf(" "); t = (i > 20 ? t.slice(0, i) : t.slice(0, SHOPCAT_TERM_MAX)).trim(); }
  return t;
}

function jwtExp(t) {
  try {
    const p = String(t).split(".")[1];
    if (!p) return 0;
    const j = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)));
    return Number(j && j.exp) > 0 ? Number(j.exp) * 1000 : 0;
  } catch (e) { return 0; }
}
/* review fix: the abort timer runs through the body read too (a response whose headers came but whose body stalls
   was unbounded), and never past the request's overall deadline. Answers { status, headers, j } (j null when the
   body was not JSON or the status was not 200; v211: all = read the JSON of any status, for Shopify's error code). */
async function timed(f, url, init, deadline, all) {
  const ms = Math.max(1, Math.min(SHOPCAT_TIMEOUT_MS, deadline ? deadline - Date.now() : SHOPCAT_TIMEOUT_MS));
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  const stop = new Promise((_, rej) => ctl.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  try {
    return await Promise.race([stop, (async () => {
      const r = await f(url, Object.assign({}, init, { signal: ctl.signal }));
      let j = null;
      if (r && (r.status === 200 || all)) { try { j = await r.json(); } catch (e) { if (ctl.signal.aborted) throw e; j = null; } }
      return { status: r ? r.status : 0, headers: r && r.headers, j: j };
    })()]);
  } finally { clearTimeout(timer); }
}

/* the bearer token, from memory while it has more than a minute left; one exchange at a time per isolate.
   Review fix: a failed exchange (a wrong or revoked secret, Shopify down) is remembered SHOPCAT_TOKEN_FAIL_MS, so
   Shopify does not get a client_credentials POST on every request meanwhile (shopLive answers "unavailable").
   v211 (live v210 answered "unavailable" with Matt's key set, and only the status was logged):
   - Shopify's error code and a trimmed error_description are kept (S.last, and KV SHOPCAT_LAST_KEY for the admin's
     Diagnose card); anything resembling the client id or secret is cut out first (shopcatScrub), never the token.
   - The docs (shopify.dev/docs/agents/get-started/authentication, .../dev-dashboard/catalogs) send a JSON body
     { client_id, client_secret, grant_type: "client_credentials" } and nothing else (no scope, no audience; the
     client-credentials page says Shopify ignores a scope). The server metadata
     (api.shopify.com/.well-known/oauth-authorization-server) also lists client_secret_basic, so when the JSON body is
     refused as a bad client (invalid_client and kin), one more try goes with HTTP Basic and a form body
     grant_type=client_credentials; the method that worked is remembered.
   - The 5-minute wait belongs to the credentials it failed with (S.failFp): changed secrets are tried at once. */
export const SHOPCAT_TOKEN_FAIL_MS = 5 * 60000;
export const SHOPCAT_LAST_KEY = "shopcat:last";
/* Shopify's codes worth a second try with the other auth method (not application_cannot_be_found: the id is unknown) */
const RETRY_CODES = { invalid_client: 1, unauthorized_client: 1, invalid_request: 1, invalid_grant: 1, unauthorized: 1, "": 1 };
function fnv(s) { let h = 0x811c9dc5; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); }
function creds(env) { return { id: String((env && env.SHOPIFY_CATALOG_CLIENT_ID) || "").trim(), secret: String((env && env.SHOPIFY_CATALOG_CLIENT_SECRET) || "").trim() }; }
export function shopcatFp(env) { const c = creds(env); return fnv(c.id + "\n" + c.secret) + "." + c.secret.length; }
/* t with every run of 6+ characters that also appears in k (lower case) replaced by [hidden]; a sliding window */
function hidePieces(t, k) {
  const low = t.toLowerCase();
  let out = "", i = 0;
  while (i < t.length) {
    let L = 0;
    if (i + 6 <= t.length && k.indexOf(low.slice(i, i + 6)) !== -1) { L = 6; while (i + L < t.length && k.indexOf(low.slice(i, i + L + 1)) !== -1) L++; }
    if (L) { out += "[hidden]"; i += L; } else { out += t[i]; i++; }
  }
  return out;
}
/* Shopify's own words, without the id, the secret or anything shaped like a key; one line, at most 200 characters */
export function shopcatScrub(v, env, n) {
  const c = creds(env);
  let t = String(v == null ? "" : v).slice(0, 4000).replace(/[\u0000-\u001f\u007f]+/g, " ");
  for (const k of [c.id, c.secret]) if (k && k.length >= 3) t = t.split(k).join("[hidden]");
  /* review fix: any 6+ character piece of the id or the secret (any case) goes too, so a partial echo is never kept */
  for (const k of [c.id, c.secret]) if (k && k.length >= 6) t = hidePieces(t, k.toLowerCase());
  return t.replace(/"[^"]{6,}"/g, "\"[hidden]\"").replace(/(?=[A-Za-z0-9_\-+\/=]*\d)(?=[A-Za-z0-9_\-+\/=]*[A-Za-z])[A-Za-z0-9_\-+\/=]{20,}/g, "[hidden]")   /* key-like: 20+ with a digit and a letter */.replace(/\s+/g, " ").trim().slice(0, n || 200);
}
export function shopcatTokenDown(nowMs, env) { return S.failUntil > (Number(nowMs) || Date.now()) && (!env || S.failFp === shopcatFp(env)); }
export function shopcatLast() { return S.last ? Object.assign({}, S.last) : null; }
export function shopcatMethod() { return S.method; }
async function record(env, rec) {
  S.last = rec;
  try { if (env && env.PROWL_ALERTS) await env.PROWL_ALERTS.put(SHOPCAT_LAST_KEY, JSON.stringify(rec), { expirationTtl: 30 * 86400 }); } catch (e) {}
}
/* one exchange with one auth method: { status, j } (j is the JSON body for any status, or null) */
function exchange(f, c, method, deadline) {
  const h = { "Accept": "application/json" };
  let body;
  if (method === "basic") {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    h["Authorization"] = "Basic " + btoa(encodeURIComponent(c.id) + ":" + encodeURIComponent(c.secret));   /* RFC 6749 2.3.1: form-encoded, then Basic */
    body = "grant_type=client_credentials";
  } else {
    h["Content-Type"] = "application/json";
    body = JSON.stringify({ client_id: c.id, client_secret: c.secret, grant_type: "client_credentials" });
  }
  return timed(f, SHOPCAT_TOKEN_URL, { method: "POST", headers: h, body: body }, deadline, true);
}
/* force (the admin's test): skip the token in memory and the 5-minute wait */
export async function shopcatToken(env, D, nowMs, deadline, force) {
  const f = (D && D.fetch) || fetch, now = Number(nowMs) || Date.now(), c = creds(env), id = c.id, fp = shopcatFp(env);
  if (!force && S.tok && S.id === id && S.fp === fp && now < S.exp - SHOPCAT_TOKEN_EARLY_MS) return S.tok;
  if (!force && S.failUntil > now && S.failFp === fp) throw new Error("token down");
  if (S.p && !force) return S.p;
  const run = (async () => {
    const order = S.method === "basic" ? ["basic", "post"] : ["post", "basic"];
    /* review fix: every attempt is kept (scrubbed), and the JSON-body ("post") attempt stays the main error, so a
       refused Basic retry or its timeout no longer hides Shopify's answer to the documented method */
    let r = null, used = order[0], tries = [], attempts = [], thrown = null;
    for (let i = 0; i < order.length; i++) {
      used = order[i];
      tries.push(used);
      try { r = await exchange(f, c, used, deadline); }
      catch (e) {
        attempts.push({ method: used, status: 0, error: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable", desc: "" });
        r = null; thrown = e;
        break;
      }
      const j = r.j, code = j && typeof j.error === "string" ? j.error : "";
      attempts.push({ method: used, status: r.status, error: shopcatScrub(code, env, 60) || (r.status === 200 && !(j && j.access_token) ? "no access_token in the answer" : ""), desc: r.status === 200 ? "" : shopcatScrub(j && (j.error_description || j.message), env, 200) });
      if (r.status === 200 && j && typeof j.access_token === "string" && j.access_token) break;
      /* refused as a bad client: once more with the other method */
      if (i === 0 && (r.status === 400 || r.status === 401) && RETRY_CODES[code]) continue;
      break;
    }
    const j = r && r.j, t = j && typeof j.access_token === "string" ? j.access_token : "";
    if (!r || r.status !== 200 || !t) {
      S.failUntil = now + SHOPCAT_TOKEN_FAIL_MS; S.failFp = fp;
      const main = attempts.filter((a) => a.method === "post")[0] || attempts[0];
      await record(env, { at: now, ok: false, status: main.status, error: main.error, desc: main.desc, method: main.method, tried: tries, attempts: attempts });
      console.error("shopcat token", attempts.map((a) => a.method + " " + (a.status || "none") + " " + (a.error || "-")).join(" + "));   /* Shopify's codes, never the body's secret parts or the token */
      if (thrown) throw thrown;   /* a timeout still reaches shopLive as one */
      throw new Error("token " + (main.status || "none"));
    }
    const said = Number(j.expires_in) > 0 ? now + Number(j.expires_in) * 1000 : jwtExp(t);
    S.tok = t; S.id = id; S.fp = fp; S.method = used; S.failUntil = 0; S.failFp = "";
    S.exp = Math.min(said > now ? said : now + SHOPCAT_TOKEN_TTL_MS, now + SHOPCAT_TOKEN_TTL_MS);
    await record(env, { at: now, ok: true, status: 200, error: "", desc: "", method: used, tried: tries, attempts: attempts });
    return t;
  })();
  if (force) return run;
  S.p = run;
  try { return await S.p; } finally { S.p = null; }
}

/* the search_catalog call's body: the hunt's words, the US and the filters, nothing else */
export function shopcatBody(term, profile, secondhand) {
  const filters = { available: true, ships_to: { country: "US" } };
  if (secondhand) filters.condition = ["secondhand"];
  return { jsonrpc: "2.0", method: "tools/call", id: 1, params: { name: "search_catalog", arguments: {
    meta: { "ucp-agent": { profile: profile } },
    catalog: { query: term, context: { address_country: "US", language: "en", currency: "USD" }, filters: filters, pagination: { limit: SHOPCAT_PAGE } } } } };
}

function hostOf(u) { try { const x = new URL(String(u || "")); return x.protocol === "https:" ? x.hostname.toLowerCase().replace(/^www\./, "") : ""; } catch (e) { return ""; } }
export function shopcatOwn(urls, env) {
  const own = SHOPCAT_OWN.concat(env && env.SHOPIFY_SHOP ? [String(env.SHOPIFY_SHOP).toLowerCase()] : []);
  return urls.some((u) => { const h = /^[a-z0-9.-]+$/i.test(String(u || "")) ? String(u).toLowerCase().replace(/^www\./, "") : hostOf(u); return !!h && own.some((d) => h === d || h.slice(-(d.length + 1)) === "." + d); });
}
function major(m) {
  const a = Number(m && m.amount), c = String((m && m.currency) || "").toUpperCase();
  if (!Number.isFinite(a) || a < 0 || !/^[A-Z]{3}$/.test(c)) return null;
  return { price: ZERO_DEC[c] ? Math.round(a) : Math.round(a) / 100, currency: c };
}
function img(list) {
  for (const m of Array.isArray(list) ? list : []) {
    const u = m && (m.url || (m.preview && m.preview.url));
    if (m && (!m.type || m.type === "image") && typeof u === "string" && /^https:\/\/cdn\.shopify\.com\/[^\s"'<>]+$/.test(u)) return u.slice(0, 600);
  }
  return "";
}
/* one product as a Prowl card: its first sale-ready variant (secondhand first) with an https link; Shopify stores only */
export function shopcatItem(p, env) {
  if (!p || typeof p.title !== "string" || !p.title.trim()) return null;
  const all = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && (!v.source || v.source === "shopify") && !(v.availability && v.availability.available === false) && hostOf(v.url));
  if (!all.length) return null;
  /* review fix: a product clusters offers from several stores; only Owl & Twig's own offers are skipped, the rest stay */
  const vs = all.filter((v) => { const s = v.seller || {}; return !shopcatOwn([v.url, s.url, s.domain], env); });
  if (!vs.length) return { own: true };
  const sh = (v) => Array.isArray(v.condition) ? v.condition.indexOf("secondhand") !== -1 : v.condition === "secondhand";
  const v = vs.filter(sh)[0] || vs[0], s = v.seller || {};
  const pr = major(v.price) || major(p.price_range && p.price_range.min);
  const out = { title: p.title.replace(/\s+/g, " ").trim().slice(0, 160), price: pr ? pr.price : null, currency: pr ? pr.currency : "",
    img: img(p.media) || img(v.media), shop: String(s.name || "").replace(/\s+/g, " ").trim().slice(0, 60) || hostOf(s.url || v.url), url: String(v.url).slice(0, 800) };
  if (sh(v)) out.secondhand = true;
  /* review fix: the same listing from two searches differs in _gsid (and shclid / shcgid), so it is matched by product and
     variant, or by the link without its query, never by the full URL; the URL itself is returned as Shopify gave it */
  Object.defineProperty(out, "key", { value: (p.id && v.id ? String(p.id) + "|" + String(v.id) : String(v.url).split(/[?#]/)[0]), enumerable: false });
  return out;
}

/* one catalog call: { products } or { err, status, wait } */
async function search(env, D, term, profile, secondhand, deadline) {
  const f = (D && D.fetch) || fetch;
  for (let tries = 0; tries < 2; tries++) {
    let tok;
    try { tok = await shopcatToken(env, D, 0, deadline); } catch (e) { if (/abort/i.test(String(e && (e.name || e.message)))) throw e; return { err: "unavailable", status: 503 }; }
    const r = await timed(f, SHOPCAT_MCP_URL, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(shopcatBody(term, profile, secondhand)) }, deadline);
    if (r.status === 401 && tries === 0) { S.tok = ""; S.exp = 0; continue; }   /* a token Shopify no longer takes: one fresh one */
    if (r.status === 429) {
      const ra = Number((r.headers && r.headers.get && r.headers.get("Retry-After")) || 0);
      return { err: "busy", status: 429, wait: Math.min(SHOPCAT_BUSY_MAX_S, ra > 0 ? ra : 30) };
    }
    if (r.status !== 200) return { err: "shopify " + r.status, status: r.status };
    const j = r.j;
    if (!j) return { err: "unreadable", status: 502 };
    if (j.error) return { err: "shopify error", status: 502 };
    const sc = j && j.result && j.result.structuredContent;
    if (!sc || (j.result && j.result.isError)) return { err: "shopify error", status: 502 };
    return { products: Array.isArray(sc.products) ? sc.products : [] };
  }
  return { err: "auth", status: 401 };
}

export async function shopLive(request, env, url, origin, D, nowMs) {
  const now = Number(nowMs) || Date.now(), NS = { "Cache-Control": "no-store" };
  const out = (body, status) => D.json(body, status || 200, origin, NS);
  if (!shopcatOn(env)) return D.json({ off: true }, 200, origin, { "Cache-Control": "private, max-age=300" });
  const term = shopcatTerm(url.searchParams.get("term") || url.searchParams.get("q"));
  if (term.replace(/[^a-z0-9À-￿]/gi, "").length < 2) return out({ on: true, error: "term required", items: [] }, 400);
  const mx = Math.floor(Number(url.searchParams.get("max")));
  const max = mx >= 1 ? Math.min(SHOPCAT_MAX, mx) : SHOPCAT_MAX;
  if (S.busyUntil > now) return out({ on: true, term: term, error: "busy", items: [] }, 429);
  if (shopcatTokenDown(now, env)) return out({ on: true, term: term, error: "unavailable", items: [] }, 503);   /* review fix: a failed exchange waits SHOPCAT_TOKEN_FAIL_MS */
  if (!(await D.vCount("shopcat:" + D.ipKey(request.headers.get("CF-Connecting-IP")), SHOPCAT_PER_IP))) return out({ on: true, term: term, error: "slow down", items: [] }, 429);
  const profile = shopcatProfileUrl(env, url.origin);
  const t0 = Date.now(), deadline = t0 + SHOPCAT_DEADLINE_MS;   /* review fix: the whole request, token and both searches */
  const items = [], seen = Object.create(null);
  let raw = 0, words = 0, own = 0;
  for (const secondhand of [true, false]) {
    if (!secondhand && (items.length >= max || Date.now() - t0 > SHOPCAT_SECOND_PASS_MS)) break;
    if (!(await D.vCount("shopcat:all", SHOPCAT_PER_DAY))) { if (secondhand) return out({ on: true, term: term, error: "daily limit", items: [] }, 429); break; }
    let r;
    try { r = await search(env, D, term, profile, secondhand, deadline); } catch (e) { r = { err: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable", status: 504 }; }
    if (r.err) {
      if (r.status === 429) S.busyUntil = now + r.wait * 1000;
      if (secondhand || !items.length) return out({ on: true, term: term, error: r.err, items: [] }, r.status === 429 ? 429 : r.status === 503 ? 503 : 502);
      break;   /* the secondhand listings already found are still worth showing */
    }
    raw += r.products.length;
    const cards = [];
    for (const p of r.products) { const c = shopcatItem(p, env); if (!c) continue; if (c.own) { own++; continue; } cards.push(c); }
    const kept = D.sgwExact(cards, term) || [];
    words += kept.length;
    for (const c of kept) { const k = c.key || c.url; if (seen[k] || items.length >= max) continue; seen[k] = 1; items.push(c); }
  }
  items.sort((a, b) => (b.secondhand ? 1 : 0) - (a.secondhand ? 1 : 0));   /* stable: secondhand first, Shopify's order within */
  const body = { on: true, term: term, items: items };
  if (!items.length) body.why = { raw: raw, words: words, own: own };
  return out(body, 200);
}

/* ---------- v211: the admin's Diagnose card "Shopify stores (Global Catalog)" ----------
   shopcatStatus: on/off, the latest exchange (this isolate's, else the KV record another isolate left), the auth method
   that worked, and the shape of the two secrets (lengths, stray spaces or quotes, swapped) without their values.
   shopcatTest: one fresh token exchange (past the memory and the 5-minute wait) and one search_catalog for a test
   term; the item count and the first 3 titles, or Shopify's exact JSON-RPC error. admin.js gates both behind the
   admin session (the owner only). */
function shape(v) {
  const raw = String(v == null ? "" : v), t = raw.trim();
  return { len: t.length, spaces: raw !== t, inner: /\s/.test(t), quotes: /^["'`]|["'`]$/.test(t), set: t.length > 0 };
}
export function shopcatShape(env) {
  const id = shape(env && env.SHOPIFY_CATALOG_CLIENT_ID), secret = shape(env && env.SHOPIFY_CATALOG_CLIENT_SECRET);
  const sid = String((env && env.SHOPIFY_CATALOG_CLIENT_ID) || "").trim(), ssec = String((env && env.SHOPIFY_CATALOG_CLIENT_SECRET) || "").trim();
  /* Shopify's secrets start shpss_ (or atkn_ and the like for tokens); an id that does, or a secret that looks like a
     bare 32-character hex id, is probably in the wrong slot. Only the yes/no leaves the worker. */
  const swapped = /^(shpss_|shpat_|shpca_|atkn_)/i.test(sid) || (/^[0-9a-f]{32}$/i.test(ssec) && !/^[0-9a-f]{32}$/i.test(sid));
  return { id: id, secret: secret, swapped: swapped, same: !!sid && sid === ssec };
}
/* each exchange attempt, scrubbed again on the way out (older KV records have none) */
export function shopcatAttempts(list, env) {
  return (Array.isArray(list) ? list : []).slice(0, 2).filter((a) => a && typeof a === "object").map((a) => ({ method: String(a.method || "").replace(/[^a-z]/g, "").slice(0, 8),
    status: Number(a.status) || 0, error: shopcatScrub(a.error, env, 60), desc: shopcatScrub(a.desc, env, 200) }));
}
export async function shopcatStatus(env, nowMs) {
  const now = Number(nowMs) || Date.now();
  let last = shopcatLast();
  if (!last && env && env.PROWL_ALERTS) { try { last = await env.PROWL_ALERTS.get(SHOPCAT_LAST_KEY, "json"); } catch (e) { last = null; } }
  const L = last && typeof last === "object" ? last : null;
  return { on: shopcatOn(env), shape: shopcatShape(env), method: S.method || (L && L.ok ? String(L.method || "") : ""),
    waitUntil: shopcatTokenDown(now, env) ? S.failUntil : 0, busyUntil: S.busyUntil > now ? S.busyUntil : 0,
    last: L ? { at: Number(L.at) || 0, ok: !!L.ok, status: Number(L.status) || 0, error: shopcatScrub(L.error, env, 60), desc: shopcatScrub(L.desc, env, 200),
      method: String(L.method || "").replace(/[^a-z]/g, "").slice(0, 8), tried: (Array.isArray(L.tried) ? L.tried : []).map((m) => String(m).replace(/[^a-z]/g, "").slice(0, 8)).slice(0, 2),
      attempts: shopcatAttempts(L.attempts, env) } : null };
}
export async function shopcatTest(env, D, term, origin, nowMs) {
  const now = Number(nowMs) || Date.now(), q = shopcatTerm(term) || "pyrex";
  if (!shopcatOn(env)) return { on: false, term: q, exchange: null, search: null };
  const deadline = Date.now() + SHOPCAT_DEADLINE_MS, f = (D && D.fetch) || fetch;
  let tok = "";
  try { tok = await shopcatToken(env, D, now, deadline, true); } catch (e) {}
  const ex = shopcatLast() || { ok: !!tok, status: tok ? 200 : 0, error: "", desc: "", method: S.method, tried: [], attempts: [] };
  const exchange = { ok: !!tok, at: ex.at || now, status: ex.status, error: ex.error, desc: ex.desc, method: ex.method, tried: ex.tried || [], attempts: shopcatAttempts(ex.attempts, env) };
  if (!tok) return { on: true, term: q, exchange: exchange, search: null };
  if (D && typeof D.vCount === "function" && !(await D.vCount("shopcat:all", SHOPCAT_PER_DAY))) return { on: true, term: q, exchange: exchange, search: { ok: false, status: 429, error: "daily limit" } };
  let r;
  try {
    r = await timed(f, SHOPCAT_MCP_URL, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(shopcatBody(q, shopcatProfileUrl(env, origin), false)) }, deadline, true);
  } catch (e) { return { on: true, term: q, exchange: exchange, search: { ok: false, status: 0, error: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable" } }; }
  const j = r.j, out = { ok: false, status: r.status };
  if (j && j.error) out.rpc = { code: Number(j.error.code) || 0, message: shopcatScrub(j.error.message, env, 300), data: j.error.data == null ? "" : shopcatScrub(typeof j.error.data === "string" ? j.error.data : JSON.stringify(j.error.data), env, 300) };
  else if (j && j.result && j.result.isError) out.rpc = { code: 0, message: shopcatScrub((Array.isArray(j.result.content) ? j.result.content : []).map((x) => x && x.text).filter(Boolean).join(" ") || "tool error", env, 300), data: "" };
  else if (r.status !== 200) out.error = shopcatScrub(j && (j.error_description || j.message || j.error), env, 200) || "answered " + r.status;
  else {
    const sc = j && j.result && j.result.structuredContent, ps = sc && Array.isArray(sc.products) ? sc.products : null;
    if (!ps) out.error = "no products in the answer";
    else { out.ok = true; out.count = ps.length; out.titles = ps.slice(0, 3).map((p) => String((p && p.title) || "").replace(/\s+/g, " ").trim().slice(0, 120)); }
  }
  return { on: true, term: q, exchange: exchange, search: out };
}
