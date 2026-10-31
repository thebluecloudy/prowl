/* v200: when the AI check (Jev result sorting) fails, Diagnose says what TypeSafe answered. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../admin-page.js", import.meta.url), "utf8");
function fn(src, name) { let i = src.indexOf("function " + name + "("); if (src.slice(i - 6, i) === "async ") i -= 6; return src.slice(i, src.indexOf("\n}\n", i) + 2); }

const JEV_TIMEOUT_MS = 6000, JEV_RESULTS_MAX = 40, JEV_URL = "https://api.typesafe.ai/v1/systemone";
function load(fetchImpl) {
  const body = "const JEV_TIMEOUT_MS = " + JEV_TIMEOUT_MS + ", JEV_RESULTS_MAX = " + JEV_RESULTS_MAX + ", JEV_URL = '" + JEV_URL + "';" +
    "const scrubListingText = (t) => String(t || ''); const vClean = (v) => String(v || ''); const console = { error() {} };" +
    "const jevResultsMode = () => 'shadow'; const vCount = async () => true; const JEV_DROP_P = 0.7;" +
    fn(INDEX, "jevClassify") + fn(INDEX, "jevWouldDrop") + fn(INDEX, "jevClean") + "; return jevClean;";
  return new Function("fetch", body)(fetchImpl);
}
const ENV = { TYPESAFE_API_KEY: "k" };
const ITEMS = [{ title: "Roseville vase", price: "$40" }];

test("a refused key says TypeSafe's status and message", async () => {
  const jevClean = load(async () => new Response(JSON.stringify({ error: { message: "Invalid API key" } }), { status: 401 }));
  const r = await jevClean(ENV, "roseville", ITEMS, "shadow");
  assert.equal(r.info.status, "jev failed: TypeSafe answered 401 Invalid API key");
  assert.equal(r.items, ITEMS);
});
test("out of credits (402) with a plain-text body", async () => {
  const jevClean = load(async () => new Response("Payment required: no credits left", { status: 402 }));
  const r = await jevClean(ENV, "roseville", ITEMS, "shadow");
  assert.match(r.info.status, /^jev failed: TypeSafe answered 402 Payment required: no credits left$/);
});
test("a network error says it could not reach TypeSafe", async () => {
  const jevClean = load(async () => { throw new Error("connection refused"); });
  const r = await jevClean(ENV, "roseville", ITEMS, "shadow");
  assert.match(r.info.status, /^jev failed: could not reach TypeSafe connection refused$/);
});
test("200 without answers", async () => {
  const jevClean = load(async () => new Response("{}", { status: 200 }));
  const r = await jevClean(ENV, "roseville", ITEMS, "shadow");
  assert.equal(r.info.status, "jev failed: TypeSafe answered with no answers");
});
test("a good answer still tags as before", async () => {
  const jevClean = load(async () => new Response(JSON.stringify({ answers: { r0: { choice: "match", confidence: 0.9 } } }), { status: 200 }));
  const r = await jevClean(ENV, "roseville", ITEMS, "shadow");
  assert.equal(r.info.status, "tagged");
  assert.equal(r.items[0].jev, "match");
});
test("the admin turns the reason into the warning and keeps the old text for a bare 'jev failed'", () => {
  const AI_STATUS = { "jev failed": "The AI check did not answer, so the AI did not check these listings." };
  const aiStatusText = new Function("AI_STATUS", fn(PAGE, "aiStatusText") + "; return aiStatusText;")(AI_STATUS);
  assert.equal(aiStatusText("jev failed: TypeSafe answered 401 Invalid API key"),
    "The AI check did not answer (TypeSafe answered 401 Invalid API key), so the AI did not check these listings.");
  assert.equal(aiStatusText("jev failed"), AI_STATUS["jev failed"]);
  assert.match(readFileSync(new URL("../admin.js", import.meta.url), "utf8"), /word\(j && j\.info && j\.info\.status, 140\)/);
});
