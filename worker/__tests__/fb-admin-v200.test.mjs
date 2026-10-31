/* v200 review fix: the admin's Facebook test sits on the Diagnose tab, built once, so the Overview's minute-by-minute
   redraw can never leave a running test's answer in a box that is no longer on the page. jsdom against stubbed
   /admin/api answers. Run: node --test worker/__tests__/fb-admin-v200.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { adminPage } from "../admin-page.js";

test("the Facebook test is on Diagnose, not in the Overview's Marketplaces card, and its answer lands in the box on the page", async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; }), sent = [];
  const dom = new JSDOM(adminPage("n0nce", "v200"), { url: "https://prowl.example.workers.dev/admin#diagnose", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path, o) => {
        const p = String(path), body = o && o.body ? JSON.parse(o.body) : undefined;
        sent.push([p, body]);
        if (p === "/admin/api/fbtest") await gate;
        const j = p === "/admin/api/fbtest" ? { ok: true, count: 1, items: [{ title: "Pyrex bowl", price: "$25", city: "Novi, MI", url: "https://www.facebook.com/marketplace/item/1234567/" }], cost: 0.00055, estimate: 0.01205, used: 0.01205, cap: 1, live: false } : {};
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  const wait = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f()); };
  assert.ok(d.querySelector("#v-diagnose #fbtbox #fbt-term"), "in the Diagnose panel");
  assert.equal(d.querySelectorAll("#fbt-term").length, 1);
  assert.equal(d.querySelector("#v-overview #fbt-term"), null, "not in the Overview, which redraws every minute");
  const term = d.querySelector("#fbt-term"), zip = d.querySelector("#fbt-zip"), btn = d.querySelector("#fbtbox button");
  term.value = "pyrex"; term.dispatchEvent(new w.Event("input"));
  zip.value = "48375"; zip.dispatchEvent(new w.Event("input"));
  btn.click();
  await wait(() => sent.some(([p]) => p === "/admin/api/fbtest"));
  assert.deepEqual(sent.find(([p]) => p === "/admin/api/fbtest")[1], { term: "pyrex", zip: "48375" });
  assert.equal(btn.disabled, true);
  assert.match(d.querySelector("#fbtbox").textContent, /Asking Apify/);
  w.location.hash = "#overview"; w.dispatchEvent(new w.HashChangeEvent("hashchange"));
  await new Promise((r) => setTimeout(r, 30));
  release();
  await wait(() => /1 listing at/.test(d.querySelector("#fbtbox").textContent));
  assert.ok(d.querySelector("#fbtbox").contains(btn), "the same button, still on the page");
  assert.equal(btn.disabled, false);
  assert.equal(d.querySelector("#fbtbox a").getAttribute("href"), "https://www.facebook.com/marketplace/item/1234567/");
});
