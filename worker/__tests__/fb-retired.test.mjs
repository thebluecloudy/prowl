/* v178 (Matt, 2026-10-28, the security and trust plan: "No session-cookie storage or replay of anyone's account,
   including Matthew's own"): the Facebook Marketplace sweep through Matt's own account is retired, and /fb-ingest
   answers 410. v200 brings Facebook finds back through Apify (fb-apify-v200.test.mjs): /fb-finds answers again, and the
   rule still holds: no session cookies, no login, nothing sent on anyone's behalf.
   Run: node --test worker/__tests__/fb-retired.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const FB = readFileSync(new URL("../fb.js", import.meta.url), "utf8");
const TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

test("/fb-ingest stays 410 Gone, whatever the method or key; /fb-finds answers again (v200)", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/fb-ingest"\) return json\(\{ error: "gone" \}, 410, ""\);/);
  assert.match(INDEX, /if \(url\.pathname === "\/fb-finds" && request\.method === "GET"\) return fbFinds\(request, env, url, origin\);/);
  assert.doesNotMatch(INDEX, /"\/fb-finds"\) return json\(\{ error: "gone" \}/);
});

test("the old sweep's code and settings stay gone", () => {
  for (const name of ["fbIngest", "fbMode"]) assert.doesNotMatch(INDEX, new RegExp("function " + name + "\\("), name);
  assert.doesNotMatch(INDEX, /env\.FB_INGEST_KEY|env\.FB_FINDS\b|"fb:" \+/);
  assert.doesNotMatch(TOML, /FB_FINDS|FB_LIVE\s*=/, "FB_LIVE is a dashboard variable (keep_vars), not set here");
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)"/.exec(INDEX)[1]) >= 200);
});

test("no session cookies: the Facebook source never sends a cookie, never logs in, never takes anyone's account", () => {
  const src = FB + INDEX.slice(INDEX.indexOf("---------- v200: Facebook Marketplace finds through Apify"), INDEX.indexOf("/* ---------- v132: NEAR ME"));
  assert.doesNotMatch(src, /[Cc]ookie["']?\s*:|cookies\s*:|credentials\s*:|c_user|\bxs\b|FB_INGEST|login\(/);
  assert.match(FB, /"Authorization": "Bearer " \+ token/);
  assert.match(FB, /getListingDetails: false/);
});
