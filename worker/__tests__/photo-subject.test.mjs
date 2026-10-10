/* v103: a photo check on a busy photo. A Couroc café tray shot beside a sphinx bookend and old books came back as
   something else: nothing told the AI which object was being checked, and eBay's photo search, which looks at the whole
   photo, handed it lookalikes of whatever else was in the frame as evidence. Run: node --test worker/__tests__/photo-subject.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const src = (() => { const m = /^function apPrompt\(/m.exec(INDEX); return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2); })();
const apPrompt = new Function("scrubListingText", "EBAY_IMAGE_LIMIT", src + "\nreturn apPrompt;")((t, n) => String(t).slice(0, n), 10);
const LOOKS = [{ title: "Bronze sphinx bookend pair" }, { title: "Couroc of Monterey tray poodle cafe" }];

test("the AI is told the piece is the one that fills the frame, and to ignore what is around it", () => {
  for (const searched of [true, false]) {
    const p = apPrompt("", searched, "", []);
    assert.match(p, /the piece being checked is the one that fills most of the frame/);
    assert.match(p, /Identify only that piece and ignore everything around it/);
    assert.match(p, /books, bookends, flowers/);
  }
});

test("with lookalikes, it is told eBay searched the whole photo, so a match for something else in the frame is not evidence", () => {
  const p = apPrompt("$20", false, "", LOOKS);
  assert.match(p, /eBay searched the whole photo, so some may match something else in the frame rather than the piece: ignore those/);
  assert.ok(p.indexOf("- Bronze sphinx bookend pair") > -1 && p.indexOf("- Couroc of Monterey tray poodle cafe") > -1, "the titles are still listed");
  assert.ok(p.indexOf("ignore those") < p.indexOf("- Bronze sphinx"), "the warning comes before the titles");
});

test("without lookalikes there is no lookalike warning, and the eight-line answer format is unchanged", () => {
  const p = apPrompt("", false, "", []);
  assert.doesNotMatch(p, /eBay searched the whole photo/);
  for (const k of ["ITEM:", "CONDITION:", "FLAWS:", "FAIR PRICE:", "VERDICT:", "WHY:", "SURE:", "SEARCH:"]) assert.ok(p.includes("\n" + k), k);
});

test("a maker the collector typed still leads", () => {
  const p = apPrompt("", false, "Couroc", []);
  assert.match(p, /The collector has identified it as: Couroc\./);
});

test("the worker says v103 or later", () => {
  const v = /const WORKER_VERSION = "v(\d+)";/.exec(INDEX);
  assert.ok(v && Number(v[1]) >= 103);
});
