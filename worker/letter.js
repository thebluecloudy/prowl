/* v152: the weekly letter. Every Sunday evening the panther writes each member a letter about their week (Matt,
   2026-10-20, from Cat On Chair's Weekly Recap: "this is perfect ... everyone gets it, sunday is good").
   This module is pure (no fetch, no env, no KV): index.js keeps the week's tally in wk:<email>, asks eBay once to
   check a shorter hunt, sends the email and stores the letter for the app.
     wkAdd(wk, found, day)            -> the tally with today's new listings added
     wkFresh(day)                      -> an empty tally starting that day
     letterShorters(hunt)              -> shorter searches to try for a hunt that found nothing (letterShorter: the first)
     letterBuild(input)                -> { day, hello, lines:[{b?, t, url?, img?, hunt?, suggest?, n?}], sign }
     letterText(letter)                -> the letter as plain text (email text part, Share) */

export const WK_TOP = 6;          /* cheapest listings kept per hunt, for the best find */
export const WK_PRICES = 60;      /* prices kept per hunt, for its typical price */
export const LETTER_SIGN = "— the panther 🐾";

export function wkFresh(day) { return { from: String(day || ""), hunts: {} }; }
/* the tally, when it started at most 8 days before `day`; an older one (the letter was off, or no letter went) is
   not "this week" and starts over */
export function wkCur(wk, day) {
  const a = Date.parse(String(wk && wk.from || "") + "T00:00:00Z"), b = Date.parse(String(day || "") + "T00:00:00Z");
  return wk && wk.hunts && isFinite(a) && isFinite(b) && b - a <= 8 * 86400000 ? wk : null;
}

function priceN(p) {
  const s = String(p || "").trim();
  if (/\b[A-Z]{3}\s*$/.test(s) && !/\bUSD\s*$/.test(s)) return 0;   /* another currency: not compared with dollars */
  const m = /([\d,]+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
}

/* found = { huntName: [ {title, price, url, image, src} ] } as alCheck holds them */
export function wkAdd(wk, found, day) {
  const w = wkCur(wk, day) || wkFresh(day);
  Object.keys(found || {}).forEach((h) => {
    const list = (found[h] || []).filter((x) => x && typeof x.url === "string" && /^https:\/\//.test(x.url));
    if (!list.length) return;
    const k = String(h).toLowerCase();
    const cur = w.hunts[k] || { name: String(h).slice(0, 80), n: 0, prices: [], top: [], srcs: [] };
    cur.n += list.length;
    list.forEach((x) => {
      const n = priceN(x.price);
      if (n > 0) cur.prices.push(n);
      if (x.src && cur.srcs.indexOf(x.src) === -1) cur.srcs.push(String(x.src).slice(0, 20));
      if (n > 0 && !cur.top.some((y) => y.u === x.url)) cur.top.push({ t: String(x.title || "").slice(0, 140), p: String(x.price || "").slice(0, 24), n: n, u: x.url,
        i: typeof x.image === "string" && /^https:\/\//.test(x.image) ? x.image : "", s: String(x.src || "").slice(0, 20) });
    });
    cur.prices = cur.prices.slice(-WK_PRICES);
    cur.top.sort((a, b) => a.n - b.n);
    cur.top = cur.top.slice(0, WK_TOP);
    w.hunts[k] = cur;
  });
  return w;
}

function median(a) {
  const s = a.filter((n) => n > 0).slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
function money(n) { return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/* Words that make a hunt too narrow for any listing to match: years, model and part numbers, and the filler of a
   seller's own title. A shouted leading word ("MONSTOR") goes too. Then a few three-word versions to try, maker and
   thing first: the first word with the last two, the first two with the last, the last three.
   "MONSTOR Vendall 1988 Vending Machine Outer Frame Shell Cover" -> "Vendall vending machine". index.js asks eBay and
   offers the first that finds something; none that do, no suggestion. */
const SHORT_FILLER = { outer: 1, inner: 1, frame: 1, shell: 1, cover: 1, lot: 1, of: 1, the: 1, and: 1, with: 1, for: 1, a: 1, an: 1,
  vintage: 1, vtg: 1, antique: 1, rare: 1, original: 1, oem: 1, set: 1, piece: 1, pieces: 1, pcs: 1, new: 1, used: 1, only: 1,
  part: 1, parts: 1, replacement: 1, genuine: 1, authentic: 1, signed: 1, marked: 1, excellent: 1, condition: 1, mint: 1, nice: 1 };
export function letterShorters(hunt) {
  const words = String(hunt || "").replace(/["\u201c\u201d]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < 3) return [];
  let keep = words.filter((w) => !/\d/.test(w) && !SHORT_FILLER[w.toLowerCase().replace(/[^a-z]/g, "")] && /[a-z]/i.test(w));
  if (keep.length >= 4 && /^[A-Z]{4,}$/.test(keep[0])) keep = keep.slice(1);
  if (keep.length < 2) return [];
  const say = (ws) => ws.map((w, i) => (i ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
  const L = keep.length, c = L <= 3 ? [keep] : [[keep[0], keep[L - 2], keep[L - 1]], [keep[0], keep[1], keep[L - 1]], keep.slice(L - 3)];
  const out = [];
  c.forEach((ws) => { const t = say(ws); if (t.toLowerCase() !== String(hunt).trim().toLowerCase() && out.indexOf(t) === -1) out.push(t); });
  return out;
}
export function letterShorter(hunt) { return letterShorters(hunt)[0] || ""; }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(day) {
  const d = new Date(String(day) + "T12:00:00Z");
  return isFinite(d) ? DAYS[d.getUTCDay()] + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() : String(day || "");
}
const NAMES = { ebay: "eBay", etsy: "Etsy", shopgoodwill: "ShopGoodwill", chairish: "Chairish", poshmark: "Poshmark", depop: "Depop", vinted: "Vinted",
  grailed: "Grailed", salvation: "Salvation Army", hibid: "HiBid", craigslist: "Craigslist" };
function site(s) { return NAMES[s] || s || ""; }
function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

/* input = { day, hunts: [names the member hunts], wk, likes: [{u,t,p,s,i,at}] this week, quiet: {hunt, suggest, n} | null } */
export function letterBuild(input) {
  const day = String(input.day || ""), hunts = (input.hunts || []).filter(Boolean), wk = input.wk && input.wk.hunts ? input.wk : wkFresh(day);
  const rows = Object.keys(wk.hunts).map((k) => wk.hunts[k]).filter((x) => x && x.n > 0);
  const finds = rows.reduce((n, x) => n + x.n, 0);
  const sites = [];
  rows.forEach((x) => (x.srcs || []).forEach((s) => { if (sites.indexOf(s) === -1) sites.push(s); }));
  const lines = [];
  lines.push({ t: finds
    ? "This week I stalked your " + plural(hunts.length, "hunt") + " across " + plural(sites.length, "marketplace") + " and dragged back " + plural(finds, "new find") + "."
    : "This week I stalked your " + plural(hunts.length, "hunt") + " and came back with nothing new. Quiet weeks happen; the good ones turn up when you stop looking." });

  /* best find: the cheapest listing against its hunt's typical price this week, at least 10% under it */
  let best = null;
  rows.forEach((x) => {
    const med = median(x.prices || []);
    if (!med || (x.prices || []).length < 3) return;
    (x.top || []).forEach((it) => {
      const under = (med - it.n) / med;
      if (under >= 0.1 && (!best || under > best.under)) best = { it: it, med: med, under: under, hunt: x.name };
    });
  });
  if (best) lines.push({ b: "Best find:", t: best.it.t + ", " + best.it.p + (best.it.s ? " on " + site(best.it.s) : "") + ", under the " + money(best.med) + " it usually goes for this week.",
    url: best.it.u, img: best.it.i, hunt: best.hunt });
  else if (rows.length) {
    const top = rows.slice().sort((a, b) => b.n - a.n)[0];
    if (top) lines.push({ b: "Busiest hunt:", t: top.name + ", with " + plural(top.n, "new find") + "." });
  }

  const liked = (input.likes || []).filter((x) => x && x.u);
  if (liked.length) lines.push({ b: "Saved this week:", t: plural(liked.length, "find") + (liked[0].t ? ", the last one " + String(liked[0].t).slice(0, 80) + "." : ".") });

  const q = input.quiet;
  if (q && q.hunt) {
    lines.push(q.suggest && q.n > 0
      ? { b: "Quietest hunt:", t: "“" + q.hunt + "” turned up nothing all week. Want me to loosen it to “" + q.suggest + "”? It would have found " + plural(q.n, "listing") + " this week.",
          hunt: q.hunt, suggest: q.suggest, n: q.n }
      : { b: "Quietest hunt:", t: "“" + q.hunt + "” turned up nothing all week. I'll keep watching.", hunt: q.hunt });
  }
  lines.push({ t: "Same time next Sunday." });
  return { day: day, hello: dayLabel(day), lines: lines, sign: LETTER_SIGN, finds: finds, hunts: hunts.length };
}

export function letterText(letter) {
  const out = [letter.hello, ""];
  (letter.lines || []).forEach((l) => out.push((l.b ? l.b + " " : "") + l.t + (l.url ? " " + l.url : "")));
  out.push("", letter.sign);
  return out.join("\n");
}

/* The quiet hunt a letter talks about: the longest hunt that found nothing all week (long ones are the narrow ones) */
export function letterQuiet(hunts, wk) {
  const h = (wk && wk.hunts) || {};
  const quiet = (hunts || []).filter((x) => x && !(h[String(x).toLowerCase()] && h[String(x).toLowerCase()].n > 0));
  if (!quiet.length) return "";
  return quiet.slice().sort((a, b) => String(b).length - String(a).length)[0];
}
