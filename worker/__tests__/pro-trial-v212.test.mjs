/* v212 (the owner, 2026-11-01: "Yes" to a 14-day reverse trial instead of a pay-only plan): members who sign up from
   PRO_TRIAL_FROM get Prowl Pro free for 14 days, no card; then Free with every hunt kept. A paid plan, a gift or the
   PRO_EMAILS list always wins; the shop being down never ends a running trial; it counts as hadPro.
   Run: node --test worker/__tests__/pro-trial-v212.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name, async) {
  const m = new RegExp("^" + (async ? "async " : "") + "function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const FROM = /^const PRO_TRIAL_FROM = "([^"]+)";/m.exec(INDEX)[1];
const T = new Function("PRO_TRIAL_FROM", fn("proTrialDays") + fn("proTrialEnds") + fn("proTrialPlan") +
  "return { proTrialDays, proTrialEnds, proTrialPlan };")(FROM);
const DAY = 86400000;

test("the trial starts with this release and is 14 days by default; PRO_TRIAL_DAYS sets it, 0 turns it off", () => {
  assert.equal(FROM, "2026-11-01");
  assert.equal(T.proTrialDays({}), 14);
  assert.equal(T.proTrialDays({ PRO_TRIAL_DAYS: "7" }), 7);
  assert.equal(T.proTrialDays({ PRO_TRIAL_DAYS: "0" }), 0);
  assert.equal(T.proTrialDays({ PRO_TRIAL_DAYS: "junk" }), 14);
  assert.equal(T.proTrialDays({ PRO_TRIAL_DAYS: "500" }), 14, "nothing silly");
  assert.equal(T.proTrialEnds({ PRO_TRIAL_DAYS: "0" }, { created: "2026-11-02T10:00:00.000Z" }), "");
});

test("members from before the trial existed, or with no sign-up day, get none", () => {
  assert.equal(T.proTrialEnds({}, { created: "2026-10-31T23:00:00.000Z" }), "");
  assert.equal(T.proTrialEnds({}, { created: "" }), "");
  assert.equal(T.proTrialEnds({}, {}), "");
});

test("a new member is Pro for 14 days from sign-up, then not", () => {
  const sub = { created: "2026-11-02T10:00:00.000Z" }, made = Date.parse(sub.created);
  assert.equal(T.proTrialEnds({}, sub), new Date(made + 14 * DAY).toISOString());
  const p = T.proTrialPlan({}, sub, made + 1000);
  assert.equal(p.pro, true);
  assert.equal(p.plan.via, "trial");
  assert.equal(p.plan.trial, true, "the admin counts it under Trial");
  assert.equal(p.plan.daysLeft, 14);
  assert.equal(T.proTrialPlan({}, sub, made + 13.5 * DAY).plan.daysLeft, 1);
  assert.equal(T.proTrialPlan({}, sub, made + 14 * DAY), null);
  assert.equal(T.proTrialPlan({}, sub, made + 30 * DAY), null);
});

/* alProSet itself, with the shop and free-Pro look-ups stubbed */
function proSet(shop, free) {
  const src = fn("alProSet", true);
  return new Function("alFreePro", "kvGet", "alProShop", "alNow", "proTrialPlan", "proTrialEnds",
    src + "return alProSet;")(async () => free || null, async () => null, async () => shop, () => ({ day: "2026-11-05" }),
    (env, sub) => T.proTrialPlan(env, sub, NOW), (env, sub) => T.proTrialEnds(env, sub));
}
const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const fresh = () => ({ email: "a@b.co", created: new Date(NOW - 2 * DAY).toISOString() });

test("a new member with no order is Pro on the trial, and that counts as their free time", async () => {
  const sub = fresh();
  assert.equal(await proSet({ pro: false, via: "orders" })({}, sub, true), true);
  assert.equal(sub.plan.via, "trial");
  assert.equal(sub.hadPro, true, "the shop then offers the paid plan, not PROWLMONTH");
  assert.equal(sub.trialEnds, T.proTrialEnds({}, sub));
});

test("the shop being down never ends a running trial", async () => {
  const sub = fresh();
  assert.equal(await proSet({ pro: null, via: "shopify unreachable" })({}, sub, true), true);
  assert.equal(sub.plan.via, "trial");
});

test("a paid order or a gift wins over the trial", async () => {
  const paid = fresh();
  await proSet({ pro: true, via: "orders", plan: { via: "order", amount: "7.00" } })({}, paid, true);
  assert.equal(paid.plan.via, "order");
  const gifted = fresh();
  await proSet({ pro: false }, { pro: true, via: "gift", plan: { via: "gift" } })({}, gifted, true);
  assert.equal(gifted.plan.via, "gift");
});

test("after 14 days they go back to Free, even when the shop cannot be asked", async () => {
  const sub = { email: "a@b.co", created: new Date(NOW - 15 * DAY).toISOString(), pro: true, plan: { via: "trial", trial: true } };
  assert.equal(await proSet({ pro: null, via: "shopify unreachable" })({}, sub, false), false);
  assert.equal(sub.plan, null);
  assert.ok(sub.trialEnds, "kept so the page can say the trial ended");
  const ok = { email: "a@b.co", created: new Date(NOW - 15 * DAY).toISOString(), pro: true, plan: { via: "trial" } };
  assert.equal(await proSet({ pro: false, via: "orders" })({}, ok, false), false);
});

test("an older member is untouched", async () => {
  const sub = { email: "a@b.co", created: "2026-10-10T10:00:00.000Z" };
  assert.equal(await proSet({ pro: false, via: "orders" })({}, sub, true), false);
  assert.equal(sub.trialEnds, undefined);
});

test("status tells the page when the trial ended, and the email warns in the last 3 days", () => {
  assert.match(INDEX, /trialEnded: !sub\.pro && sub\.trialEnds && Date\.parse\(sub\.trialEnds\) <= Date\.now\(\)/);
  assert.match(INDEX, /Your free Prowl Pro ends ' \+ \(tleft === 1 \? 'tomorrow'/);
  assert.match(INDEX, /tleft > 0 && tleft <= 3/);
});
