/* v218: the admin's Spending tab fits per-unit prices to a bill. Matt's Meta (Muse Spark) bill for Oct 1-31 2026: cached
   request tokens $0.40, response tokens $2.23, uncached request tokens $4.10, search grounding requests $2.05, total
   $8.78. Each line over Prowl's own counts for the same days becomes Muse's price in spend:cfg (cached folded into input:
   Prowl does not count cached tokens apart); counting that begins after the bill's first day is warned about. Muse's web
   searches are billed, so their default price is empty ("fit from your Meta bill"). Owner-only, like the rest of admin.
   Run: node --test worker/__tests__/spend-fit-v218.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as SP from "../spend.js";
import { adminFetch, signSession } from "../admin.js";
import { adminPage } from "../admin-page.js";

const BILL = { input: 4.10, cached: 0.40, output: 2.23, searches: 2.05 };
const OCT = [{ day: "2026-10-30", key: "muse", n: 120, ti: 1500000, to: 250000, ws: 90 }, { day: "2026-10-31", key: "muse", n: 80, ti: 1500000, to: 250000, ws: 60 },
  { day: "2026-10-31", key: "jev", n: 50, ti: 9e6 }, { day: "2026-11-01", key: "muse", n: 999, ti: 9e9, to: 9e9, ws: 999 }];

test("spendFit: Matt's October bill over Prowl's counts; cached folded into input; a late start is warned with the first day", () => {
  const f = SP.spendFit(OCT, "muse", "2026-10-01", "2026-10-31", BILL);
  assert.deepEqual(f.counts, { n: 200, ti: 3e6, to: 5e5, ws: 150 }, "only Muse, only the bill's days");
  assert.deepEqual(f.dollars, { tin: 4.5, tout: 2.23, ws: 2.05 });
  assert.deepEqual(f.prices, { tin: 1.5, tout: 4.46, ws: 13.6667 }, "$4.50 / 3M, $2.23 / 0.5M, $2.05 / 150 searches");
  assert.equal(f.first, "2026-10-30"); assert.equal(f.last, "2026-10-31"); assert.equal(f.days, 2);
  assert.match(f.warn, /counts start on 2026-10-30, after the bill's first day \(2026-10-01\)/);
  assert.match(f.notes.join(" "), /cached line \(\$0\.40\) is folded into input/);
  const whole = SP.spendFit([{ day: "2026-10-01", key: "muse", n: 1, ti: 1e6, to: 1e6, ws: 10 }], "muse", "2026-10-01", "2026-10-31", BILL);
  assert.equal(whole.warn, "", "counted from the bill's first day: no warning");
  const noWs = SP.spendFit([{ day: "2026-10-01", key: "muse", n: 1, ti: 1e6, to: 1e6, ws: 0 }], "muse", "2026-10-01", "2026-10-31", BILL);
  assert.deepEqual(noWs.skipped, ["ws"], "dollars for searches Prowl never counted: not fitted");
  assert.equal("ws" in noWs.prices, false);
  const jev = SP.spendFit(OCT, "jev", "2026-10-01", "2026-10-31", { input: 0.36, searches: 1 });
  assert.deepEqual(jev.prices, { tin: 0.04 });
  assert.match(jev.notes.join(" "), /Searches .* left out/);
  assert.match(SP.spendFit([], "muse", "2026-10-01", "2026-10-31", BILL).warn, /counted nothing/);
  assert.deepEqual(SP.SPEND_FIT_KEYS, ["muse", "jev"]);
  for (const [k, from, to, b, re] of [["g_text", "2026-10-01", "2026-10-31", BILL, /no token or search prices/], ["muse", "2026-10-31", "2026-10-01", BILL, /first and last day/],
    ["muse", "2026-10-01", "nope", BILL, /first and last day/], ["muse", "2026-10-01", "2026-10-31", {}, /at least one dollar line/],
    ["muse", "2026-10-01", "2026-10-31", { input: -1 }, /Input .*0 or more/], ["muse", "2024-01-01", "2026-10-31", BILL, /At most 400 days/]])
    assert.match(SP.spendFit(OCT, k, from, to, b).error || "", re, k + " " + from + " " + to);
});

/* ---------- the admin route ---------- */
const KEY = "test-admin-key-0123456789", ORIGIN = "https://prowl.example.workers.dev";
class FakeKV { constructor() { this.m = new Map(); } async get(k, t) { if (!this.m.has(k)) return null; const v = this.m.get(k); return t === "json" ? JSON.parse(v) : v; } async put(k, v) { this.m.set(k, String(v)); } }
function admin(rows) {
  const kv = new FakeKV(), audits = [], calls = [], env = { PROWL_ALERTS: kv, ADMIN_KEY: KEY };
  const H = { kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; }, kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)), vCount: async () => true,
    capsCall: async (n, op, body) => { calls.push([n, op, body]); if (op === "sget") { if (rows === "down") throw new Error("caps 500"); return { rows: (rows || []).filter((r) => r.day >= body.from && r.day <= body.to) }; } audits.push(...(body && body.a || [])); return {}; } };
  const call = async (method, path, body, headers = {}) => {
    const h = { Cookie: "prowl_admin=" + await signSession(KEY, Date.now() + 3600000) };
    if (body !== undefined) Object.assign(h, { "Content-Type": "application/json", "X-Prowl-Admin": "1", Origin: ORIGIN });
    Object.assign(h, headers);
    const pending = [];
    const r = await adminFetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => pending.push(p) }, H);
    await Promise.all(pending);
    return { status: r.status, j: await r.json() };
  };
  return { kv, env, call, audits, calls };
}

test("review fix: an impossible date is refused before the 400-day span check (NaN skipped it)", () => {
  for (const [from, to] of [["2024-99-99", "2026-10-31"], ["2026-10-00", "2026-10-31"], ["2025-01-01", "2026-13-01"], ["2026-02-30", "2026-03-01"], ["2026-10-01", "2026-10-32"]]) {
    const f = SP.spendFit(OCT, "muse", from, to, BILL);
    assert.equal(f.error, "Pick the bill's first and last day.", from + " to " + to);
  }
  assert.equal(SP.spendFit(OCT, "muse", "2024-02-29", "2024-03-01", BILL).error, undefined, "a real leap day is fine");
});

test("POST /admin/api/spend/fit saves the fitted prices to spend:cfg, keeps the rest, says what it counted; audited", async () => {
  const A = admin(OCT);
  await A.kv.put("spend:cfg", JSON.stringify({ prices: { g_text: { call: 35 }, muse: { ws: 0 } }, fixed: [{ name: "Shopify plan", perMonth: 39 }] }));
  const r = await A.call("POST", "/admin/api/spend/fit", { key: "muse", from: "2026-10-01", to: "2026-10-31", bill: BILL });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(A.calls.find((c) => c[1] === "sget"), ["spend", "sget", { from: "2026-10-01", to: "2026-10-31" }], "the bill's own days");
  const saved = JSON.parse(A.kv.m.get("spend:cfg"));
  assert.deepEqual(saved.prices.muse, { tin: 1.5, tout: 4.46, ws: 13.6667 }, "the old ws 0 is replaced");
  assert.equal(saved.prices.g_text.call, 35, "other prices kept");
  assert.deepEqual(saved.fixed, [{ name: "Shopify plan", perMonth: 39 }], "the monthly bills kept");
  assert.match(r.j.message, /^Fitted Muse \(Meta Muse Spark\) to the bill for 2026-10-01 to 2026-10-31 and saved: \$1\.5 per 1M input tokens, \$4\.46 per 1M output tokens, \$13\.6667 per 1,000 searches\./);
  assert.match(r.j.message, /counts start on 2026-10-30/);
  assert.equal(r.j.fit.first, "2026-10-30");
  assert.deepEqual(r.j.fit.counts, { n: 200, ti: 3e6, to: 5e5, ws: 150 });
  assert.deepEqual(r.j.cfg.prices.muse, saved.prices.muse, "the answer is the redrawn tab");
  assert.deepEqual(r.j.fitKeys, ["muse", "jev"]);
  assert.deepEqual(A.audits.map((a) => [a.action, a.ok]), [["spend-fit", true]]);
  assert.doesNotMatch(JSON.stringify(r.j), /@/, "nothing personal");
});

test("spend/fit: nothing counted saves nothing; bad input is 400; counts down is 503; signed in and from the admin page only", async () => {
  let A = admin([]);
  let r = await A.call("POST", "/admin/api/spend/fit", { key: "muse", from: "2026-10-01", to: "2026-10-31", bill: BILL });
  assert.equal(r.status, 200); assert.match(r.j.message, /counted nothing.*Prices not changed/);
  assert.equal(A.kv.m.get("spend:cfg"), undefined, "nothing saved");
  assert.equal(A.audits.length, 0);
  const reads = A.calls.filter((c) => c[1] === "sget").length;
  r = await A.call("POST", "/admin/api/spend/fit", { key: "muse", from: "2026-10-31", to: "2026-10-01", bill: BILL });
  assert.equal(r.status, 400);
  r = await A.call("POST", "/admin/api/spend/fit", { key: "lens", from: "2026-10-01", to: "2026-10-31", bill: BILL });
  assert.equal(r.status, 400);
  assert.equal(A.calls.filter((c) => c[1] === "sget").length, reads, "a refused ask reads no counts");
  A = admin("down");
  r = await A.call("POST", "/admin/api/spend/fit", { key: "muse", from: "2026-10-01", to: "2026-10-31", bill: BILL });
  assert.equal(r.status, 503); assert.equal(A.kv.m.get("spend:cfg"), undefined);
  r = await A.call("POST", "/admin/api/spend/fit", { key: "muse" }, { "X-Prowl-Admin": "0" });
  assert.equal(r.status, 403);
  const out = await adminFetch(new Request(ORIGIN + "/admin/api/spend/fit", { method: "POST", headers: { "Content-Type": "application/json", "X-Prowl-Admin": "1", Origin: ORIGIN }, body: "{}" }), A.env, {}, {});
  assert.equal(out.status, 401, "no admin session, no fit");
});

/* ---------- the form ---------- */
const NOW = Date.UTC(2026, 10, 1, 15);
function answer(cfgIn, rows, extra) {
  const cfg = SP.spendCfgClean(cfgIn || {}).cfg;
  return Object.assign(SP.spendSummary(rows || [], cfg, NOW), { ok: true, cfg, fixedMax: SP.SPEND_FIXED_MAX, fitKeys: SP.SPEND_FIT_KEYS,
    fitLines: SP.SPEND_FIT_LINES.map((l) => ({ line: l[0], f: l[1], label: l[2] })),
    meta: SP.SPEND_SERVICES.map((s) => ({ key: s.key, name: s.name, uses: s.uses, list: s.price, free: s.free || 0, src: s.src, srcNote: s.srcNote, bill: s.bill })) }, extra || {});
}
test("the Fit prices to a bill form: last month by default, Muse first, sends the bill's lines, shows the counts and the warning", async (t) => {
  const sent = [];
  const dom = new JSDOM(adminPage("n0nce", "v218"), { url: "https://prowl.example.workers.dev/admin#spending", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path, o) => {
        const p = String(path), body = o && o.body ? JSON.parse(o.body) : undefined;
        sent.push([p, body]);
        let j = {};
        if (p === "/admin/api/spend") j = answer({}, []);
        if (p === "/admin/api/spend/fit") { const fit = SP.spendFit(OCT, body.key, body.from, body.to, body.bill); j = answer({ prices: { muse: fit.prices } }, [], { fit, message: "Fitted Muse and saved. " + fit.warn }); }
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      w.confirm = () => true;
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  for (let i = 0; i < 50 && !d.querySelector("#spfit"); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(d.querySelector("#spfit"), "the form is on the Spending tab");
  assert.equal(d.querySelector("#spfit-key").value, "muse");
  assert.deepEqual([d.querySelector("#spfit-from").value, d.querySelector("#spfit-to").value], ["2026-10-01", "2026-10-31"], "the bill's month: last month");
  assert.deepEqual([...d.querySelectorAll("#spfit label")].map((l) => l.textContent).slice(3),
    ["Input (uncached request tokens)", "Cached input (cached request tokens)", "Output (response tokens)", "Searches (search grounding requests)"]);
  assert.match(d.querySelector("#sp-muse-ws-hint").textContent, /List price not published.*billed.*fit from your Meta bill/, "the search price asks for the bill");
  assert.equal(d.querySelector("#sp-muse-ws").placeholder, "price from your bill");
  d.querySelector("#spfit-input").value = "4.10"; d.querySelector("#spfit-cached").value = "0.40"; d.querySelector("#spfit-output").value = "2.23"; d.querySelector("#spfit-searches").value = "2.05";
  d.querySelector("#spfit").dispatchEvent(new w.Event("submit", { cancelable: true, bubbles: true }));
  for (let i = 0; i < 50 && !d.querySelector("#spfit-res"); i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(sent.find((s) => s[0] === "/admin/api/spend/fit")[1], { key: "muse", from: "2026-10-01", to: "2026-10-31", bill: { input: 4.1, cached: 0.4, output: 2.23, searches: 2.05 } });
  const res = d.querySelector("#spfit-res").textContent;
  assert.match(res, /200 calls, 3M input \/ 500k output tokens, 150 web searches, on 2 days \(first counted day 2026-10-30, last 2026-10-31\)/);
  assert.match(res, /Fitted: \$1\.5 per 1M input tokens, \$4\.46 per 1M output tokens, \$13\.6667 per 1,000 searches/);
  assert.match(res, /folded into input/);
  assert.match(res, /counts start on 2026-10-30, after the bill's first day/);
  assert.equal(d.querySelector("#sp-muse-ws").value, "13.6667", "the prices form shows the saved fit");
  /* Jev has input only: the other lines are hidden and not sent */
  const sel = d.querySelector("#spfit-key"); sel.value = "jev"; sel.dispatchEvent(new w.Event("change"));
  assert.equal(d.querySelector("#spfit-searches").disabled, true);
  assert.equal(d.querySelector("#spfit-input").disabled, false);
});
