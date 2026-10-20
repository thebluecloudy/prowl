/* v88 listing popup for Etsy: which URLs open, and how a listing from the Etsy Open API is read.
   Run: node --test worker/__tests__/item-etsy.test.mjs */
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
const constLine = (name) => { const m = new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX); assert.ok(m, name); return m[0]; };

function load(etsyGet) {
  const asked = [];
  const names = ["hibidText", "money", "itemRef", "itemDesc", "itemImages", "etsyMade", "etsyEnglish", "itemEtsy", "itemRoute"];
  const src = [constLine("ITEM_TAGS"), "const itemImg = " + /const itemImg = ([^\n]+)/.exec(INDEX)[1],
    "const ITEM_CACHE_SECONDS = 86400, ITEM_PER_IP = 300, ITEM_IMAGES = 24, ITEM_DESC_MAX = 20000;"].concat(names.map(indexFn)).join("\n");
  const deps = {
    etsyGet: async (path, env) => { asked.push(path); return etsyGet(path, env); },
    PCACHE: { match: async () => null, put: async () => {} }, vCount: async () => true, ipKey: (x) => String(x || "ip"),
    json: (body, status, origin, extra) => ({ body, status: status || 200, extra: extra || {} }), console: { error() {} },
    itemEbay: async () => ({ error: "x" }), itemSgw: async () => ({ error: "x" }), itemSalvation: async () => ({ error: "x" }),
  };
  const keys = Object.keys(deps);
  const f = new Function(...keys, src + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, asked };
}
const ok = (body) => ({ status: 200, text: JSON.stringify(body) });
const LISTING = {
  listing_id: 1234567890, state: "active", title: "Vintage Haeger Black Panther TV Lamp &amp; Planter",
  description: "Glossy black glaze.\nNo chips <b>or</b> cracks.\r\nWorks & lights up.",
  price: { amount: 14500, divisor: 100, currency_code: "USD" },
  when_made: "1950s", materials: ["ceramic", "glaze", " ", "metal", "cord", "bulb"],
  shop: { shop_name: "OwlFinds" },
  images: [
    { rank: 2, url_fullxfull: "https://i.etsystatic.com/2_full.jpg", url_570xN: "https://i.etsystatic.com/2_570.jpg" },
    { rank: 1, url_570xN: "https://i.etsystatic.com/1_570.jpg" },
    { rank: 3, url_fullxfull: "javascript:alert(1)" },
  ],
};

test("Etsy listing URLs open; anything else does not", () => {
  const { itemRef } = load(async () => ok({}));
  assert.deepEqual(itemRef("https://www.etsy.com/listing/1234567890/vintage-haeger-panther"), { src: "etsy", id: "1234567890" });
  assert.deepEqual(itemRef("https://etsy.com/listing/1234567890"), { src: "etsy", id: "1234567890" });
  for (const bad of ["https://www.etsy.com/listing/1", "http://www.etsy.com/listing/1234567890", "https://www.etsy.com/shop/OwlFinds",
    "https://etsy.com.evil.example/listing/1234567890", "https://www.etsy.com/listing/1234567890/../../x"]) assert.equal(itemRef(bad), null, bad);
});

test("an Etsy listing: photos in order, price, escaped description with its lines, shop, when made and materials", async () => {
  const L = load(async () => ok(LISTING));
  const d = await L.itemEtsy("1234567890", {});
  assert.deepEqual(L.asked, ["listings/1234567890?includes=Images,Shop"]);
  assert.equal(d.title, "Vintage Haeger Black Panther TV Lamp & Planter");
  assert.equal(d.price, "$145.00");
  assert.deepEqual(d.images, ["https://i.etsystatic.com/1_570.jpg", "https://i.etsystatic.com/2_full.jpg"], "rank order, full size first, no javascript:");
  assert.match(d.description, /Glossy black glaze\.<br>No chips &lt;b&gt;or&lt;\/b&gt; cracks\.<br>Works &amp; lights up\./);
  assert.doesNotMatch(d.description, /<b>/, "seller markup is shown as text");
  assert.deepEqual(d.aspects, [{ n: "Shop", v: "OwlFinds" }, { n: "Made", v: "1950s" }, { n: "Materials", v: "ceramic, glaze, metal, cord" }]);
  assert.equal(d.url, "https://www.etsy.com/listing/1234567890");
  assert.equal(d.gone, undefined);
});

test("sold out, expired or missing reads as gone; other errors stay errors", async () => {
  assert.equal((await load(async () => ok({ ...LISTING, state: "sold_out" })).itemEtsy("1234567890", {})).gone, true);
  assert.deepEqual(await load(async () => ({ status: 404, text: "" })).itemEtsy("1234567890", {}), { gone: true });
  assert.deepEqual(await load(async () => ({ status: 500, text: "" })).itemEtsy("1234567890", {}), { error: "etsy 500" });
  assert.deepEqual(await load(async () => ({ status: 200, text: "nope" })).itemEtsy("1234567890", {}), { error: "etsy unreadable" });
});

test("when made reads like a person wrote it", () => {
  const { etsyMade } = load(async () => ok({}));
  assert.equal(etsyMade("1970s"), "1970s");
  assert.equal(etsyMade("before_2006"), "before 2006");
  assert.equal(etsyMade("2010_2019"), "2010–2019");
  assert.equal(etsyMade("made_to_order"), "made to order");
  assert.equal(etsyMade(""), "");
});

test("/item sends Etsy to the Etsy reader; no Etsy keys means a plain 502", async () => {
  const req = { headers: { get: () => "1.2.3.4" } };
  const u = new URL("https://w.example/item?url=" + encodeURIComponent("https://www.etsy.com/listing/1234567890/x"));
  let r = await load(async () => ok(LISTING)).itemRoute({}, u, "o", req);
  assert.equal(r.status, 200); assert.equal(r.body.src, "etsy"); assert.equal(r.body.id, "1234567890"); assert.equal(r.body.images.length, 2);
  r = await load(async () => { throw new Error("ETSY_API_KEY / ETSY_SHARED_SECRET not set"); }).itemRoute({}, u, "o", req);
  assert.equal(r.status, 502); assert.equal(r.body.error, "upstream unreachable");
  assert.match(INDEX, /const WORKER_VERSION = "v(8[89]|9\d|[1-9]\d{2})";/);
});

test("v126: the shop's review average and count come along as seller stars", async () => {
  const withStars = await load(async () => ok({ ...LISTING, shop: { shop_name: "OwlFinds", review_average: 4.8571, review_count: 312 } })).itemEtsy("1234567890", {});
  assert.deepEqual(withStars.seller, { stars: 4.9, n: 312 });
  const none = await load(async () => ok({ ...LISTING, shop: { shop_name: "OwlFinds", review_average: null, review_count: 0 } })).itemEtsy("1234567890", {});
  assert.equal("seller" in none, false, "a shop with no reviews shows none");
});

/* v128: a German shop's listing showed in German in Prowl though Etsy showed it in English. The English is the
   seller's translation, asked for separately; with none, the shop's own text stays. */
const DE = { ...LISTING, listing_id: 4596549900, shop_id: 777, language: "de",
  title: "Hertwig Katzhütte Panther Porzellanfigur", description: "Hallo Sammler von schönem Porzellan." };
const etsyBy = (map) => async (path) => (path in map ? map[path] : { status: 404, text: "{}" });

test("a German shop's listing comes in the seller's English translation", async () => {
  const L = load(etsyBy({
    "listings/4596549900?includes=Images,Shop": ok(DE),
    "shops/777/listings/4596549900/translations/en-US": ok({ title: "Hertwig Katzhutte Panther Figurine", description: "Hello collectors.\nRare panther." }),
  }));
  const d = await L.itemEtsy("4596549900", {});
  assert.equal(d.title, "Hertwig Katzhutte Panther Figurine");
  assert.match(d.description, /Hello collectors\.<br>Rare panther\./);
  assert.doesNotMatch(d.description, /Hallo/);
});

test("English under en-GB is found when en-US is missing", async () => {
  const L = load(etsyBy({
    "listings/4596549900?includes=Images,Shop": ok(DE),
    "shops/777/listings/4596549900/translations/en-GB": ok({ title: "Panther figurine", description: "Hello." }),
  }));
  const d = await L.itemEtsy("4596549900", {});
  assert.equal(d.title, "Panther figurine");
  assert.deepEqual(L.asked.slice(1), ["shops/777/listings/4596549900/translations/en-US", "shops/777/listings/4596549900/translations/en-GB"]);
});

test("no English translation, or a failure asking for one, keeps the shop's own text", async () => {
  const none = load(etsyBy({ "listings/4596549900?includes=Images,Shop": ok(DE) }));
  const d = await none.itemEtsy("4596549900", {});
  assert.equal(d.title, "Hertwig Katzhütte Panther Porzellanfigur");
  assert.match(d.description, /Hallo Sammler/);
  const broken = load(async (path) => (path.indexOf("translations") !== -1 ? { status: 200, text: "not json" } : ok(DE)));
  assert.match((await broken.itemEtsy("4596549900", {})).description, /Hallo Sammler/);
});

test("an English shop's listing asks Etsy once, no translation call", async () => {
  for (const language of ["en-US", "en", undefined]) {
    const L = load(async () => ok({ ...LISTING, shop_id: 1, language }));
    await L.itemEtsy("1234567890", {});
    assert.deepEqual(L.asked, ["listings/1234567890?includes=Images,Shop"], String(language));
  }
});
