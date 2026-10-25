/* v174 eBay look-alike titles weigh less in the photo check (Matt's ceramic cat came back as a Moselland glass cat
   bottle, copied from a look-alike's title). Run: node --test worker/__tests__/apprompt-v174.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const at = INDEX.indexOf("function apPrompt(");
const body = INDEX.slice(at, INDEX.indexOf("\n}\n", at) + 2);
const apPrompt = new Function("scrubListingText", "EBAY_IMAGE_LIMIT", body + "\nreturn apPrompt;")((s, n) => String(s).slice(0, n), 8);
const LOOKS = [{ title: "TWO MOSELLAND REISLING HAPPY CATS BOTTLES" }];

test("with eBay look-alikes, the prompt says to name the piece from the photo and match form and material", () => {
  const p = apPrompt("", true, "", LOOKS, 1, null, null);
  assert.match(p, /- TWO MOSELLAND REISLING HAPPY CATS BOTTLES/);
  assert.match(p, /Most are a different piece of a similar shape or colour: name the piece from the photo itself/);
  assert.match(p, /use a title only when the photo plainly shows the same form and material \(glass is not pottery, a bottle is not a figurine\)/);
  assert.ok(p.indexOf("never copy prices from them") < p.indexOf("Most are a different piece"), "after the existing warning");
});

test("without look-alikes, none of that is said", () => {
  assert.ok(!/Most are a different piece/.test(apPrompt("", true, "", [], 1, null, null)));
});

test("the worker says v174", () => {
  assert.match(INDEX, /^const WORKER_VERSION = "v174";$/m);
  assert.match(INDEX, /^ \*   v174: 2026-10-25\. eBay's look-alike titles weigh less/m);
});
