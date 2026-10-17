// Worker v121 (Matt, 2026-10-17: share a photo into Prowl on Android, the way the Chrome extension takes an image).
// The installed app's manifest share_target POSTs the photo to /pages/prowl-app?share-target=1; sw.js keeps it in
// Cache Storage and sends the app to ?shared=1. Every other request passes straight through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SW = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

function boot() {
  const handlers = {}, store = new Map();
  const self = {
    location: { origin: "https://www.owlandtwigvintage.com" },
    addEventListener: (t, f) => { handlers[t] = f; },
    skipWaiting() {}, clients: { claim() {} }, registration: {},
  };
  const caches = { open: async () => ({ put: async (k, r) => { store.set(k, await r.blob()); } }) };
  vm.runInNewContext(SW, { self, caches, Response, URL, Blob, Uint8Array, atob, fetch: () => Promise.resolve() });
  return { fetch: handlers.fetch, store };
}
function run(h, req) {
  let p = null;
  h.fetch({ request: req, respondWith: (x) => { p = x; } });
  return p;
}
function share(file) {
  const fd = new FormData();
  if (file) fd.append("photo", file, "pic.jpg");
  return new Request("https://www.owlandtwigvintage.com/pages/prowl-app?share-target=1", { method: "POST", body: fd });
}

test("a shared photo is kept on the phone and the app opens at ?shared=1", async () => {
  const h = boot();
  const r = await run(h, share(new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("Location"), "https://www.owlandtwigvintage.com/pages/prowl-app?shared=1");
  const b = h.store.get("/__prowl-share");
  assert.equal(b.size, 3);
  assert.equal(b.type, "image/jpeg");
});

test("no photo, or not an image: back to the app with ?shared=0 and nothing kept", async () => {
  for (const f of [null, new Blob(["hi"], { type: "text/plain" })]) {
    const h = boot();
    const r = await run(h, share(f));
    assert.equal(r.headers.get("Location"), "https://www.owlandtwigvintage.com/pages/prowl-app?shared=0");
    assert.equal(h.store.size, 0);
  }
});

test("every other request passes through untouched", () => {
  const h = boot();
  assert.equal(run(h, new Request("https://www.owlandtwigvintage.com/pages/prowl-app")), null);
  assert.equal(run(h, new Request("https://www.owlandtwigvintage.com/cart/add", { method: "POST", body: "x" })), null);
});
