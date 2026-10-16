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
