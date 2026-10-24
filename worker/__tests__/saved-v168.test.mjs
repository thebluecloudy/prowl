/* v168 Saved forever (Matt: "Let's build the forever save but a prowl perk and let's trim it to a year").
   saved.js is pure and imported as is; alSaved and its helpers are taken from index.js with fakes for KV, R2 and fetch.
   Run: node --test worker/__tests__/saved-v168.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../saved.js";

const DAY = 86400000, NOW = Date.UTC(2026, 9, 24, 12);
const find = (n, at, extra = {}) => ({ url: "https://www.ebay.com/itm/" + n, title: "Rookwood vase " + n, price: "$" + n, image: "https://i.ebayimg.com/images/" + n + ".jpg", src: "ebay", hunt: "rookwood vase", at, ...extra });

test("two devices: finds from both are kept, newest first; the newer copy of a link wins", () => {
  const m = S.savedMerge({ saved: [find(1, NOW - 100), find(2, NOW - 300)] }, { saved: [find(3, NOW - 200), find(1, NOW - 50)] }, NOW);
  assert.deepEqual(m.saved.map((f) => f.url.slice(-1)), ["1", "3", "2"]);
  assert.equal(m.saved[0].at, NOW - 50);
  assert.deepEqual(m.gone, []);
});

test("removed beats an older save, a newer save beats an older removal, a tie is removed", () => {
  const m = S.savedMerge({ saved: [find(1, NOW - 100), find(2, NOW - 100), find(3, NOW - 100)] },
    { gone: [{ u: find(1).url, at: NOW - 50 }, { u: find(2).url, at: NOW - 150 }, { u: find(3).url, at: NOW - 100 }] }, NOW);
  assert.deepEqual(m.saved.map((f) => f.url.slice(-1)), ["2"]);
  assert.deepEqual(m.gone.map((g) => g.u.slice(-1)).sort(), ["1", "3"]);
});

test("a find is kept a year from the day it was saved, then leaves; its photo is listed to delete", () => {
  const had = { saved: [{ ...find(1, NOW - 366 * DAY), ph: 1 }, { ...find(2, NOW - 364 * DAY), ph: 1 }, find(3, NOW - 400 * DAY)] };
  const m = S.savedMerge(had, null, NOW);
  assert.deepEqual(m.saved.map((f) => f.url.slice(-1)), ["2"]);
  assert.equal(m.saved[0].ph, 1, "the stored photo flag stays");
  assert.deepEqual(m.dropped, [find(1).url], "only finds that had a photo");
  assert.equal(S.savedUntil(NOW - 364 * DAY), new Date(NOW + DAY).toISOString().slice(0, 10));
});

test("a device cannot claim a photo is kept; a find saved before v168 (no time) starts its year now", () => {
  const m = S.savedMerge(null, { saved: [{ ...find(1, 0), ph: 1 }] }, NOW);
  assert.equal(m.saved[0].ph, 0);
  assert.equal(m.saved[0].at, NOW);
  const f = S.savedMerge(null, { saved: [find(2, NOW + 10 * DAY)] }, NOW);
  assert.equal(f.saved[0].at, NOW, "a fast clock is clamped to now");
});

test("past the cap the oldest leave, photos and all; junk is ignored; old removals are forgotten", () => {
  const many = Array.from({ length: S.SAVED_MAX + 2 }, (_, i) => ({ ...find(i, NOW - i * 1000), ph: 1 }));
  const m = S.savedMerge({ saved: many, gone: [{ u: "https://x.co/a", at: NOW - 400 * DAY }] }, { saved: [null, { url: "http://x.co/b", title: "t" }, { url: "https://x.co/c" }] }, NOW);
  assert.equal(m.saved.length, S.SAVED_MAX);
  assert.deepEqual(m.dropped.sort(), [find(S.SAVED_MAX).url, find(S.SAVED_MAX + 1).url].sort());
  assert.deepEqual(m.gone, []);
});

test("photos are fetched only from named public https hosts", () => {
  for (const u of ["https://i.ebayimg.com/a.jpg", "https://shopgoodwillimages.azureedge.net/x/y.jpg", "https://i.etsystatic.com/1/il.jpg"]) assert.ok(S.photoHostOk(u), u);
  for (const u of ["http://i.ebayimg.com/a.jpg", "https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://localhost/a.jpg", "https://printer.local/a.jpg",
    "https://i.ebayimg.com:8443/a.jpg", "https://user:pw@i.ebayimg.com/a.jpg", "https://metadata.internal/a", "not a url"]) assert.ok(!S.photoHostOk(u), u);
  const c = S.savedToCopy([{ ...find(1, 3), ph: 1 }, find(2, 2), { ...find(3, 1), image: "" }, find(4, 0)], 1);
  assert.deepEqual(c.map((f) => f.url.slice(-1)), ["2"]);
});

/* ---- the route, from index.js ---- */
const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
class FakeR2 {
  constructor() { this.m = new Map(); }
  async put(k, v, o) { this.m.set(k, { body: v, httpMetadata: (o && o.httpMetadata) || {} }); }
  async get(k) { return this.m.get(k) || null; }
  async delete(k) { this.m.delete(k); }
  async list({ prefix }) { return { objects: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; }
}
const EMAIL = "jane@example.com", TOK = "T".repeat(24);
async function sha16(s) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s || ""))); return Array.from(new Uint8Array(d).slice(0, 8), (x) => ("0" + x.toString(16)).slice(-2)).join(""); }
async function pxHmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))), (x) => ("0" + x.toString(16)).slice(-2)).join("");
}
function setup({ pro = true, image = true } = {}) {
  const kv = new FakeKV(), r2 = new FakeR2(), fetched = [];
  kv.set("sub:" + EMAIL, { email: EMAIL, tok: TOK, pro });
  const fetch = async (u) => { fetched.push(u); return image ? new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { status: 200, headers: { "Content-Type": "image/jpeg" } }) : new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }); };
  const deps = {
    ...S, fetch, sha16, pxHmac, sessKey: () => "k".repeat(40),
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)),
    json: (body, status) => ({ status: status || 200, body }),
    alReady: (env) => !!env.PROWL_ALERTS, readJson: async (r) => (r.big ? { big: true } : r.body || {}), sessMember: async () => null, vCount: async () => true,
    alEmail: (e) => (typeof e === "string" && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e.trim()) ? e.trim().toLowerCase() : ""),
    alSame: (a, b) => typeof a === "string" && typeof b === "string" && a.length > 0 && a === b,
  };
  const names = ["alSaved", "savedPhotoCopy", "savedSig", "savedPhotoUrl", "savedPhotoRoute", "savedIndex", "savedSweep", "savedPurge"];
  const keys = Object.keys(deps);
  const W = new Function(...keys, names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { W, kv, r2, env: { PROWL_ALERTS: kv, PROWL_FINDS: r2 }, fetched };
}
const post = (body) => ({ body: { email: EMAIL, tok: TOK, ...body } });

test("without Prowl Pro: 402, nothing stored, nothing fetched", async () => {
  const { W, kv, env, fetched } = setup({ pro: false });
  const r = await W.alSaved(post({ saved: [find(1, NOW)] }), env, "");
  assert.equal(r.status, 402);
  assert.equal(r.body.pro, false);
  assert.equal(kv.json("saved:" + EMAIL), null);
  assert.equal(fetched.length, 0);
});

test("Pro: the finds are kept, each photo copied once and handed back as a signed link with its keep-until day", async () => {
  const { W, kv, r2, env, fetched } = setup();
  const now = Date.now();
  const r = await W.alSaved(post({ saved: [find(1, now - 1000), find(2, now - 2000)] }), env, "");
  assert.equal(r.status, 200);
  assert.equal(r.body.saved.length, 2);
  const h = await sha16(EMAIL), k = await sha16(find(1).url);
  assert.ok(r2.m.has("saved/" + h + "/" + k + ".jpg"), "the photo is in R2 under the hashed address");
  assert.ok(![...r2.m.keys()].some((x) => x.includes("jane")), "no email in a key");
  assert.match(r.body.saved[0].ph, new RegExp("^/saved/" + h + "/" + k + "\\.jpg\\?e=\\d+&s=[0-9a-f]{32}$"));
  assert.equal(r.body.saved[0].until, S.savedUntil(now - 1000));
  assert.deepEqual(kv.json("saved:all"), [EMAIL], "listed for the daily sweep");
  assert.equal(kv.json("saved:" + EMAIL).saved[0].ph, 1);
  const n = fetched.length;
  await W.alSaved(post({ saved: [find(1, now - 1000)] }), env, "");
  assert.equal(fetched.length, n, "a kept photo is not fetched again");
  /* the signed link serves the photo; a wrong or stale signature does not */
  const ok = await W.savedPhotoRoute({}, env, new URL("https://w.dev" + r.body.saved[0].ph));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "image/jpeg");
  const flip = r.body.saved[0].ph.replace(/s=(.)/, (m, c) => "s=" + (c === "0" ? "1" : "0"));   /* always a different first character */
  const bad = await W.savedPhotoRoute({}, env, new URL("https://w.dev" + flip));
  assert.equal(bad.status, 404);
  const old = await W.savedPhotoRoute({}, env, new URL("https://w.dev/saved/" + h + "/" + k + ".jpg?e=1&s=" + (await W.savedSig(env, h, k, 1))));
  assert.equal(old.status, 404);
});

test("a page that is not an image is not kept as a photo", async () => {
  const { W, r2, env } = setup({ image: false });
  const r = await W.alSaved(post({ saved: [find(1, Date.now())] }), env, "");
  assert.equal(r2.m.size, 0);
  assert.equal(r.body.saved[0].ph, "");
});

test("removing a find deletes its photo", async () => {
  const { W, r2, env } = setup();
  const now = Date.now();
  await W.alSaved(post({ saved: [find(1, now - 1000)] }), env, "");
  assert.equal(r2.m.size, 1);
  const r = await W.alSaved(post({ saved: [], gone: [{ u: find(1).url, at: now }] }), env, "");
  assert.equal(r.body.saved.length, 0);
  assert.equal(r2.m.size, 0);
});

test("the daily sweep drops finds past their year with their photos, and an empty list leaves the index", async () => {
  const { W, kv, r2, env } = setup();
  const now = Date.now();
  await W.alSaved(post({ saved: [find(1, now - 1000)] }), env, "");
  assert.deepEqual(await W.savedSweep(env, now), { swept: 0 });
  const r = await W.savedSweep(env, now + 366 * DAY);
  assert.equal(r.swept, 1);
  assert.equal(r2.m.size, 0);
  assert.equal(kv.json("saved:" + EMAIL), null);
  assert.deepEqual(kv.json("saved:all"), []);
});

test("Delete in Prowl takes every saved photo and the index entry", async () => {
  const { W, kv, r2, env } = setup();
  await W.alSaved(post({ saved: [find(1, Date.now()), find(2, Date.now() - 5)] }), env, "");
  assert.equal(r2.m.size, 2);
  await W.savedPurge(env, EMAIL);
  assert.equal(r2.m.size, 0);
  assert.deepEqual(kv.json("saved:all"), []);
  assert.match(INDEX, /"last:", "likes:", "saved:", "code:"/, "saved:<email> goes with the rest");
  assert.match(INDEX, /await savedPurge\(env, email\); gone\.push\("saved\/"\);/);
});

test("the routes are wired and the version is v168 or later", () => {
  assert.match(INDEX, /url\.pathname === "\/alerts\/saved" && request\.method === "POST"\) return alSaved\(/);
  assert.match(INDEX, /url\.pathname\.startsWith\("\/saved\/"\) && request\.method === "GET"\) return savedPhotoRoute\(/);
  assert.match(INDEX, /await savedSweep\(env\)/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 168, "v168 or later");
});
