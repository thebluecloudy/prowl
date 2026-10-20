/* v130 (the owner: "if lowest price need to include the shipping"): eBay's search says what shipping costs.
   Run: node --test worker/__tests__/ebay-ship.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const m = /^function ebayShip\(/m.exec(INDEX);
const ebayShip = new Function(INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2) + "return ebayShip;")();

test("free, a dollar amount, or nothing when eBay does not say", () => {
  assert.equal(ebayShip({ shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "0.00", currency: "USD" } }] }), "free");
  assert.equal(ebayShip({ shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "12.5", currency: "USD" } }] }), "$12.50");
  assert.equal(ebayShip({ shippingOptions: [{ shippingCostType: "CALCULATED" }] }), "");
  assert.equal(ebayShip({ shippingOptions: [{ shippingCost: { value: "9", currency: "GBP" } }] }), "", "not in dollars");
  assert.equal(ebayShip({}), "");
});

test("eBay listings carry it, and /hunt passes it on with a fresh cache key", () => {
  assert.match(INDEX, /const ship = ebayShip\(it\);   \/\* v130 \*\/\n  if \(ship\) out\.ship = ship;/);
  assert.match(INDEX, /ship: String\(x\.ship \|\| ""\)\.slice\(0, 24\) \}\)\);   \/\* v130: ship \*\//);
  assert.match(INDEX, /"&cl=" \+ cl \+ "&v=2"/);
});
