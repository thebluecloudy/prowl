/* v157: Facebook watches (docs/update-2026-10-21/prowl-facebook-watches-spec.md).
   A watch is a saved hunt plus 1 to 3 metros, an optional price ceiling, optional skip-words and a cadence (weekly,
   daily or hot). The watcher's own browser runs it, through the Prowl extension, with their own Facebook login and their
   own connection, and posts what it found to /fb-ingest with their store session. This worker never asks Facebook for
   anything: it keeps the watches and the listings, and sends the alerts.
   This module is pure (no fetch, no env, no KV): index.js reads and writes KV, checks the session and sends the email.
     watchPlan(pro)                          the plan's limits: Free 1 watch at Weekly; Pro 25 at Daily, 3 of them Hot
     watchGoal(s)                            "find me a ceramic panther lamp under $200" -> { term, ceiling }
     watchUpsert(list, input, plan, now, id) add, change or turn off one watch; a change of filters starts a new baseline
     watchItems(arr)                         the listings the extension reported, cleaned
     watchIngest(w, seen, items, hidden, comps, now)   the authoritative diff: baseline, seen, filters, new finds
     watchRead(item, comps, now)             the price read: Fair price? on asking prices, below-usual, condition, stale
     watchFindsMerge(old, add, now)          a watch's finds for Flock and the Den: newest first, 60, 30 days
     watchHotHtml / watchDigestHtml / watchText   the email bodies (index.js wraps them in the alerts shell) */

export const WATCH_FREE_MAX = 1, WATCH_PRO_MAX = 25, WATCH_HOT_MAX = 3;
export const WATCH_METROS_MAX = 3, WATCH_SKIP_MAX = 20, WATCH_ITEMS_MAX = 150, WATCH_COMPS_MAX = 300, WATCH_COMPS_MIN = 5;
export const WATCH_SEEN_DAYS = 30, WATCH_SEEN_MAX = 3000, WATCH_FINDS_MAX = 60, WATCH_HIDE_MAX = 1000, WATCH_STALE_DAYS = 14;
export const WATCH_TIERS = ["weekly", "daily", "hot"];
const DAY = 86400000;

/* The metros a watch can search: the watcher's own area (Facebook's location for their account, which is where they
   pick up) and the metros the page's Facebook hub lists (page FBHUBS / FBID, Sept 2026). An invented city slug lands
   on Facebook's error page, so only these. loc is the place ID where one is known, else the city slug. */
export const WATCH_METROS = {
  local: { label: "Near you", loc: "" },
  nyc: { label: "New York", loc: "108424279189115" },
  la: { label: "Los Angeles", loc: "110970792260960" },
  sf: { label: "San Francisco", loc: "sanfrancisco" },
  chicago: { label: "Chicago", loc: "108659242498155" },
  detroit: { label: "Detroit", loc: "151286001683429" },
  dallas: { label: "Dallas", loc: "2181928745183595" },
  houston: { label: "Houston", loc: "112164325476741" },
  phoenix: { label: "Phoenix", loc: "112534082095531" },
  miami: { label: "Miami", loc: "110148382341970" },
  atlanta: { label: "Atlanta", loc: "atlanta" },
  seattle: { label: "Seattle", loc: "110843418940484" },
};

export function watchPlan(pro) {
  return pro ? { pro: true, max: WATCH_PRO_MAX, hot: WATCH_HOT_MAX, tiers: WATCH_TIERS.slice() }
    : { pro: false, max: WATCH_FREE_MAX, hot: 0, tiers: ["weekly"] };
}

/* the page's key for a hunt (fbTerm in index.js): single spaces, cut to 60, no half of an emoji, trimmed, lowercased */
export function watchTerm(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").slice(0, 60)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1").trim().toLowerCase().slice(0, 60);
}

/* A goal sentence to a term: the asking words, articles, "on Facebook" and "near me" go; "under $200" becomes the
   ceiling. A plain term comes back as it is. */
const GOAL_CEIL = /\s*(?:,\s*)?\b(?:under|below|less than|no more than|not over|up to|at most|max(?:imum)?|for under)\s*\$?\s?(\d[\d,]*)(?:\.\d{1,2})?\s*(?:dollars|bucks)?/i;
const GOAL_LEAD = /^(?:(?:please|hey|ok|okay)\s*,?\s+)*(?:(?:i(?:'m| am)|we(?:'re| are))\s+(?:looking|hunting|searching)\s+for|(?:i|we)\s+(?:want|need|collect)|(?:i(?:'d| would)|we(?:'d| would))\s+(?:like|love)|looking\s+for|hunting\s+for|searching\s+for|on\s+the\s+hunt\s+for|find\s+me|find|watch\s+for|keep\s+an\s+eye\s+out\s+for|show\s+me|tell\s+me\s+(?:when|if)(?:\s+(?:there'?s|there\s+is|someone\s+lists?|anyone\s+lists?))?|let\s+me\s+know\s+(?:when|if)(?:\s+(?:there'?s|there\s+is|someone\s+lists?|anyone\s+lists?))?|alert\s+me\s+(?:when|if|to|about)(?:\s+(?:there'?s|someone\s+lists?))?)\s+/i;
export function watchGoal(s) {
  let t = String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, 300), ceiling = 0;
  const m = GOAL_CEIL.exec(t);
  if (m) { ceiling = Math.min(1000000, Number(m[1].replace(/,/g, "")) || 0); t = (t.slice(0, m.index) + " " + t.slice(m.index + m[0].length)).trim(); }
  t = t.replace(GOAL_LEAD, "")
    .replace(/^(?:a|an|the|some|any|a few|a pair of|one of those)\s+/i, "")
    .replace(/\s+(?:on|from)\s+(?:facebook(?:\s+marketplace)?|fb(?:\s+marketplace)?|marketplace)\b/gi, "")
    .replace(/\s+(?:near\s+me|nearby|around\s+here|in\s+my\s+area|close\s+by|locally)\b/gi, "")
    .replace(/\s+(?:please|thanks|thank\s+you)\b/gi, "")
    .replace(/[.!?,;:]+$/g, "").replace(/^["'“‘]+|["'”’]+$/g, "");
  return { term: watchTerm(t), ceiling: ceiling };
}

function cleanMetros(a) {
  const out = [];
  for (const k of Array.isArray(a) ? a : []) {
    const key = String(k || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(WATCH_METROS, key) && out.indexOf(key) === -1 && out.length < WATCH_METROS_MAX) out.push(key);
  }
  return out.length ? out : ["local"];
}
/* skip-words: a word or a short phrase (up to 3 words), letters and numbers, lowercased; "repro, lamp shade" -> two */
export function watchSkip(v) {
  const raw = Array.isArray(v) ? v : String(v == null ? "" : v).split(/[,;\n]+/), out = [];
  for (const x of raw) {
    const w = String(x == null ? "" : x).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
    if (w.length < 2 || w.length > 30 || w.split(" ").length > 3 || out.indexOf(w) !== -1) continue;
    out.push(w);
    if (out.length >= WATCH_SKIP_MAX) break;
  }
  return out;
}
function cleanCeiling(v) {
  const n = Math.floor(Number(String(v == null ? "" : v).replace(/[$,\s]/g, "")));
  return n > 0 && n <= 1000000 ? n : 0;
}
function sameFilters(a, b) {
  return !!a && !!b && a.term === b.term && a.ceiling === b.ceiling && a.metros.join(",") === b.metros.join(",") && a.skip.join(",") === b.skip.join(",");
}

/* Add, change or turn off one watch. input: { id?, term | goal, metros, ceiling, skip, tier } (tier "off" removes it).
   Returns { list, watch } or { error, status }. The list is never changed in place. */
export function watchUpsert(list, input, plan, now, newId) {
  list = Array.isArray(list) ? list.slice() : [];
  const b = input && typeof input === "object" ? input : {};
  const iso = new Date(now).toISOString();
  const at = b.id ? list.findIndex((w) => w && w.id === String(b.id)) : -1;
  const old = at > -1 ? list[at] : null;
  const tier = String(b.tier || (old ? old.tier : "") || "weekly").toLowerCase();
  if (tier === "off") {
    if (!old) return { error: "That watch is already off.", status: 404 };
    list.splice(at, 1);
    return { list: list, watch: null, removed: old };
  }
  if (WATCH_TIERS.indexOf(tier) === -1) return { error: "Pick Weekly, Daily or Hot.", status: 400 };
  let term = old ? old.term : "", ceiling = old ? old.ceiling : 0;
  if (b.goal != null && String(b.goal).trim()) { const g = watchGoal(b.goal); term = g.term; if (g.ceiling && b.ceiling == null) ceiling = g.ceiling; }
  else if (b.term != null) term = watchTerm(b.term);
  if (b.ceiling != null) ceiling = cleanCeiling(b.ceiling);
  if (!term) return { error: "Name what to watch for.", status: 400 };
  if (/@/.test(term)) return { error: "That looks like an email address, not something to hunt.", status: 400 };
  const dupe = list.findIndex((w) => w && w.term === term);
  if (dupe > -1 && dupe !== at) return { error: "You already watch that hunt.", status: 409 };
  if (plan.tiers.indexOf(tier) === -1) return { error: tier === "hot" ? "Hot watches come with Prowl Pro." : "Daily watches come with Prowl Pro. Free watches check once a week.", status: 403 };
  if (!old && list.length >= plan.max) return { error: plan.pro ? "Prowl Pro holds " + plan.max + " watches. Turn one off to add this one." : "The free plan holds one watch. Prowl Pro holds " + WATCH_PRO_MAX + ".", status: 403 };
  if (tier === "hot" && !(old && old.tier === "hot") && list.filter((w) => w && w.tier === "hot").length >= plan.hot)
    return { error: "You already have " + plan.hot + " Hot watches. Make one of them Daily first.", status: 403 };
  const w = {
    id: old ? old.id : String(newId || ""), term: term,
    metros: b.metros != null ? cleanMetros(b.metros) : (old ? old.metros : ["local"]),
    ceiling: ceiling,
    skip: b.skip != null ? watchSkip(b.skip) : (old ? old.skip : []),
    tier: tier,
    gen: old ? old.gen : 1,
    created: old ? old.created : iso,
    activeAt: old ? old.activeAt : "", checkedAt: old ? old.checkedAt : "", skips: old ? old.skips : 0,
    filtered: old ? old.filtered : 0, found: old ? old.found : 0,
  };
  if (!/^w[a-z0-9]{8}$/.test(w.id)) return { error: "bad id", status: 500 };
  /* the baseline rule: new filters, a new first check that alerts on nothing */
  if (old && !sameFilters(old, w)) { w.gen = (Number(old.gen) || 1) + 1; w.activeAt = ""; w.filtered = 0; w.found = 0; }
  if (at > -1) list[at] = w; else list.push(w);
  return { list: list, watch: w };
}
/* a fresh watch id: "w" and 8 of [a-z0-9], from 8 random bytes */
export function watchId(bytes) { return "w" + Array.from(bytes || [], (x) => "abcdefghijklmnopqrstuvwxyz0123456789"[x % 36]).join("").slice(0, 8); }
/* the stored list, cleaned (a bad row is dropped, never fatal) */
export function watchList(v) {
  const a = v && Array.isArray(v.watches) ? v.watches : [];
  return a.filter((w) => w && /^w[a-z0-9]{8}$/.test(String(w.id)) && typeof w.term === "string" && w.term && WATCH_TIERS.indexOf(w.tier) !== -1).slice(0, WATCH_PRO_MAX);
}
/* A plan that shrank (Pro ended): the oldest watch stays on at Weekly, the rest wait. Nothing is deleted. */
export function watchFit(list, plan) {
  let hot = 0;
  return list.map((w, i) => {
    const x = Object.assign({}, w);
    x.paused = i >= plan.max;
    if (plan.tiers.indexOf(x.tier) === -1) x.runs = "weekly";
    else if (x.tier === "hot" && ++hot > plan.hot) x.runs = "daily";
    else x.runs = x.tier;
    return x;
  });
}

/* ---------- what the extension reported ---------- */
const FB_IMG = /^https:\/\/([a-z0-9-]+\.)*fbcdn\.net\//i;
function vClean(s, n) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n); }
/* no email address or phone number rides along in a title or a place */
function noPII(s) {
  return String(s).replace(/[^\s@<>"',;:]+@[^\s@<>"',;:]+/g, "[email]").replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[phone]");
}
export function watchPrice(s) {
  const t = String(s == null ? "" : s).trim();
  if (/^free$/i.test(t)) return 0;
  const m = /^\$?\s?(\d[\d,]*)(\.\d{1,2})?$/.exec(t);
  return m ? Number(m[1].replace(/,/g, "")) + (m[2] ? Number(m[2]) : 0) : NaN;
}
export function watchItems(arr) {
  const out = [], seen = Object.create(null);
  for (const x of Array.isArray(arr) ? arr.slice(0, WATCH_ITEMS_MAX * 2) : []) {
    if (out.length >= WATCH_ITEMS_MAX) break;
    if (!x || typeof x !== "object") continue;
    const id = String(x.id == null ? "" : x.id).trim(), title = noPII(vClean(x.title, 160));
    if (!/^\d{5,20}$/.test(id) || seen[id] || !title) continue;
    seen[id] = 1;
    const price = vClean(x.price, 24), listed = Math.floor(Number(x.listed) || 0);
    out.push({
      id: id, title: title, price: /^\$?\s?\d[\d,]*(\.\d{1,2})?$|^free$/i.test(price) ? price : "",
      url: "https://www.facebook.com/marketplace/item/" + id + "/",
      image: typeof x.image === "string" && x.image.length < 2000 && FB_IMG.test(x.image) ? x.image : "",
      location: noPII(vClean(x.location, 60)),
      listed: listed > 1e9 && listed < 1e10 ? listed : 0,   /* seconds, when Facebook said when it was listed */
    });
  }
  return out;
}
/* the other listings' asking prices (whole dollars), as the extension saw them on the same searches */
export function watchComps(arr) {
  const out = [];
  for (const x of Array.isArray(arr) ? arr.slice(0, WATCH_COMPS_MAX) : []) { const n = Number(x); if (n > 0 && n < 1000000) out.push(n); }
  return out;
}

/* ---------- the diff ---------- */
function words(s) { return " " + String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " "; }
/* "" when the listing passes the watch's filters, else why it was held back */
export function watchMatch(w, item) {
  const p = watchPrice(item.price);
  if (w.ceiling > 0 && p > w.ceiling) return "ceiling";
  const t = words(item.title);
  for (const s of w.skip || []) if (t.indexOf(" " + s + " ") !== -1) return "skip";
  return "";
}
/* the seen state, cleaned: { g, at, ids: { id: first-seen ms } }, anything past WATCH_SEEN_DAYS gone */
export function watchSeen(v, now) {
  const ids = {}, cut = now - WATCH_SEEN_DAYS * DAY;   /* keys are digits only, so a plain object is safe */
  const src = v && v.ids && typeof v.ids === "object" ? v.ids : {};
  const keep = Object.keys(src).filter((k) => /^\d{5,20}$/.test(k) && Number(src[k]) > cut).sort((a, b) => src[b] - src[a]).slice(0, WATCH_SEEN_MAX);
  for (const k of keep) ids[k] = Number(src[k]);
  return { g: v && Number(v.g) > 0 ? Number(v.g) : 0, at: v && typeof v.at === "string" ? v.at : "", ids: ids };
}
/* what the extension diffs against: the last 8 digits of each seen id, comma-joined. Short, so a Daily cycle of 25
   watches stays small. The server diffs again on the full id; a clash (about 1 in 100,000 for a watch with 1,000 seen
   listings) only means the extension leaves that one new listing out of its report. */
export function watchDigest(seen) { return Object.keys(seen.ids).map((k) => k.slice(-8)).join(","); }

/* The authoritative diff for one watch's check. A watch whose seen state is from another generation (new, or its
   filters changed) takes this check as its baseline: everything it reported is marked seen and nothing alerts. After
   that, a listing not seen before is new; a hidden one is only marked seen; one the ceiling or skip-words hold back
   counts toward filtered; the rest are the finds, each with its price read. */
export function watchIngest(w, seenV, items, hidden, comps, now) {
  const seen = watchSeen(seenV, now), iso = new Date(now).toISOString(), hid = hidden || {};
  const base = seen.g !== w.gen;
  const out = { baseline: base, finds: [], filtered: 0, fresh: 0 };
  if (base) { seen.g = w.gen; seen.at = iso; }
  for (const it of items) {
    if (seen.ids[it.id]) continue;
    seen.ids[it.id] = now;
    out.fresh++;
    if (base || hid[it.id]) continue;
    if (watchMatch(w, it)) { out.filtered++; continue; }
    out.finds.push(Object.assign({}, it, { found: iso.slice(0, 10), read: watchRead(it, comps, now) }));
  }
  out.seen = seen;
  return out;
}

/* ---------- the price read ----------
   Honest by construction: only the asking prices the watcher's own searches just returned, never a sold price and
   never an estimate. With fewer than WATCH_COMPS_MIN priced listings it says so instead of guessing. */
const COND = /\b(chip(?:s|ped)?|crack(?:s|ed)?|hairline|broken|as[- ]is|for parts|parts only|needs? (?:work|repair|tlc)|repair(?:ed|s)?|damaged?|missing|stain(?:s|ed)?|rust(?:y|ed)?|flaw(?:s|ed)?|scratch(?:es|ed)?|torn|ripped|not working|doesn'?t work|cracked)\b/i;
function median(a) { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
function usd(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
export function watchRead(item, comps, now) {
  const p = watchPrice(item.price), out = { verdict: "", line: "", below: "", flags: [] };
  const others = watchComps(comps), self = others.indexOf(p);
  if (self > -1) others.splice(self, 1);   /* the comps are everything the searches returned, this listing too */
  if (!(p > 0)) out.line = p === 0 ? "Fair price? Listed as free, so there is no price to judge." : "Fair price? No price on the listing to judge.";
  else if (others.length < WATCH_COMPS_MIN) out.line = "Fair price? Too few listings nearby to judge it yet.";
  else {
    const m = median(others), r = p / m;
    out.verdict = r <= 0.75 ? "DEAL" : r >= 1.35 ? "HIGH" : "FAIR";
    out.line = "Fair price? " + (out.verdict === "DEAL" ? "Looks like a deal" : out.verdict === "HIGH" ? "Looks high" : "Looks fair") +
      ", against " + others.length + " asking prices for this hunt nearby (asking, not sold).";
    if (p < m) out.below = usd(m - p) + " below the usual asking price nearby (" + usd(m) + ").";
    const c = COND.exec(item.title);
    if (c && out.verdict !== "DEAL") out.flags.push("The title says “" + c[1].toLowerCase() + "”, and the price doesn’t seem to allow for it.");
  }
  const days = item.listed ? Math.floor((now - item.listed * 1000) / DAY) : 0;
  if (days >= WATCH_STALE_DAYS) out.flags.push("Listed " + (days >= 60 ? Math.floor(days / 30) + " months" : days >= 21 ? Math.floor(days / 7) + " weeks" : days + " days") + " ago, so it has sat a while. An offer may land.");
  return out;
}

/* a watch's finds: the new ones first, then the earlier ones still inside WATCH_SEEN_DAYS, one per listing */
export function watchFindsMerge(old, add, now) {
  const cut = new Date(now - WATCH_SEEN_DAYS * DAY).toISOString().slice(0, 10), have = Object.create(null), out = [];
  for (const x of (add || []).concat(old && Array.isArray(old.items) ? old.items : [])) {
    if (!x || !x.id || have[x.id] || !(String(x.found || "") > cut)) continue;
    have[x.id] = 1; out.push(x);
    if (out.length >= WATCH_FINDS_MAX) break;
  }
  return { items: out };
}

/* ---------- the emails ----------
   urls: { hide(item) -> one-tap Hide link, app -> Prowl, watch(w) -> the hunt in Prowl }. Tables and inline styles,
   the alerts' look. */
export function watchEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
const E = watchEsc;
function card(x, urls) {
  const r = x.read || {}, lines = [];
  if (r.line) lines.push('<div style="font:13px/1.45 Arial,sans-serif;color:#2b2118;margin-top:6px">' + E(r.line) + '</div>');
  if (r.below) lines.push('<div style="font:bold 13px/1.45 Arial,sans-serif;color:#2f6b3a;margin-top:3px">' + E(r.below) + '</div>');
  for (const f of r.flags || []) lines.push('<div style="font:13px/1.45 Arial,sans-serif;color:#6b4a1f;background:#fff3df;border-radius:4px;padding:5px 7px;margin-top:5px">' + E(f) + '</div>');
  return '<table width="100%" cellpadding="0" cellspacing="0" style="border:1.5px solid #d6c9b6;border-radius:4px;background:#ffffff;border-collapse:separate;margin:0 0 12px"><tr>' +
    '<td width="132" valign="top" style="padding:0"><a href="' + E(x.url) + '" style="text-decoration:none">' +
    (x.image ? '<img src="' + E(x.image) + '" alt="" width="132" style="width:132px;height:132px;object-fit:cover;display:block;background:#efe8dc">' : '<div style="width:132px;height:132px;background:#efe8dc"></div>') +
    '</a></td><td valign="top" style="padding:10px 12px">' +
    '<a href="' + E(x.url) + '" style="text-decoration:none;color:#2b2118;font:800 15px/1.3 Arial,sans-serif">' + E(x.title) + '</a>' +
    '<div style="font:800 17px/1.3 Arial,sans-serif;color:#8a4b1f;margin-top:4px">' + E(x.price || "No price listed") + '</div>' +
    (x.location ? '<div style="font:13px/1.45 Arial,sans-serif;color:#6b5b4a">' + E(x.location) + ' · Facebook Marketplace</div>' : '<div style="font:13px/1.45 Arial,sans-serif;color:#6b5b4a">Facebook Marketplace</div>') +
    lines.join("") +
    '<div style="font:bold 13px Arial,sans-serif;margin-top:8px"><a href="' + E(x.url) + '" style="color:#8a4b1f">Open on Facebook →</a>' +
    ' <span style="color:#d6c9b6">·</span> <a href="' + E(urls.hide(x)) + '" style="color:#9a8b7a;font-weight:normal">Hide this one</a></div>' +
    '</td></tr></table>';
}
export function watchHotHtml(w, x, urls) {
  return '<tr><td style="padding:12px 12px 4px;font:bold 22px Georgia,serif;color:#2b2118">New on Facebook for “' + E(w.term) + '”</td></tr>' +
    '<tr><td style="padding:0 12px 10px;font:14px/1.5 Arial,sans-serif;color:#6b5b4a">Your Hot watch spotted it just now.</td></tr>' +
    '<tr><td style="padding:0 12px">' + card(x, urls) + '</td></tr>';
}
/* groups: [{ w, items }] */
export function watchDigestHtml(groups, urls) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  let body = '<tr><td style="padding:12px 12px 6px;font:bold 24px Georgia,serif;color:#2b2118">' + total + ' new on Facebook</td></tr>' +
    '<tr><td style="padding:0 12px;font:14px/1.5 Arial,sans-serif;color:#6b5b4a">' + groups.map((g) => E(g.w.term) + " (" + g.items.length + ")").join(" · ") + '</td></tr>';
  for (const g of groups) {
    body += '<tr><td style="padding:20px 12px 8px;font:bold 19px Georgia,serif;color:#2b2118">' + E(g.w.term) +
      ' <span style="font:normal 14px Arial,sans-serif;color:#6b5b4a">· ' + g.items.length + ' new · <a href="' + E(urls.watch(g.w)) + '" style="color:#8a4b1f">See it in Prowl</a></span></td></tr>' +
      '<tr><td style="padding:0 12px">' + g.items.map((x) => card(x, urls)).join("") + '</td></tr>';
  }
  return body;
}
export function watchText(groups, urls) {
  const out = [];
  for (const g of groups) {
    out.push(g.w.term + " (" + g.items.length + " new on Facebook)");
    for (const x of g.items) {
      const r = x.read || {};
      out.push("- " + x.title + (x.price ? " · " + x.price : "") + (x.location ? " · " + x.location : ""), "  " + x.url);
      for (const l of [r.line, r.below].concat(r.flags || [])) if (l) out.push("  " + l);
      out.push("  Hide this one: " + urls.hide(x));
    }
    out.push("");
  }
  return out.join("\n");
}
export function watchSubject(groups) {
  if (groups.length === 1 && groups[0].items.length === 1) { const x = groups[0].items[0]; return "New on Facebook: " + x.title.slice(0, 70) + (x.price ? " · " + x.price : ""); }
  const n = groups.reduce((a, g) => a + g.items.length, 0);
  return n + " new on Facebook for " + (groups.length === 1 ? groups[0].w.term : groups.length + " watches");
}
