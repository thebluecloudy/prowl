/* v131 (the owner: "3 hunts is good, pro gets unlimited ... once they get the email, they can adjust this"): one free
   plan for every member, 3 hunts at the pace they pick; Pro up to 100 hunts; Pro photo checks unlimited with a
   fair-use ceiling of 100 a day. Run: node --test worker/__tests__/plans-v131.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) {
  const m = new RegExp("^function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const line = (name) => new RegExp("^function " + name + "\\(.*$", "m").exec(INDEX)[0] + "\n";
const num = (name) => Number(new RegExp("^const " + name + " = (\\d+);", "m").exec(INDEX)[1]);

const AL_MAX_HUNTS = num("AL_MAX_HUNTS");
const H = new Function("AL_MAX_HUNTS", "AL_FREQ_DAYS", "alPrefs",
  line("alFree") + line("alFreeWeekly") + fn("alActive") + line("alSendDay") + "return { alFree, alFreeWeekly, alActive, alSendDay };");
const prefsOf = (sub) => ({ freq: (sub.prefs && sub.prefs.freq) || "daily", mute: (sub.prefs && sub.prefs.mute) || [] });
const { alFree, alFreeWeekly, alActive, alSendDay } = H(AL_MAX_HUNTS, { daily: [0, 1, 2, 3, 4, 5, 6], mwf: [1, 3, 5], weekly: [1] }, prefsOf);
const hunts = (n) => Array.from({ length: n }, (_, i) => "hunt " + i);
const NEW = "2026-10-20", OLD = "2026-09-01";

test("Free is 3 hunts for every member, old or new; ALERT_FREE_HUNTS still sets it", () => {
  assert.equal(alFree({}, { created: NEW }), 3);
  assert.equal(alFree({}, { created: OLD }), 3);
  assert.equal(alFree({}, undefined), 3);
  assert.equal(alFree({ ALERT_FREE_HUNTS: "5" }, { created: NEW }), 5);
  assert.equal(alFree({ ALERT_FREE_HUNTS_NEW: "1" }, { created: NEW }), 3, "the old new-member setting no longer applies");
  assert.equal(alActive({}, { created: NEW, hunts: hunts(10) }).length, 3);
});

test("no member is held to Mondays: Free sends on the days they pick", () => {
  const sub = { created: NEW, pro: false, prefs: { freq: "daily" } };
  assert.equal(alFreeWeekly(sub), false);
  for (let wday = 0; wday < 7; wday++) assert.equal(alSendDay(sub, { wday }), true, "daily, day " + wday);
  const mwf = { created: NEW, prefs: { freq: "mwf" } };
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((wday) => alSendDay(mwf, { wday })), [false, true, false, true, false, true, false]);
});

test("Pro covers up to 100 hunts", () => {
  assert.equal(AL_MAX_HUNTS, 100);
  assert.equal(alActive({}, { pro: true, hunts: hunts(140) }).length, 100);
  assert.equal(alActive({}, { pro: true, hunts: hunts(40), prefs: { mute: ["hunt 3"] } }).length, 39, "muted hunts stay out");
});

test("Pro photo checks are unlimited with a fair-use ceiling of 100 a day; Free stays 1", () => {
  assert.equal(num("PHOTO_PRO_PER_DAY"), 100);
  assert.equal(num("PHOTO_FREE_PER_DAY"), 1);
});

test("the Pro perks and the welcome email say the new plan, never 25", () => {
  const perks = new Function("AL_MAX_HUNTS", "PHOTO_PRO_PER_DAY", fn("alPerks") + "return alPerks();")(AL_MAX_HUNTS, num("PHOTO_PRO_PER_DAY"));
  assert.match(perks[0], /^Prowl Alerts for up to 100 hunts, or your whole Den, as often as you pick$/);
  assert.match(perks[2], /^Unlimited photo checks \(fair use, 100 a day\)/);
  const code = INDEX.split("\n").filter((l) => !/^\s*\*/.test(l)).join("\n");   /* the header's history notes keep their old numbers */
  assert.doesNotMatch(code, /25 photo checks a day|up to 25 hunts|Get all ' \+ Math\.min\(all, AL_MAX_HUNTS\) \+ ' every day/);
});
