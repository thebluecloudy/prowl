/* v178 (Matt, 2026-10-28, the security and trust plan: "No session-cookie storage or replay of anyone's account,
   including Matthew's own"): the Facebook Marketplace sweep through Matt's own account is retired. Both of its paths
   answer 410 and its code is gone. Replaces fb-sweep.test.mjs. Run: node --test worker/__tests__/fb-retired.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("/fb-ingest and /fb-finds answer 410 Gone, whatever the method or key", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/fb-ingest"\) return json\(\{ error: "gone" \}, 410, ""\);/);
  assert.match(INDEX, /if \(url\.pathname === "\/fb-finds"\) return json\(\{ error: "gone" \}, 410, origin\);/);
});

test("the sweep's code and settings are gone", () => {
  for (const name of ["fbIngest", "fbFinds", "fbItems", "fbMode", "fbTerm"]) assert.doesNotMatch(INDEX, new RegExp("function " + name + "\\("), name);
  assert.doesNotMatch(INDEX, /env\.FB_INGEST_KEY|env\.FB_FINDS|"fb:" \+/);
  assert.doesNotMatch(TOML, /FB_FINDS/);
  assert.match(INDEX, /const WORKER_VERSION = "v(\d+)"/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)"/.exec(INDEX)[1]) >= 178);
});
