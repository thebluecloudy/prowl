/* v171 Photo check: Seen on the web (Google Cloud Vision web detection; Matt: "When Google does an image search it isn't
   using text it uses similar images can we tap into that"). Run: node --test worker/__tests__/vision-v171.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX)[0];
function load(deps) {
  const keys = Object.keys(deps);
  return new Function(...keys, constLine("VISION_URL") + "\n" + indexFn("visionPick") + indexFn("visionWeb") + "\nreturn { visionPick, visionWeb };")(...keys.map((k) => deps[k]));
}
const WD = {
  bestGuessLabels: [{ label: "royal haeger panther" }],
  pagesWithMatchingImages: [
    { url: "https://www.ebay.com/itm/226512345678", pageTitle: "Rare <b>ROYAL HAEGER</b> Panther &amp; Base", fullMatchingImages: [{ url: "https://i.ebayimg.com/a.jpg" }] },
    { url: "https://www.ebay.com/itm/226512345678?hash=x", pageTitle: "the same page again" },
    { url: "http://insecure.example.com/x", pageTitle: "not https" },
    { url: "https://www.worthpoint.com/worthopedia/haeger-panther-1", pageTitle: "Haeger panther | WorthPoint", partialMatchingImages: [{ url: "https://images.worthpoint.com/p.jpg" }] },
    { url: "javascript:alert(1)", pageTitle: "never" },
    ...Array.from({ length: 8 }, (_, i) => ({ url: "https://shop" + i + ".example.org/item", pageTitle: "Shop " + i })),
  ],
};

test("visionPick: the best guess, https pages only, titles as plain text, one per page, at most six", () => {
  const { visionPick } = load({ fetch: null, vCount: null, console });
  const r = visionPick(WD);
  assert.equal(r.guess, "royal haeger panther");
  assert.equal(r.pages.length, 6);
  assert.deepEqual(r.pages[0], { url: "https://www.ebay.com/itm/226512345678", title: "Rare ROYAL HAEGER Panther & Base", image: "https://i.ebayimg.com/a.jpg", host: "ebay.com" });
  assert.equal(r.pages[1].host, "worthpoint.com"); assert.equal(r.pages[1].image, "https://images.worthpoint.com/p.jpg", "a partial match's picture when there is no full one");
  assert.ok(!r.pages.some((p) => /^http:|javascript/.test(p.url)));
  assert.equal(visionPick(null), null); assert.equal(visionPick({}), null, "nothing found: nothing shown");
});

test("visionWeb: nothing without the key or past the day's cap; with them, one call with the photo and the key", async () => {
  const calls = [];
  const fetch = async (u, o) => { calls.push({ u, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ responses: [{ webDetection: WD }] }) }; };
  let room = true;
  const { visionWeb } = load({ fetch, vCount: async (k, n) => { assert.equal(k, "gv:all"); assert.equal(n, 300); return room; }, console: { error() {} } });
  assert.equal(await visionWeb("data:image/jpeg;base64,/9j/AAAA", {}), null, "no key: no call");
  assert.equal(calls.length, 0);
  const env = { GOOGLE_VISION_KEY: "AIza" + "x".repeat(35) };
  const r = await visionWeb("data:image/jpeg;base64,/9j/AAAA", env);
  assert.equal(r.guess, "royal haeger panther");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].u.startsWith("https://vision.googleapis.com/v1/images:annotate?key=AIza"));
  assert.deepEqual(calls[0].body, { requests: [{ image: { content: "/9j/AAAA" }, features: [{ type: "WEB_DETECTION", maxResults: 12 }] }] }, "the photo alone, nothing about the visitor");
  room = false;
  assert.equal(await visionWeb("data:image/jpeg;base64,/9j/AAAA", env), null, "past VISION_PER_DAY");
  assert.equal(calls.length, 1);
});

test("wiring: the quick photo check asks Google beside eBay and hands back web; the admin card counts it; v171", () => {
  const ap = indexFn("appraise");
  assert.match(ap, /\[looks, web\] = await Promise\.all\(\[ebayImageSearch\(image, env\)\.catch\(\(\) => \[\]\), visionWeb\(image, env\)\.catch\(\(\) => null\)\]\)/);
  assert.match(ap, /if \(web\) out\.web = web;/);
  assert.match(INDEX, /\{ key: "gv:all", name: "Google Vision \(Photo check, Seen on the web\)", limit: 300 \}/);
  assert.match(constLine("VISION_URL"), /VISION_PER_DAY = 300\b/);
  assert.match(INDEX, /const WORKER_VERSION = "v171";/);
});
