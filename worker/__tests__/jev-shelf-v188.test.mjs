/* v188: shelf scan Jev pass (shadow). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) { const i = INDEX.indexOf("function " + name + "("); return INDEX.slice(i, INDEX.indexOf("\n}\n", i) + 2); }
const K = "const JEV_SHELF_HUNTS = 30, JEV_SHELF_MIN_P = 0.5;";
const shelfHunts = new Function("scrubListingText", "vClean", K + fn("shelfHunts") + "; return shelfHunts;")(t => String(t), (x, n) => String(x == null ? "" : x).slice(0, n));
const jevShelfBody = new Function(fn("jevShelfBody") + "; return jevShelfBody;")();
const jevShelfRead = new Function(K + fn("jevShelfRead") + "; return jevShelfRead;")();

test("shelfHunts dedupes, drops junk and caps at 30", () => {
  const raw = ["Pyrex", "pyrex", "", "x", 7, "Brad Keeler"].concat(Array.from({ length: 40 }, (_, i) => "hunt " + i));
  const out = shelfHunts(raw);
  assert.deepEqual(out.slice(0, 3), ["Pyrex", "Brad Keeler", "hunt 0"]);
  assert.equal(out.length, 30);
  assert.deepEqual(shelfHunts("not a list"), []);
});
test("jevShelfBody sends the photo once and asks a Noul and a Box per hunt", () => {
  const b = jevShelfBody(["Pyrex", "Fire-King"], "imgZ");
  assert.deepEqual(b.assets, { imgZ: { type: "image", part: "shelf" } });
  assert.equal(b.state.shelf, "imgZ");
  assert.deepEqual(Object.keys(b.questions), ["h0", "b0", "h1", "b1"]);
  assert.equal(b.questions.h1.type, "noul");
  assert.equal(b.questions.b1.type, "box");
  assert.match(b.questions.b1.instructions, /hunts\[1\]/);
});
test("jevShelfRead keeps a box only when the Noul says yes, sorted by likelihood", () => {
  const box = { top: 0.1, bottom: 0.4, left: 0.2, right: 0.3 };
  const out = jevShelfRead(["Pyrex", "Fire-King"], {
    h0: { probability: 0.2 }, b0: { box: box, confidence: 0.9 },
    h1: { probability: 0.87 }, b1: { box: box, confidence: 0.66 }
  });
  assert.deepEqual(out.map(x => x.hunt), ["Fire-King", "Pyrex"]);
  assert.deepEqual(out[0].box, { top: 0.1, bottom: 0.4, left: 0.2, right: 0.3, c: 0.66 });
  assert.equal(out[1].box, undefined);
  assert.equal(jevShelfRead(["a"], null), null);
});
test("shelf mode runs Muse and Jev together, shadow only, with the images header", () => {
  assert.match(INDEX, /museVision\(env, shelfPrompt\(\), image, false\)\.catch\(\(\) => null\),\n\s+sHunts\.length \? jevShelf\(/);
  assert.match(INDEX, /if \(js\) so\.jevShelf = js;/);
  assert.match(INDEX, /JEV_SHELF\) \|\| "off"\)\.toLowerCase\(\) === "shadow"/);
});
