/* v173 Google Lens matches through SerpApi's free plan (Matt: "I need something free"), and generic labels dropped.
   Run: node --test worker/__tests__/lens-v173.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constLine = (name) => new RegExp("^const " + name + " = [^\\n]+", "m").exec(INDEX)[0];
class FakeR2 { constructor() { this.m = new Map(); this.log = []; } async put(k, v) { this.log.push("put " + k); this.m.set(k, v); } async get(k) { return this.m.has(k) ? { body: this.m.get(k) } : null; } async delete(k) { this.log.push("delete " + k); this.m.delete(k); } }
const SERP = { visual_matches: [
  { title: "Vintage Royal Haeger Orange Winking Egyptian Cat 616", link: "https://www.ebay.com/itm/1234567890", source: "eBay", thumbnail: "https://serpapi.com/t1.jpg", price: { value: "$125.00", extracted_value: 125 } },
  { title: "Mid Century Royal Haeger cat", link: "https://grandviewshop.example.com/cat", source: "Grandview", thumbnail: "https://serpapi.com/t2.jpg" },
  { title: "no link" }, { title: "bad", link: "javascript:alert(1)" },
  ...Array.from({ length: 6 }, (_, i) => ({ title: "More " + i, link: "https://m" + i + ".example.org/x" })) ] };
function load(fetch, vCount) {
  const deps = { fetch, vCount, crypto: webcrypto, atob, console: { error() {} }, pxHmac: async (k, s) => "h" + s.length + "x".repeat(40), sessKey: () => "k", alSame: (a, b) => a === b, scrubListingText: (s, n) => String(s).slice(0, n), EBAY_IMAGE_LIMIT: 8 };
  const keys = Object.keys(deps);
  const body = constLine("LENS_PER_DAY") + "\n" + constLine("VISION_GENERIC") + "\n" + ["lensSig", "lensFind", "lensPick", "lensPhotoRoute", "apPrompt"].map(indexFn).join("\n") + "\nreturn { lensSig, lensFind, lensPick, lensPhotoRoute, apPrompt, VISION_GENERIC };";
  return new Function(...keys, body)(...keys.map((k) => deps[k]));
}

test("lensPick: https listings with a title, six at most, the price when it looks like one", () => {
  const L = load(null, null).lensPick(SERP);
  assert.equal(L.length, 6);
  assert.deepEqual(L[0], { title: "Vintage Royal Haeger Orange Winking Egyptian Cat 616", url: "https://www.ebay.com/itm/1234567890", image: "https://serpapi.com/t1.jpg", source: "eBay", price: "$125.00" });
  assert.equal(L[1].price, ""); assert.ok(L.every((x) => /^https:/.test(x.url)));
  assert.equal(load(null, null).lensPick({}), null);
});

test("lensFind: no key, nothing; with it the photo sits in R2 behind a signed link only while SerpApi looks, then is deleted", async () => {
  const calls = [], r2 = new FakeR2();
  let served = null;
  const W = load(async (u) => { calls.push(u);
    const photo = decodeURIComponent(/[?&]url=([^&]+)/.exec(u)[1]), pu = new URL(photo);
    served = await W.lensPhotoRoute({}, { PROWL_FINDS: r2 }, pu);   /* SerpApi fetches the photo now */
    return { ok: true, json: async () => SERP }; }, async (k, n) => { assert.equal(k, "gl:all"); assert.equal(n, 8); return true; });
  const img = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
  assert.equal(await W.lensFind(img, { PROWL_FINDS: r2 }, "https://prowl.thebluecloud.workers.dev"), null, "no SERPAPI_KEY");
  assert.equal(calls.length, 0);
  const env = { SERPAPI_KEY: "s".repeat(64), PROWL_FINDS: r2 };
  const L = await W.lensFind(img, env, "https://prowl.thebluecloud.workers.dev");
  assert.equal(L[0].title, "Vintage Royal Haeger Orange Winking Egyptian Cat 616");
  assert.match(calls[0], /^https:\/\/serpapi\.com\/search\.json\?engine=google_lens&hl=en&country=us&url=https%3A%2F%2Fprowl\.thebluecloud\.workers\.dev%2Flens%2F[0-9a-f]{16}\.jpg%3Fe%3D\d+%26s%3D/);
  assert.equal(served.status, 200, "the signed link served the photo while SerpApi looked");
  assert.deepEqual(r2.log.map((x) => x.replace(/[0-9a-f]{16}/, "K")), ["put finds/lens/K.jpg", "delete finds/lens/K.jpg"], "deleted after");
  assert.equal(r2.m.size, 0);
  const bad = new URL("https://prowl.thebluecloud.workers.dev/lens/0123456789abcdef.jpg?e=" + (Math.floor(Date.now() / 1000) + 60) + "&s=wrong");
  assert.equal((await W.lensPhotoRoute({}, env, bad)).status, 404, "a wrong signature gets nothing");
  const W2 = load(async () => { throw new Error("no call"); }, async () => false);
  assert.equal(await W2.lensFind(img, env, "https://prowl.thebluecloud.workers.dev"), null, "past LENS_PER_DAY: no call");
});

test("the AI gets Lens's titles as the strongest evidence; generic labels are dropped", () => {
  const W = load(null, null);
  const p = W.apPrompt("", false, "", [], 1, [], [{ title: "Royal Haeger Orange Winking Egyptian Cat 616" }]);
  assert.match(p, /Google Lens matched the photo to these listings, by the picture itself\..*strongest evidence of maker and model:\n- Royal Haeger Orange Winking Egyptian Cat 616\n/s);
  assert.doesNotMatch(W.apPrompt("", false, "", [], 1, []), /Google Lens/);
  for (const g of ["sculpture", "figurine", "ceramic", "statue", "orange"]) assert.ok(W.VISION_GENERIC.test(g), g);
  assert.ok(!W.VISION_GENERIC.test("haeger potteries"));
  assert.match(indexFn("visionPick"), /VISION_GENERIC\.test\(k\)/);
});

test("wiring: the quick check asks Lens beside eBay and Vision, hands back lens, counts gl:all, serves /lens/; v173", () => {
  const ap = indexFn("appraise");
  assert.match(ap, /lensFind\(image, env, new URL\(request\.url\)\.origin\)/);
  assert.match(ap, /if \(lens\) out\.lens = lens;/);
  assert.match(ap, /apPrompt\(price, false, hint, looks, ims\.length, web && web\.seen, lens\)/);
  assert.match(INDEX, /\{ key: "gl:all", name: "Google Lens \(SerpApi, free 250 a month\)", limit: 8 \}/);
  assert.match(INDEX, /url\.pathname\.startsWith\("\/lens\/"\) && request\.method === "GET"\) return lensPhotoRoute/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 173);
});

/* Matt: "just getting them to Google images in a separate screen similar to when we open marketplace would work" */
test("POST /lens/up keeps a JPEG behind a 15-minute signed link and hands back Lens's upload-by-URL; the sweep deletes old ones", async () => {
  const r2 = new FakeR2();
  r2.list = async () => ({ objects: [{ key: "finds/lens/old.jpg", uploaded: new Date(Date.now() - 2 * 3600000) }, { key: "finds/lens/new.jpg", uploaded: new Date() }], truncated: false });
  const deps = { crypto: webcrypto, atob, console: { error() {} }, pxHmac: async (k, s) => "h" + s.length + "x".repeat(40), sessKey: () => "k", alSame: (a, b) => a === b,
    ALLOW_ORIGINS: ["https://www.owlandtwigvintage.com"], ipKey: (x) => x, vCount: async () => true,
    readJson: async (req) => JSON.parse(await req.text()), json: (o, st) => ({ status: st || 200, body: o }) };
  const keys = Object.keys(deps);
  const W = new Function(...keys, constLine("LENS_UP_SECONDS") + "\n" + ["lensSig", "lensUp", "lensSweep"].map(indexFn).join("\n") + "\nreturn { lensUp, lensSweep };")(...keys.map((k) => deps[k]));
  const jpg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString("base64");
  const req = (body) => ({ url: "https://prowl.thebluecloud.workers.dev/lens/up", headers: { get: () => "1.2.3.4" }, text: async () => JSON.stringify(body) });
  const env = { PROWL_FINDS: r2 };
  assert.equal((await W.lensUp(req({ image: jpg }), env, "https://evil.example.com")).status, 403, "only from the page");
  assert.equal((await W.lensUp(req({ image: "data:image/jpeg;base64," + Buffer.alloc(200, 1).toString("base64") }), env, "https://www.owlandtwigvintage.com")).status, 400, "not a JPEG");
  const ok = await W.lensUp(req({ image: jpg }), env, "https://www.owlandtwigvintage.com");
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /^https:\/\/prowl\.thebluecloud\.workers\.dev\/lens\/[0-9a-f]{16}\.jpg\?e=\d+&s=/);
  const e = Number(/e=(\d+)/.exec(ok.body.url)[1]); assert.ok(Math.abs(e - (Date.now() / 1000 + 900)) < 5, "15 minutes");
  assert.equal(ok.body.lens, "https://lens.google.com/uploadbyurl?url=" + encodeURIComponent(ok.body.url));
  assert.equal(r2.m.size, 1);
  assert.equal(await W.lensSweep({ PROWL_FINDS: r2 }), 1);
  assert.deepEqual(r2.log.filter((x) => /^delete/.test(x)), ["delete finds/lens/old.jpg"], "only what is older than an hour");
  assert.match(INDEX, /url\.pathname === "\/lens\/up" && request\.method === "POST"\) return lensUp/);
  assert.match(INDEX, /await lensSweep\(env\);/);
});
