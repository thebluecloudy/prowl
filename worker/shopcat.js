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
     even a short cache: every answer is no-store), "Don't cache or re-use images" (the page loads them straight from
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

/* in this isolate only: the token, and how long Shopify asked us to wait after a 429 */
const S = { tok: "", exp: 0, id: "", p: null, busyUntil: 0 };
export function shopcatReset() { S.tok = ""; S.exp = 0; S.id = ""; S.p = null; S.busyUntil = 0; }

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
async function timed(f, url, init) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), SHOPCAT_TIMEOUT_MS);
  try { return await f(url, Object.assign({}, init, { signal: ctl.signal })); } finally { clearTimeout(timer); }
}

/* the bearer token, from memory while it has more than a minute left; one exchange at a time per isolate */
export async function shopcatToken(env, D, nowMs) {
  const f = (D && D.fetch) || fetch, now = Number(nowMs) || Date.now(), id = String(env.SHOPIFY_CATALOG_CLIENT_ID || "").trim();
  if (S.tok && S.id === id && now < S.exp - SHOPCAT_TOKEN_EARLY_MS) return S.tok;
  if (S.p) return S.p;
  S.p = (async () => {
    const r = await timed(f, SHOPCAT_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ client_id: id, client_secret: String(env.SHOPIFY_CATALOG_CLIENT_SECRET || "").trim(), grant_type: "client_credentials" }) });
    if (!r || r.status !== 200) throw new Error("token " + (r ? r.status : "none"));
    const j = await r.json();
    const t = j && typeof j.access_token === "string" ? j.access_token : "";
    if (!t) throw new Error("token missing");
    const said = Number(j.expires_in) > 0 ? now + Number(j.expires_in) * 1000 : jwtExp(t);
    S.tok = t; S.id = id; S.exp = Math.min(said > now ? said : now + SHOPCAT_TOKEN_TTL_MS, now + SHOPCAT_TOKEN_TTL_MS);
    return t;
  })();
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
  const vs = (Array.isArray(p.variants) ? p.variants : []).filter((v) => v && (!v.source || v.source === "shopify") && !(v.availability && v.availability.available === false) && hostOf(v.url));
  if (!vs.length) return null;
  const sh = (v) => Array.isArray(v.condition) ? v.condition.indexOf("secondhand") !== -1 : v.condition === "secondhand";
  const v = vs.filter(sh)[0] || vs[0], s = v.seller || {};
  if (shopcatOwn([v.url, s.url, s.domain], env)) return { own: true };
  const pr = major(v.price) || major(p.price_range && p.price_range.min);
  const out = { title: p.title.replace(/\s+/g, " ").trim().slice(0, 160), price: pr ? pr.price : null, currency: pr ? pr.currency : "",
    img: img(p.media) || img(v.media), shop: String(s.name || "").replace(/\s+/g, " ").trim().slice(0, 60) || hostOf(s.url || v.url), url: String(v.url).slice(0, 800) };
  if (sh(v)) out.secondhand = true;
  return out;
}

/* one catalog call: { products } or { err, status, wait } */
async function search(env, D, term, profile, secondhand) {
  const f = (D && D.fetch) || fetch;
  for (let tries = 0; tries < 2; tries++) {
    const tok = await shopcatToken(env, D);
    const r = await timed(f, SHOPCAT_MCP_URL, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(shopcatBody(term, profile, secondhand)) });
    if (r.status === 401 && tries === 0) { S.tok = ""; S.exp = 0; continue; }   /* a token Shopify no longer takes: one fresh one */
    if (r.status === 429) {
      const ra = Number((r.headers && r.headers.get && r.headers.get("Retry-After")) || 0);
      return { err: "busy", status: 429, wait: Math.min(SHOPCAT_BUSY_MAX_S, ra > 0 ? ra : 30) };
    }
    if (r.status !== 200) return { err: "shopify " + r.status, status: r.status };
    let j = null;
    try { j = await r.json(); } catch (e) { return { err: "unreadable" }; }
    if (j && j.error) return { err: "shopify error", status: 502 };
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
  if (!(await D.vCount("shopcat:" + D.ipKey(request.headers.get("CF-Connecting-IP")), SHOPCAT_PER_IP))) return out({ on: true, term: term, error: "slow down", items: [] }, 429);
  const profile = shopcatProfileUrl(env, url.origin);
  const items = [], seen = Object.create(null);
  let raw = 0, words = 0, own = 0;
  for (const secondhand of [true, false]) {
    if (!secondhand && items.length >= max) break;
    if (!(await D.vCount("shopcat:all", SHOPCAT_PER_DAY))) { if (secondhand) return out({ on: true, term: term, error: "daily limit", items: [] }, 429); break; }
    let r;
    try { r = await search(env, D, term, profile, secondhand); } catch (e) { r = { err: /abort/i.test(String(e && (e.name || e.message))) ? "timeout" : "unreachable", status: 504 }; }
    if (r.err) {
      if (r.status === 429) S.busyUntil = now + r.wait * 1000;
      if (secondhand || !items.length) return out({ on: true, term: term, error: r.err, items: [] }, r.status === 429 ? 429 : 502);
      break;   /* the secondhand listings already found are still worth showing */
    }
    raw += r.products.length;
    const cards = [];
    for (const p of r.products) { const c = shopcatItem(p, env); if (!c) continue; if (c.own) { own++; continue; } cards.push(c); }
    const kept = D.sgwExact(cards, term) || [];
    words += kept.length;
    for (const c of kept) { if (seen[c.url] || items.length >= max) continue; seen[c.url] = 1; items.push(c); }
  }
  items.sort((a, b) => (b.secondhand ? 1 : 0) - (a.secondhand ? 1 : 0));   /* stable: secondhand first, Shopify's order within */
  const body = { on: true, term: term, items: items };
  if (!items.length) body.why = { raw: raw, words: words, own: own };
  return out(body, 200);
}
