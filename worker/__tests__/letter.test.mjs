/* v152 the weekly letter (Matt, 2026-10-20, from Cat On Chair's Weekly Recap: "this is perfect ... everyone gets it,
   sunday is good"). Run: node --test worker/__tests__/letter.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wkAdd, wkFresh, wkCur, letterShorter, letterShorters, letterBuild, letterText, letterQuiet, WK_TOP, LETTER_SIGN } from "../letter.js";

const it = (title, price, src = "etsy", n = 0) => ({ title, price, url: "https://" + src + ".example/" + encodeURIComponent(title + price + n), image: "https://img.example/x.jpg", src });

test("the week's tally adds up each hunt's finds, keeps the cheapest few and the sites", () => {
  let wk = wkAdd(null, { "Rookwood owl": [it("Rookwood owl ashtray", "$190.00"), it("Rookwood owl", "$240.00", "poshmark")] }, "2026-10-19");
  wk = wkAdd(wk, { "Rookwood owl": [it("Rookwood owl paperweight", "$210.00", "ebay")], "ceramic panther": [it("Panther", "$40.00", "ebay")] }, "2026-10-20");
  assert.equal(wk.from, "2026-10-19", "the week starts on the first day anything was found");
  const r = wk.hunts["rookwood owl"];
  assert.equal(r.n, 3);
  assert.deepEqual(r.top.map(x => x.p), ["$190.00", "$210.00", "$240.00"], "cheapest first");
  assert.deepEqual(r.srcs.sort(), ["ebay", "etsy", "poshmark"]);
  assert.equal(wk.hunts["ceramic panther"].n, 1);
  const many = wkAdd(null, { h: Array.from({ length: 20 }, (_, i) => it("x", "$" + (i + 1) + ".00", "ebay", i)) }, "2026-10-19");
  assert.equal(many.hunts.h.top.length, WK_TOP);
  assert.equal(wkAdd(null, { h: [{ title: "bad", price: "$1", url: "javascript:x" }] }, "d").hunts.h, undefined, "only https listings count");
});

test("a shorter hunt drops years, model numbers and filler, keeps the maker and the thing", () => {
  assert.equal(letterShorter("MONSTOR Vendall 1988 Vending Machine Outer Frame Shell Cover"), "Vendall vending machine");
  assert.deepEqual(letterShorters("Rookwood Pottery ceramic owl Trinket pin ashtray"), ["Rookwood pin ashtray", "Rookwood pottery ashtray", "Trinket pin ashtray"], "the maker stays first");
  assert.deepEqual(letterShorters("Royal Haeger 1950s panther lamp"), ["Royal panther lamp", "Royal haeger lamp", "Haeger panther lamp"]);
  assert.equal(letterShorter("rookwood owl"), "", "two words is already short");
  assert.equal(letterShorter("1988 1989 lot"), "", "nothing left worth trying");
});

test("the quiet hunt is the longest one that found nothing all week", () => {
  const wk = wkAdd(null, { "rookwood owl": [it("Rookwood owl", "$10")] }, "d");
  assert.equal(letterQuiet(["rookwood owl", "pyrex", "MONSTOR Vendall 1988 Vending Machine"], wk), "MONSTOR Vendall 1988 Vending Machine");
  assert.equal(letterQuiet(["rookwood owl"], wk), "");
});

test("the letter: the week in numbers, the best find against its typical price, saved finds, the quiet hunt, the sign-off", () => {
  const wk = wkAdd(null, { "Rookwood owl": [it("Rookwood owl ashtray", "$150.00"), it("Rookwood owl a", "$200.00", "ebay"), it("Rookwood owl b", "$210.00", "poshmark"), it("Rookwood owl c", "$220.00", "ebay")] }, "2026-10-19");
  const L = letterBuild({ day: "2026-10-25", hunts: ["Rookwood owl", "MONSTOR Vendall 1988 Vending Machine"], wk: wk,
    likes: [{ u: "https://x", t: "Haeger panther lamp" }, { u: "https://y" }],
    quiet: { hunt: "MONSTOR Vendall 1988 Vending Machine", suggest: "Vendall vending machine", n: 6 } });
  assert.equal(L.hello, "Sunday, Oct 25");
  assert.equal(L.finds, 4);
  assert.match(L.lines[0].t, /^This week I stalked your 2 hunts across 3 marketplaces and dragged back 4 new finds\.$/);
  const best = L.lines.find(l => l.b === "Best find:");
  assert.match(best.t, /^Rookwood owl ashtray, \$150\.00 on Etsy, under the \$210\.00 it usually goes for this week\.$/);
  assert.match(best.url, /^https:\/\//);
  assert.match(L.lines.find(l => l.b === "Saved this week:").t, /^2 finds, the last one Haeger panther lamp\.$/);
  const q = L.lines.find(l => l.b === "Quietest hunt:");
  assert.match(q.t, /“MONSTOR Vendall 1988 Vending Machine” turned up nothing all week\. Want me to loosen it to “Vendall vending machine”\? It would have found 6 listings this week\./);
  assert.equal(q.suggest, "Vendall vending machine");
  assert.equal(L.sign, LETTER_SIGN);
  const txt = letterText(L);
  assert.match(txt, /^Sunday, Oct 25\n\nThis week I stalked/);
  assert.match(txt, /— the panther 🐾$/);
});

test("a suggestion that finds nothing is not offered; a quiet week says so kindly; no best find claim without a 10% gap", () => {
  const L = letterBuild({ day: "2026-10-25", hunts: ["a b c d"], wk: wkFresh("2026-10-19"), likes: [], quiet: { hunt: "a b c d", suggest: "b c", n: 0 } });
  assert.match(L.lines[0].t, /came back with nothing new/);
  const q = L.lines.find(l => l.b === "Quietest hunt:");
  assert.equal(q.suggest, undefined);
  assert.match(q.t, /I'll keep watching\.$/);
  const even = wkAdd(null, { h: [it("x", "$100"), it("y", "$100", "ebay"), it("z", "$100", "poshmark")] }, "d");
  const L2 = letterBuild({ day: "2026-10-25", hunts: ["h"], wk: even, likes: [] });
  assert.equal(L2.lines.find(l => l.b === "Best find:"), undefined);
  assert.match(L2.lines.find(l => l.b === "Busiest hunt:").t, /^h, with 3 new finds\.$/);
});

test("prices in another currency are not compared with dollars", () => {
  const wk = wkAdd(null, { h: [it("lamp", "180.00 CAD"), it("lamp2", "$100")] }, "d");
  assert.deepEqual(wk.hunts.h.prices, [100]);
});

/* index.js wiring */
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}

test("due on Sunday from 6pm in the member's time, once, unless off, mail off, paused or no hunts", () => {
  const src = "const AL_LETTER_HOUR = 18;\n" + fn("alLetterDue");
  const due = new Function("alPrefs", "alPaused", src + "\nreturn alLetterDue;")((s) => ({ letter: (s.prefs || {}).letter === "off" ? "off" : "" }), (s) => !!s.paused);
  const sun = { day: "2026-10-25", wday: 0, hour: 18 };
  const sub = { hunts: ["owl"], prefs: {} };
  assert.equal(due(sub, sun), true);
  assert.equal(due(sub, { ...sun, hour: 17 }), false, "not before 6pm");
  assert.equal(due(sub, { ...sun, wday: 1 }), false, "Sundays only");
  assert.equal(due({ ...sub, letter: "2026-10-25" }, sun), false, "once a Sunday");
  assert.equal(due({ ...sub, prefs: { letter: "off" } }, sun), false, "turned off");
  assert.equal(due({ ...sub, mail: "off" }, sun), false, "emails off");
  assert.equal(due({ ...sub, paused: 1 }, sun), false, "paused");
  assert.equal(due({ hunts: [], prefs: {} }, sun), false, "no hunts");
});

test("the worker keeps the tally, sends with a letter-only one-click unsubscribe, and serves the app", () => {
  assert.match(INDEX, /letter: p\.letter === "off" \? "off" : ""/, "prefs.letter survives a settings save");
  assert.match(INDEX, /await kvPut\(env, "wk:" \+ sub\.email, wkAdd\(await kvGet\(env, "wk:" \+ sub\.email, null\), found, now\.day\)\)/);
  assert.match(INDEX, /if \(lettersLeft > 0 && alLetterDue\(sub, loc\)\)/);
  assert.match(fn("alLetterMake"), /letterShorters\(qh\)\.slice\(0, 2\)/, "at most two eBay checks");
  /* v184: built from a copy with a sign-in ticket (alMailSub), never saved */
  assert.match(fn("alLetterSend"), /const ms = await alMailSub\(env, sub\);[\s\S]*alSend\(env, sub\.email, subject, alLetterHtml\(env, ms, L\), [^;]*alLetterUnsubUrl\(ms\)\);/);
  assert.match(fn("alLetterUnsubUrl"), /alUnsubUrl\(sub\) \+ "&w=letter"/);
  assert.match(fn("alUnsub"), /if \(p\.w === "letter"\) \{[\s\S]*letter: "off"[\s\S]*alMerge\(env, sub, \["prefs"\]\)/);
  assert.match(INDEX, /url\.pathname === "\/alerts\/letter" && request\.method === "POST"\) return alLetterRoute/);
  for (const list of [/"pp:", "wk:", "lt:"\]\) \{ const v = await kvGet/, /"pq:", "pp:", "wk:", "lt:"\]\) await env\.PROWL_ALERTS\.delete/, /"pq:", "pp:", "wk:", "lt:"\]\) \{ await kv\.delete/])
    assert.match(INDEX, list, "wk: and lt: move with the member and go with them");
  assert.match(INDEX, /const WORKER_VERSION = "v(\d+)"/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)"/.exec(INDEX)[1]) >= 152);
});

/* the review of v152 */
test("a tally older than a week starts over, so a letter never calls months of finds this week", () => {
  const old = wkAdd(null, { h: [it("x", "$10")] }, "2026-09-01");
  assert.equal(wkCur(old, "2026-10-25"), null);
  assert.equal(wkCur(old, "2026-09-08"), old, "8 days is still this week");
  const w = wkAdd(old, { h: [it("y", "$12")] }, "2026-10-20");
  assert.equal(w.from, "2026-10-20");
  assert.equal(w.hunts.h.n, 1, "the old finds are gone");
});

test("the marker is saved right after the send, letters use the lean eBay search and take one hunt of the run", () => {
  const send = fn("alLetterSend");
  assert.ok(send.indexOf('sub.letter = loc.day;\n  await alMerge(env, sub, ["letter"]);') < send.indexOf('"lt:" + sub.email'), "marker before the other writes");
  assert.match(fn("alLetterMake"), /ebayLean\(t, env, ""\)/);
  assert.doesNotMatch(fn("alLetterMake"), /liveFetch\(/);
  assert.match(fn("alLetterMake"), /const act = alActive\(env, sub\);/);
  assert.match(INDEX, /lettersLeft--; budget = Math\.max\(0, budget - 1\);/);
});
