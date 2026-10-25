/* v164: a photo check takes up to 3 photos of one piece (POST /appraise { images }), the AI sees them all, and a free
   visitor's re-check of a photo checked in the last 30 minutes (a corrected maker, a close-up added) is free 3 times.
   Run: node --test worker/__tests__/photo-tray-v164.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function fn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => { const m = new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX); assert.ok(m, name); return m[0]; };
const CONSTS = INDEX.match(/^const APPRAISE_MAX_PHOTOS = [^\n]+/m)[0];
const IMG = (n, size) => "data:image/jpeg;base64," + "A".repeat(size || 10) + n;

/* a Cache API that keeps what it is given and honours max-age against a clock the test moves */
function fakeCache() {
  const m = new Map();
  const now = { t: 1_800_000_000_000 };
  return {
    now, m,
    async match(k) { const v = m.get(k.url); if (!v || v.until <= now.t) return undefined; return new Response(v.body); },
    async put(k, res) { const age = Number(/max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "")[1]); m.set(k.url, { body: await res.text(), until: now.t + age * 1000 }); },
  };
}
function load() {
  const cache = fakeCache();
  const fakeDate = { now: () => cache.now.t };
  const W = new Function("caches", "Date", CONSTS + "\n" + [fn("sha16"), fn("apImages"), fn("apRcKey"), fn("apRcMark"), fn("apRcTake")].join("\n") + "\nreturn { apImages, apRcMark, apRcTake };")({ default: cache }, fakeDate);
  return { W, cache };
}

test("apImages: up to 3 photos from images, the older single image still works, anything else is refused", () => {
  const { W } = load();
  assert.deepEqual(W.apImages({ images: [IMG(1), IMG(2)] }).ims, [IMG(1), IMG(2)]);
  assert.deepEqual(W.apImages({ images: [IMG(1), IMG(2), IMG(3), IMG(4)] }).ims, [IMG(1), IMG(2), IMG(3)], "a fourth is left out");
  assert.deepEqual(W.apImages({ image: IMG(9) }).ims, [IMG(9)], "the page before v7.76");
  assert.deepEqual(W.apImages({}), { err: "need a photo", code: 400 });
  assert.deepEqual(W.apImages({ images: [] }), { err: "need a photo", code: 400 });
  assert.deepEqual(W.apImages({ images: [IMG(1), "https://example.com/x.jpg"] }), { err: "need a photo", code: 400 }, "every one must be a photo");
  assert.deepEqual(W.apImages({ images: [IMG(1, 2800001)] }), { err: "photo too large", code: 413 });
  assert.deepEqual(W.apImages({ images: [IMG(1, 2500000), IMG(2, 2500000), IMG(3, 2500000)] }), { err: "photo too large", code: 413 }, "7 MB in all");
  assert.equal(constLine("APPRAISE_MAX_PHOTOS").includes("APPRAISE_MAX_PHOTOS = 3"), true);
});

test("a re-check of a photo checked in the last 30 minutes is free 3 times, from the same address only", async () => {
  const { W, cache } = load();
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(1)]), false, "nothing checked yet");
  await W.apRcMark("1.2.3.4", [IMG(1), IMG(2)]);
  assert.equal(await W.apRcTake("5.6.7.8", [IMG(1)]), false, "another address pays");
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(7)]), false, "a different photo pays");
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(1)]), true);
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(1), IMG(5)]), true, "with a close-up added");
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(2)]), true, "the other photo of the check, counted on its own");
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(1)]), true);
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(1)]), false, "three re-checks a photo");
  await W.apRcMark("1.2.3.4", [IMG(3)]);
  cache.now.t += 1801 * 1000;
  assert.equal(await W.apRcTake("1.2.3.4", [IMG(3)]), false, "30 minutes on, it is a new check");
  for (const k of cache.m.keys()) assert.match(k, /^https:\/\/prowl-recheck\.invalid\/[0-9a-f]{16}$/, "a digest only: no address, no photo");
});

test("appraise: a re-check skips the free count but not the shared pool; the AI gets every photo; eBay the first", () => {
  const a = fn("appraise");
  assert.ok(a.indexOf("await apRcTake(ip, ims)") > a.indexOf("pro = await proMember") && a.indexOf("await apRcTake(ip, ims)") < a.indexOf('vTake("apf:" + ip'), "checked before the free count");
  assert.match(a, /if \(left !== null \|\| again\) \{ const pool = await poolOk/);
  assert.match(a, /giveBack\(again \? \[\] : \["apf:" \+ ip/, "a re-check has no count to give back");
  assert.match(a, /if \(left !== null\) await apRcMark\(ip, ims\);/, "only a counted free check marks its photos");
  assert.match(a, /apPrompt\(price, false, hint, looks, ims\.length, web && web\.seen, lens\), ims, false\)/);   /* v173: and Lens */   /* v172: and the web's labels */
  assert.match(a, /ebayImageSearch\(image, env\)/);
  assert.match(a, /const ims = pi\.ims, image = ims\[0\];/);
  assert.match(a, /if \(again\) out\.again = true;/);
});

test("museVision sends every photo after the prompt; apPrompt says there are several", async () => {
  const sent = [];
  const fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: "ITEM: x" } }], output_text: "ITEM: x" }) }; };
  const museVision = new Function("fetch", "MUSE_RESPONSES_URL", "MUSE_URL", "MUSE_MODEL", "AbortController", "setTimeout", "clearTimeout", fn("museVision") + "\nreturn museVision;")(fetch, "r", "c", "m", AbortController, setTimeout, clearTimeout);
  await museVision({ MUSE_API_KEY: "k" }, "P", [IMG(1), IMG(2)], false);
  assert.deepEqual(sent[0].messages[0].content, [{ type: "text", text: "P" }, { type: "image_url", image_url: { url: IMG(1) } }, { type: "image_url", image_url: { url: IMG(2) } }]);
  await museVision({ MUSE_API_KEY: "k" }, "P", [IMG(1), IMG(2)], true);
  assert.deepEqual(sent[1].input[0].content.map((c) => c.type), ["input_text", "input_image", "input_image"]);
  await museVision({ MUSE_API_KEY: "k" }, "P", IMG(3), false);
  assert.equal(sent[2].messages[0].content.length, 2, "one photo still works");
  const apPrompt = new Function("scrubListingText", "EBAY_IMAGE_LIMIT", fn("apPrompt") + "\nreturn apPrompt;")((t, n) => String(t).slice(0, n), 10);
  assert.match(apPrompt("", false, "", [], 2), /There are 2 photos of the same piece: the first shows the whole piece/);
  assert.doesNotMatch(apPrompt("", false, "", [], 1), /There are/);
  assert.doesNotMatch(apPrompt("", false, "", []), /There are/);
});
