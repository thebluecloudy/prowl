/* v119: eBay's marketingPrice (a seller's sale) rides along as was/off on search results and /item, so the page and
   Pounce can say a listing is on sale. Run: node --test worker/__tests__/ebay-sale.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const deps = { EBAY_ITEM_URL: "https://www.ebay.com/itm/", timeLeft: () => "" };
const keys = Object.keys(deps);
const { ebaySale, ebayItem } = new Function(...keys, indexFn("money") + indexFn("ebayMoney") + indexFn("ebaySale") + indexFn("ebayAge") + indexFn("ebaySeller") + indexFn("ebayItem") + "\nreturn { ebaySale, ebayItem };")(...keys.map((k) => deps[k]));
const SUMMARY = { title: "Marilyn Consco astronaut girl", itemWebUrl: "https://www.ebay.com/itm/1", legacyItemId: "123456789012", price: { value: "358.40", currency: "USD" }, buyingOptions: ["FIXED_PRICE"],
  marketingPrice: { originalPrice: { value: "448.00", currency: "USD" }, discountPercentage: "20", priceTreatment: "STRIKETHROUGH" } };

test("a sale: was and how much is off", () => {
  assert.deepEqual(ebaySale(SUMMARY), { was: "$448.00", off: "20% off" });
  const it = ebayItem(SUMMARY);
  assert.equal(it.price, "$358.40");
  assert.equal(it.was, "$448.00");
  assert.equal(it.off, "20% off");
});

test("no sale, a was that is not higher, or an auction: nothing added", () => {
  assert.equal(ebaySale({ price: { value: "10" } }), null);
  assert.equal(ebaySale({ price: { value: "10" }, marketingPrice: { originalPrice: { value: "10" } } }), null);
  assert.equal(ebaySale({ price: { value: "12" }, marketingPrice: { originalPrice: { value: "10" } } }), null);
  const auc = ebayItem(Object.assign({}, SUMMARY, { buyingOptions: ["AUCTION"], currentBidPrice: { value: "5", currency: "USD" } }));
  assert.equal(auc.was, undefined);
  assert.equal(ebayItem(Object.assign({}, SUMMARY, { marketingPrice: undefined })).was, undefined);
});

test("no percentage from eBay: worked out from the two prices", () => {
  assert.deepEqual(ebaySale({ price: { value: "75", currency: "USD" }, marketingPrice: { originalPrice: { value: "100", currency: "USD" } } }), { was: "$100.00", off: "25% off" });
});

test("a Pounce note says the match is on sale", () => {
  assert.match(indexFn("pushMatch"), /x\.was \? "\(on sale, was " \+ x\.was \+ "\)"/);
  assert.match(INDEX, /\.\.\.\(x\.was \? \{ was: x\.was, off: x\.off \|\| "" \} : \{\}\)/, "kept with the match");
});
