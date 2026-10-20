/* v123: how long an eBay listing has been up (Matt: "is there a way to show ebay aging? how many times it has been
   listed"). eBay gives the date this listing was made (itemCreationDate) and, since 2025, when the piece was first
   listed (itemOriginDate); a later creation means a relist. eBay gives no relist count. */
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
const { ebayAge, ebayItem } = new Function(...keys, indexFn("money") + indexFn("ebayMoney") + indexFn("ebaySale") + indexFn("ebayAge") + indexFn("ebaySeller") + indexFn("ebayShip") + indexFn("ebayItem") + "\nreturn { ebayAge, ebayItem };")(...keys.map((k) => deps[k]));
const NOW = Date.parse("2026-10-18T12:00:00Z");
const BASE = { title: "Padilla studio vase", itemWebUrl: "https://www.ebay.com/itm/1", legacyItemId: "123456789012", price: { value: "85.00", currency: "USD" }, buyingOptions: ["FIXED_PRICE"] };

test("first listed and relisted come from eBay's two dates", () => {
  assert.deepEqual(ebayAge({ itemOriginDate: "2026-03-02T10:00:00.000Z", itemCreationDate: "2026-10-01T09:00:00.000Z" }, NOW), { listed: "2026-03-02", relisted: "2026-10-01" });
  assert.deepEqual(ebayAge({ itemOriginDate: "2026-09-01T10:00:00.000Z", itemCreationDate: "2026-09-01T10:00:05.000Z" }, NOW), { listed: "2026-09-01" }, "the same day is not a relist");
  assert.deepEqual(ebayAge({ itemCreationDate: "2026-08-20T10:00:00.000Z" }, NOW), { listed: "2026-08-20" }, "no origin date: the creation date");
  assert.equal(ebayAge({}, NOW), null);
  assert.equal(ebayAge({ itemCreationDate: "2027-05-01T00:00:00.000Z" }, NOW), null, "a date in the future is ignored");
  assert.equal(ebayAge({ itemCreationDate: "not a date" }, NOW), null);
});

test("search results carry listed and relisted", () => {
  const it = ebayItem(Object.assign({}, BASE, { itemOriginDate: "2026-03-02T10:00:00.000Z", itemCreationDate: "2026-10-01T09:00:00.000Z" }));
  assert.equal(it.listed, "2026-03-02");
  assert.equal(it.relisted, "2026-10-01");
  const plain = ebayItem(BASE);
  assert.equal("listed" in plain, false);
});

test("the item details (/item) carry them too", () => {
  const src = indexFn("itemEbay");
  assert.match(src, /const age = ebayAge\(j\);/);
  assert.match(src, /out\.listed = age\.listed; if \(age\.relisted\) out\.relisted = age\.relisted;/);
});
