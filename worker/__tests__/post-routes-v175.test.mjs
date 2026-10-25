/* v175 Check with Google Lens opened Lens's intro page: POST /lens/up sat below the "GET only" guard and was 405, as
   group trips' POSTs were before v156. Every POST route must be dispatched before that guard.
   Run: node --test worker/__tests__/post-routes-v175.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const GUARD = 'return json({ error: "GET only" }, 405, origin);';

test("no POST route is dispatched after the GET-only guard", () => {
  const g = INDEX.indexOf(GUARD);
  assert.ok(g > 0, "the guard is there");
  assert.equal(INDEX.indexOf(GUARD, g + 1), -1, "one guard");
  const after = INDEX.slice(g).split("\n").filter((l) => /request\.method === "POST"/.test(l));
  assert.deepEqual(after, [], "POST routes below the guard are never reached");
});

test("the Lens photo upload is routed before the guard", () => {
  const at = INDEX.search(/url\.pathname === "\/lens\/up" && request\.method === "POST"\) return lensUp\(request, env, origin\)/);
  assert.ok(at > 0 && at < INDEX.indexOf(GUARD));
  assert.match(INDEX, /^const WORKER_VERSION = "v175";$/m);
});
