/* v118 shelf scan: the prompt asks for at most 3 picks, and the reader keeps at most 3 clean ones. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) { const i = INDEX.indexOf("function " + name + "("); return INDEX.slice(i, INDEX.indexOf("\n}\n", i) + 2); }
const noCents = new Function(fn("noCents") + "; return noCents;")();
const shelfParse = new Function("noCents", fn("shelfParse") + "; return shelfParse;")(noCents);
const shelfPrompt = new Function(fn("shelfPrompt") + "; return shelfPrompt;")();

test("shelfParse reads up to three PICK lines and ignores the rest", () => {
  const out = shelfParse("PICK 1: Fire-King jadeite mug | top shelf left | $20-$35 | $8\nPICK 2: likely McCoy planter | middle | $25-$40 | $10\nPICK 3: Pyrex bowl | bottom | $15-$25 | $5\nPICK 4: extra | x | $1 | $1\nnoise");
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { item: "Fire-King jadeite mug", where: "top shelf left", fair: "$20-$35", payUpTo: "$8" });
});
test("shelfParse returns nothing for a NONE answer, and the prompt caps the picks at 3", () => {
  assert.deepEqual(shelfParse("NONE: nothing here stands out."), []);
  assert.match(shelfPrompt(), /at most 3/);
});
test("appraise routes mode shelf before the single-piece path", () => {
  assert.ok(INDEX.indexOf('if (mode === "shelf")') > -1);
  assert.ok(INDEX.indexOf('if (mode === "shelf")') < INDEX.indexOf('if (mode === "fast") { try { looks'));
});
