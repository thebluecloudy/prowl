/* v190: a Jev shadow pass can never hold up or break the photo check. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) { const i = INDEX.indexOf("function " + name + "("); return INDEX.slice(i, INDEX.indexOf("\n}\n", i) + 2); }
const graceRace = new Function(fn("graceRace") + "; return graceRace;")();

test("graceRace returns the answer when it is in time", async () => {
  assert.deepEqual(await graceRace(Promise.resolve([1]), 50), [1]);
});
test("graceRace gives up with 'late' and does not wait for a slow pass", async () => {
  const t0 = Date.now();
  const r = await graceRace(new Promise(res => setTimeout(() => res([1]), 2000)), 40);
  assert.equal(r, "late");
  assert.ok(Date.now() - t0 < 500);
});
test("graceRace turns a failing pass into null instead of throwing", async () => {
  assert.equal(await graceRace(Promise.reject(new Error("boom")), 50), null);
});
test("the photo pass sends 3 pictures, starts without blocking, and is read through graceRace", () => {
  assert.match(INDEX, /const JEV_PHOTO_THUMBS = 3, JEV_GRACE_MS = 1500;/);
  assert.match(INDEX, /\(looks \|\| \[\]\)\.slice\(0, JEV_PHOTO_THUMBS\)/);
  assert.match(INDEX, /const photoP = thumbsP \? Promise\.resolve\(\)\.then\(\(\) => jevPhotoLooks\(/);
  assert.match(INDEX, /jevPhoto = await graceRace\(photoP, JEV_GRACE_MS\);/);
  assert.match(INDEX, /jevThumbs\(looks\)\.catch\(\(\) => \[\]\)/);
});
