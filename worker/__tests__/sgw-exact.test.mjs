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
