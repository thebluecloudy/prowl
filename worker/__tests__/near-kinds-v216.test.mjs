/* v216: a shop counts for every kind its name or type says. Finders Keepers Vintage & Vinyl (Plymouth, MI) was typed
   Records only and dropped from a Vintage search. Run: node --test worker/__tests__/near-kinds-v216.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlace, kindAllowed, kindsOf, differentiator, placeCard, CATS_DEFAULT } from "../trip.js";

const finders = { id: "fk1", displayName: { text: "Finders Keepers Vintage & Vinyl" }, primaryType: "store", primaryTypeDisplayName: { text: "Record store" },
  formattedAddress: "900 N Mill St, Plymouth, MI 48170, USA", location: { latitude: 42.38, longitude: -83.47 }, rating: 4.8, userRatingCount: 120 };

test("v216: a vintage-and-vinyl shop shows on a Vintage search with Records off", () => {
  const p = normalizePlace(finders);
  assert.equal(p.kind, "Records");
  assert.deepEqual(p.kinds.sort(), ["records", "vintage"]);
  assert.equal(kindAllowed(p, CATS_DEFAULT), true, "antiques, vintage, thrift on");
  assert.equal(kindAllowed(p, ["records"]), true);
  assert.equal(kindAllowed(p, ["books"]), false, "neither of its kinds on");
  assert.equal(placeCard(p).why, "Records · Vintage");
});

test("v216: an older cached place without kinds still counts by its name", () => {
  const old = { id: "x", name: "Finders Keepers Vintage & Vinyl", kind: "Records" };
  assert.deepEqual(kindsOf(old), ["records", "vintage"]);
  assert.equal(kindAllowed(old, ["vintage"]), true);
  assert.equal(kindAllowed({ id: "y", name: "Spin Records", kind: "Records" }, ["vintage"]), false, "a plain record store stays out of Vintage");
  assert.equal(kindAllowed({ id: "z", name: "Corner Store", kind: "Store" }, ["vintage"]), true, "a kind with no chip stays, as before");
  assert.equal(differentiator({ name: "Spin Records", kind: "Records" }), "Records");
});
