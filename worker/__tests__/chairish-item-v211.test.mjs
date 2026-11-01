/* v211 (Matt: "add a check for chairish images in the popup, i only see one image"): a Chairish listing opens the full
   popup, and /item reads the product page's JSON-LD Product for the whole gallery: one photo per image uuid, at
   Chairish's 1600 px fit size, at most 12, never the similar-listing photos elsewhere on the page. The fixture is the
   real chairish.com/product/20217247 page (2026-11-01), trimmed to its og tags and JSON-LD, the seller renamed.
   Other sites' readers are unchanged. Run: node --test worker/__tests__/chairish-item-v211.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("./fixtures/chairish-product-v211.html", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => { const m = new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX); assert.ok(m, name); return m[0]; };
function load(fetchImpl) {
  const names = ["hibidText", "money", "itemRef", "itemDesc", "itemImages", "chairishPhotos", "chairishItem", "itemChairish"];
  const src = [constLine("ITEM_TAGS"), "const itemImg = " + /const itemImg = ([^\n]+)/.exec(INDEX)[1], constLine("CHAIRISH_ITEM_IMAGES"), constLine("CHAIRISH_COND"), constLine("chText"),
    "const ITEM_IMAGES = 24, ITEM_DESC_MAX = 20000, UPSTREAM_TIMEOUT_MS = 5000, SCRAPE_MAX = 3000000;"].concat(names.map(indexFn)).join("\n");
  return new Function("fetch", src + "\nreturn { " + names.join(", ") + " };")(fetchImpl || (async () => { throw new Error("no fetch"); }));
}
const IMG = /^https:\/\/chairish-prod\.freetls\.fastly\.net\/image\/product\/sized\/([0-9a-f-]{36})\/[a-z0-9-]+\?aspect=fit&width=1600&height=1600$/;

test("Chairish product URLs open the popup; other sites are read as before", () => {
  const { itemRef } = load();
  assert.deepEqual(itemRef("https://www.chairish.com/product/20217247/mid-century-lucite-lamp"), { src: "chairish", id: "20217247", slug: "mid-century-lucite-lamp" });
  assert.deepEqual(itemRef("https://chairish.com/product/2032169"), { src: "chairish", id: "2032169", slug: "" });
  assert.deepEqual(itemRef("https://www.ebay.com/itm/123456789012"), { src: "ebay", id: "123456789012" });
  assert.deepEqual(itemRef("https://www.etsy.com/listing/1234567890/hen"), { src: "etsy", id: "1234567890" });
  for (const bad of ["http://www.chairish.com/product/20217247/x", "https://www.chairish.com/search?q=lamp", "https://www.chairish.com/product/12/../../admin",
    "https://chairish.com.evil.example/product/20217247/x", "https://www.chairish.com/shop/example"]) assert.equal(itemRef(bad), null, bad);
});

test("the gallery comes from the JSON-LD Product: every photo once, large, in order, none from similar listings", () => {
  const { chairishItem } = load();
  const d = chairishItem(PAGE, { id: "20217247", slug: "mid-century-lucite-lamp" });
  assert.equal(d.title, "Mid-Century Lucite Lamp");
  assert.equal(d.price, "$745.00");
  assert.equal(d.images.length, 8, "the 8 photos of the listing (the fixture repeats the first at another size)");
  const ids = d.images.map((u) => { const m = IMG.exec(u); assert.ok(m, u); return m[1]; });
  assert.equal(new Set(ids).size, 8, "one per photo");
  assert.equal(ids[0], "1e54f962-cd79-4cee-8224-04e84f0dcca5", "the page's main photo first");
  assert.ok(!d.images.some((u) => /aaaaaaaa-|bbbbbbbb-/.test(u)), "similar listings stay out");
  assert.equal(d.condition, "Used");
  assert.match(d.description, /it's tapering/, "Chairish's it&#x27;s decoded once");
  assert.deepEqual(d.aspects.map((a) => a.n), ["Size", "Materials", "Color", "Shop"]);
  assert.equal(d.aspects[0].v, "H 26 in × W 6.5 in × D 6.5 in");
  assert.equal(d.url, "https://www.chairish.com/product/20217247/mid-century-lucite-lamp");
  assert.equal(d.gone, undefined);
});

test("at most 12 photos; sold out is gone; no JSON-LD gallery falls back to og:image; an unreadable page is an error", () => {
  const { chairishItem, chairishPhotos } = load();
  const many = Array.from({ length: 20 }, (_, i) => ({ contentUrl: "https://chairish-prod.freetls.fastly.net/image/product/master/" + String(i).padStart(8, "0") + "-0000-4000-8000-000000000000/lamp-" + i }));
  assert.equal(chairishPhotos(many).length, 12);
  const sold = PAGE.replace("http://schema.org/InStock", "http://schema.org/SoldOut");
  assert.equal(chairishItem(sold, { id: "1", slug: "" }).gone, true);
  const noImg = PAGE.replace(/"image": \[[\s\S]*?\], "name"/, '"name"');
  assert.notEqual(noImg, PAGE);
  const d = chairishItem(noImg, { id: "1", slug: "" });
  assert.equal(d.images.length, 1);
  assert.match(d.images[0], IMG);
  assert.deepEqual(chairishItem("<html><body>Something else</body></html>", { id: "1", slug: "" }), { error: "chairish unreadable" });
});

test("itemChairish asks the product page once, as a browser would; a 404 is gone", async () => {
  const asked = [];
  const { itemChairish } = load(async (u, init) => { asked.push([u, init.headers["User-Agent"]]); return { status: /missing/.test(u) ? 404 : 200, text: async () => PAGE }; });
  const d = await itemChairish({ id: "20217247", slug: "mid-century-lucite-lamp" });
  assert.equal(d.images.length, 8);
  assert.equal(asked[0][0], "https://www.chairish.com/product/20217247/mid-century-lucite-lamp");
  assert.match(asked[0][1], /Mozilla/);
  assert.deepEqual(await itemChairish({ id: "1", slug: "missing" }), { gone: true });
});
