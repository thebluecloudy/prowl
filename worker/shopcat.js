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
   v213: off-Shopify offers only from known stores (SHOPCAT_OFF_TRUSTED, SHOPCAT_OFF_ALLOW; see shopcatTrusted).
   Caps: SHOPCAT_PER_IP asks a day per IP key and SHOPCAT_PER_DAY catalog calls a day for the whole site (vCount).

   Everything here takes D, the helpers index.js hands in (shopDeps there): { vCount, ipKey, json, sgwExact, fetch? },
   so the module never imports index.js and the tests can run it with fakes. */

export const SHOPCAT_TOKEN_URL = "https://api.shopify.com/auth/access_token";
export const SHOPCAT_MCP_URL = "https://catalog.shopify.com/api/ucp/mcp";
export const SHOPCAT_UCP_VERSION = "2026-08-25";
export const SHOPCAT_PROFILE_PATH = "/ucp/profile.json";
/* v213: every call to Shopify names itself (a Worker's fetch sends no User-Agent of its own; v211's exchange from the
   Worker got a bare 403 with no JSON, which looks like an edge block rather than a refused key) */
export const SHOPCAT_UA = "Prowl/213 (+https://www.owlandtwigvintage.com/pages/prowl)";
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
const S = { tok: "", exp: 0, id: "", p: null, busyUntil: 0, failUntil: 0, fp: "", failFp: "", method: "", last: null, search: null, kvMode: "", kvRec: "" };
export function shopcatReset() { S.tok = ""; S.exp = 0; S.id = ""; S.p = null; S.busyUntil = 0; S.failUntil = 0; S.fp = ""; S.failFp = ""; S.method = ""; S.last = null; S.search = null; S.kvMode = ""; S.kvRec = ""; }
export const SHOPCAT_DEADLINE_MS = 15000, SHOPCAT_SECOND_PASS_MS = 9000;   /* review fix: a whole request's limit; no fallback search past 9 s */

/* v213: a saved catalog (Dev Dashboard › Catalogs) is sent as catalog.catalog_id (shopify.dev/docs/apps/build/dev-dashboard/catalogs;
   saved_catalog_slug is deprecated). Matt's "Prowl_catalogsearch_shopify" (All products, Shopify + Off-Shopify, region
   Anywhere) is the default; the plain variable SHOPIFY_CATALOG_ID overrides it, and "none" (or "off") sends no catalog. */
export const SHOPCAT_CATALOG_ID = "01m6bnevzyfcxd7e3s8g125vca";
export function shopcatCatalogId(env) {
  const v = String((env && env.SHOPIFY_CATALOG_ID) || "").trim();
  if (/^(none|off|0|-)$/i.test(v)) return "";
  return /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : SHOPCAT_CATALOG_ID;
}

/* v213: on = the two secrets are set (the token mode is tried). /shop-live works without them too: it searches keyless
   (Shopify: Global Catalog auth is "Agent profile (no API key needed)", shopify.dev/docs/agents/catalog; keyless calls
   have rate limits that cannot be raised), and keyless again when the token exchange fails or is in its 5-minute wait. */
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
      let j = null, text = "";
      if (r && r.status !== 200 && all && typeof r.text === "function") {
        /* v213: any status: the text, then its JSON, so a non-JSON refusal (an edge or WAF page) still says something */
        try { text = String(await r.text()); } catch (e) { if (ctl.signal.aborted) throw e; text = ""; }
        try { j = text ? JSON.parse(text) : null; } catch (e) { j = null; }
      } else if (r && (r.status === 200 || all)) { try { j = await r.json(); } catch (e) { if (ctl.signal.aborted) throw e; j = null; } }
      return { status: r ? r.status : 0, headers: r && r.headers, j: j, text: j ? "" : text };
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
/* v213: a non-JSON body as one short line: tags, scripts and styles out, scrubbed, 200 characters */
export function shopcatSnippet(text, env) {
  const t = String(text || "").slice(0, 20000).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return shopcatScrub(t, env, 200);
}
/* v213: who answered: the server header (a word or two) and whether a cf-ray came back (Cloudflare's edge) */
function edge(headers) {
  const g = (k) => { try { return headers && headers.get ? String(headers.get(k) || "") : ""; } catch (e) { return ""; } };
  return { server: g("server").replace(/[^A-Za-z0-9 ._\/-]/g, "").slice(0, 40), ray: !!g("cf-ray") };
}
export function shopcatTokenDown(nowMs, env) { return S.failUntil > (Number(nowMs) || Date.now()) && (!env || S.failFp === shopcatFp(env)); }
export function shopcatLast() { return S.last ? Object.assign({}, S.last) : null; }
export function shopcatMethod() { return S.method; }
async function record(env, rec) {
  if (S.search) rec = Object.assign({}, rec, { search: S.search });   /* v213: the latest search's mode stays with the exchange */
  S.last = rec;
  /* review fix: KV gets the record only when the outcome changes (ok, status, error, method), not on every exchange */
  const sig = [rec.ok ? 1 : 0, rec.status, rec.error, rec.method, rec.refused ? 1 : 0].join("|");
  if (S.kvRec === sig) return;
  S.kvRec = sig;
  try { if (env && env.PROWL_ALERTS) await env.PROWL_ALERTS.put(SHOPCAT_LAST_KEY, JSON.stringify(rec), { expirationTtl: 30 * 86400 }); } catch (e) {}
}
/* one exchange with one auth method: { status, j } (j is the JSON body for any status, or null) */
function exchange(f, c, method, deadline) {
  const h = { "Accept": "application/json", "User-Agent": SHOPCAT_UA };
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
      const j = r.j, code = j && typeof j.error === "string" ? j.error : "", eg = edge(r.headers);
      const a = { method: used, status: r.status, error: shopcatScrub(code, env, 60) || (r.status === 200 && !(j && j.access_token) ? "no access_token in the answer" : r.status !== 200 && !j ? "not JSON" : ""),
        desc: r.status === 200 ? "" : j ? shopcatScrub(j.error_description || j.message, env, 200) : shopcatSnippet(r.text, env) };
      if (r.status !== 200) { a.server = eg.server; a.ray = eg.ray; }   /* v213: an edge block or Shopify's own refusal */
      attempts.push(a);
      if (r.status === 200 && j && typeof j.access_token === "string" && j.access_token) break;
      /* refused as a bad client: once more with the other method (v213: and a 403 with no JSON body) */
      if (i === 0 && (((r.status === 400 || r.status === 401) && RETRY_CODES[code]) || (r.status === 403 && !j))) continue;
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

/* the search_catalog call's body: the hunt's words, the US and the filters, nothing else (v213: and the saved catalog's id) */
export function shopcatBody(term, profile, secondhand, catalogId) {
  const filters = { available: true, ships_to: { country: "US" } };
  if (secondhand) filters.condition = ["secondhand"];
  const catalog = { query: term };
  if (catalogId) catalog.catalog_id = String(catalogId);
  Object.assign(catalog, { context: { address_country: "US", language: "en", currency: "USD" }, filters: filters, pagination: { limit: SHOPCAT_PAGE } });
  return { jsonrpc: "2.0", method: "tools/call", id: 1, params: { name: "search_catalog", arguments: {
    meta: { "ucp-agent": { profile: profile } }, catalog: catalog } } };
}

function hostOf(u) { try { const x = new URL(String(u || "")); return x.protocol === "https:" ? x.hostname.toLowerCase().replace(/^www\./, "") : ""; } catch (e) { return ""; } }
export function shopcatOwn(urls, env) {
  const own = SHOPCAT_OWN.concat(env && env.SHOPIFY_SHOP ? [String(env.SHOPIFY_SHOP).toLowerCase()] : []);
  return urls.some((u) => { const h = /^[a-z0-9.-]+$/i.test(String(u || "")) ? String(u).toLowerCase().replace(/^www\./, "") : hostOf(u); return !!h && own.some((d) => h === d || h.slice(-(d.length + 1)) === "." + d); });
}
/* v213 (Matt, 2026-11-01: "Known stores only"): an off-Shopify offer is kept only when its link's host is one of these
   marketplaces or a subdomain of one (an exact host-suffix match, never a substring: etsy.com.fake.ru and notetsy.com
   are not etsy.com). Many off-Shopify offers in the saved catalog are copied listings on unrelated domains. Every
   Shopify store's offer stays. The variable SHOPCAT_OFF_ALLOW (comma-separated domains) adds more. */
export const SHOPCAT_OFF_TRUSTED = ["chairish.com", "poshmark.com", "etsy.com", "ebay.com", "1stdibs.com", "rubylane.com", "mercari.com",
  "depop.com", "vinted.com", "grailed.com", "reverb.com", "whatnot.com", "hibid.com", "bidprowl.com", "liveauctioneers.com", "invaluable.com",
  "lot-art.com", "ha.com", "shopgoodwill.com", "ctbids.com", "ecrater.com", "abebooks.com", "aptdeco.com", "offerup.com", "kaiyo.com",
  "everythingbutthehouse.com", "replacements.com", "amazon.com", "walmart.com", "target.com", "wayfair.com"];
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
/* review fix: suffixes that would trust every store under them (a bare TLD, a public second level, a hosting platform);
   an SHOPCAT_OFF_ALLOW entry that is one of these is ignored and listed in the Diagnose card */
export const SHOPCAT_PUBLIC_SUFFIX = ["com", "net", "org", "co", "io", "shop", "store", "biz", "info", "us", "uk", "ca", "au", "de", "fr", "ru", "cn",
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "com.br", "com.mx", "com.cn", "co.in", "co.za",
  "myshopify.com", "shopify.com", "shopifypreview.com", "github.io", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "wixsite.com",
  "squarespace.com", "square.site", "weebly.com", "wordpress.com", "blogspot.com", "herokuapp.com", "web.app", "firebaseapp.com", "bigcartel.com", "storenvy.com"];
/* one SHOPCAT_OFF_ALLOW entry as a bare host: a pasted URL (http or https) gives its host; *. and www. go */
function allowHost(e) {
  let d = String(e || "").trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(d)) { try { const x = new URL(d); d = /^https?:$/.test(x.protocol) ? x.hostname : ""; } catch (err) { d = ""; } }
  else d = d.split(/[\/?#]/)[0];
  return d.replace(/^(\*\.|\.)/, "").replace(/^www\./, "").replace(/\.$/, "");
}
/* { add: the hosts SHOPCAT_OFF_ALLOW adds, ignored: the entries left out (as typed, trimmed to 80) } */
export function shopcatOffAllowParse(env) {
  const add = [], ignored = [];
  for (const raw of String((env && env.SHOPCAT_OFF_ALLOW) || "").split(/[,\s]+/)) {
    const e = raw.trim();
    if (!e) continue;
    const d = allowHost(e);
    if (DOMAIN_RE.test(d) && SHOPCAT_PUBLIC_SUFFIX.indexOf(d) === -1) { if (add.indexOf(d) === -1) add.push(d); }
    else if (ignored.length < 20) ignored.push(e.replace(/[^\x21-\x7e]/g, "").slice(0, 80));
  }
  return { add: add, ignored: ignored };
}
export function shopcatOffAllow(env) { return SHOPCAT_OFF_TRUSTED.concat(shopcatOffAllowParse(env).add); }
/* the trusted suffix a link's host falls under ("" when none) */
function trustedSuffix(u, env) {
  const h = DOMAIN_RE.test(String(u || "")) ? String(u).toLowerCase().replace(/^www\./, "") : hostOf(u);
  return (h && shopcatOffAllow(env).filter((d) => h === d || h.slice(-(d.length + 1)) === "." + d)[0]) || "";
}
export function shopcatTrusted(u, env) { return !!trustedSuffix(u, env); }
function major(m) {
  const a = Number(m && m.amount), c = String((m && m.currency) || "").toUpperCase();
  if (!Number.isFinite(a) || a < 0 || !/^[A-Z]{3}$/.test(c)) return null;
  return { price: ZERO_DEC[c] ? Math.round(a) : Math.round(a) / 100, currency: c };
}
/* v213 (Matt wants the off-Shopify offers too): any https photo the catalog gives, Shopify's CDN first; the page loads it
   straight from its host, the worker never fetches, proxies or keeps one */
function img(list) {
  let any = "";
  for (const m of Array.isArray(list) ? list : []) {
    const u = m && (m.url || (m.preview && m.preview.url));
    if (!m || (m.type && m.type !== "image") || typeof u !== "string" || u.length > 600 || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(:\d+)?\/[^\s"'<>\\]*$/i.test(u)) continue;
    if (/^https:\/\/cdn\.shopify\.com\//.test(u)) return u;
    if (!any) any = u;
  }
  return any;
}
/* one product as a Prowl card: its first sale-ready variant (secondhand first, then a Shopify store's) with an https link.
   v213: off-Shopify offers (source "external", from a saved catalog with Off-Shopify ticked) are kept too, marked
   offShopify; a card needs a title, a price and an https photo. domain = the seller's domain (or the link's host). */
export function shopcatItem(p, env) {
  if (!p || typeof p.title !== "string" || !p.title.trim()) return null;
  const all = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && !(v.availability && v.availability.available === false) && hostOf(v.url));
  if (!all.length) return null;
  /* review fix: a product clusters offers from several stores; only Owl & Twig's own offers are skipped, the rest stay */
  let vs = all.filter((v) => { const s = v.seller || {}; return !shopcatOwn([v.url, s.url, s.domain], env); });
  if (!vs.length) return { own: true };
  const ext = (v) => v.source === "external";
  /* v213 "Known stores only": off-Shopify offers from a domain not on the trusted list are dropped; a product with
     nothing else left is { hidden, domain } (counted for Diagnose, never shown) */
  const known = vs.filter((v) => !ext(v) || shopcatTrusted(v.url, env));
  if (!known.length) return { hidden: true, domain: hostOf(vs[0].url) };
  vs = known;
  const sh = (v) => Array.isArray(v.condition) ? v.condition.indexOf("secondhand") !== -1 : v.condition === "secondhand";
  const v = vs.filter((x) => sh(x) && !ext(x))[0] || vs.filter(sh)[0] || vs.filter((x) => !ext(x))[0] || vs[0], s = v.seller || {};
  const pr = major(v.price) || major(p.price_range && p.price_range.min);
  const photo = img(p.media) || img(v.media);
  if (!pr || !photo) return null;
  const dom = String(s.domain || "").toLowerCase().replace(/^www\./, "");
  let domain = (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dom) ? dom : hostOf(s.url) || hostOf(v.url)).slice(0, 80);
  let name = String(s.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (ext(v)) {
    /* review fix: an off-Shopify card names the vetted link's host, never the catalog's unchecked seller.domain; the
       seller's name stays only when its domain sits under the same trusted suffix as the link */
    const lh = hostOf(v.url), suf = trustedSuffix(v.url, env);
    if (!(suf && (dom === suf || dom.slice(-(suf.length + 1)) === "." + suf))) name = "";
    domain = lh.slice(0, 80);
  }
  const out = { title: p.title.replace(/\s+/g, " ").trim().slice(0, 160), price: pr.price, currency: pr.currency,
    img: photo, shop: name || domain, domain: domain, url: String(v.url).slice(0, 800) };
  if (sh(v)) out.secondhand = true;
  if (ext(v)) out.offShopify = true;
  if (SHOPCAT_GID_RE.test(String(p.id || ""))) {
    out.pid = String(p.id);   /* v218: the popup's get_product asks for it */
    if (SHOPCAT_VID_RE.test(String(v.id || ""))) out.vid = String(v.id);   /* v218 review fix: and the card's own variant, so the popup shows that one */
  }
  /* review fix: the same listing from two searches differs in _gsid (and shclid / shcgid), so it is matched by product and
     variant, or by the link without its query, never by the full URL; the URL itself is returned as Shopify gave it */
  Object.defineProperty(out, "key", { value: (p.id && v.id ? String(p.id) + "|" + String(v.id) : String(v.url).split(/[?#]/)[0]), enumerable: false });
  return out;
}

/* v213: the latest search's mode for the Diagnose card (memory), and in KV shopcat:last when this isolate's mode changes
   (not on every search) */
async function noteSearch(env, mode, status, catalogId) {
  S.search = { at: Date.now(), mode: mode, status: Number(status) || 0, catalog: !!catalogId };
  const k = mode + ":" + (Number(status) || 0);   /* review fix: KV on a change of mode or status, not on every search */
  if (S.kvMode === k) return;
  S.kvMode = k;
  let rec = S.last;
  if (!rec && env && env.PROWL_ALERTS) { try { rec = await env.PROWL_ALERTS.get(SHOPCAT_LAST_KEY, "json"); } catch (e) { rec = null; } }
  rec = Object.assign({}, rec && typeof rec === "object" ? rec : {}, { search: S.search });
  if (S.last) S.last = rec;   /* a search-only record is not an exchange: S.last stays empty until one runs */
  try { if (env && env.PROWL_ALERTS) await env.PROWL_ALERTS.put(SHOPCAT_LAST_KEY, JSON.stringify(rec), { expirationTtl: 30 * 86400 }); } catch (e) {}
}

/* one catalog call: { products, mode } or { err, status, wait, mode }.
   v213: mode "token" (Authorization: Bearer) while the two secrets are set and the exchange works; "keyless" (no
   Authorization header, the agent profile alone) when they are missing, the exchange fails or is in its 5-minute wait,
   or Shopify refuses the token.
   Review fix: a token the catalog refuses puts the credentials in the same 5-minute wait as a failed exchange (S.failUntil,
   S.failFp), so the next passes and requests go straight to keyless with no exchange; only a token from memory (it may
   have been revoked) gets one fresh exchange first. Every catalog POST counts in SHOPCAT_PER_DAY (shopcat:all). */
async function search(env, D, term, profile, secondhand, deadline, catalogId) {
  const r = await catalogCall(env, D, shopcatBody(term, profile, secondhand, catalogId), deadline, { catalogId: catalogId });
  if (r.err) return r;
  return { products: Array.isArray(r.sc.products) ? r.sc.products : [], mode: r.mode };
}
/* v218: one JSON-RPC tools/call to the Global Catalog (search_catalog or get_product), with the token or keyless as above:
   { sc: result.structuredContent, mode } or { err, status, wait?, limit?, mode }. o.note false: not the Diagnose card's
   "Last search" (a popup's get_product is not a search). */
async function catalogCall(env, D, body, deadline, o) {
  const f = (D && D.fetch) || fetch, catalogId = o && o.catalogId;
  let mode = shopcatOn(env) && !shopcatTokenDown(Date.now(), env) ? "token" : "keyless", renewed = false;
  for (let tries = 0; tries < 3; tries++) {
    let tok = "", cached = false;
    if (D && typeof D.vCount === "function" && !(await D.vCount("shopcat:all", SHOPCAT_PER_DAY))) return { err: "daily limit", status: 429, limit: true, mode: mode };   /* before the exchange: a capped call never reaches Shopify */
    if (mode === "token") {
      const fp = shopcatFp(env);
      cached = !!S.tok && S.fp === fp && Date.now() < S.exp - SHOPCAT_TOKEN_EARLY_MS;
      try { tok = await shopcatToken(env, D, 0, deadline); } catch (e) { mode = "keyless"; }
    }
    const h = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": SHOPCAT_UA };
    if (tok) h["Authorization"] = "Bearer " + tok;
    const r = await timed(f, SHOPCAT_MCP_URL, { method: "POST", headers: h, body: JSON.stringify(body) }, deadline);
    if (r.status === 401 && tok) {
      S.tok = ""; S.exp = 0;
      if (cached && !renewed) { renewed = true; continue; }   /* a token from memory Shopify no longer takes: one fresh one */
      const now = Date.now();
      S.failUntil = now + SHOPCAT_TOKEN_FAIL_MS; S.failFp = shopcatFp(env);
      await record(env, { at: now, ok: false, refused: true, status: 401, error: "catalog refused the token", desc: "The token exchange worked, but catalog.shopify.com answered 401 to the token; searching keyless until the wait ends.",
        method: S.method, tried: [], attempts: [] });
      mode = "keyless"; continue;
    }
    if (!(o && o.note === false)) await noteSearch(env, mode, r.status, catalogId);
    if (r.status === 429) {
      const ra = Number((r.headers && r.headers.get && r.headers.get("Retry-After")) || 0);
      return { err: "busy", status: 429, wait: Math.min(SHOPCAT_BUSY_MAX_S, ra > 0 ? ra : 30), mode: mode };
    }
    if (r.status !== 200) return { err: "shopify " + r.status, status: r.status, mode: mode };
    const j = r.j;
    if (!j) return { err: "unreadable", status: 502, mode: mode };
    if (j.error) return { err: "shopify error", status: 502, mode: mode };
    const sc = j && j.result && j.result.structuredContent;
    if (!sc || (j.result && j.result.isError)) return { err: "shopify error", status: 502, mode: mode };
    return { sc: sc, mode: mode };
  }
  return { err: "auth", status: 401, mode: mode };
}
const stops = (r) => r.status === 429 || r.err === "timeout" || r.err === "daily limit";   /* a 429, the deadline or the day's cap */

export async function shopLive(request, env, url, origin, D, nowMs) {
  const now = Number(nowMs) || Date.now(), NS = { "Cache-Control": "no-store" };
  const out = (body, status) => D.json(body, status || 200, origin, NS);
  const term = shopcatTerm(url.searchParams.get("term") || url.searchParams.get("q"));
  if (term.replace(/[^a-z0-9À-￿]/gi, "").length < 2) return out({ on: true, error: "term required", items: [] }, 400);
  const mx = Math.floor(Number(url.searchParams.get("max")));
  const max = mx >= 1 ? Math.min(SHOPCAT_MAX, mx) : SHOPCAT_MAX;
  if (S.busyUntil > now) return out({ on: true, term: term, error: "busy", items: [] }, 429);
  if (!(await D.vCount("shopcat:" + D.ipKey(request.headers.get("CF-Connecting-IP")), SHOPCAT_PER_IP))) return out({ on: true, term: term, error: "slow down", items: [] }, 429);
  const profile = shopcatProfileUrl(env, url.origin);
  const t0 = Date.now(), deadline = t0 + SHOPCAT_DEADLINE_MS;   /* review fix: the whole request, token and both searches */
  const items = [], seen = Object.create(null);
  const fail = (r) => r.limit ? out({ on: true, term: term, error: "daily limit", items: [] }, 429)
    : out({ on: true, term: term, mode: mode || undefined, error: r.err, items: [] }, r.status === 429 ? 429 : r.status === 503 ? 503 : 502);
  let raw = 0, words = 0, own = 0, hidden = 0, mode = "", failed = null, ran = 0;
  /* v213: with a saved catalog (its own limit, Off-Shopify offers too) first, then the whole Global Catalog when that
     leaves fewer than max: secondhand, then any condition */
  const cid = shopcatCatalogId(env);
  const passes = (cid ? [{ secondhand: true, cid: cid }] : []).concat([{ secondhand: true, cid: "" }, { secondhand: false, cid: "" }]);
  for (let i = 0; i < passes.length; i++) {
    const secondhand = passes[i].secondhand;
    if (i && (items.length >= max || Date.now() - t0 > SHOPCAT_SECOND_PASS_MS)) break;
    let r;
    try { r = await search(env, D, term, profile, secondhand, deadline, passes[i].cid); } catch (e) { r = { err: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable", status: 504 }; }
    if (r.mode) mode = r.mode;
    if (r.err) {
      if (r.status === 429 && !r.limit) S.busyUntil = now + r.wait * 1000;
      /* review fix: the optional saved-catalog pass failing (a refused or deleted catalog id) falls back to the whole
         Global Catalog; only a 429, the deadline or the day's cap stops the hunt there */
      if (passes[i].cid && !stops(r) && Date.now() < deadline) { failed = r; continue; }
      if (!items.length) return fail(r);
      break;   /* the listings already found are still worth showing */
    }
    ran++;
    const cards = [];
    for (const p of r.products) { const c = shopcatItem(p, env); if (c && c.hidden) { hidden++; continue; } raw++; if (!c) continue; if (c.own) { own++; continue; } cards.push(c); }
    const kept = D.sgwExact(cards, term) || [];
    words += kept.length;
    for (const c of kept) { const k = c.key || c.url; if (seen[k] || items.length >= max) continue; seen[k] = 1; items.push(c); }
  }
  if (!ran && failed) return fail(failed);   /* the catalog pass failed and no fallback pass ran */
  items.sort((a, b) => (b.secondhand ? 1 : 0) - (a.secondhand ? 1 : 0));   /* stable: secondhand first, Shopify's order within */
  const body = { on: true, term: term, mode: mode, items: items };
  if (!items.length) { body.why = { raw: raw, words: words, own: own }; if (hidden) body.why.hidden = hidden; }   /* v213: raw leaves out the off-Shopify offers hidden as unknown stores */
  return out(body, 200);
}

/* ---------- v218: a Shopify find's listing popup (GET /item?shop=<gid>&url=<the card's link>) ----------
   Matt (2026-11-01): "when i open a shopify shop, is it possible to do the pop up like the others? it currently goes
   directly to the shop." The page sends the product's Global Catalog id (pid, from search_catalog) and the card's own link;
   one JSON-RPC tools/call get_product (shopify.dev/docs/agents/catalog/global-catalog: catalog.id is
   gid://shopify/p/<upid> or gid://shopify/ProductVariant/<id>; the same endpoint, profile, token or keyless as the search)
   gives the photos, the description, the options and every store's offer in the product's cluster; the offer from the
   card's store is the one shown.
   Probed live (keyless, our profile, 2026-11-01): 200 with result.structuredContent.product { id, title, description
   { plain | html } (plain can carry the seller's HTML), handle, media[] { type, url, alt_text, width, height }, metadata
   (inferred: not shown), variants[] { id, title, url, price, list_price?, availability, media, seller, checkout_url,
   condition[], source }, price_range, options?, selected }; an unknown id is 200 with ucp.status "error" and
   messages[{ code: "not_found" }].
   Shopify's rules: no caching of catalog results or images, so this is Cache-Control: no-store, never the 1-day
   /item cache in index.js, never KV; the photos load in the browser straight from their hosts. Counted like a search: the IP's
   SHOPCAT_PER_IP, the site's SHOPCAT_PER_DAY (shopcat:all), and as a shopcat call in spend.js (the global fetch wrap). */
export const SHOPCAT_GID_RE = /^gid:\/\/shopify\/(?:p\/[A-Za-z0-9]{6,40}|ProductVariant\/\d{1,20})$/;
export const SHOPCAT_VID_RE = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;
export const SHOPCAT_ITEM_IMAGES = 12;
export function shopcatProductBody(gid, profile) {
  return { jsonrpc: "2.0", method: "tools/call", id: 1, params: { name: "get_product", arguments: {
    meta: { "ucp-agent": { profile: profile } }, catalog: { id: String(gid), context: { address_country: "US", language: "en", currency: "USD" } } } } };
}
function fmtMoney(m) {
  const x = major(m);
  if (!x) return "";
  const n = x.price, s = (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return x.currency === "USD" ? "$" + s : s + " " + x.currency;
}
function photos(lists) {
  const out = [];
  for (const list of lists) for (const m of Array.isArray(list) ? list : []) {
    const u = img([m]);
    if (u && out.indexOf(u) === -1) out.push(u);
    if (out.length >= SHOPCAT_ITEM_IMAGES) return out;
  }
  return out;
}
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const txt = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
/* the card's link against an offer's: the same variant (review fix: one store's sizes share a path and differ only in
   ?variant=), else the same host and path (the query differs per search: _gsid), else the same host */
function linkKey(u) { try { const x = new URL(String(u || "")); return x.hostname.toLowerCase().replace(/^www\./, "") + x.pathname.replace(/\/+$/, ""); } catch (e) { return ""; } }
function linkVariant(u) { try { const n = new URL(String(u || "")).searchParams.get("variant") || ""; return /^\d{1,20}$/.test(n) ? n : ""; } catch (e) { return ""; } }
const vidNum = (id) => { const m = /^gid:\/\/shopify\/ProductVariant\/(\d{1,20})$/.exec(String(id || "")); return m ? m[1] : ""; };
/* get_product's structuredContent -> the popup's item: { title, price, was?, images, description, condition, aspects,
   shop, domain, offShopify?, gone?, elsewhere? } or { gone } / { error }. D.itemDesc (index.js) strips seller HTML to the
   popup's tags. The link is never rewritten: the page keeps the card's own. vid = the card's variant gid (/shop-live's
   vid), else the card link's ?variant= is used. */
export function shopcatProduct(sc, cardUrl, env, D, vid) {
  const p = sc && sc.product;
  const msgs = sc && Array.isArray(sc.messages) ? sc.messages : [];
  if (!p || typeof p !== "object") {
    if (msgs.some((m) => m && m.code === "not_found")) return { gone: true };
    return { error: "shopify " + txt((msgs[0] && msgs[0].code) || "no product", 40) };
  }
  const title = txt(p.title, 200);
  if (!title) return { error: "shopify no title" };
  const vs = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && hostOf(v.url) && !shopcatOwn([v.url, v.seller && v.seller.url, v.seller && v.seller.domain], env));
  const want = linkKey(cardUrl), wh = hostOf(cardUrl);
  const wv = vidNum(vid) || linkVariant(cardUrl);
  const v = (wv && vs.filter((x) => vidNum(x.id) === wv || linkVariant(x.url) === wv)[0]) || vs.filter((x) => want && linkKey(x.url) === want)[0] ||
    vs.filter((x) => wh && hostOf(x.url) === wh)[0] || null;
  const ext = v && v.source === "external";
  const out = { title: title, price: "", images: photos([p.media, v && v.media]), description: "", condition: "", aspects: [], shop: "", domain: "" };
  if (v) {
    out.price = fmtMoney(v.price);
    const was = fmtMoney(v.list_price);
    if (was && major(v.price) && major(v.list_price).price > major(v.price).price) out.was = was;
    const c = Array.isArray(v.condition) ? v.condition : [v.condition];
    out.condition = c.indexOf("secondhand") !== -1 ? "Used" : c.indexOf("new") !== -1 ? "New" : "";
    const s = v.seller || {}, dom = String(s.domain || "").toLowerCase().replace(/^www\./, "");
    /* the store's own web address (not its myshopify name) when it gives one; an off-Shopify offer names the link's host,
       never the catalog's unchecked seller (as shopcatItem) */
    out.domain = (ext ? hostOf(v.url) : hostOf(s.url) || (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dom) ? dom : "") || hostOf(v.url)).slice(0, 80);
    out.shop = (ext ? "" : txt(s.name, 60)) || out.domain;
    if (ext) out.offShopify = true;
    if (v.availability && v.availability.available === false) out.gone = true;
  } else if (!vs.length && want) out.gone = true;   /* nothing left for sale from anyone */
  /* review fix: the card's store no longer in the cluster: no price from another store (the page keeps the card's own);
     Shopify's lowest goes out as elsewhere, which the page labels "from $X elsewhere" */
  if (!v && vs.length) { const e = fmtMoney(p.price_range && p.price_range.min); if (e) out.elsewhere = e; }
  const d = p.description || {}, raw = typeof d.html === "string" ? d.html : typeof d.plain === "string" ? d.plain : "";
  const html = /<[a-z][^>]*>/i.test(raw) ? raw : esc(raw).replace(/\r?\n/g, "<br>");   /* "plain" can carry the seller's HTML */
  out.description = D && typeof D.itemDesc === "function" ? D.itemDesc(html) : esc(raw.replace(/<[^>]*>/g, " ")).slice(0, 20000);
  /* the options: each with its values, the sold-out ones said so; at most 4 options, 12 values each */
  for (const o of (Array.isArray(p.options) ? p.options : []).slice(0, 4)) {
    const n = txt(o && o.name, 40), vals = (Array.isArray(o && o.values) ? o.values : []).filter((x) => x && x.exists !== false && txt(x.label, 40));
    if (!n || !vals.length || (vals.length === 1 && /^default/i.test(String(vals[0].label)))) continue;
    const on = vals.filter((x) => x.available !== false).map((x) => txt(x.label, 40)), off = vals.filter((x) => x.available === false).map((x) => txt(x.label, 40));
    out.aspects.push({ n: n, v: (on.slice(0, 12).join(", ") + (off.length ? (on.length ? " (" : "(") + off.slice(0, 12).join(", ") + " sold out)" : "")).slice(0, 200) });
  }
  if (v && Array.isArray(v.options)) {
    const sel = v.options.filter((x) => x && txt(x.name, 40) && txt(x.label, 40) && !/^default/i.test(String(x.label))).map((x) => txt(x.name, 40) + " " + txt(x.label, 40));
    if (sel.length) out.aspects.push({ n: "This one", v: sel.join(", ").slice(0, 200) });
  }
  if (out.shop) out.aspects.push({ n: "Shop", v: out.shop });
  if (out.domain && out.domain !== String(out.shop).toLowerCase()) out.aspects.push({ n: "Website", v: out.domain });
  return out;
}
export async function shopItem(request, env, url, origin, D) {
  const NS = { "Cache-Control": "no-store" }, out = (b, st) => D.json(b, st || 200, origin, NS);
  const gid = String(url.searchParams.get("shop") || ""), cardUrl = String(url.searchParams.get("url") || ""), vid = String(url.searchParams.get("vid") || "");
  if (!SHOPCAT_GID_RE.test(gid) || (vid && !SHOPCAT_VID_RE.test(vid))) return out({ error: "not a listing Prowl can open" }, 400);
  if (cardUrl && (!hostOf(cardUrl) || cardUrl.length > 800)) return out({ error: "not a listing Prowl can open" }, 400);
  if (S.busyUntil > Date.now()) return out({ error: "busy", src: "shopify" }, 429);
  if (!(await D.vCount("shopcat:" + D.ipKey(request.headers.get("CF-Connecting-IP")), SHOPCAT_PER_IP))) return out({ error: "slow down", src: "shopify" }, 429);
  let r;
  try { r = await catalogCall(env, D, shopcatProductBody(gid, shopcatProfileUrl(env, url.origin)), Date.now() + SHOPCAT_DEADLINE_MS, { note: false }); }
  catch (e) { r = { err: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable", status: 504 }; }
  if (r.err) {
    if (r.status === 429 && !r.limit) S.busyUntil = Date.now() + r.wait * 1000;
    console.error("item shopify", r.err);
    return out({ error: r.limit ? "daily limit" : r.status === 429 ? "busy" : r.err, src: "shopify" }, r.status === 429 ? 429 : 502);
  }
  const it = shopcatProduct(r.sc, cardUrl, env, D, vid);
  if (it.error) { console.error("item shopify", it.error); return out({ error: it.error, src: "shopify" }, 502); }
  return out(Object.assign({ src: "shopify", id: gid, mode: r.mode }, it), 200);
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
    status: Number(a.status) || 0, error: shopcatScrub(a.error, env, 60), desc: shopcatScrub(a.desc, env, 200),
    server: String(a.server || "").replace(/[^A-Za-z0-9 ._\/-]/g, "").slice(0, 40), ray: !!a.ray }));
}
export async function shopcatStatus(env, nowMs) {
  const now = Number(nowMs) || Date.now();
  let last = shopcatLast();
  if (!last && env && env.PROWL_ALERTS) { try { last = await env.PROWL_ALERTS.get(SHOPCAT_LAST_KEY, "json"); } catch (e) { last = null; } }
  const L0 = last && typeof last === "object" ? last : null, L = L0 && Number(L0.at) > 0 ? L0 : null;   /* v213: a search-only record has no exchange */
  const sx = S.search || (L0 && L0.search && typeof L0.search === "object" ? L0.search : null);
  return { on: shopcatOn(env), shape: shopcatShape(env), method: S.method || (L && L.ok ? String(L.method || "") : ""),
    offAllow: shopcatOffAllowParse(env),   /* review fix: the SHOPCAT_OFF_ALLOW hosts in use and the entries ignored */
    catalogId: shopcatCatalogId(env),   /* v213: not a secret (the Dev Dashboard shows it; it only names a saved search) */
    search: sx ? { at: Number(sx.at) || 0, mode: sx.mode === "token" ? "token" : "keyless", status: Number(sx.status) || 0, catalog: !!sx.catalog } : null,
    waitUntil: shopcatTokenDown(now, env) ? S.failUntil : 0, busyUntil: S.busyUntil > now ? S.busyUntil : 0,
    last: L ? { at: Number(L.at) || 0, ok: !!L.ok, status: Number(L.status) || 0, error: shopcatScrub(L.error, env, 60), desc: shopcatScrub(L.desc, env, 200),
      method: String(L.method || "").replace(/[^a-z]/g, "").slice(0, 8), tried: (Array.isArray(L.tried) ? L.tried : []).map((m) => String(m).replace(/[^a-z]/g, "").slice(0, 8)).slice(0, 2),
      attempts: shopcatAttempts(L.attempts, env) } : null };
}
export async function shopcatTest(env, D, term, origin, nowMs) {
  const now = Number(nowMs) || Date.now(), q = shopcatTerm(term) || "pyrex";
  /* v213: without the secrets, or when the exchange fails, the test search runs keyless (as /shop-live does) */
  const on = shopcatOn(env), deadline = Date.now() + SHOPCAT_DEADLINE_MS, f = (D && D.fetch) || fetch, cid = shopcatCatalogId(env);
  let tok = "", exchange = null;
  if (on) {
    try { tok = await shopcatToken(env, D, now, deadline, true); } catch (e) {}
    const ex = shopcatLast() || { ok: !!tok, status: tok ? 200 : 0, error: "", desc: "", method: S.method, tried: [], attempts: [] };
    exchange = { ok: !!tok, at: ex.at || now, status: ex.status, error: ex.error, desc: ex.desc, method: ex.method, tried: ex.tried || [], attempts: shopcatAttempts(ex.attempts, env) };
  }
  const mode = tok ? "token" : "keyless";
  if (D && typeof D.vCount === "function" && !(await D.vCount("shopcat:all", SHOPCAT_PER_DAY))) return { on: on, term: q, exchange: exchange, search: { ok: false, mode: mode, status: 429, error: "daily limit" } };
  const h = { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": SHOPCAT_UA };
  if (tok) h["Authorization"] = "Bearer " + tok;
  let r;
  try {
    r = await timed(f, SHOPCAT_MCP_URL, { method: "POST", headers: h, body: JSON.stringify(shopcatBody(q, shopcatProfileUrl(env, origin), false, cid)) }, deadline, true);
  } catch (e) { return { on: on, term: q, exchange: exchange, search: { ok: false, mode: mode, status: 0, error: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable" } }; }
  await noteSearch(env, mode, r.status, cid);
  const j = r.j, out = { ok: false, mode: mode, catalog: !!cid, status: r.status };
  if (j && j.error) out.rpc = { code: Number(j.error.code) || 0, message: shopcatScrub(j.error.message, env, 300), data: j.error.data == null ? "" : shopcatScrub(typeof j.error.data === "string" ? j.error.data : JSON.stringify(j.error.data), env, 300) };
  else if (j && j.result && j.result.isError) out.rpc = { code: 0, message: shopcatScrub((Array.isArray(j.result.content) ? j.result.content : []).map((x) => x && x.text).filter(Boolean).join(" ") || "tool error", env, 300), data: "" };
  else if (r.status !== 200) {
    out.error = (j ? shopcatScrub(j.error_description || j.message || j.error, env, 200) : shopcatSnippet(r.text, env)) || "answered " + r.status;
    const eg = edge(r.headers); out.server = eg.server; out.ray = eg.ray;   /* v213 */
  }
  else {
    const sc = j && j.result && j.result.structuredContent, ps = sc && Array.isArray(sc.products) ? sc.products : null;
    if (!ps) out.error = "no products in the answer";
    else {
      /* v213 "Known stores only": the off-Shopify items hidden as unknown stores, with their domains, so Matt sees what is
         filtered; the sample titles are from what a hunt would show */
      let shown = [], doms = [];
      let hid = 0;
      for (const p of ps) {
        const c = shopcatItem(p, env);
        if (c && c.hidden) { hid++; const d = String(c.domain || "").slice(0, 80); if (d && doms.indexOf(d) === -1 && doms.length < 20) doms.push(d); continue; }
        if (c && !c.own) shown.push(c);   /* review fix: only cards a hunt would show (not Owl & Twig's own, not a photo-less or price-less listing) */
      }
      if (D && typeof D.sgwExact === "function") shown = D.sgwExact(shown, q) || [];   /* and with every word of the term, as a hunt keeps them */
      out.ok = true; out.count = ps.length; if (hid) out.hidden = { count: hid, domains: doms };
      out.titles = shown.slice(0, 3).map((c) => String((c && c.title) || "").replace(/\s+/g, " ").trim().slice(0, 120));
    }
  }
  return { on: on, term: q, exchange: exchange, search: out };
}
