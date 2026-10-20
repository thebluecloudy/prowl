/* v126: seller stars (Matt, from Jellycat's stars and review count). eBay results and /item carry the seller's
   feedback as numbers only, never the seller's name; Etsy's /item carries the shop's review average and count.
   Run: node --test worker/__tests__/seller-stars.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const deps = { EBAY_ITEM_URL: "https://www.ebay.com/itm/", timeLeft: () => "" };
const keys = Object.keys(deps);
const { ebaySeller, ebayItem } = new Function(...keys, ["money", "ebayMoney", "ebaySale", "ebayAge", "ebaySeller", "ebayShip", "ebayItem"].map(indexFn).join("") +
  "\nreturn { ebaySeller, ebayItem };")(...keys.map((k) => deps[k]));
const BASE = { title: "Haeger panther planter", itemWebUrl: "https://www.ebay.com/itm/1", legacyItemId: "123456789012", price: { value: "40.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"] };

test("eBay feedback becomes a percentage and a count", () => {
  assert.deepEqual(ebaySeller({ seller: { username: "panther_lady", feedbackPercentage: "99.8", feedbackScore: 12345 } }), { pct: 99.8, n: 12345 });
  assert.deepEqual(ebaySeller({ seller: { feedbackPercentage: "100.0" } }), { pct: 100, n: 0 }, "no score: 0");
  assert.deepEqual(ebaySeller({ seller: { feedbackPercentage: "97.25", feedbackScore: "88" } }), { pct: 97.3, n: 88 });
});

test("missing or nonsense feedback is left out", () => {
  assert.equal(ebaySeller({}), null);
  assert.equal(ebaySeller({ seller: { username: "x" } }), null);
  assert.equal(ebaySeller({ seller: { feedbackPercentage: "" } }), null);
  assert.equal(ebaySeller({ seller: { feedbackPercentage: "abc" } }), null);
  assert.equal(ebaySeller({ seller: { feedbackPercentage: "120" } }), null);
  assert.equal(ebaySeller(null), null);
});

test("search results carry the seller's numbers, never the name", () => {
  const it = ebayItem({ ...BASE, seller: { username: "panther_lady", feedbackPercentage: "99.8", feedbackScore: 12345 } });
  assert.deepEqual(it.seller, { pct: 99.8, n: 12345 });
  assert.doesNotMatch(JSON.stringify(it), /panther_lady/);
  assert.equal("seller" in ebayItem(BASE), false);
});

test("/item carries them for eBay and Etsy", () => {
  assert.match(indexFn("itemEbay"), /const sel = ebaySeller\(j\);[^\n]*\n\s*if \(sel\) out\.seller = sel;/);
  const etsy = indexFn("itemEtsy");
  assert.match(etsy, /review_average/);
  assert.match(etsy, /out\.seller = \{ stars: Math\.round\(ra \* 10\) \/ 10, n: Math\.floor\(rc\) \}/);
});

test("the version is v126 or later", () => {
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 126);
});
