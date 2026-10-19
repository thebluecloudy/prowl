/* v125: where visitors came from (Cloudflare Web Analytics referrers), read for the admin's Visitors card since v127. */
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
  return new Function(...k, "let REFS = { k: '', at: 0, v: null };\n" + fn("cfReferrers") + "\nreturn { cfReferrers };")(...k.map((x) => deps[x]));
}

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
