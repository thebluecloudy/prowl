/* v157: Facebook watches, the pure part (watch.js): plans, goal sentences, add/change/off, the baseline rule, filters,
   the authoritative diff, the honest price read, finds kept for Flock, and the email bodies.
   Run: node --test worker/__tests__/fb-watch.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  watchPlan, watchGoal, watchTerm, watchSkip, watchUpsert, watchId, watchList, watchFit, watchItems, watchComps, watchMatch,
  watchSeen, watchDigest, watchIngest, watchRead, watchFindsMerge, watchHotHtml, watchDigestHtml, watchText, watchSubject, watchPrice,
  WATCH_METROS, WATCH_PRO_MAX, WATCH_SEEN_DAYS, WATCH_FINDS_MAX,
} from "../watch.js";

const NOW = Date.parse("2026-10-21T15:00:00Z"), DAY = 86400000;
const FREE = watchPlan(false), PRO = watchPlan(true);
const add = (list, input, plan = PRO, id = "wabcdefgh", now = NOW) => watchUpsert(list, input, plan, now, id);
const IT = (id, extra = {}) => ({ id: String(id), title: "Ceramic black panther TV lamp " + id, price: "$150", image: "https://scontent.xx.fbcdn.net/v/" + id + ".jpg", location: "Novi, MI", ...extra });

test("plans: Free holds 1 watch at Weekly; Pro holds 25 at Daily with 3 Hot", () => {
  assert.deepEqual(FREE, { pro: false, max: 1, hot: 0, tiers: ["weekly"] });
  assert.deepEqual(PRO, { pro: true, max: 25, hot: 3, tiers: ["weekly", "daily", "hot"] });
});

test("a goal sentence resolves to a term, and its price becomes the ceiling", () => {
  assert.deepEqual(watchGoal("Find me a ceramic panther lamp under $200 on Facebook please"), { term: "ceramic panther lamp", ceiling: 200 });
  assert.deepEqual(watchGoal("I'm looking for a Blenko glass decanter near me"), { term: "blenko glass decanter", ceiling: 0 });
  assert.deepEqual(watchGoal("Let me know when someone lists a Pyrex butterprint bowl, no more than $1,250."), { term: "pyrex butterprint bowl", ceiling: 1250 });
  assert.deepEqual(watchGoal("roseville jardiniere"), { term: "roseville jardiniere", ceiling: 0 }, "a plain term comes back as it is");
  assert.equal(watchTerm("  Fire-King   JADEITE  "), "fire-king jadeite");
  assert.equal(watchTerm("x".repeat(80)).length, 60);
});

test("skip-words: words or short phrases, lowercased, no repeats, nothing too short or long", () => {
  assert.deepEqual(watchSkip("Repro, lamp shade; x, REPRO\nreproduction style piece only"), ["repro", "lamp shade"]);
  assert.deepEqual(watchSkip(["Chip!", "chip"]), ["chip"]);
  assert.equal(watchSkip(Array.from({ length: 40 }, (_, i) => "word" + i)).length, 20);
});

test("add: metros default to near you, at most 3 known ones; the ceiling is whole dollars", () => {
  const r = add([], { term: "Ceramic Panther", tier: "daily", metros: ["detroit", "gotham", "local", "nyc", "la"], ceiling: "$1,200", skip: "repro" });
  assert.equal(r.watch.term, "ceramic panther");
  assert.deepEqual(r.watch.metros, ["detroit", "local", "nyc"]);
  assert.equal(r.watch.ceiling, 1200);
  assert.deepEqual(r.watch.skip, ["repro"]);
  assert.equal(r.watch.gen, 1);
  assert.equal(r.watch.activeAt, "", "not active until its baseline check");
  assert.deepEqual(add([], { term: "x" }).watch.metros, ["local"]);
  for (const k of Object.keys(WATCH_METROS)) assert.ok(k === "local" || WATCH_METROS[k].loc, k + " has a place");
});

test("add: the plan's limits, said in human words", () => {
  let r = add([], { term: "panther", tier: "daily" }, FREE);
  assert.equal(r.status, 403); assert.match(r.error, /Daily watches come with Prowl Pro/);
  r = add([], { term: "panther", tier: "hot" }, FREE);
  assert.match(r.error, /Hot watches come with Prowl Pro/);
  const one = add([], { term: "panther", tier: "weekly" }, FREE).list;
  r = add(one, { term: "owl", tier: "weekly" }, FREE, "wbbbbbbbb");
  assert.equal(r.status, 403); assert.match(r.error, /free plan holds one watch/);
  let list = [];
  for (let i = 0; i < 3; i++) list = add(list, { term: "hunt " + i, tier: "hot" }, PRO, "whot0000" + i).list;
  r = add(list, { term: "hunt 3", tier: "hot" }, PRO, "whot00003");
  assert.match(r.error, /already have 3 Hot watches/);
  assert.equal(add(list, { id: "whot00001", tier: "hot", ceiling: 50 }).watch.tier, "hot", "a Hot watch stays Hot when it is edited");
  for (let i = 3; i < WATCH_PRO_MAX; i++) list = add(list, { term: "hunt " + i, tier: "daily" }, PRO, "wday000" + String(i).padStart(2, "0")).list;
  r = add(list, { term: "one more" }, PRO, "wzzzzzzzz");
  assert.match(r.error, /holds 25 watches/);
  assert.equal(add(list, { term: "hunt 1" }, PRO, "wzzzzzzzz").status, 409, "the same hunt twice");
  assert.equal(add([], { term: "me@example.com" }).status, 400);
  assert.equal(add([], { term: "  " }).status, 400);
  assert.equal(add([], { term: "x", tier: "monthly" }).status, 400);
});

test("change: new filters start a new baseline; the tier alone does not", () => {
  const a = add([], { term: "panther", tier: "daily", ceiling: 100 });
  const live = { ...a.watch, activeAt: "2026-10-01T00:00:00Z", filtered: 4, found: 2 };
  let r = add([live], { id: live.id, tier: "hot" });
  assert.equal(r.watch.gen, 1); assert.equal(r.watch.activeAt, live.activeAt); assert.equal(r.watch.filtered, 4);
  r = add([live], { id: live.id, ceiling: 200 });
  assert.equal(r.watch.gen, 2); assert.equal(r.watch.activeAt, ""); assert.equal(r.watch.filtered, 0); assert.equal(r.watch.found, 0);
  r = add([live], { id: live.id, skip: "repro" }); assert.equal(r.watch.gen, 2);
  r = add([live], { id: live.id, metros: ["detroit"] }); assert.equal(r.watch.gen, 2);
  r = add([live], { id: live.id, tier: "off" });
  assert.deepEqual(r.list, []); assert.equal(r.removed.id, live.id);
  assert.equal(add([], { id: "wnope0000", tier: "off" }).status, 404);
});

test("ids, the stored list and a plan that shrank", () => {
  assert.match(watchId(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])), /^w[a-z0-9]{8}$/);
  const good = add([], { term: "a" }).watch;
  assert.deepEqual(watchList({ watches: [good, { id: "bad", term: "x", tier: "daily" }, null, { ...good, id: "wcccccccc", tier: "yearly" }] }), [good]);
  assert.deepEqual(watchList(null), []);
  const list = [{ ...good, tier: "hot" }, { ...good, id: "wbbbbbbbb", tier: "daily" }];
  const fit = watchFit(list, FREE);
  assert.deepEqual(fit.map((w) => [w.runs, w.paused]), [["weekly", false], ["weekly", true]], "the oldest stays on at Weekly, the rest wait");
  const four = [0, 1, 2, 3].map((i) => ({ ...good, id: "whot0000" + i, tier: "hot" }));
  assert.deepEqual(watchFit(four, PRO).map((w) => w.runs), ["hot", "hot", "hot", "daily"]);
});

test("reported listings are cleaned: Facebook ids, fbcdn photos, no email or phone, a sane listed time", () => {
  const out = watchItems([
    IT(1234567, { title: "Panther, call 313-555-1212 or me@x.com", listed: 1790000000 }),
    IT(1234567), { id: "12", title: "short id" }, { id: "abc12345", title: "letters" }, IT(7654321, { image: "https://evil.example/a.jpg", price: "make offer", listed: 5 }),
    null, "x",
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Panther, call [phone] or [email]");
  assert.equal(out[0].url, "https://www.facebook.com/marketplace/item/1234567/");
  assert.equal(out[0].listed, 1790000000);
  assert.equal(out[1].image, ""); assert.equal(out[1].price, ""); assert.equal(out[1].listed, 0);
  assert.deepEqual(watchComps([10, "20", -1, 0, "x", 2e6]), [10, 20]);
  assert.equal(watchPrice("$1,200"), 1200); assert.equal(watchPrice("Free"), 0); assert.ok(Number.isNaN(watchPrice("")));
});

test("filters: over the ceiling or holding a skip-word is held back; a listing without a price passes the ceiling", () => {
  const w = { ceiling: 100, skip: ["repro", "lamp shade"] };
  assert.equal(watchMatch(w, { title: "Panther", price: "$150" }), "ceiling");
  assert.equal(watchMatch(w, { title: "Panther", price: "$100" }), "");
  assert.equal(watchMatch(w, { title: "Panther REPRO!", price: "$10" }), "skip");
  assert.equal(watchMatch(w, { title: "Panther reproduction", price: "$10" }), "", "whole words only");
  assert.equal(watchMatch(w, { title: "Panther with lamp shade", price: "" }), "skip");
  assert.equal(watchMatch(w, { title: "Panther", price: "" }), "");
});

test("baseline: the first check fills silently, then only listings first seen after it alert", () => {
  const w = add([], { term: "panther", tier: "daily", ceiling: 200, skip: "repro" }).watch;
  const first = watchIngest(w, null, watchItems([IT(1000001), IT(1000002)]), {}, [], NOW);
  assert.equal(first.baseline, true); assert.equal(first.finds.length, 0); assert.equal(first.filtered, 0);
  assert.equal(first.seen.g, 1); assert.equal(first.seen.at, new Date(NOW).toISOString());
  const second = watchIngest(w, first.seen, watchItems([IT(1000001), IT(1000003), IT(1000004, { price: "$900" }), IT(1000005, { title: "Panther repro" }), IT(1000006)]), { 1000006: 1 }, [], NOW + 3600000);
  assert.equal(second.baseline, false);
  assert.deepEqual(second.finds.map((x) => x.id), ["1000003"], "the old one is seen; the dear one and the repro are held back; the hidden one is skipped");
  assert.equal(second.filtered, 2);
  assert.equal(second.fresh, 4);
  assert.equal(second.finds[0].found, "2026-10-21");
  assert.equal(second.seen.at, first.seen.at, "activation time stays");
  const again = watchIngest(w, second.seen, watchItems([IT(1000003), IT(1000004, { price: "$900" })]), {}, [], NOW + 7200000);
  assert.equal(again.finds.length, 0, "reported twice, alerts once"); assert.equal(again.filtered, 0, "counted once"); assert.equal(again.fresh, 0);
  const changed = { ...w, gen: 2 };
  const re = watchIngest(changed, again.seen, watchItems([IT(1000007)]), {}, [], NOW + 9000000);
  assert.equal(re.baseline, true, "new filters, a new baseline"); assert.equal(re.finds.length, 0); assert.ok(re.seen.ids["1000001"], "earlier ids stay seen");
});

test("seen state ages out after 30 days; the digest is the last 8 digits", () => {
  const s = watchSeen({ g: 1, at: "x", ids: { 1234567890123: NOW - 2 * DAY, 2222222: NOW - (WATCH_SEEN_DAYS + 1) * DAY, bad: NOW } }, NOW);
  assert.deepEqual(Object.keys(s.ids), ["1234567890123"]);
  assert.equal(watchDigest(s), "67890123");
  assert.deepEqual(watchSeen(null, NOW), { g: 0, at: "", ids: {} });
});

test("the price read: asking prices only, said as such; too few, free and unpriced say so instead of guessing", () => {
  const comps = [100, 110, 120, 130, 140, 150];
  let r = watchRead({ title: "Panther", price: "$60" }, comps.concat(60), NOW);
  assert.equal(r.verdict, "DEAL");
  assert.match(r.line, /^Fair price\? Looks like a deal, against 6 asking prices .*\(asking, not sold\)/, "its own price is not one of the comps");
  assert.equal(r.below, "$65 below the usual asking price nearby ($125).");
  r = watchRead({ title: "Panther", price: "$125" }, comps, NOW);
  assert.equal(r.verdict, "FAIR"); assert.equal(r.below, "", "not below: no below line");
  r = watchRead({ title: "Panther", price: "$200" }, comps, NOW);
  assert.equal(r.verdict, "HIGH");
  r = watchRead({ title: "Panther", price: "$60" }, [100, 110, 120, 130], NOW);
  assert.equal(r.verdict, ""); assert.match(r.line, /Too few listings nearby/); assert.equal(r.below, "", "never estimated");
  assert.match(watchRead({ title: "Panther", price: "Free" }, comps, NOW).line, /free/);
  assert.match(watchRead({ title: "Panther", price: "" }, comps, NOW).line, /No price/);
});

test("the condition-not-priced-in and stale flags fire only when they should", () => {
  const comps = [100, 110, 120, 130, 140, 150];
  assert.deepEqual(watchRead({ title: "Panther, chipped ear", price: "$130" }, comps, NOW).flags, ["The title says “chipped”, and the price doesn’t seem to allow for it."]);
  assert.deepEqual(watchRead({ title: "Panther, chipped ear", price: "$40" }, comps, NOW).flags, [], "priced in: a deal");
  assert.deepEqual(watchRead({ title: "Panther, chipped ear", price: "$130" }, [1, 2], NOW).flags, [], "no comps, no claim");
  const listed = Math.floor((NOW - 30 * DAY) / 1000);
  assert.deepEqual(watchRead({ title: "Panther", price: "$125", listed }, comps, NOW).flags, ["Listed 4 weeks ago, so it has sat a while. An offer may land."]);
  assert.deepEqual(watchRead({ title: "Panther", price: "$125", listed: Math.floor((NOW - 3 * DAY) / 1000) }, comps, NOW).flags, []);
  assert.deepEqual(watchRead({ title: "Panther", price: "$125" }, comps, NOW).flags, [], "no listed time, no stale flag");
});

test("finds for Flock and the Den: newest first, one per listing, 60 at most, 30 days", () => {
  const old = { items: [{ id: "1", found: "2026-10-20" }, { id: "2", found: "2026-09-01" }] };
  assert.deepEqual(watchFindsMerge(old, [{ id: "3", found: "2026-10-21" }, { id: "1", found: "2026-10-21" }], NOW).items.map((x) => x.id), ["3", "1"]);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), found: "2026-10-21" }));
  assert.equal(watchFindsMerge(null, many, NOW).items.length, WATCH_FINDS_MAX);
});

test("the emails: photo, title, price, city, the clean link, the read and a Hide link; text and subject too", () => {
  const w = { term: "ceramic panther" };
  const x = { id: "1234567", title: "Panther <b>lamp</b>", price: "$60", url: "https://www.facebook.com/marketplace/item/1234567/", image: "https://scontent.xx.fbcdn.net/a.jpg", location: "Novi, MI",
    read: watchRead({ title: "Panther, chipped", price: "$130" }, [100, 110, 120, 130, 140, 150], NOW) };
  const urls = { hide: (i) => "https://w.example/watch-hide?i=" + i.id, watch: (ww) => "https://p.example/?q=" + encodeURIComponent(ww.term) };
  const hot = watchHotHtml(w, x, urls);
  assert.match(hot, /New on Facebook for “ceramic panther”/);
  assert.match(hot, /src="https:\/\/scontent\.xx\.fbcdn\.net\/a\.jpg"/);
  assert.match(hot, /Panther &lt;b&gt;lamp&lt;\/b&gt;/, "escaped");
  assert.match(hot, /\$60/); assert.match(hot, /Novi, MI/);
  assert.match(hot, /href="https:\/\/www\.facebook\.com\/marketplace\/item\/1234567\/"/, "the clean link, no tagging");
  assert.match(hot, /Fair price\? Looks fair/); assert.match(hot, /chipped/);
  assert.match(hot, /watch-hide\?i=1234567" [^>]*>Hide this one/);
  const groups = [{ w, items: [x, { ...x, id: "7654321" }] }, { w: { term: "owl" }, items: [x] }];
  const dg = watchDigestHtml(groups, urls);
  assert.match(dg, /3 new on Facebook/); assert.match(dg, /ceramic panther \(2\) · owl \(1\)/);
  assert.match(dg, /See it in Prowl/);
  const t = watchText(groups, urls);
  assert.match(t, /ceramic panther \(2 new on Facebook\)/); assert.match(t, /Hide this one: https:\/\/w\.example\/watch-hide\?i=7654321/);
  assert.equal(watchSubject([{ w, items: [x] }]), "New on Facebook: Panther <b>lamp</b> · $60");
  assert.equal(watchSubject(groups), "3 new on Facebook for 2 watches");
  assert.equal(watchSubject([groups[0]]), "2 new on Facebook for ceramic panther");
});
