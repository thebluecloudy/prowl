/* v193: the admin's Spending tab, run in jsdom against stubbed /admin/api answers: the table per service and period,
   the monthly bills and totals, the prices form (list prices as placeholders, sources linked) and what Save sends.
   Run: node --test worker/__tests__/spend-ui.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { adminPage } from "../admin-page.js";
import * as SP from "../spend.js";

const NOW = Date.now();
function spendAnswer(cfgIn, rows) {
  const cfg = SP.spendCfgClean(cfgIn || {}).cfg;
  return Object.assign(SP.spendSummary(rows || [], cfg, NOW), { ok: true, cfg, fixedMax: SP.SPEND_FIXED_MAX,
    meta: SP.SPEND_SERVICES.map((s) => ({ key: s.key, name: s.name, uses: s.uses, list: s.price, free: s.free || 0, src: s.src, srcNote: s.srcNote, bill: s.bill })) });
}
async function boot(t, answer) {
  const sent = [];
  const dom = new JSDOM(adminPage("n0nce", "v193"), { url: "https://prowl.example.workers.dev/admin#spending", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path, o) => {
        const p = String(path), body = o && o.body ? JSON.parse(o.body) : undefined;
        sent.push([p, body]);
        const j = p === "/admin/api/spend" ? answer : p === "/admin/api/spend/cfg" ? Object.assign(spendAnswer(body), { message: "Saved. The estimate uses these prices now." }) : {};
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });   /* jsdom has no Response */
      };
      w.confirm = () => true;
    } });
  const w = dom.window;
  t.after(() => w.close());   /* closed even when an assertion fails, so the run never hangs */
  for (let i = 0; i < 50 && !w.document.querySelector("#spbox table"); i++) await new Promise((r) => setTimeout(r, 10));
  return { w, d: w.document, sent };
}

test("the Spending tab shows each service by period, the monthly bills, and a total", async (t) => {
  const today = SP.dayOf(NOW);
  const A = await boot(t, spendAnswer({ fixed: [{ name: "Shopify plan", perMonth: 39 }] },
    [{ day: today, key: "g_text", n: 100 }, { day: today, key: "muse", n: 3, ti: 120000, to: 40000, ws: 2 }, { day: today, key: "lens", n: 4 }]));
  const { d } = A;
  assert.equal(d.querySelector("#v-spending").hidden, false, "#spending opens the tab");
  assert.equal(d.querySelector("#t-spending").getAttribute("aria-selected"), "true");
  const rows = [...d.querySelectorAll("#spbox tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, " ").trim()));
  assert.equal(rows.length, SP.SPEND_SERVICES.length + 1 + 1, "every service, the bill, the total");
  const text = rows.find((r) => /Text Search/.test(r[0]));
  assert.match(text[1], /^\$4\.00.*100 calls/);
  const muse = rows.find((r) => /^Muse/.test(r[0]));
  assert.match(muse[1], /3 calls, 120k in \/ 40k out tokens, 2 web searches/);
  assert.match(rows.find((r) => /SerpApi/.test(r[0]))[1], /no price.*4 calls/, "used without a price says so");
  assert.deepEqual(rows.find((r) => /Shopify plan/.test(r[0])).slice(3), ["$39.00", "$39.00"]);
  assert.equal(rows.at(-1)[0], "Total");
  assert.match(d.querySelector("#spbox .ukpi").textContent, /so far this month \(1 service used without a price\)/);
});

test("the prices form: list prices as placeholders with their sources; Save sends prices and bills", async (t) => {
  const A = await boot(t, spendAnswer({ prices: { g_text: { call: 35 } } }, []));
  const { d, sent } = A;
  const gt = d.querySelector("#sp-g_text-call");
  assert.equal(gt.value, "35");
  assert.equal(gt.placeholder, "40");
  assert.equal(d.querySelector("#sp-lens-call").placeholder, "price from your bill");
  assert.match(d.querySelector("#sp-g_text-call-hint").textContent, /SKU 120C-BEC3-B48F.*First 1,000 a month free/);
  const links = [...d.querySelectorAll("#spbox .spp a")];
  assert.ok(links.length >= SP.SPEND_SERVICES.length * 2);
  for (const a of links) { assert.match(a.href, /^https:\/\//); assert.equal(a.target, "_blank"); assert.match(a.rel, /noopener/); }
  d.querySelector("#sp-g_nearby-call").value = "41";
  d.querySelector("#sp-muse-ws").value = "";
  [...d.querySelectorAll("#spbox button")].find((b) => b.textContent === "Add a monthly bill").click();
  const row = d.querySelector("#spbox .fxrow"), ins = row.querySelectorAll("input");
  ins[0].value = "Cloudflare Workers"; ins[1].value = "5";
  d.querySelector("#spbox form").dispatchEvent(new A.w.Event("submit", { cancelable: true, bubbles: true }));
  for (let i = 0; i < 50 && !sent.some((s) => s[0] === "/admin/api/spend/cfg"); i++) await new Promise((r) => setTimeout(r, 10));
  const body = sent.find((s) => s[0] === "/admin/api/spend/cfg")[1];
  assert.equal(body.prices.g_nearby.call, 41);
  assert.equal(body.prices.g_text.call, 35);
  assert.equal(body.prices.muse.ws, null, "empty sends none");
  assert.deepEqual(body.fixed, [{ name: "Cloudflare Workers", perMonth: 5 }]);
  for (let i = 0; i < 50 && !/Saved/.test(d.querySelector("#sp-msg").textContent); i++) await new Promise((r) => setTimeout(r, 10));
  assert.match(d.querySelector("#sp-msg").textContent, /Saved/);
  assert.equal(d.querySelectorAll("#spbox .fxrow").length, 1, "redrawn with the saved bill");
});

test("monthly bills stop at the most allowed; Remove takes a row out", async (t) => {
  const A = await boot(t, spendAnswer({ fixed: Array.from({ length: SP.SPEND_FIXED_MAX }, (_, i) => ({ name: "Bill " + i, perMonth: 1 })) }, []));
  const { d } = A;
  const add = [...d.querySelectorAll("#spbox button")].find((b) => b.textContent === "Add a monthly bill");
  assert.equal(add.disabled, true);
  [...d.querySelectorAll("#spbox .fxrow button")][0].click();
  assert.equal(d.querySelectorAll("#spbox .fxrow").length, SP.SPEND_FIXED_MAX - 1);
  assert.equal(add.disabled, false);
});
