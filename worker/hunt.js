/* v117: one hunt across every live marketplace, the way Hark ran "ceramic panther" by hand on 2026-10-16.
   This module is pure (no fetch, no env): index.js fans out to the marketplaces and hands the rows here.
     huntCombine(rows, term) -> { median, picks, rows, dupes }
   1. Relevance: every meaningful query word (or a synonym, plurals folded) must be in the title, and no noise phrase.
   2. Cross-posts: the same title words (80%) on two different sites with prices within 6%; the dearer one is marked.
   3. Best picks: top 3 by cheap-vs-median, a quiet live auction, a lot or pair, a photo.
   4. Every source keeps a row with a note, and the login-only sites are listed as gated, so a hunt reads complete. */

export const HUNT_PICKS = 3;

/* Sites Prowl can't read without the visitor's own login. Shown as a row, never fetched. */
export const HUNT_GATED = {
  facebook: "Needs your Facebook login. Open it from the list below.",
  ebaysold: "eBay shows sold prices only when you are signed in. Open it from the list below."
};

/* Words that never count toward relevance. */
const HUNT_STOP = { a: 1, an: 1, the: 1, of: 1, and: 1, or: 1, with: 1, for: 1, vintage: 1, vtg: 1, antique: 1, old: 1, mcm: 1, retro: 1 };

/* Phrases that look like a match but aren't, keyed by a query word. */
const HUNT_NOISE = {
  panther: [/pink\s+panther/i, /marvel/i, /wakanda/i, /black\s+panther\s+party/i, /cartier/i, /panth[eè]re\s+de/i, /\bnfl\b|carolina\s+panthers/i],
  owl: [/owl\s+city/i, /night\s+owl\s+(camera|security)/i],
  pyrex: [/lid\s+only/i]
};

/* Equivalent words: "pottery" or "porcelain" satisfies "ceramic". */
const HUNT_SYN = {
  ceramic: ["ceramic", "ceramics", "pottery", "porcelain", "stoneware", "earthenware", "glazed", "chalkware"],
  figurine: ["figurine", "figure", "statue", "sculpture", "statuette"],
  lamp: ["lamp", "light", "lighting"]
};

export function huntWords(s) {
  return String(s || "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}
export function huntStem(w) { return w.replace(/ies$/, "y").replace(/(es|s)$/, ""); }

/* Query words that must each appear in the title, as lists of acceptable stems. */
export function huntNeeds(term) {
  const out = [];
  huntWords(term).forEach((w) => {
    if (HUNT_STOP[w] || w.length < 3) return;
    out.push((HUNT_SYN[w] || [w]).map(huntStem));
  });
  return out;
}

export function huntRelevant(title, needs, term) {
  const stems = huntWords(title).map(huntStem);
  for (let i = 0; i < needs.length; i++) {
    if (!needs[i].some((n) => stems.indexOf(n) !== -1)) return false;
  }
  const qs = huntWords(term);
  for (let k = 0; k < qs.length; k++) {
    const bad = HUNT_NOISE[qs[k]];
    if (bad && bad.some((re) => re.test(title))) return false;
  }
  return true;
}

export function huntPriceN(p) {
  const m = /([\d,]+(?:\.\d+)?)/.exec(String(p || ""));
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

/* Title fingerprint for cross-posts: sorted meaningful words, sizes and filler dropped. */
export function huntKey(title) {
  return huntWords(title).filter((w) => !HUNT_STOP[w] && !/^\d+(in|cm|x)?$/.test(w) && w.length > 2).map(huntStem).sort().join(" ");
}
export function huntSimilar(a, b) {
  const A = a ? a.split(" ") : [], B = b ? b.split(" ") : [];
  if (!A.length || !B.length) return false;
  let same = 0;
  A.forEach((w) => { if (B.indexOf(w) !== -1) same++; });
  return same / Math.max(A.length, B.length) >= 0.8;
}

export function huntScore(it, median) {
  let s = 0;
  if (it.priceN > 0 && median > 0) s += Math.max(-2, Math.min(3, (median - it.priceN) / median * 3));
  if (it.time_left && (it.bids || 0) <= 2) s += 1.5;        /* live auction, nobody chasing it yet */
  if (/\b(lot|pair|set of|\d+\s*(pc|pcs|pieces))\b/i.test(it.title)) s += 1;
  if (it.image) s += 0.5;
  if (it.dupeOf) s -= 1;                                      /* show the cheaper twin, not both */
  return s;
}

function money(n) { return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/* rows: [{ source, status, count, items:[{title, price, priceN, url, image, src, bids, time_left, where}], note }] */
export function huntCombine(rows, term) {
  const needs = huntNeeds(term), all = [];
  rows.forEach((r) => {
    r.count = (r.items || []).length;
    r.items = (r.items || []).filter((it) => huntRelevant(it.title, needs, term));
    r.kept = r.items.length;
    if (!r.note && r.count && !r.kept) r.note = r.count + " results, none were a true match";
    if (!r.note && !r.count) r.note = "nothing live right now";
    r.items.forEach((it) => { it.key = huntKey(it.title); all.push(it); });
  });

  const dupes = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.src === b.src || !a.priceN || !b.priceN) continue;
    if (Math.abs(a.priceN - b.priceN) / Math.max(a.priceN, b.priceN) > 0.06) continue;
    if (!huntSimilar(a.key, b.key)) continue;
    const dear = a.priceN > b.priceN ? a : b, cheap = dear === a ? b : a;
    if (dear.dupeOf) continue;
    dear.dupeOf = cheap.url;
    dupes.push([cheap.url, dear.url]);
  }

  const prices = all.map((x) => x.priceN).filter((n) => n > 0).sort((x, y) => x - y);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : 0;
  all.forEach((it) => { it.score = Math.round(huntScore(it, median) * 100) / 100; delete it.key; });
  const picks = all.filter((x) => !x.dupeOf).sort((x, y) => y.score - x.score).slice(0, HUNT_PICKS);

  Object.keys(HUNT_GATED).forEach((k) => rows.push({ source: k, status: 0, count: 0, kept: 0, items: [], note: HUNT_GATED[k], gated: true }));
  rows.sort((x, y) => y.kept - x.kept);
  return { median: median ? money(median) : "", picks: picks, rows: rows, dupes: dupes };
}

/* ---------- Craigslist: the static (no-JS) search list. Untested from a Worker address: /hunt reports its status. ---------- */
export function craigslistNormalize(html, max) {
  if (html && max && html.length > max) html = html.slice(0, max);
  if (!html || html.indexOf("cl-static-search-result") === -1) return /cl-search|search-results/i.test(html || "") ? [] : null;
  const parts = html.split(/<li[^>]+class="cl-static-search-result"/i), out = [];
  for (let i = 1; i < parts.length; i++) {
    const t = parts[i];
    const a = /<a href="(https:\/\/[a-z]+\.craigslist\.org\/[^"]+)"/i.exec(t);
    const ti = /<div class="title">([\s\S]*?)<\/div>/i.exec(t);
    const pr = /<div class="price">([\s\S]*?)<\/div>/i.exec(t);
    const loc = /<div class="location">([\s\S]*?)<\/div>/i.exec(t);
    if (!a || !ti) continue;
    const title = ti[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
    if (/wanted|we buy|cash for/i.test(title)) continue;
    out.push({ title: title.slice(0, 160), price: pr ? pr[1].replace(/<[^>]+>/g, "").trim() : "", url: a[1], image: "",
      src: "craigslist", where: loc ? loc[1].replace(/<[^>]+>/g, "").trim() : "" });
  }
  return out;
}
