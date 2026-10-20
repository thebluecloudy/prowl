/* v129 (the owner: a "Brookwood USA Camouflage Backpack" came up for the Rookwood hunt): ShopGoodwill listings keep
   only titles that carry every word of the hunt. Run: node --test worker/__tests__/sgw-exact.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) {
  const m = new RegExp("^function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const { sgwExact } = new Function(fn("alExWords") + fn("sgwExact") + "return { sgwExact };")();
const t = (...titles) => titles.map((title, i) => ({ title, url: "https://shopgoodwill.com/item/" + i }));

test("Brookwood is not Rookwood; Rookwood stays", () => {
  const got = sgwExact(t("Brookwood USA Camouflage Backpack Woodland Forest Pattern", "Vintage Rookwood Pottery Vase 1928", "ROOKWOOD paperweight"), "Rookwood");
  assert.deepEqual(got.map(x => x.title), ["Vintage Rookwood Pottery Vase 1928", "ROOKWOOD paperweight"]);
});

test("every word must be there, in any order, plurals allowed; nothing matching means nothing", () => {
  const got = sgwExact(t("Black Ceramic Panther Figurine", "Ceramic Panthers pair", "Ceramic cat", "Panther lamp"), "ceramic panther");
  assert.deepEqual(got.map(x => x.title), ["Black Ceramic Panther Figurine", "Ceramic Panthers pair"]);
  assert.deepEqual(sgwExact(t("Ceramic cat"), "ceramic panther"), []);
});

test("an empty hunt or a failed read passes through", () => {
  assert.equal(sgwExact(null, "rookwood"), null);
  const a = t("anything");
  assert.equal(sgwExact(a, ""), a);
});

test("every ShopGoodwill search path uses it", () => {
  assert.match(INDEX, /shopgoodwill: \[\(t\) => callUpstream\(t\), \(x, t\) => sgwExact\(normalize\(x\), t\)\]/);
  assert.equal((INDEX.match(/sgwExact\(normalize\(up\.text\), term\)/g) || []).length, 2, "alSearch and the live search route");
});

/* the review of v129: the same piece spelled another way must stay */
test("spellings run together, split, dotted or hyphenated still match; Brookwood still does not", () => {
  const keep = (term, title) => sgwExact(t(title), term).length === 1;
  assert.ok(keep("mc escher", "M.C. Escher Print Reptiles"));
  assert.ok(keep("mc escher", "MC Escher Litho"));
  assert.ok(keep("mid century", "Midcentury lamp"));
  assert.ok(keep("midcentury", "Mid-Century Modern lamp"));
  assert.ok(keep("fire king", "Fireking Jadeite Mug"));
  assert.ok(keep("fireking", "Fire-King mug"));
  assert.ok(keep("haeger panther", "Royal Haeger™ black panther"));
  assert.ok(keep("“rookwood”", "Rookwood vase"), "curly quotes in the hunt");
  assert.ok(!keep("rookwood", "Brookwood USA Camouflage Backpack"));
  assert.ok(!keep("fire", "Fireplace screen"), "a word must end on a word edge");
});

test("filler words in the hunt are not required", () => {
  const got = sgwExact(t("Pyrex Butterprint bowl", "Corning bowl"), "vintage pyrex");
  assert.deepEqual(got.map(x => x.title), ["Pyrex Butterprint bowl"]);
  assert.equal(sgwExact(t("a"), "vintage").length, 1, "a hunt of filler only is left alone");
});
