/* v196: GET /version names the live worker version, so .github/workflows/verify-worker.yml can confirm after each merge
   that Cloudflare Workers Builds deployed it. Run: node --test worker/__tests__/version-route.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeKey } from "../metrics.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const WORKFLOW = readFileSync(new URL("../../.github/workflows/verify-worker.yml", import.meta.url), "utf8");
const VERSION = /^const WORKER_VERSION = "(v\d+)";/m.exec(INDEX)[1];
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const versionResponse = new Function("WORKER_VERSION", indexFn("versionResponse") + "\nreturn versionResponse;")(VERSION);

test("GET /version answers the worker version and nothing else, never cached", async () => {
  const r = versionResponse("GET");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { worker: VERSION });
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Content-Type"), "application/json");
  const head = versionResponse("HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const m of ["POST", "PUT", "DELETE"]) assert.equal(versionResponse(m).status, 405, m);
});

test("the route is wired ahead of every other route, and kept out of the traffic numbers", () => {
  const h = INDEX.indexOf("async function handleFetch(");
  const route = INDEX.indexOf('if (url.pathname === "/version") return versionResponse(request.method);', h);
  assert.ok(route > h, "routed in handleFetch");
  assert.ok(route < INDEX.indexOf("const origin = request.headers.get(\"Origin\")", h), "before the origin rule and every other route");
  assert.equal(routeKey("/version"), null);
  assert.equal(routeKey("/versions"), "other", "only the exact path");
});

test("verify-worker.yml waits for the version in worker/index.js after each worker merge to main", () => {
  assert.match(WORKFLOW, /on:\n  push:\n    branches: \[main\]\n    paths: \['worker\/\*\*'\]/);
  assert.match(WORKFLOW, /workflow_dispatch:/);
  assert.match(WORKFLOW, /permissions:\n  contents: read/);
  assert.match(WORKFLOW, /grep -oE 'const WORKER_VERSION = "v\[0-9\]\+"' worker\/index\.js/, "reads the same line the worker sets");
  assert.match(WORKFLOW, /https:\/\/prowl\.thebluecloud\.workers\.dev\/version/);
  assert.match(WORKFLOW, /"worker":"v\[0-9\]\+"/, "reads the field /version answers");
  assert.doesNotMatch(WORKFLOW, /secrets\./, "needs no secrets");
  assert.match(INDEX, /JSON\.stringify\(\{ worker: WORKER_VERSION \}\)/);
});
