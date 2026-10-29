/* v187: Jev sees the pictures (shadow). Pure helpers are pulled out of index.js the same way shelf.test.mjs does. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) { const i = INDEX.indexOf("function " + name + "("); return INDEX.slice(i, INDEX.indexOf("\n}\n", i) + 2); }
const C = "const JEV_IMG_MIN = 280, JEV_IMG_MAX = 1568;";
const ebayBig = new Function(fn("ebayBig") + "; return ebayBig;")();
const imgSize = new Function(fn("imgSize") + "; return imgSize;")();
const imgFits = new Function(C + fn("imgFits") + "; return imgFits;")();
const jevPhotoBody = new Function("scrubListingText", fn("jevPhotoBody") + "; return jevPhotoBody;")(t => String(t).slice(0, 140));

function jpeg(w, h, sof = 0xc0) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, sof, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
}
function png(w, h) {
  const b = new Uint8Array(32); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([w >>> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >>> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255], 16);
  return b;
}

test("ebayBig asks eBay's CDN for the 960px picture and ignores other hosts", () => {
  assert.equal(ebayBig("https://i.ebayimg.com/images/g/abc/s-l225.jpg"), "https://i.ebayimg.com/images/g/abc/s-l960.jpg");
  assert.equal(ebayBig("https://i.ebayimg.com/images/g/abc/s-l140.webp?x=1"), "https://i.ebayimg.com/images/g/abc/s-l960.jpg");
  assert.equal(ebayBig("https://example.com/s-l225.jpg"), "");
  assert.equal(ebayBig(""), "");
});
test("imgSize reads baseline JPEG and PNG sizes, refuses progressive JPEG", () => {
  assert.deepEqual(imgSize(jpeg(960, 720)), { fmt: "jpg", w: 960, h: 720 });
  assert.deepEqual(imgSize(png(500, 400)), { fmt: "png", w: 500, h: 400 });
  assert.equal(imgSize(jpeg(960, 720, 0xc2)), null);
  assert.equal(imgSize(Uint8Array.from([1, 2, 3])), null);
});
test("imgFits keeps TypeSafe's 280 to 1568 px rule on both sides", () => {
  assert.ok(imgFits({ w: 960, h: 720 }));
  assert.ok(imgFits({ w: 280, h: 1568 }));
  assert.ok(!imgFits({ w: 960, h: 250 }));
  assert.ok(!imgFits({ w: 1600, h: 900 }));
  assert.ok(!imgFits(null));
});
test("jevPhotoBody references every image once and falls back to the title for a listing with no picture", () => {
  const looks = [{ title: "Brad Keeler Siamese cat" }, { title: "cat phone case" }];
  const b = jevPhotoBody("Brad Keeler Siamese cat figurine", looks, [{ bytes: new Uint8Array(1), fmt: "jpg" }, null], "imgX");
  assert.deepEqual(Object.keys(b.assets).sort(), ["imgX-l0", "imgX-you"]);
  assert.equal(b.assets["imgX-l0"].part, "l0");
  assert.equal(b.state.visitor_photo, "imgX-you");
  assert.equal(b.state.listings[0].photo, "imgX-l0");
  assert.equal(b.state.listings[1].photo, undefined);
  assert.match(b.questions.l0.instructions, /listings\[0\]\.photo/);
  assert.match(b.questions.l1.instructions, /no photo/);
  assert.deepEqual(Object.keys(b.questions.l0.criteria), ["same", "other_piece", "lot", "unrelated"]);
  const text = JSON.stringify(b);
  for (const k of Object.keys(b.assets)) assert.ok(text.split(k).length - 1 >= 2, k + " is referenced");   /* every asset must be used */
});
test("the photo check sends the danger-zone header and stays in shadow", () => {
  assert.match(INDEX, /"TypeSafe-Danger-Zone-Images": "true"/);
  assert.match(INDEX, /photoMode === "shadow" && looks\.length \? jevThumbs\(looks\)/);
  assert.ok(!/looks = .*jevPhoto/.test(INDEX), "jevPhoto never filters what the visitor sees");
});
