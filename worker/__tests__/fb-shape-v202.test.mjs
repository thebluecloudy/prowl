/* v202 (Matt, 2026-10-31: his first Facebook test showed every price as "—", and he asked to see the finds on the hunt
   pages with photos): fb.js reads the price and the photo in each shape the actor may send, the admin's test lists the
   field names Apify sent (names only) and keeps its finds where the hunt page reads them. Run:
   node --test worker/__tests__/fb-shape-v202.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as FB from "../fb.js";
import { adminFetch, signSession } from "../admin.js";
import { adminPage } from "../admin-page.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const KEY = "k".repeat(40), ORIGIN = "https://prowl.example.workers.dev", DAY = new Date().toISOString().slice(0, 10);
const PHOTO = "https://scontent-ord5-1.xx.fbcdn.net/v/t45/1.jpg";

test("the price: a dollar amount in every shape; another currency or a bad value gives none", () => {
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "$40", amount: "40.00", currency: "USD" } }), "$40");
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "$40", amount: "40.00" } }), "$40", "v200 dropped this: no currency field");
  assert.equal(FB.fbPrice({ listing_price: { amount: "1250.5" } }), "$1,250.50");
  assert.equal(FB.fbPrice({ listing_price: { amount: "12000" } }), "$12,000");
  assert.equal(FB.fbPrice({ listing_price: { amount: "0", formatted_amount: "FREE" } }), "FREE");
  assert.equal(FB.fbPrice({ listing_price: { amount: 0 } }), "Free");
  assert.equal(FB.fbPrice({ listing_price: "$15" }), "$15");
  assert.equal(FB.fbPrice({ formatted_price: "$7" }), "$7");
  assert.equal(FB.fbPrice({ price: "$9.99" }), "$9.99");
  assert.equal(FB.fbPrice({ price: 30 }), "$30");
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "CA$40", amount: "40", currency: "CAD" } }), "", "not dollars");
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "€40" } }), "");
  assert.equal(FB.fbPrice({ listing_price: { amount: "call me" } }), "");
  assert.equal(FB.fbPrice({ listing_price: { amount: "-5" } }), "");
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "CA$40", amount: "40" } }), "", "review fix: a formatted price naming another currency, no currency field");
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "40 CAD", amount: "40" } }), "");
  assert.equal(FB.fbPrice({ listing_price: { formatted_amount: "40 USD", amount: "40" } }), "$40");
  for (const blank of [" ", "\t", false, true, [], {}, "1e3", "0x10"]) assert.equal(FB.fbPrice({ listing_price: { amount: blank } }), "", "review fix: not a price: " + JSON.stringify(blank));
  assert.equal(FB.fbPrice({ listing_price: { amount: "" } }), "");
  assert.equal(FB.fbPrice({}), "");
  assert.equal(FB.fbPrice(null), "");
});

test("the photo: Facebook's image hosts only, in every shape", () => {
  assert.equal(FB.fbPhoto({ primary_listing_photo_url: PHOTO }), PHOTO);
  assert.equal(FB.fbPhoto({ primary_listing_photo: { image: { uri: PHOTO } } }), PHOTO);
  assert.equal(FB.fbPhoto({ primary_listing_photo: { photo_image_url: PHOTO } }), PHOTO);
  assert.equal(FB.fbPhoto({ listing_photos: [{ image: { uri: PHOTO } }] }), PHOTO);
  assert.equal(FB.fbPhoto({ primary_listing_photo: PHOTO }), PHOTO);
  assert.equal(FB.fbPhoto({ image: PHOTO }), PHOTO);
  assert.equal(FB.fbPhoto({ primary_listing_photo_url: "https://evil.example/fbcdn.net/a.jpg" }), "");
  assert.equal(FB.fbPhoto({ primary_listing_photo_url: "http://scontent.xx.fbcdn.net/a.jpg" }), "", "https only");
  assert.equal(FB.fbPhoto({ primary_listing_photo_url: "https://scontent.xx.fbcdn.net/" + "a".repeat(2100) }), "");
  assert.equal(FB.fbPhoto({ primary_listing_photo_url: "https://evil.example/a.jpg", primary_listing_photo: { image: { uri: PHOTO } } }), PHOTO, "the next shape is tried");
  assert.equal(FB.fbPhoto({}), "");
});

test("fbClean keeps the price and photo of the shapes v200 missed", () => {
  const out = FB.fbClean([{ id: "1234567", marketplace_listing_title: "VTG Large Black Ceramic Panther", listing_price: { formatted_amount: "$45", amount: "45.00" },
    primary_listing_photo: { image: { uri: PHOTO } }, location: { reverse_geocode: { city: "Ferndale", state: "MI" } } }], DAY);
  assert.deepEqual(out, [{ id: "1234567", title: "VTG Large Black Ceramic Panther", price: "$45", url: "https://www.facebook.com/marketplace/item/1234567/", image: PHOTO, location: "Ferndale, MI", found: DAY }]);
});

test("fbShape lists field names and types, never a value", () => {
  const f = FB.fbShape({ id: "1", listing_price: { amount: "4" }, marketplace_listing_seller: { name: "Ray Goberdhan" }, listing_photos: [{ image: { uri: PHOTO } }],
    redacted_description: { text: "jane@example.com" }, n: null, ok: true, "bad key!": 1 });
  assert.deepEqual(f, ["id (string)", "listing_price", "listing_price.amount (string)", "marketplace_listing_seller", "marketplace_listing_seller.name (string)",
    "listing_photos (list)", "listing_photos[].image", "listing_photos[].image.uri (string)", "redacted_description", "redacted_description.text (string)", "n (null)", "ok (boolean)"]);
  assert.doesNotMatch(f.join(" "), /Ray|Goberdhan|jane|example|fbcdn/);
  const deep = FB.fbShape({ a: { b: { c: { d: { e: 1 } } } } });
  assert.ok(!deep.some((x) => /\.e/.test(x)), "four levels at most");
  const many = {}; for (let i = 0; i < 200; i++) many["k" + i] = { x: 1 };
  assert.ok(FB.fbShape(many).length <= 80);
  assert.deepEqual(FB.fbShape(null), []);
});

test("fbRun answers the field names of the first listing", async () => {
  const cell = FB.fbCell(42.48, -83.47);
  const r = await FB.fbRun({ APIFY_TOKEN: "t" }, "panther", cell, 24, async () => new Response(JSON.stringify([{ id: "1234567", marketplace_listing_title: "Panther", listing_price: { amount: "5" } }]), { status: 200 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.fields, ["id (string)", "marketplace_listing_title (string)", "listing_price", "listing_price.amount (string)"]);
  assert.equal(r.items[0].price, "$5");
});

/* fbTestRun, built from index.js with fakes */
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); if (o && o.expirationTtl) this.ttl.set(k, o.expirationTtl); }
}
function testRun(callResult) {
  const kv = new FakeKV(), cell = FB.fbCell(42.48, -83.47);
  const asked = [];
  const deps = { fbTerm: FB.fbTerm, fbArea: async () => cell, fbCall: async (env, term, c, n, opt) => { asked.push(opt); return callResult; }, FB_UNIT: FB.FB_UNIT, FB_RUN_ITEMS: FB.FB_RUN_ITEMS, FB_TTL: FB.FB_TTL,
    fbEstimate: FB.fbEstimate, fbCapUnits: FB.fbCapUnits, fbLive: FB.fbLive, fbMerge: FB.fbMerge,
    fbMi: FB.fbMi, FB_USA_MI: FB.FB_USA_MI, fbPickKey: FB.fbPickKey, fbShipKey: FB.fbShipKey, scrubPII: (s) => s, FB_OWN_ZIP: "fbownzip", FB_DAY_LIST_MAX: 2000,
    kvGet: async (env, k, d) => { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; } };
  const keys = Object.keys(deps);
  const fn = new Function(...keys, indexFn("fbTestRun") + "\nreturn fbTestRun;")(...keys.map((k) => deps[k]));
  return { kv, cell, asked, run: (term, zip, mode) => fn({ PROWL_ALERTS: kv, APIFY_TOKEN: "t" }, term, zip, mode) };
}
const ITEM = (id) => ({ id: String(id), title: "Ceramic Panther " + id, price: "$40", url: "https://www.facebook.com/marketplace/item/" + id + "/", image: PHOTO, location: "Novi, MI", found: DAY });

test("the admin's test keeps its finds where the hunt page reads them (v203: fb3:<hunt>|<cell>|<miles>, merged, 8 days)", async () => {
  const T = testRun({ ok: true, items: [ITEM(1111111), ITEM(2222222)], raw: 2, units: 1100, used: 1205, cap: 100000, fields: ["id (string)"] });
  await T.kv.put(FB.fbPickKey("ceramic panther", T.cell, 50), JSON.stringify({ updated: "x", day: DAY, items: [ITEM(2222222), ITEM(3333333)] }));
  const r = await T.run("  Ceramic   Panther ", "48375");
  assert.equal(r.ok, true);
  assert.equal(r.kept, true);
  assert.equal(r.term, "ceramic panther");
  assert.deepEqual(r.fields, ["id (string)"]);
  assert.equal(r.mode, "50", "no mode: pickup within 50 miles");
  assert.deepEqual(T.asked, [{ mi: 50 }]);
  const k = FB.fbPickKey("ceramic panther", T.cell, 50), v = JSON.parse(T.kv.m.get(k));
  assert.equal(k, "fb3:ceramic panther|42.5,-83.5|50");
  assert.deepEqual(v.items.map((x) => x.id), ["1111111", "2222222", "3333333"], "merged by id, the old ones kept");
  assert.equal(T.kv.ttl.get(k), FB.FB_TTL);
  assert.deepEqual(JSON.parse(T.kv.m.get("fb3day:" + DAY)), { ["p|ceramic panther|" + T.cell.key + "|50"]: 1 }, "review fix: the day's sweep does not pay again for it");
  assert.deepEqual(JSON.parse(T.kv.m.get("fbownzip")), { zip: "48375", mi: 50 }, "the owner key's hunt page reads this area and distance");
});

test("a test does not undo a capped day or touch the other hunts the sweep did", async () => {
  const T = testRun({ ok: true, items: [ITEM(1111111)], units: 600, used: 600, cap: 100000 });
  await T.kv.put("fb3day:" + DAY, JSON.stringify({ "p|pyrex|42.5,-83.5|50": -1, _cap: 1 }));
  await T.run("panther", "02134");
  assert.deepEqual(JSON.parse(T.kv.m.get("fb3day:" + DAY)), { "p|pyrex|42.5,-83.5|50": -1, _cap: 1 });
  assert.equal(JSON.parse(T.kv.m.get("fbownzip")).zip, "02134", "a leading zero survives");
});

test("/fb-finds: the owner key reads the last test's ZIP first, a member only their own", () => {
  const f = indexFn("fbAreaFor");   /* v203: fbFinds and fbSearch both read the area here */
  assert.match(indexFn("fbFinds"), /const o = await fbAreaFor\(env, w, url\);/);
  assert.match(f, /let zip = w\.owner && \/\^\\d\{5\}\$\/\.test\(oz\) \? oz : "";\n  if \(!zip && w\.owner\) \{/);
  assert.match(f, /const z = await kvGet\(env, FB_OWN_ZIP, null\)/);
  assert.match(f, /if \(zip && !w\.sub && z && typeof z === "object"\) o\.mi = /, "v203 review fix: the owner key alone reads the test's distance");
  assert.match(f, /if \(!zip\) zip = o\.zip;/);
  assert.ok(f.indexOf("FB_OWN_ZIP") < f.indexOf("zip = o.zip"));
});

test("v203: a test in each mode keeps its finds in that mode's key and marks that job done", async () => {
  for (const [mode, opt, key, jk, out] of [["25", { mi: 25 }, "fb3:panther|42.5,-83.5|25", "p|panther|42.5,-83.5|25", "25"], ["100", { mi: 100 }, "fb3:panther|42.5,-83.5|100", "p|panther|42.5,-83.5|100", "100"],
    ["usa", { mi: 500 }, "fb3:panther|42.5,-83.5|500", "p|panther|42.5,-83.5|500", "usa"], ["ship", { ship: true }, "fb3s:panther", "s|panther", "ship"], ["junk", { mi: 50 }, "fb3:panther|42.5,-83.5|50", "p|panther|42.5,-83.5|50", "50"]]) {
    const T = testRun({ ok: true, items: [ITEM(1111111)], units: 600, used: 600, cap: 100000 });
    const r = await T.run("panther", "48375", mode);
    assert.deepEqual(T.asked, [opt], mode);
    assert.equal(r.mode, out, mode);
    assert.equal(JSON.parse(T.kv.m.get(key)).items[0].id, "1111111", mode);
    assert.deepEqual(JSON.parse(T.kv.m.get("fb3day:" + DAY)), { [jk]: 1 }, mode);
  }
});

test("a failed, empty or capped test keeps nothing", async () => {
  for (const res of [{ ok: false, error: "apify 500", units: 0 }, { ok: true, items: [], units: 5 }, { capped: true, used: 100000, cap: 100000 }]) {
    const T = testRun(res);
    const r = await T.run("panther", "48375");
    assert.ok(!r.kept);
    assert.equal(T.kv.m.size, 0);
  }
});

test("the admin passes the field names and the kept flag through, cleaned", async () => {
  const env = { PROWL_ALERTS: new FakeKV(), ADMIN_KEY: KEY };
  const H = { kvGet: async () => null, kvPut: async () => {}, vCount: async () => true, capsCall: async () => ({}),
    fbTestRun: async () => ({ ok: true, items: [ITEM(1111111)], raw: 1, cost: 0.0005, estimate: 0.012, used: 0.2, cap: 1, live: true,
      fields: ["id (string)", "marketplace_listing_title (string)", "<b>x</b>@\"y\""], kept: true, term: "panther" }) };
  const h = { "Content-Type": "application/json", "X-Prowl-Admin": "1", Origin: ORIGIN, Cookie: "prowl_admin=" + await signSession(KEY, Date.now() + 3600000) };
  const r = await adminFetch(new Request(ORIGIN + "/admin/api/fbtest", { method: "POST", headers: h, body: JSON.stringify({ term: "panther", zip: "48375" }) }), env, { waitUntil() {} }, H);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.kept, true);
  assert.equal(j.term, "panther");
  assert.deepEqual(j.fields, ["id (string)", "marketplace_listing_title (string)", "bxby"], "long names stay whole; anything but a name is dropped");
  assert.equal(j.items[0].image, PHOTO);
});

test("the Diagnose test box shows each photo, where the finds went and the field names", async (t) => {
  const dom = new JSDOM(adminPage("n0nce", "v202"), { url: ORIGIN + "/admin#diagnose", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (u) => {
        const p = String(u);
        const body = p === "/admin/api/fbtest" ? { ok: true, count: 1, items: [{ title: "Ceramic Panther", price: "$40", city: "Novi, MI", url: "https://www.facebook.com/marketplace/item/1111111/", image: PHOTO }],
          cost: 0.0005, estimate: 0.012, used: 0.2, cap: 1, live: true, kept: true, term: "ceramic panther", zip: "48375", fields: ["id (string)", "listing_price.amount (string)"] } : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  const term = d.getElementById("fbt-term"), zip = d.getElementById("fbt-zip");
  assert.ok(term && zip, "the test box is on Diagnose");
  term.value = "ceramic panther"; term.dispatchEvent(new w.Event("input"));
  zip.value = "48375"; zip.dispatchEvent(new w.Event("input"));
  d.querySelector("#fbtbox button").click();
  for (let i = 0; i < 50 && !d.querySelector(".fbt-img"); i++) await new Promise((r) => setTimeout(r, 20));
  const img = d.querySelector(".fbt-img");
  assert.ok(img, "a photo per listing");
  assert.equal(img.getAttribute("src"), PHOTO);
  assert.equal(img.getAttribute("referrerpolicy"), "no-referrer");
  assert.ok(!img.closest("td").classList.contains("nil"), "review fix: a photo cell is not empty, so phones show it");
  assert.match(d.body.textContent, /Kept for the hunt page \(8 days\): open the hunt “ceramic panther” in Prowl with the owner key, or signed in as a Pro member whose local-pickup ZIP is in the same area as 48375/);
  assert.match(d.body.textContent, /Fields Apify sent \(2, names only\)/);
  assert.match(d.body.textContent, /listing_price\.amount \(string\)/);
});
