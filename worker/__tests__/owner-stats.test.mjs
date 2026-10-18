/* v125: GET /owner-stats for the page's Den › Stats (owner key only) and Cloudflare Web Analytics referrers. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) {
  const m = new RegExp("^(export )?(async )?function " + name + "\\(", "m").exec(INDEX);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2).replace(/^export /, "");
}
function build(over) {
  const deps = Object.assign({ WORKER_VERSION: "v125", looksPersonal: (t) => /\d{3}-\d{4}/.test(t),
    json: (b, s) => ({ body: b, status: s }), capsCall: async () => ({}), fetch: async () => { throw new Error("no net"); } }, over);
  const k = Object.keys(deps);
  return new Function(...k, "let REFS = { k: '', at: 0, v: null };\n" + fn("isOwner") + fn("cfReferrers") + fn("ownerStats") + "\nreturn { ownerStats, cfReferrers };")(...k.map((x) => deps[x]));
}
const req = (key) => ({ headers: { get: (h) => (h === "X-Prowl-Owner" ? key : null) } });
const ENV = { OWNER_KEY: "owner-key-123456" };

test("refuses without the owner key", async () => {
  const { ownerStats } = build();
  assert.equal((await ownerStats(req(""), ENV, "o")).status, 403);
  assert.equal((await ownerStats(req("owner-key-123457"), ENV, "o")).status, 403);
});

test("14 days of people and searches, top terms without personal ones, referrers off without secrets", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { ownerStats } = build({ capsCall: async (n, op, q) => op === "days"
    ? (q.kind === "u" ? { days: { [today]: { v: 5, r: 17, n: 1 } } } : { days: { [today]: { v: 9, r: 40, n: 6 } } })
    : { top: [{ term: "mccoy", visitorDays: 4 }, { term: "call 555-1234", visitorDays: 1 }] } });
  const r = await ownerStats(req(ENV.OWNER_KEY), ENV, "o");
  assert.equal(r.status, 200);
  assert.equal(r.body.days.length, 14);
  assert.deepEqual(r.body.days[13], { day: today, people: 5, searches: 17, terms: 6 });
  assert.deepEqual(r.body.top, [{ term: "mccoy", people: 4 }]);
  assert.deepEqual(r.body.refs, { off: true });
});

test("referrers come from the GraphQL Analytics API", async () => {
  let sent = null;
  const { cfReferrers } = build({ fetch: async (u, o) => { sent = { u, o }; return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [{ rumPageloadEventsAdaptiveGroups: [
    { count: 40, dimensions: { refererHost: "Instagram.com" } }, { count: 12, dimensions: { refererHost: "" } }] }] } } }) }; } });
  const env = { CF_API_TOKEN: "t", CF_ACCOUNT_ID: "a", CF_SITE_TAG: "s" };
  const v = await cfReferrers(env, "2026-10-11", "2026-10-18");
  assert.equal(sent.u, "https://api.cloudflare.com/client/v4/graphql");
  assert.equal(sent.o.headers.Authorization, "Bearer t");
  assert.deepEqual(JSON.parse(sent.o.body).variables, { a: "a", s: "s", f: "2026-10-11", t: "2026-10-18" });
  assert.deepEqual(v.list, [{ host: "instagram.com", views: 40 }, { host: "", views: 12 }]);
});

test("a Cloudflare error is reported, not thrown", async () => {
  const { cfReferrers } = build({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: "not authorized" }] }) }) });
  const v = await cfReferrers({ CF_API_TOKEN: "t", CF_ACCOUNT_ID: "a", CF_SITE_TAG: "s" }, "2026-10-11", "2026-10-18");
  assert.match(v.error, /not authorized/);
});
