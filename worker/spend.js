/* ---------- v193: what Prowl spends (the admin's Spending tab) ----------
   Matt: "can we add how much i am spending in the ai, muse, jev, google, etc into the admin section?"
   Every call to a paid service goes through index.js paidFetch, which counts it here (and, for Muse, the tokens and
   web searches its answer reports). Counts are summed in this isolate and sent to the "spend" Caps object at the end
   of the request (or the cron run), one row per UTC day and service, kept SPEND_KEEP_DAYS. The admin turns them into
   an estimate with the prices in KV (spend:cfg), which start from the list prices below and which Matt can edit, and
   adds the monthly bills he types in (Shopify, Cloudflare, his Claude plan...). An estimate: the month columns take off
   Google's free monthly allowance per SKU, Today and 7 days do not; the real bill is on each provider's billing page.
   Nothing personal is kept: a day, a service key and four numbers. No imports: index.js and admin.js both use it. */

export const SPEND_KEEP_DAYS = 400;
export const SPEND_CFG_KEY = "spend:cfg";
export const SPEND_FIXED_MAX = 12;
const PRICES_CHECKED = "2026-10-30";   /* Google: Matt's billing account price list, exported that day */

/* The paid services. price: $ per 1,000 calls (call), per 1M input / output tokens (tin / tout), per 1,000 web searches
   (ws). null = no published per-unit price found; the admin asks for the one on the bill. free = calls a month Google
   bills nothing for (per SKU, from Matt's billing account's price list, 2026-10-30): taken off the month columns. src says where each list
   price came from (third-party when the provider prints none). Google SKUs follow the field mask Prowl sends: Text and
   Nearby Search ask for editorialSummary (Atmosphere) and opening hours (Enterprise). */
export const SPEND_SERVICES = [
  { key: "muse", name: "Muse (Meta Muse Spark): Fair price, Research, Field Guides, Pounce, shop picks", uses: ["tin", "tout", "ws"],
    price: { tin: 1.25, tout: 4.25, ws: 2.5 }, src: "https://openrouter.ai/meta/muse-spark-1.1",
    srcNote: "third-party listing; Meta prints no price. Reasoning tokens bill as output.", bill: "https://developers.meta.ai" },
  { key: "jev", name: "Jev (TypeSafe): AI sorting, hunt checks, photo looks", uses: ["tin"],
    price: { tin: 0.04 }, src: "https://typesafe.ai",
    srcNote: "TypeSafe's own model page (\"From $0.04 per 1M\" input, v194); output is free. Input tokens are estimated (4 characters a token) unless TypeSafe reports them; picture calls count as calls only.",
    bill: "https://typesafe.ai" },
  { key: "g_text", name: "Google Places Text Search (Enterprise + Atmosphere)", uses: ["call"], price: { call: 40 }, free: 1000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU 120C-BEC3-B48F)", bill: "https://console.cloud.google.com/billing" },
  { key: "g_nearby", name: "Google Places Nearby Search (Enterprise + Atmosphere)", uses: ["call"], price: { call: 40 }, free: 1000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "from Matt's Google billing price list (SKU F20E-7034-0EF7)", bill: "https://console.cloud.google.com/billing" },
  { key: "g_hours", name: "Google Place Details: opening hours (Enterprise)", uses: ["call"], price: { call: 20 }, free: 1000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU 2D9A-3DE0-3766)", bill: "https://console.cloud.google.com/billing" },
  { key: "g_reviews", name: "Google Place Details: reviews (Enterprise + Atmosphere)", uses: ["call"], price: { call: 25 }, free: 1000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU EB23-5ECC-F753)", bill: "https://console.cloud.google.com/billing" },
  { key: "g_photo", name: "Google Place Photos", uses: ["call"], price: { call: 7 }, free: 1000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU DCD1-FE97-8C71); cache hits are not counted", bill: "https://console.cloud.google.com/billing" },
  { key: "g_suggest", name: "Google Places Autocomplete (typing a place)", uses: ["call"], price: { call: 2.83 }, free: 10000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU 4EF4-B17C-B31A)", bill: "https://console.cloud.google.com/billing" },
  { key: "g_geo", name: "Google Geocoding (town lookups)", uses: ["call"], price: { call: 5 }, free: 10000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU BAC8-4E68-E261)", bill: "https://console.cloud.google.com/billing" },
  { key: "g_route", name: "Google Routes: driving routes (Road trip, Essentials)", uses: ["call"], price: { call: 5 }, free: 10000,
    src: "https://developers.google.com/maps/billing-and-pricing/pricing", srcNote: "matches Matt's Google billing price list (SKU 9EFF-679A-9B16); traffic-unaware, 3 stops at most", bill: "https://console.cloud.google.com/billing" },
  { key: "g_vision", name: "Google Cloud Vision web detection (Photo check)", uses: ["call"], price: { call: 3.5 }, free: 1000,
    src: "https://cloud.google.com/vision/pricing", srcNote: "matches Matt's Google billing price list (SKU D89F-B380-AE61)", bill: "https://console.cloud.google.com/billing" },
  { key: "lens", name: "Google Lens through SerpApi", uses: ["call"], price: { call: null },
    src: "https://serpapi.com/pricing", srcNote: "billed by monthly plan (free plan: 250 a month); add a paid plan under monthly bills", bill: "https://serpapi.com/dashboard" }
];
export const SPEND_KEYS = SPEND_SERVICES.map(s => s.key);
const KNOWN = new Set(SPEND_KEYS);
const FIELDS = ["n", "ti", "to", "ws"];
const PRICE_FIELDS = ["call", "tin", "tout", "ws"];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const int = (v, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, hi) : 0; };
export function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

/* ---------- worker-side buffer ---------- */
export class SpendBuffer {
  constructor() { this.b = {}; this.count = 0; }
  /* f: { n, ti, to, ws }; n defaults to 1 call */
  tick(key, f, nowMs) {
    if (!KNOWN.has(key)) return;
    const o = f || {}, k = dayOf(nowMs || Date.now()) + "|" + key, row = this.b[k] || (this.b[k] = { n: 0, ti: 0, to: 0, ws: 0 });
    row.n += o.n == null ? 1 : int(o.n, 1e6);
    row.ti += int(o.ti, 1e9); row.to += int(o.to, 1e9); row.ws += int(o.ws, 1e6);
    this.count++;
  }
  drain() {
    if (!this.count) return null;
    const rows = this.b;
    this.b = {}; this.count = 0;
    return { rows: rows };
  }
}

/* Muse answers say what they used: the Responses API as usage.input_tokens / output_tokens and one output item per web
   search; the chat API as usage.prompt_tokens / completion_tokens. Anything missing counts 0. */
export function museUsage(j) {
  const u = (j && j.usage) || {}, out = Array.isArray(j && j.output) ? j.output : [];
  return { ti: int(u.input_tokens != null ? u.input_tokens : u.prompt_tokens, 1e9), to: int(u.output_tokens != null ? u.output_tokens : u.completion_tokens, 1e9),
    ws: out.filter(x => x && x.type === "web_search_call").length };
}
/* Jev: TypeSafe's own count when it gives one, else about 4 characters a token of what was sent (a picture upload is
   FormData, not text, so 0). */
export function jevUsage(j, body) {
  const u = (j && j.usage) || {}, said = u.input_tokens != null ? u.input_tokens : u.prompt_tokens;
  if (said != null) return { ti: int(said, 1e9) };
  return { ti: typeof body === "string" ? Math.ceil(body.length / 4) : 0 };
}
/* Which Google SKU a call through gFetch bills, from its address and field mask */
export function googleSku(url, mask) {
  const u = String(url || ""), m = String(mask || "");
  if (u.indexOf("maps.googleapis.com/maps/api/geocode/") >= 0) return "g_geo";
  if (u.indexOf("routes.googleapis.com/") >= 0) return "g_route";
  if (u.indexOf("/places:searchText") >= 0) return "g_text";
  if (u.indexOf("/places:searchNearby") >= 0) return "g_nearby";
  if (u.indexOf("/places:autocomplete") >= 0) return "g_suggest";
  if (/\/media(\?|$)/.test(u)) return "g_photo";
  if (u.indexOf("places.googleapis.com/v1/places/") >= 0) return /(^|,)reviews(,|$)/.test(m) ? "g_reviews" : "g_hours";
  return "";
}

/* Which paid service an outgoing request is, by its address (and, for Google Places, its field mask); "" = not paid */
export function paidKey(url, init) {
  let u;
  try { u = new URL(String(url)); } catch (e) { return ""; }
  if (u.protocol !== "https:") return "";
  const h = u.hostname;
  if (h === "api.meta.ai") return "muse";
  if (h === "api.typesafe.ai") return "jev";
  if (h === "serpapi.com" && u.pathname === "/search.json") return "lens";
  if (h === "vision.googleapis.com") return "g_vision";
  if (h === "places.googleapis.com" || h === "routes.googleapis.com" || (h === "maps.googleapis.com" && u.pathname.indexOf("/maps/api/geocode/") === 0)) {
    const hd = init && init.headers, mask = !hd ? "" : typeof hd.get === "function" ? hd.get("X-Goog-FieldMask") : (hd["X-Goog-FieldMask"] || hd["x-goog-fieldmask"] || "");
    return googleSku(u.href, mask || "");
  }
  return "";
}
/* The wrapped fetch: answers exactly as fetch does, and counts a paid call once it has an answer (a call that threw
   before any answer is not counted; a Cloudflare cache hit, as for Place Photos, is free). Muse and Jev answers are read
   from a copy for the tokens they report; the caller reads the original. Counting never breaks the call. */
export function spendWrap(f, buf) {
  const w = async function (input, init) {
    const url = input && typeof input === "object" && "url" in input ? input.url : input;
    const key = paidKey(url, init || (input && typeof input === "object" ? input : null));
    const r = await f(input, init);
    if (!key) return r;
    try {
      if (String((r && r.headers && r.headers.get && r.headers.get("cf-cache-status")) || "").toUpperCase() === "HIT") return r;
      let fields = null;
      if (key === "muse" || key === "jev") {
        let j = null;
        try { if (r.ok && typeof r.clone === "function") j = await r.clone().json(); } catch (e) {}
        fields = key === "muse" ? museUsage(j) : jevUsage(j, init && init.body);
      }
      buf.tick(key, fields);
    } catch (e) {}
    return r;
  };
  w.__prowlSpend = true;
  return w;
}

/* ---------- Durable Object side (the "spend" Caps object) ----------
   w:<day>|<key> = { n, ti, to, ws }. Caps' own alarm clears c: v: s: n: m:, never w:; this prunes itself, once a day,
   when a row is added. */
export async function spendOp(storage, op, q, nowMs) {
  q = q && typeof q === "object" ? q : {};
  const now = Number(nowMs) || Date.now();
  if (op === "sadd") {
    const rows = q.rows && typeof q.rows === "object" ? q.rows : {};
    let added = 0;
    for (const k of Object.keys(rows).slice(0, 200)) {
      const i = k.indexOf("|"), day = k.slice(0, i), key = k.slice(i + 1), r = rows[k] || {};
      if (!DAY_RE.test(day) || !KNOWN.has(key)) continue;
      const sk = "w:" + day + "|" + key, cur = (await storage.get(sk)) || {}, next = {};
      for (const f of FIELDS) next[f] = Math.min(1e12, int(cur[f], 1e12) + int(r[f], 1e9));
      await storage.put(sk, next);
      added++;
    }
    const today = dayOf(now);
    if (added && (await storage.get("w~pruned")) !== today) {
      const cut = dayOf(now - SPEND_KEEP_DAYS * 86400000), old = [];
      for (const k of (await storage.list({ prefix: "w:", end: "w:" + cut })).keys()) old.push(k);
      for (let i = 0; i < old.length; i += 128) await storage.delete(old.slice(i, i + 128));
      await storage.put("w~pruned", today);
    }
    return { ok: true, added: added };
  }
  if (op === "sget") {
    const from = String(q.from || ""), to = String(q.to || "");
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) return { error: "bad days" };
    const out = [];
    for (const [k, v] of await storage.list({ prefix: "w:", start: "w:" + from, end: "w:" + to + "~" })) {
      const i = k.indexOf("|"), key = k.slice(i + 1);
      if (!KNOWN.has(key)) continue;
      const row = { day: k.slice(2, i), key: key };
      for (const f of FIELDS) row[f] = int(v && v[f], 1e12);
      out.push(row);
    }
    return { rows: out };
  }
  return { error: "bad op" };
}

/* ---------- prices and monthly bills ---------- */
const EMAILISH = /[^\s@<>"',;:]+@[^\s@<>"',;:]+/g;
function money(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 10000) / 10000 : undefined;   /* undefined = refused */
}
export function spendDefaults() {
  const prices = {};
  for (const s of SPEND_SERVICES) { prices[s.key] = {}; for (const f of s.uses) prices[s.key][f] = s.price[f] == null ? null : s.price[f]; }
  return { prices: prices, fixed: [] };
}
/* A cfg from the admin form or KV, rebuilt field by field. Returns { cfg, errors }: a refused number keeps the default. */
export function spendCfgClean(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, out = spendDefaults(), errors = [];
  const rp = r.prices && typeof r.prices === "object" ? r.prices : {};
  for (const s of SPEND_SERVICES) {
    const p = rp[s.key] && typeof rp[s.key] === "object" ? rp[s.key] : null;
    if (!p) continue;
    for (const f of s.uses) {
      if (!(f in p)) continue;
      const m = money(p[f]);
      if (m === undefined) errors.push(s.key + "." + f); else out.prices[s.key][f] = m;
    }
  }
  const fx = Array.isArray(r.fixed) ? r.fixed : [];
  for (const x of fx) {
    if (out.fixed.length >= SPEND_FIXED_MAX) { errors.push("fixed: at most " + SPEND_FIXED_MAX); break; }
    const name = String((x && x.name) || "").replace(EMAILISH, "[email]").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40), m = money(x && x.perMonth);
    if (!name && (m === null || m === 0)) continue;   /* an empty row */
    if (!name || m === undefined || m === null) { errors.push("fixed: " + (name || "a row without a name")); continue; }
    out.fixed.push({ name: name, perMonth: m });
  }
  return { cfg: out, errors: errors };
}

/* ---------- the estimate ---------- */
/* Cost of usage u under price p for service s: null when a price it needs is missing and that part was used. */
export function spendCost(s, u, p, free) {
  let c = 0;
  const billed = Math.max(0, (u.n || 0) - (Number(free) || 0));   /* free: calls a month Google charges nothing for */
  const parts = { call: [billed, 1000], tin: [u.ti, 1e6], tout: [u.to, 1e6], ws: [u.ws, 1000] };
  for (const f of s.uses) {
    const used = parts[f][0] || 0, price = p ? p[f] : null;
    if (!used) continue;
    if (price == null) return null;
    c += used / parts[f][1] * price;
  }
  return Math.round(c * 10000) / 10000;
}
/* UTC periods for "now": today, the last 7 days (today included), this month so far, last month */
export function spendPeriods(nowMs) {
  const d = new Date(Number(nowMs) || Date.now()), y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const today = dayOf(d.getTime());
  const iso = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  return {
    today: { from: today, to: today },
    d7: { from: dayOf(d.getTime() - 6 * 86400000), to: today },
    month: { from: iso(y, mo, 1), to: today },
    last: { from: iso(y, mo - 1, 1), to: iso(y, mo, 0) }
  };
}
const PERIODS = ["today", "d7", "month", "last"];
export function spendSummary(rows, cfg, nowMs) {
  const per = spendPeriods(nowMs), c = cfg || spendDefaults(), list = Array.isArray(rows) ? rows : [];
  const services = SPEND_SERVICES.map(s => {
    const o = { key: s.key };
    for (const pk of PERIODS) {
      const P = per[pk], u = { n: 0, ti: 0, to: 0, ws: 0 };
      for (const r of list) if (r && r.key === s.key && r.day >= P.from && r.day <= P.to) for (const f of FIELDS) u[f] += Number(r[f]) || 0;
      /* a calendar month takes off the free monthly allowance; Today and 7 days are at the list price */
      o[pk] = Object.assign(u, { cost: spendCost(s, u, c.prices[s.key], pk === "month" || pk === "last" ? s.free : 0) });
    }
    return o;
  });
  const fixed = (c.fixed || []).reduce((a, x) => a + (Number(x.perMonth) || 0), 0);
  const totals = {};
  for (const pk of PERIODS) {
    let sum = 0, unpriced = 0;
    for (const s of services) { if (s[pk].cost == null) unpriced++; else sum += s[pk].cost; }
    totals[pk] = { calls: Math.round(sum * 100) / 100, unpriced: unpriced };
  }
  totals.fixed = Math.round(fixed * 100) / 100;
  totals.monthAll = Math.round((totals.month.calls + fixed) * 100) / 100;
  totals.lastAll = Math.round((totals.last.calls + fixed) * 100) / 100;
  return { periods: per, services: services, totals: totals, pricesChecked: PRICES_CHECKED };
}
