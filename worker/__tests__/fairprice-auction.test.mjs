/* v87 Fair price: an auction is priced as one, and the sold search must match the exact item.
   Run: node --test worker/__tests__/fairprice-auction.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const consts = INDEX.match(/^const VERDICT_[A-Z_]+ = .*$/gm).join("\n");
function load(answer = "ITEM: AmToy Super Madballs Touchdown Terror, 1986\nVERDICT: FAIR\nFAIR PRICE: $150-250\nWHY: Sold examples at $180 and $250.", searchFails = false) {
  const prompts = [], store = new Map();
  const deps = {
    ALLOW_ORIGINS: ["https://www.owlandtwigvintage.com"],
    json: (body, status, origin, extra) => ({ status: status || 200, body, extra }),
    readJson: async (r) => r.body,
    PCACHE: { match: async (k) => (store.has(k.url) ? { text: async () => store.get(k.url) } : null), put: async (k, r) => store.set(k.url, await r.text()) },
    ipKey: () => "1.2.3.4", isOwner: () => true, proMember: async () => null, vTake: async () => 0, vCount: async () => true, ipNet: () => "n", poolOk: async () => ({ ok: true }), busyNow: () => null,
    museAsk: async (env, prompt, search) => { prompts.push({ prompt, search }); return searchFails && search ? { status: 500, content: "" } : { status: 200, content: answer }; },
    Request: class { constructor(u) { this.url = u; } },
    Response: class { constructor(b) { this.b = b; } async text() { return this.b; } },
  };
  const keys = Object.keys(deps);
  const names = ["vClean", "scrubListingText", "sha16", "noCents", "soldCited", "verdictAuction", "verdict"];
  const f = new Function(...keys, consts + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, prompts, store };
}
const req = (body) => ({ body, headers: { get: () => null } });
const ORIGIN = "https://www.owlandtwigvintage.com";
const MADBALLS = { title: "Super Madballs Touchdown Terror Football Monster Rubber Ball Toy", price: "$142.00", url: "https://shopgoodwill.com/item/278987071",
  details: "21h 1m left · 9 bids · Used. Brand: AmToy. Description: This is a Super Madballs Touchdown Terror Football, 1986.", comps: [] };

test("verdictAuction reads bids and time left from card or popup details", () => {
  const { verdictAuction } = load();
  assert.deepEqual(verdictAuction("21h 1m left · 9 bids · Used"), { bids: 9, left: "21h 1m" });
  assert.deepEqual(verdictAuction("ShopGoodwill · 1 bid · 2d 3h left"), { bids: 1, left: "2d 3h" });
  assert.equal(verdictAuction("0 bids · 3h left"), null, "no bids yet: the price is a starting price");
  assert.equal(verdictAuction("eBay · Buy It Now"), null);
  assert.equal(verdictAuction(""), null);
  assert.equal(verdictAuction("eBay · Buy It Now. Description: taking 5 bids, 2h left"), null, "seller text cannot fake an auction");
});

test("an auction with bids is priced as the current bid, and the sold search must match the exact item", async () => {
  const L = load();
  const r = await L.verdict(req(MADBALLS), {}, ORIGIN);
  assert.equal(r.status, 200);
  assert.equal(r.body.fair, "$150-250");
  const p = L.prompts[0].prompt;
  assert.match(p, /\| current auction bid \$142\.00 after 9 bids, ending in 21h 1m\. The final price will likely be higher\./);
  assert.doesNotMatch(p, /\| asking \$142/);
  assert.match(p, /Judge the current bid for a collector buying to keep: DEAL if winning near this bid would be a good buy/);
  assert.match(p, /Only count sales of the same item: same maker, same line and variant, same size, same era\. Originals are not reissues/);
  assert.match(p, /This auction already has 9 bids at \$142\.00\. If the sales you found are far below that, you are probably pricing a different version/);
  assert.match(p, /Description: This is a Super Madballs Touchdown Terror Football, 1986\./, "the description reaches the model");
  assert.ok([...L.store.keys()][0].startsWith("https://prowl-verdicts.invalid/v7/"), "new cache key, old answers are not reused");
});

test("a fixed-price listing is still an asking price", async () => {
  const L = load();
  await L.verdict(req({ ...MADBALLS, details: "eBay · Buy It Now" }), {}, ORIGIN);
  const p = L.prompts[0].prompt;
  assert.match(p, /\| asking \$142\.00\n/);
  assert.match(p, /Judge the asking price for a collector buying to keep\./);
  assert.doesNotMatch(p, /current auction bid|This auction already has/);
  assert.match(p, /Only count sales of the same item/, "exact matches count for every listing");
});

test("without web search, an auction bid is not called high on a guess", async () => {
  const L = load("ITEM: x\nVERDICT: FAIR\nFAIR PRICE: $150-250\nWHY: Similar pieces listed now.", true);
  const r = await L.verdict(req(MADBALLS), {}, ORIGIN);
  assert.equal(r.body.basis, "listed");
  assert.deepEqual(L.prompts.map((x) => x.search), [true, false]);
  const p = L.prompts[1].prompt;
  assert.match(p, /current auction bid \$142\.00 after 9 bids/);
  assert.match(p, /Bidders have already taken this auction to \$142\.00; do not call that bid high unless you are sure this exact item sells for less\./);
});

test("worker version", () => assert.match(INDEX, /const WORKER_VERSION = "v(8[7-9]|9\d|[1-9]\d{2})";/));
