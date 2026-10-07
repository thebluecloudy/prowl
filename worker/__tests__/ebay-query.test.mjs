/* v79 eBay hunt matching: exact phrase first, a thin 4+ word phrase topped up with the plain search, curly quotes
   and decades cleaned. Run: node --test worker/__tests__/ebay-query.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* index.js needs the Workers runtime to import, so the functions under test are lifted out of the source (the same
   approach as admin.test.mjs) and run with a fake eBay that answers from a table. */
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const EBAY_LIMIT = Number(/const EBAY_LIMIT = (\d+);/.exec(INDEX)[1]);

const summary = (id, title) => ({ legacyItemId: String(id), itemId: "v1|" + id + "|0", title, itemWebUrl: "https://www.ebay.com/itm/" + id, price: { value: "10.00", currency: "USD" } });
const page = (items) => ({ status: 200, text: JSON.stringify({ total: items.length, itemSummaries: items }) });
const empty = { status: 200, text: JSON.stringify({ total: 0 }) };

function fakeEbay(table) {
  const calls = [];
  const ebaySearchRaw = async (q, env, autocorrect, filter) => {
    calls.push({ q, autocorrect: !!autocorrect, filter: filter || "" });
    return table[q] || empty;
  };
  const ebayNormalize = (raw) => {
    let d; try { d = JSON.parse(raw); } catch (e) { return null; }
    if (d && d.total === 0 && !d.itemSummaries) return [];
    return Array.isArray(d.itemSummaries) ? d.itemSummaries.map((x) => ({ title: x.title, url: x.itemWebUrl })) : null;
  };
  const names = ["ebayPhrase", "ebayClean", "ebayMerge", "ebayPhraseFirst", "ebayCall", "ebayLean"];
  const fns = new Function("ebaySearchRaw", "ebayNormalize", "EBAY_LIMIT",
    names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(ebaySearchRaw, ebayNormalize, EBAY_LIMIT);
  return { ...fns, calls, titles: (r) => JSON.parse(r.text).itemSummaries.map((x) => x.title) };
}

const MONSTER = "1970’s General Mills MONSTER Cereal";
const CLEAN = "1970s General Mills MONSTER Cereal";
const boxes = [summary(1, "1970s General Mills Monster Cereal box Count Chocula"), summary(2, "1970s General Mills Monster Cereal ad")];
const figures = [summary(3, "Vintage General Mills Monster Cereal soft vinyl figures Product People 1970s"), summary(1, "dup of the box"), summary(4, "Franken Berry vinyl figure General Mills Monster Cereal 1970s")];

test("ebayClean: curly quotes, decades, spacing", () => {
  const { ebayClean } = fakeEbay({});
  assert.equal(ebayClean(MONSTER), CLEAN);
  assert.equal(ebayClean("  1950's   Fire-King  "), "1950s Fire-King");
  assert.equal(ebayClean("“Hull pottery”"), '"Hull pottery"');
  assert.equal(ebayClean("60's lamp"), "60s lamp");
  assert.equal(ebayClean("Roseville 1234's"), "Roseville 1234's", "only decades change");
  assert.equal(ebayClean("McCoy's cookie jar"), "McCoy's cookie jar");
});

test("the reported hunt: a thin 5-word phrase is topped up with the plain search, phrase hits first, no repeats", async () => {
  const E = fakeEbay({ ['"' + CLEAN + '"']: page(boxes), [CLEAN]: page(figures) });
  const r = await E.ebayCall(MONSTER, {});
  assert.deepEqual(E.calls.map((c) => c.q), ['"' + CLEAN + '"', CLEAN]);
  const t = E.titles(r);
  assert.deepEqual(t.slice(0, 2), boxes.map((x) => x.title));
  assert.ok(t.some((x) => /soft vinyl figures/.test(x)), "the figures show");
  assert.equal(t.length, 4, "item 1 is not repeated");
});

test("a full page of phrase hits is enough: one call", async () => {
  const full = Array.from({ length: EBAY_LIMIT }, (_, i) => summary(100 + i, "phrase " + i));
  const E = fakeEbay({ ['"' + CLEAN + '"']: page(full), [CLEAN]: page(figures) });
  const r = await E.ebayCall(MONSTER, {});
  assert.equal(E.calls.length, 1);
  assert.equal(E.titles(r).length, EBAY_LIMIT);
});

test("merged results never pass one page", async () => {
  const many = Array.from({ length: EBAY_LIMIT }, (_, i) => summary(200 + i, "plain " + i));
  const E = fakeEbay({ ['"' + CLEAN + '"']: page(boxes), [CLEAN]: page(many) });
  assert.equal(E.titles(await E.ebayCall(MONSTER, {})).length, EBAY_LIMIT);
});

test("2-3 word hunts keep phrase-wins (ceramic panther stays clear of the Jaguar parts)", async () => {
  const E = fakeEbay({ ['"ceramic panther"']: page([summary(5, "Ceramic panther TV lamp")]), ["ceramic panther"]: page([summary(6, "Jaguar catalytic converter ceramic Panther")]) });
  const t = E.titles(await E.ebayCall("ceramic panther", {}));
  assert.deepEqual(t, ["Ceramic panther TV lamp"]);
  assert.equal(E.calls.length, 1);
});

test("a phrase with no hits falls back to the plain search", async () => {
  const E = fakeEbay({ ["Hull pottery"]: page([summary(7, "Hull pottery vase")]) });
  assert.deepEqual(E.titles(await E.ebayCall("Hull pottery", {})), ["Hull pottery vase"]);
  assert.deepEqual(E.calls.map((c) => c.q), ['"Hull pottery"', "Hull pottery"]);
});

test("a hunt the visitor quoted is searched as typed", async () => {
  const E = fakeEbay({ ['"Monster Cereal" vinyl']: page([summary(8, "x")]) });
  await E.ebayCall("“Monster Cereal” vinyl", {});
  assert.deepEqual(E.calls.map((c) => c.q), ['"Monster Cereal" vinyl']);
});

test("an eBay error on the phrase is passed up, not hidden", async () => {
  const E = fakeEbay({ ['"' + CLEAN + '"']: { status: 500, text: "oops" } });
  const r = await E.ebayCall(MONSTER, {});
  assert.equal(r.text, "oops");
});

test("alerts (ebayLean) use the same rule, keep the pickup filter, and spend at most 2 calls", async () => {
  const E = fakeEbay({ ['"' + CLEAN + '"']: page(boxes), [CLEAN]: page(figures) });
  const r = await E.ebayLean(MONSTER, {}, "pickupPostalCode:{48322}");
  assert.equal(E.calls.length, 2);
  assert.ok(E.calls.every((c) => c.filter === "pickupPostalCode:{48322}" && !c.autocorrect));
  assert.ok(E.titles(r).some((x) => /soft vinyl figures/.test(x)));
});

test("nothing anywhere: the spelling fix and shorter versions still run (live strip only)", async () => {
  const E = fakeEbay({});
  await E.ebayCall("Brad Keelr pelican planter", {});
  assert.ok(E.calls.some((c) => c.autocorrect && c.q === "Brad Keelr pelican planter"));
  assert.ok(E.calls.length > 3);
});

test("Etsy's every-word title check reads 1970's as 1970s", () => {
  assert.match(INDEX, /term = ebayClean\(term\);   \/\* v79/);
  const T = (t) => (" " + t.toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ").replace(/ (\d{2,4}0) s /g, " $1s ");
  assert.ok(T("Monster Cereal 1970's figure").includes(" 1970s "));
  assert.ok(T("Monster Cereal 1970s figure").includes(" 1970s "));
  assert.ok(INDEX.includes('.replace(/ (\\d{2,4}0) s /g, " $1s ")'), "the same rule is in etsyCall");
});
