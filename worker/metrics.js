/* ---------- v78: traffic metrics for the admin dashboard ----------
   The worker counts every request into a small in-memory buffer (per UTC hour, per route) and flushes it
   to the "metrics" Caps Durable Object now and then, so the dashboard can show speed, errors and uptime.
   Nothing personal is kept: a route name, a status, a duration, a cache flag, and for 5xx a short error
   message and the scrubbed search term. No imports: index.js and admin.js both use this file. */

const HOUR = 3600000, DAY = 86400000;

/* Which bucket a request lands in. Exact paths, matching how index.js routes them. */
/* null-prototype tables, so a path like "constructor" can never pick up an inherited property */
const table = o => Object.assign(Object.create(null), o);
const LIVE = table({ "/": "shopgoodwill", "/ebay": "ebay", "/etsy": "etsy", "/chairish": "chairish", "/poshmark": "poshmark",
  "/poshsold": "poshsold", "/depop": "depop", "/vinted": "vinted", "/grailed": "grailed", "/hibid": "hibid",
  "/salvation": "salvation" });   /* v80 */
const NAMED = table({ "/verdict": "ai:fairprice", "/appraise": "ai:photo", "/research": "ai:research", "/guide": "ai:guide",
  "/where": "ai:where", "/hunt-check": "ai:huntcheck", "/shop-picks": "shop:picks", "/item": "item:popup",   /* v81: item */
  "/fb-finds": "fb:finds", "/fb-ingest": "fb:ingest" });   /* v94: the Facebook sweep */
const ALERTS = new Set(["subscribe", "confirm", "signin", "in", "status", "prefs", "mail", "delete", "move", "move-confirm", "unsub", "test", "gift", "giftstop", "likes", "code", "verify", "sharestop", "redeem", "signout-others"]);   /* v85: likes, v108: code, verify; v179: sharestop; v184: redeem, signout-others */

export function routeKey(pathname) {
  const p = String(pathname == null ? "" : pathname) || "/";
  /* the admin area and the diagnostics pages would only measure the owner looking at them */
  if (p.startsWith("/admin") || p.startsWith("/__") || p === "/favicon.ico" || p === "/robots.txt" || p === "/version") return null;   /* v196: /version is the deploy check */
  if (LIVE[p]) return "live:" + LIVE[p];
  if (NAMED[p]) return NAMED[p];
  if (p === "/alerts" || p.startsWith("/alerts/")) { const n = p.slice(8); return "alerts:" + (ALERTS.has(n) ? n : "other"); }
  if (p === "/proxy" || p.startsWith("/proxy/")) return "store:login";
  if (p.startsWith("/art/")) return "art";   /* v97: the page's drawings, so they do not swell "other" */
  return "other";
}

/* UTC hour key, e.g. "2026-10-05T21"; sorts as text in time order. */
export function hourKey(ms) { return new Date(ms).toISOString().slice(0, 13); }
const hourMs = hk => Date.parse(String(hk || "") + ":00:00Z") || 0;
const pad13 = t => String(Math.max(0, Math.floor(Number(t) || 0))).padStart(13, "0");
const num = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };   /* NaN, negatives and Infinity count as 0 */
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
/* A usable epoch-ms time (13 digits at most, so padded keys keep sorting), else 0. A bad time from a caller
   must not throw out of toISOString() and lose the rest of the batch. */
const okT = v => { const t = Number(v); return t > 0 && t < 1e13 ? t : 0; };
const nowOf = v => okT(v) || Date.now();
/* Defence in depth for the no-PII rule: callers already scrub, but no stored text may hold an email address. */
const EMAILISH = /[^\s@<>"',;:]+@[^\s@<>"',;:]+/g;
const txt = (v, n) => str(v, 400).replace(EMAILISH, "[email]").slice(0, n);

/* ---------- latency histogram ---------- */
export const HIST_EDGES = [100, 250, 500, 1000, 2000, 4000, 8000];
export function histIndex(ms) {
  const v = Number(ms);
  if (!(v > 0)) return 0;   /* NaN, 0 and negatives all count as instant */
  for (let i = 0; i < HIST_EDGES.length; i++) if (v < HIST_EDGES[i]) return i;
  return HIST_EDGES.length;
}
/* Coarse on purpose: the answer is the top edge of the bucket holding that rank, so "8000" means 8 s or more. */
export function pctFromHist(h, p) {
  const c = Array.isArray(h) ? h.map(num) : [], total = c.reduce((s, x) => s + x, 0);
  if (!total) return 0;
  const pp = Math.min(1, Math.max(0, Number(p) || 0));
  const rank = Math.max(1, Math.ceil(pp * total - 1e-9));   /* the epsilon keeps 0.95 * 60 from becoming 58 */
  let cum = 0;
  for (let i = 0; i < c.length; i++) { cum += c[i]; if (cum >= rank) return HIST_EDGES[Math.min(i, HIST_EDGES.length - 1)]; }
  return HIST_EDGES[HIST_EDGES.length - 1];
}

/* ---------- aggregates ---------- */
export function emptyAgg() { return { n: 0, hit: 0, e4: 0, e5: 0, lim: 0, ms: 0, h: [0, 0, 0, 0, 0, 0, 0, 0] }; }
export function addToAgg(agg, ev) {
  const s = Number(ev && ev.s) || 0, ms = Math.round(num(ev && ev.ms));
  agg.n += 1;
  if (ev && ev.hit) agg.hit += 1;
  if (s === 429) agg.lim += 1;
  else if (s >= 500) agg.e5 += 1;
  else if (s >= 400) agg.e4 += 1;
  agg.ms += ms;
  agg.h[histIndex(ms)] += 1;
  return agg;
}
/* Adds b into a and returns a (a new one when a is missing). Tolerates stored records missing fields. */
export function mergeAgg(a, b) {
  /* a malformed a is rebuilt from its seven agg fields only (never copied wholesale), then b is added */
  if (!a || typeof a !== "object" || !Array.isArray(a.h) || a.h.length !== 8) a = addInto(emptyAgg(), a);
  return addInto(a, b);
}
const AGG_KEYS = ["n", "hit", "e4", "e5", "lim", "ms"];
function addInto(a, b) {
  if (!b || typeof b !== "object") return a;
  for (const k of AGG_KEYS) a[k] = num(a[k]) + num(b[k]);
  const bh = Array.isArray(b.h) ? b.h : [];
  for (let i = 0; i < 8; i++) a.h[i] = num(a.h[i]) + num(bh[i]);
  return a;
}
const aggOf = v => mergeAgg(emptyAgg(), v);
const pct = (x, n) => n ? Math.round(x / n * 1000) / 10 : 0;
/* What the dashboard reads off an aggregate: the averages and percentiles it cannot work out itself. */
function stats(a) {
  return { hitPct: pct(a.hit, a.n), avgMs: a.n ? Math.round(a.ms / a.n) : 0, p50: pctFromHist(a.h, 0.5), p95: pctFromHist(a.h, 0.95), errPct: pct(a.e5, a.n) };
}

/* ---------- worker-side buffer ----------
   One isolate sees a trickle of requests; writing each to the Durable Object would cost a call per request,
   so they are summed here and sent in one go every maxEvents requests or maxAgeMs, whichever comes first.
   Nothing flushes a buffer whose isolate goes quiet, so a server error (5xx) asks for a flush straight away:
   the rare errors are the records the owner most needs. At most one such early flush per errEveryMs, so an
   error storm still goes out in batches. */
export class MetricsBuffer {
  constructor(opts) {
    const o = opts || {};
    this.maxEvents = o.maxEvents || 20; this.maxAgeMs = o.maxAgeMs || 30000; this.maxErrors = o.maxErrors == null ? 20 : o.maxErrors;
    this.errEveryMs = o.errEveryMs == null ? 5000 : o.errEveryMs; this.lastErrFlush = 0;
    this.reset();
  }
  reset() { this.b = {}; this.e = []; this.count = 0; this.first = 0; }
  due(nowMs) { return this.count > 0 && (this.count >= this.maxEvents || nowMs - this.first >= this.maxAgeMs); }
  add(ev, nowMs) {
    const now = nowOf(nowMs);
    if (!ev || !ev.r) return this.due(now);
    if (!this.count) this.first = now;
    const k = hourKey(now) + "|" + ev.r;
    addToAgg(this.b[k] || (this.b[k] = emptyAgg()), ev);
    /* an error storm keeps its count in the aggregate but only the first few messages */
    const err = Number(ev.s) >= 500;
    if (err && this.e.length < this.maxErrors) this.e.push({ t: now, r: ev.r, s: Number(ev.s), m: txt(ev.err, 160), q: txt(ev.q, 60) });
    this.count += 1;
    if (err && now - this.lastErrFlush >= this.errEveryMs) { this.lastErrFlush = now; return true; }
    return this.due(now);
  }
  drain() {
    if (!this.count) return null;
    const out = { b: this.b, e: this.e };
    this.reset();
    return out;
  }
}

/* ---------- Durable Object side ----------
   Runs inside the "metrics" Caps object. Prefixes x: y: z: p: a: (and q:, the trim counters) belong to metrics
   only (Caps itself uses c: v: s: n: m:). Records are rebuilt field by field, so whatever is stored has a known shape. */
const CAP = { "y:": 500, "z:": 400, "a:": 300 };
const rand4 = () => { const b = new Uint8Array(2); crypto.getRandomValues(b); return Array.from(b, x => x.toString(16).padStart(2, "0")).join(""); };
const BKEY = /^\d{4}-\d{2}-\d{2}T\d{2}\|[a-z0-9:_-]{1,40}$/;
const SRC = /^[a-z0-9_-]{1,30}$/;
const lim = (v, d, lo, hi) => { const n = v == null || v === "" ? d : Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

async function delKeys(storage, keys) {
  for (let i = 0; i < keys.length; i += 128) await storage.delete(keys.slice(i, i + 128));   /* storage deletes at most 128 at once */
}
/* How many keys a capped prefix holds is kept in a counter ("q:y:" for "y:"), so a write does not list the whole
   prefix (hundreds of rows read) just to count it. Keys sort oldest first (padded time), so the surplus is the front
   of the list and only that many rows are read. The first trim counts once; metricsPrune re-counts every day, which
   also corrects the rare drift (an age-pruned key, or two entries in the same millisecond with the same random tag). */
const countKey = prefix => "q:" + prefix;
async function trim(storage, prefix, added) {
  const ck = countKey(prefix), had = await storage.get(ck);
  let n = typeof had === "number" && had >= 0 ? had + added : (await storage.list({ prefix: prefix })).size;
  const extra = n - CAP[prefix];
  if (extra > 0) {
    const old = Array.from((await storage.list({ prefix: prefix, limit: extra })).keys());
    await delKeys(storage, old);
    n -= old.length;
  }
  await storage.put(ck, Math.max(0, n));
}
/* the cron record's member counts for the overview (numbers only, by allowlist) */
const COUNT_KEYS = ["total", "pro", "gifted", "trial", "free", "freeLegacy", "mailOff", "paused", "noHunts", "new7d", "hunts", "activeHunts",
  "dueToday", "sentToday", "late", "checkedToday", "huntsLeftToday"];
function countsOf(v) {
  if (!v || typeof v !== "object") return null;
  const o = {};
  for (const k of COUNT_KEYS) o[k] = Math.floor(num(v[k]));
  return o;
}

export async function metricsOp(storage, op, q, nowMs) {
  const now = nowOf(nowMs);
  q = q && typeof q === "object" ? q : {};
  if (op === "mrec") {
    if (q.b && typeof q.b === "object") {
      for (const key of Object.keys(q.b).slice(0, 400)) {
        if (!BKEY.test(key)) continue;
        const k = "x:" + key;
        await storage.put(k, mergeAgg(aggOf(await storage.get(k)), q.b[key]));
      }
    }
    if (Array.isArray(q.e) && q.e.length) {
      let added = 0;
      for (const e of q.e.slice(0, 100)) {
        if (!e) continue;
        const t = okT(e.t) || now;
        await storage.put("y:" + pad13(t) + ":" + rand4(), { t: t, r: str(e.r, 40), s: num(e.s), m: txt(e.m, 160), q: txt(e.q, 60) });
        added++;
      }
      if (added) await trim(storage, "y:", added);
    }
    if (q.c && typeof q.c === "object") {
      const c = q.c, t = okT(c.t) || now, k = "z:" + pad13(t), counts = countsOf(c.counts);
      const isNew = (await storage.get(k)) === undefined;
      const row = { t: t, ms: num(c.ms), members: num(c.members), checked: num(c.checked), sent: num(c.sent), failed: num(c.failed),
        errors: (Array.isArray(c.errors) ? c.errors : []).slice(0, 5).map(x => txt(x, 160)) };
      if (counts) row.counts = counts;   /* v78: member counts worked out by the alert clock, so the overview need not read every member */
      await storage.put(k, row);
      await trim(storage, "z:", isNew ? 1 : 0);
    }
    if (Array.isArray(q.p)) {
      for (const p of q.p.slice(0, 50)) {
        if (!p || !SRC.test(String(p.source || ""))) continue;
        const t = okT(p.t) || now;
        /* one per source per hour: a manual health check replaces that hour's scheduled one */
        await storage.put("p:" + hourKey(t) + "|" + p.source, { t: t, source: String(p.source), ok: !!p.ok, status: num(p.status), n: num(p.n), ms: num(p.ms), err: txt(p.err, 160) });
      }
    }
    if (Array.isArray(q.a) && q.a.length) {
      let added = 0;
      for (const a of q.a.slice(0, 50)) {
        if (!a) continue;
        const t = okT(a.t) || now;
        await storage.put("a:" + pad13(t) + ":" + rand4(), { t: t, action: txt(a.action, 40), id: txt(a.id, 20), ok: !!a.ok, note: txt(a.note, 200) });
        added++;
      }
      if (added) await trim(storage, "a:", added);
    }
    return { ok: true };
  }
  if (op === "mget") {
    /* hours 0 or probeDays 0 skip that section (the overview reads the slow-changing parts less often) */
    const hours = lim(q.hours, 48, 0, 24 * 8), nErr = lim(q.errors, 100, 0, 500), nCron = lim(q.crons, 60, 0, 400);
    const probeDays = lim(q.probeDays, 7, 0, 8), nAudit = lim(q.audit, 50, 0, 300);
    const newest = async (prefix, n) => n ? Array.from((await storage.list({ prefix: prefix, reverse: true, limit: n })).values()) : [];
    const buckets = [];
    if (hours) for (const [k, v] of await storage.list({ prefix: "x:", start: "x:" + hourKey(now - (hours - 1) * HOUR) })) {
      const i = k.indexOf("|");
      buckets.push(Object.assign({ hour: k.slice(2, i), route: k.slice(i + 1) }, aggOf(v)));
    }
    const probes = [];
    if (probeDays) for (const [k, v] of await storage.list({ prefix: "p:", start: "p:" + hourKey(now - probeDays * DAY) })) {
      const i = k.indexOf("|"), p = v || {};
      probes.push({ hour: k.slice(2, i), source: k.slice(i + 1), t: p.t, ok: !!p.ok, status: p.status, n: p.n, ms: p.ms, err: p.err || "" });
    }
    return { buckets: buckets, errors: await newest("y:", nErr), crons: await newest("z:", nCron), probes: probes, audit: await newest("a:", nAudit) };
  }
  if (op === "peek") {
    /* the daily AI pool counters Caps keeps under c:<key>, read without taking one */
    const values = {};
    for (const key of (Array.isArray(q.keys) ? q.keys : []).slice(0, 50)) values[String(key)] = Number(await storage.get("c:" + String(key))) || 0;
    return { values: values };
  }
  return { error: "bad op" };
}

/* Housekeeping for the Caps alarm: hourly buckets and probes for 8 days, errors and the audit log for 30,
   cron runs for 7. Returns how many metrics keys are left, so the alarm knows whether to come back. */
export async function metricsPrune(storage, nowMs) {
  const now = nowOf(nowMs);
  const rules = [["x:", 8, hourMs], ["p:", 8, hourMs], ["y:", 30, Number], ["a:", 30, Number], ["z:", 7, Number]];
  const del = [];
  let kept = 0;
  const left = {};
  for (const [prefix, days, when] of rules) {
    const cut = now - days * DAY;
    let n = 0;
    for (const k of (await storage.list({ prefix: prefix })).keys()) {
      const t = when(k.slice(2, 15));
      if (!(t > 0) || t < cut) del.push(k); else { kept++; n++; }   /* a key whose time cannot be read is junk, not history */
    }
    left[prefix] = n;
  }
  await delKeys(storage, del);
  /* the trim counters start again from the true count (only where metrics are kept at all) */
  for (const prefix of Object.keys(CAP)) {
    const ck = countKey(prefix);
    if (left[prefix] || (await storage.get(ck)) !== undefined) await storage.put(ck, left[prefix] || 0);
  }
  return kept;
}

/* ---------- summaries for the dashboard ---------- */
export function summarize(buckets, nowMs, hours) {
  const now = nowOf(nowMs), nh = lim(hours, 24, 1, 24 * 8);
  const keys = [];
  for (let i = nh - 1; i >= 0; i--) keys.push(hourKey(now - i * HOUR));
  const at = new Map(keys.map((k, i) => [k, i]));
  const req = keys.map(() => 0), err5 = keys.map(() => 0), slow = keys.map(() => 0);
  const per = Object.create(null), totals = emptyAgg(), live = emptyAgg();   /* null prototype: a route named __proto__ stays data */
  for (const b of Array.isArray(buckets) ? buckets : []) {
    const i = b ? at.get(b.hour) : undefined;
    if (i === undefined || !b.route) continue;   /* outside the window, or a future hour from clock skew */
    const a = aggOf(b);
    mergeAgg(per[b.route] || (per[b.route] = emptyAgg()), a);
    mergeAgg(totals, a);
    if (String(b.route).startsWith("live:")) mergeAgg(live, a);
    req[i] += a.n; err5[i] += a.e5; slow[i] += a.h[5] + a.h[6] + a.h[7];   /* buckets 5..7 are 2 s and over */
  }
  const routes = Object.keys(per).map(r => {
    const a = per[r], s = stats(a);
    return { route: r, n: a.n, hit: a.hit, hitPct: s.hitPct, e4: a.e4, e5: a.e5, lim: a.lim, avgMs: s.avgMs, p50: s.p50, p95: s.p95, errPct: s.errPct };
  }).sort((x, y) => y.n - x.n || (x.route < y.route ? -1 : 1));
  return { routes: routes, series: { hours: keys, req: req, err5: err5, slow: slow },
    totals: Object.assign(totals, stats(totals)), live: Object.assign(live, stats(live)) };
}

/* Per marketplace, from the hourly probe results: share of checks that worked over 24 h and 7 days
   (null when there were no checks), and what the latest check saw. */
export function uptimeFrom(probes, nowMs) {
  const now = nowOf(nowMs), by = Object.create(null);   /* null prototype: a source named __proto__ cannot break the grouping */
  for (const p of Array.isArray(probes) ? probes : []) {
    if (!p || !p.source) continue;
    (by[p.source] || (by[p.source] = [])).push({ p: p, t: okT(p.t) || okT(hourMs(p.hour)) });
  }
  return Object.keys(by).sort().map(source => {
    const list = by[source].sort((x, y) => x.t - y.t);
    let c24 = 0, ok24 = 0, c7 = 0, ok7 = 0, lastOk = null;
    for (const { p, t } of list) {
      const age = now - t;
      if (age < 7 * DAY) { c7++; if (p.ok) ok7++; }
      if (age < DAY) { c24++; if (p.ok) ok24++; }
      if (p.ok) lastOk = { p: p, t: t };
    }
    const last = list[list.length - 1], lp = last.p;
    return { source: source, pct24: c24 ? pct(ok24, c24) : null, pct7d: c7 ? pct(ok7, c7) : null, checks24: c24, checks7d: c7,
      lastOkAt: lastOk ? (lastOk.p.hour ? String(lastOk.p.hour) : lastOk.t ? hourKey(lastOk.t) : null) : null, lastAt: last.t || null,
      lastStatus: lp.status == null ? null : Number(lp.status), lastMs: lp.ms == null ? null : Number(lp.ms), lastErr: str(lp.err, 160),
      lastN: lp.n == null ? null : Number(lp.n), down: !lp.ok };
  });
}
