/* v120: admin phone app files. Run: node --test worker/__tests__/admin-app.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appAsset, MANIFEST, SW } from "../admin-app.js";
import { loginPage, adminPage } from "../admin-page.js";

test("manifest makes /admin installable and opens on Members", () => {
  const m = JSON.parse(MANIFEST);
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/admin#members");
  assert.equal(m.scope, "/admin");
  assert.ok(m.icons.some(i => i.sizes === "512x512" && i.purpose === "maskable"));
  assert.ok(m.icons.some(i => i.sizes === "192x192"));
});

test("icons are real PNGs of the stated size", async () => {
  for (const n of [180, 192, 512]) {
    const r = appAsset("/admin/icon-" + n + ".png", "GET");
    assert.equal(r.headers.get("Content-Type"), "image/png");
    const b = new Uint8Array(await r.arrayBuffer());
    assert.deepEqual([...b.slice(1, 4)], [80, 78, 71]);
    const dv = new DataView(b.buffer);
    assert.equal(dv.getUint32(16), n); assert.equal(dv.getUint32(20), n);
  }
});

test("service worker: scope header, parses, never caches", async () => {
  const r = appAsset("/admin/sw.js", "GET");
  assert.equal(r.headers.get("Service-Worker-Allowed"), "/admin");
  assert.doesNotThrow(() => new Function(SW));
  assert.equal(/caches\./.test(SW), false);
});

test("other paths fall through; non-GET refused", () => {
  assert.equal(appAsset("/admin", "GET"), null);
  assert.equal(appAsset("/admin/api/members", "GET"), null);
  assert.equal(appAsset("/admin/sw.js", "POST").status, 405);
});

test("both pages link the manifest and iPhone icon", () => {
  for (const h of [adminPage("n", "v120"), loginPage("n", "")]) {
    assert.match(h, /<link rel="manifest" href="\/admin\/app.webmanifest">/);
    assert.match(h, /apple-touch-icon" href="\/admin\/icon-180.png"/);
    assert.match(h, /apple-mobile-web-app-capable/);
  }
  assert.match(adminPage("n", "v120"), /serviceWorker\.register\("\/admin\/sw\.js"/);
});
