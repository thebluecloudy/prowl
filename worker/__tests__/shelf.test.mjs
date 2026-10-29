/* v118 shelf scan; v191: up to 8 picks, an ALL line for the whole shelf, pay-up-to is money only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) { const i = INDEX.indexOf("function " + name + "("); return INDEX.slice(i, INDEX.indexOf("\n}\n", i) + 2); }
const noCents = new Function(fn("noCents") + "; return noCents;")();
const shelfMoney = new Function("noCents", fn("shelfMoney") + "; return shelfMoney;")(noCents);
const shelfAll = new Function("noCents", "shelfMoney", fn("shelfAll") + "; return shelfAll;")(noCents, shelfMoney);
const shelfParse = new Function("noCents", "shelfMoney", "const SHELF_MAX = 8;" + fn("shelfParse") + "; return shelfParse;")(noCents, shelfMoney);
const shelfPrompt = new Function(fn("shelfPrompt") + "; return shelfPrompt;")();

test("shelfParse reads up to 8 PICK lines, PICK 10 included, and ignores the rest", () => {
  const lines = Array.from({ length: 10 }, (_, i) => "PICK " + (i + 1) + ": piece " + (i + 1) + " | spot | $20-$35 | $8").join("\n");
  const out = shelfParse(lines + "\nnoise");
  assert.equal(out.length, 8);
  assert.deepEqual(out[0], { item: "piece 1", where: "spot", fair: "$20-$35", payUpTo: "$8" });
});
test("pay-up-to keeps only the money (Matt's screenshot: 'Pay up to $40 to pay')", () => {
  const out = shelfParse("PICK 1: likely L.E. Smith Bittersweet swung vase | center | $90-$150 | $40 to pay");
  assert.equal(out[0].payUpTo, "$40");
  assert.equal(shelfMoney("up to $30 - $45 for resale"), "$30-$45");
  assert.equal(shelfMoney("no idea"), "");
});
test("shelfAll reads the whole-shelf line, and none without one", () => {
  const all = shelfAll("PICK 1: a | b | $1 | $1\nALL: matched Bittersweet set, all swung glass | $400-$650 | $150 for all of it");
  assert.deepEqual(all, { why: "matched Bittersweet set, all swung glass", fair: "$400-$650", payUpTo: "$150" });
  assert.equal(shelfAll("PICK 1: a | b | $1 | $1"), null);
});
test("shelfParse returns nothing for a NONE answer, and the prompt asks for up to 8 and an ALL line", () => {
  assert.deepEqual(shelfParse("NONE: nothing here stands out."), []);
  assert.match(shelfPrompt(), /up to 8/);
  assert.match(shelfPrompt(), /ALL: /);
  assert.match(INDEX, /const all = so\.shelf\.length >= 2 \? shelfAll\(sa\.content\) : null;/);
});
test("appraise routes mode shelf before the single-piece path", () => {
  assert.ok(INDEX.indexOf('if (mode === "shelf")') > -1);
  assert.ok(INDEX.indexOf('if (mode === "shelf")') < INDEX.indexOf('if (mode === "fast") [looks, web, lens]'));   /* v171: eBay and Google together; v173: and Lens */
  assert.ok(INDEX.indexOf('if (mode === "fast") [looks, web, lens]') > -1);
});
