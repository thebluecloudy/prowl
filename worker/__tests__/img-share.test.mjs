/* v115: GET /img?u= hands a find's photo to Prowl's page for Share in Flock. Only for Prowl's own pages, only an image,
   4 MB at most, a daily cap per visitor. Run: node --test worker/__tests__/img-share.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const SHOP = "https://www.owlandtwigvintage.com";
function load(answer, cap) {
  const asked = [];
  const deps = {
    ALLOW_ORIGINS: [SHOP], IMG_MAX: 4 * 1024 * 1024, IMG_PER_IP: 200,
    vCount: async () => cap !== false, ipKey: (x) => x || "ip",
    json: (o, st) => new Response(JSON.stringify(o), { status: st || 200 }),
    cors: (o) => ({ "Access-Control-Allow-Origin": o }),
    fetch: async (u) => { asked.push(u); return answer(u); },
  };
  const keys = Object.keys(deps);
  const f = new Function(...keys, indexFn("imgShare") + "\nreturn imgShare;")(...keys.map((k) => deps[k]));
  return { f, asked };
}
const req = () => new Request("https://w/img", { headers: { "CF-Connecting-IP": "1.2.3.4" } });
const img = (type, bytes) => async () => new Response(new Uint8Array(bytes || 10), { status: 200, headers: { "Content-Type": type } });

test("a photo for Prowl's page: the image, with CORS for the shop", async () => {
  const { f, asked } = load(img("image/jpeg"));
  const r = await f(req(), new URL("https://w/img?u=" + encodeURIComponent("https://i.ebayimg.com/images/g/abc/s-l1600.jpg")), SHOP);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Content-Type"), "image/jpeg");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), SHOP);
  assert.equal((await r.arrayBuffer()).byteLength, 10);
  assert.deepEqual(asked, ["https://i.ebayimg.com/images/g/abc/s-l1600.jpg"]);
});

test("not an open proxy: other sites, non-images, big files, bad addresses and the daily cap are refused", async () => {
  const u = (s) => new URL("https://w/img?u=" + encodeURIComponent(s));
  let L = load(img("image/jpeg"));
  assert.equal((await L.f(req(), u("https://i.ebayimg.com/a.jpg"), "https://evil.example")).status, 404, "only Prowl's pages");
  assert.equal(L.asked.length, 0);
  assert.equal((await L.f(req(), u("http://i.ebayimg.com/a.jpg"), SHOP)).status, 400, "https only");
  assert.equal((await L.f(req(), u("javascript:alert(1)"), SHOP)).status, 400);
  L = load(img("text/html"));
  assert.equal((await L.f(req(), u("https://example.com/page"), SHOP)).status, 415, "an image or nothing");
  L = load(img("image/svg+xml"));
  assert.equal((await L.f(req(), u("https://example.com/a.svg"), SHOP)).status, 415, "no SVG (it can carry script)");
  L = load(img("image/png", 4 * 1024 * 1024 + 1));
  assert.equal((await L.f(req(), u("https://example.com/big.png"), SHOP)).status, 413);
  L = load(img("image/jpeg"), false);
  assert.equal((await L.f(req(), u("https://i.ebayimg.com/a.jpg"), SHOP)).status, 429, "the daily cap");
  assert.match(INDEX, /url\.pathname === "\/img" && request\.method === "GET"\) return imgShare\(request, url, origin\)/);
});
