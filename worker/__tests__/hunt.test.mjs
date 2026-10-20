/* v117 /hunt: relevance gate, cross-posts, best picks, complete rows, Craigslist reader.
   Run: node --test worker/__tests__/hunt.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { huntNeeds, huntRelevant, huntKey, huntSimilar, huntCombine, huntPriceN, craigslistNormalize, HUNT_GATED } from "../hunt.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const T = "ceramic panther", N = huntNeeds(T);
const it = (src, title, price, extra = {}) => Object.assign({ src, title, price, priceN: huntPriceN(price), url: "https://" + src + ".example/" + encodeURIComponent(title + price), image: "https://img.example/x.jpg" }, extra);

test("pottery counts as ceramic, and plurals fold", () => {
  assert.equal(huntRelevant("Vintage MCM Pottery Black Panther Planter", N, T), true);
  assert.equal(huntRelevant("Frankoma Resting Black Panther Ceramic Figurine", N, T), true);
  assert.equal(huntRelevant("Pair of porcelain panthers", N, T), true);
});

test("noise and missing words are rejected", () => {
  assert.equal(huntRelevant("Pink Panther Ceramic Card 1984", N, T), false);
  assert.equal(huntRelevant("Fenton Panther Carnival Glass Bowl", N, T), false);
  assert.equal(huntRelevant("Marvel Black Panther ceramic mug", N, T), false);
});

test("the same panther on two sites fingerprints alike", () => {
  const a = huntKey('Vtg Brown Gold Ceramic Panther MCM Ceramic 15" Stalking Crouching Big Cat');
  const b = huntKey('Vintage Brown Gold Ceramic Panther MCM 15" Stalking Crouching Big Cat');
  assert.equal(huntSimilar(a, b), true);
});

test("huntCombine keeps true matches, marks the dearer cross-post, ranks picks and lists every site", () => {
  const rows = [
    { source: "ebay", status: 200, note: "", items: [
      it("ebay", 'Vtg Brown Gold Ceramic Panther MCM 15" Stalking Big Cat', "$34.87"),
      it("ebay", "Pink Panther ceramic bank", "$20.00"),
      it("ebay", "Royal Haeger ceramic panther TV lamp", "$140.00") ] },
    { source: "vinted", status: 200, note: "", items: [it("vinted", 'Brown Gold Ceramic Panther MCM 15" Stalking Big Cat', "$35.00")] },
    { source: "shopgoodwill", status: 200, note: "", items: [it("shopgoodwill", "Lot of 4 ceramic panther figurines", "$41.00", { time_left: "2h 10m", bids: 1 })] },
    { source: "etsy", status: 200, note: "", items: [it("etsy", "Fenton glass panther", "$60.00")] },
    { source: "chairish", status: 403, note: "answered 403", items: [] }
  ];
  const out = huntCombine(rows, T);
  const ebay = out.rows.find(r => r.source === "ebay");
  assert.equal(ebay.count, 3);
  assert.equal(ebay.kept, 2, "the Pink Panther bank is dropped");
  assert.equal(out.dupes.length, 1);
  assert.match(out.dupes[0][1], /vinted/, "the $35 Vinted twin is the dearer one");
  assert.ok(out.picks.length <= 3);
  assert.equal(out.picks[0].src, "shopgoodwill", "the cheap 4-piece auction with 1 bid leads");
  assert.ok(!out.picks.some(p => p.dupeOf), "a marked twin is never a pick");
  assert.equal(out.rows.find(r => r.source === "etsy").note, "1 results, none were a true match");
  assert.equal(out.rows.find(r => r.source === "chairish").note, "answered 403");
  for (const k of Object.keys(HUNT_GATED)) assert.ok(out.rows.find(r => r.source === k && r.gated), k + " is listed as gated");
  assert.ok(out.median.startsWith("$"));
});

test("Craigslist reader takes the static list and drops buyer spam", () => {
  const html = '<ol class="cl-static-search-results">' +
    '<li class="cl-static-search-result" title="x"><a href="https://detroit.craigslist.org/okl/atq/d/ceramic-panther/1.html"><div class="title">Ceramic panther &amp; cub</div><div class="details"><div class="price">$45</div><div class="location">Royal Oak</div></div></a></li>' +
    '<li class="cl-static-search-result" title="y"><a href="https://detroit.craigslist.org/wan/2.html"><div class="title">WANTED: we buy old pottery</div></a></li></ol>';
  const out = craigslistNormalize(html);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Ceramic panther & cub");
  assert.equal(out[0].price, "$45");
  assert.equal(out[0].where, "Royal Oak");
  assert.equal(craigslistNormalize("<html>blocked</html>"), null, "an unreadable page is null, not empty");
});

test("index.js wires /hunt with a fixed Craigslist host, a per-visitor cap and a 15-minute cache", () => {
  assert.match(INDEX, /url\.pathname === "\/hunt"\) return huntRoute\(/);
  assert.match(INDEX, /\/\^\[a-z\]\{3,20\}\$\/\.test\(site/);
  assert.match(INDEX, /vCount\("hu:"/);
  assert.match(INDEX, /HUNT_CACHE_SECONDS = 900/);
  assert.match(INDEX, /coolUntil\(source\)\) row\.note/);
});

/* v130 (the owner: one Rookwood owl at $190 on Etsy, $211 on Poshmark and on eBay: "show that it is listed in 2 other
   places, and they have different prices ... if lowest price need to include the shipping") */
test("one piece on three sites at different prices is one group: the cheapest leads, every copy lists the others", () => {
  const O = "Rookwood Pottery ceramic owl Trinket pin ashtray", title = 'Rookwood Pottery ceramic owl Trinket pin ashtray 6" Cream';
  const rows = [
    { source: "etsy", status: 200, note: "", items: [it("etsy", title, "$190.00")] },
    { source: "poshmark", status: 200, note: "", items: [it("poshmark", title, "$211.00")] },
    { source: "ebay", status: 200, note: "", items: [it("ebay", "Rookwood Pottery Ceramic Owl Trinket Pin Ashtray Cream 6 in", "$205.00", { ship: "$12.50" })] }
  ];
  const out = huntCombine(rows, O);
  const all = out.rows.flatMap(r => r.items);
  const etsy = all.find(x => x.src === "etsy"), posh = all.find(x => x.src === "poshmark"), ebay = all.find(x => x.src === "ebay");
  assert.equal(out.picks.length, 1, "the same owl takes one Best pick spot, not three");
  assert.equal(out.picks[0].src, "etsy", "the cheapest copy leads");
  assert.equal(posh.dupeOf, etsy.url);
  assert.equal(ebay.dupeOf, etsy.url);
  assert.equal(out.dupes.length, 2);
  assert.deepEqual(etsy.also.map(a => [a.src, a.price, a.ship || ""]), [["ebay", "$205.00", "$12.50"], ["poshmark", "$211.00", ""]], "cheapest first, eBay's shipping kept");
  assert.deepEqual(posh.also.map(a => a.src), ["etsy", "ebay"]);
  assert.ok(posh.also.every(a => /^https:\/\//.test(a.url)));
});

test("a short, generic title only counts as a cross-post when the prices are within 6%", () => {
  const rows = [
    { source: "etsy", status: 200, note: "", items: [it("etsy", "Ceramic panther", "$20.00")] },
    { source: "ebay", status: 200, note: "", items: [it("ebay", "Ceramic panther", "$30.00")] },
    { source: "poshmark", status: 200, note: "", items: [it("poshmark", "Ceramic panther", "$20.50")] }
  ];
  const out = huntCombine(rows, T);
  const ebay = out.rows.flatMap(r => r.items).find(x => x.src === "ebay");
  assert.equal(ebay.dupeOf, undefined, "$30 is a different panther");
  assert.equal(ebay.also, undefined);
  assert.equal(out.dupes.length, 1, "$20 and $20.50 are the same one");
});

test("a long title more than 60% apart is not the same piece", () => {
  const title = "Royal Haeger black ceramic panther TV lamp planter";
  const rows = [
    { source: "etsy", status: 200, note: "", items: [it("etsy", title, "$40.00")] },
    { source: "ebay", status: 200, note: "", items: [it("ebay", title, "$90.00")] }
  ];
  assert.equal(huntCombine(rows, T).dupes.length, 0);
});

/* the review of v130: different pieces stay apart, and no chains */
test("different sizes, glazes, a pair or a lot are not the same piece, even with near-identical titles", () => {
  const Q = "rookwood owl";
  const two = (a, pa, b, pb) => huntCombine([
    { source: "etsy", status: 200, note: "", items: [it("etsy", a, pa)] },
    { source: "poshmark", status: 200, note: "", items: [it("poshmark", b, pb)] }], Q).dupes.length;
  assert.equal(two("Rookwood pottery owl paperweight 6 inch signed", "$190.00", "Rookwood pottery owl paperweight 4 inch signed", "$125.00"), 0, "6 vs 4 inch");
  assert.equal(two("Rookwood pottery owl paperweight blue glaze", "$190.00", "Rookwood pottery owl paperweight green glaze", "$130.00"), 0, "blue vs green");
  assert.equal(two("Pair Rookwood pottery owl bookends signed", "$300.00", "Rookwood pottery owl bookends signed", "$190.00"), 0, "pair vs single");
  assert.equal(two("Lot of 2 Rookwood pottery owl paperweight", "$300.00", "Rookwood pottery owl paperweight", "$190.00"), 0, "lot vs single");
  assert.equal(two("Rookwood pottery owl paperweight signed 1946", "$190.00", "Rookwood pottery owl paperweight signed 1922", "$130.00"), 0, "1946 vs 1922");
  assert.equal(two("Rookwood pottery owl paperweight 6 inch signed", "$190.00", "Rookwood pottery owl paperweight 6 inch signed cream", "$211.00"), 1, "the same piece, one title adds a word");
});

test("no chains through a middle listing, and never two listings from the same site", () => {
  const rows = [
    { source: "etsy", status: 200, note: "", items: [it("etsy", "Rookwood pottery owl paperweight green", "$120.00"), it("etsy", "Rookwood pottery owl paperweight green glaze", "$180.00")] },
    { source: "poshmark", status: 200, note: "", items: [it("poshmark", "Rookwood pottery owl paperweight green glaze", "$170.00")] },
    { source: "ebay", status: 200, note: "", items: [it("ebay", "Rookwood pottery owl paperweight green", "$150.00")] }
  ];
  const out = huntCombine(rows, "rookwood owl"), all = out.rows.flatMap(r => r.items);
  for (const x of all) for (const a of x.also || []) assert.notEqual(a.src, x.src, x.src + " lists another " + a.src + " listing as itself");
  const etsy = all.filter(x => x.src === "etsy");
  assert.ok(!(etsy[0].dupeOf === etsy[1].url || etsy[1].dupeOf === etsy[0].url), "two Etsy listings are never one piece");
});

/* v147 (the owner: an Etsy panther lamp at 180.00 CAD was called the same piece as a $129 Poshmark lamp) */
test("prices in different currencies are never matched", () => {
  const rows = [
    { source: "etsy", status: 200, note: "", items: [it("etsy", "Black Ceramic Panther Panther Lamp with shade", "180.00 CAD")] },
    { source: "poshmark", status: 200, note: "", items: [it("poshmark", "Vintage Ceramic Black Panther TV Lamp", "$129.00")] }
  ];
  assert.equal(huntCombine(rows, T).dupes.length, 0);
});
