/* v89: affiliate switches. The owner turns each program on or off in the admin area (Affiliates); KV aff:on keeps it,
   AFF_PROGRAMS has the defaults (eBay on, Depop off since Rakuten declined), and every link builder follows it.
   Run: node --test worker/__tests__/aff-switches.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminFetch, signSession } from "../admin.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const RAN = "https://click.linksynergy.com/deeplink?id=jh1j/r7*wkQ&mid=53555&murl=";
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const lineOf = (re) => { const m = re.exec(INDEX); assert.ok(m, String(re)); return m[0]; };
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const kvGet = async (env, k, d) => { try { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; } catch (e) { return d; } };
const kvPut = async (env, k, v) => env.PROWL_ALERTS.put(k, JSON.stringify(v));
function lift() {
  const src = [lineOf(/^const DEPOP_URL = [^\n]*;/m), lineOf(/^const DEPOP_AFF = [^\n]*;/m), lineOf(/^const AFF_PROGRAMS = \[[\s\S]*?\n\];/m),
    lineOf(/^const AFF_KEY = [^\n]*;/m), indexFn("affClean"), lineOf(/^let AFF_ON = [^\n]*;/m),
    ...["affLoad", "affNote", "depopAff", "epnUrl"].map(indexFn), "const AL_ALSO = " + /const AL_ALSO = (\[[\s\S]*?\n\]);/.exec(INDEX)[1] + ";"].join("\n");
  return new Function("kvGet", src + "\nreturn { AFF_PROGRAMS, AFF_KEY, affClean, affLoad, affNote, depopAff, epnUrl, AL_ALSO, on: () => AFF_ON };")(kvGet);
}
const EPN = { EPN_CAMPAIGN_ID: "5339216838" };

test("defaults: eBay on, Depop off; a stored choice wins, junk is ignored", async () => {
  const X = lift();
  assert.deepEqual(X.affClean(null), { ebay: true, depop: false });
  assert.deepEqual(X.affClean({ depop: true }), { ebay: true, depop: true });
  assert.deepEqual(X.affClean({ ebay: "no", depop: 1, etsy: true }), { ebay: true, depop: false }, "only booleans for known programs");
  assert.deepEqual(X.AFF_PROGRAMS.map((p) => [p.id, p.def]), [["ebay", true], ["depop", false]]);
  const kv = new FakeKV();
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }, true), { ebay: true, depop: false }, "nothing stored: defaults");
  await kv.put("aff:on", JSON.stringify({ ebay: false, depop: true }));
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }), { ebay: true, depop: false }, "read at most once a minute");
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }, true), { ebay: false, depop: true });
});

test("Depop off: plain links everywhere, the email footer names only eBay", async () => {
  const X = lift();
  await X.affLoad({ PROWL_ALERTS: new FakeKV() }, true);
  const u = "https://www.depop.com/search/?q=ceramic%20panther";
  assert.equal(X.depopAff(u), u);
  assert.equal(X.AL_ALSO.find((a) => a[0] === "Depop")[1]("hull pottery"), "https://www.depop.com/search/?q=hull%20pottery");
  assert.ok(X.AL_ALSO.every((a) => a[1]("x").indexOf("linksynergy") === -1));
  assert.equal(X.affNote(), "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.");
  assert.match(X.epnUrl(EPN, "https://www.ebay.com/itm/1", "prowl-alerts"), /campid=5339216838/);
});

test("Depop on: the Rakuten deep link comes back exactly, only on depop.com", async () => {
  const X = lift(), kv = new FakeKV();
  await kv.put("aff:on", JSON.stringify({ depop: true }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  const u = "https://www.depop.com/search/?q=ceramic%20panther";
  assert.equal(X.depopAff(u), RAN + encodeURIComponent(u));
  assert.equal(X.depopAff("https://depop.com/products/x/"), RAN + encodeURIComponent("https://depop.com/products/x/"));
  for (const v of ["https://www.etsy.com/listing/1", "https://depop.com.evil.example/x", "http://www.depop.com/x", ""]) assert.equal(X.depopAff(v), v);
  assert.equal(X.AL_ALSO.find((a) => a[0] === "Depop")[1]("hull pottery"), RAN + encodeURIComponent("https://www.depop.com/search/?q=hull%20pottery"));
  assert.equal(X.affNote(), "Some links (eBay, Depop) earn Owl & Twig a small commission, at no cost to you.");
});

test("eBay off: no campaign on eBay links; both off: no commission line at all", async () => {
  const X = lift(), kv = new FakeKV();
  await kv.put("aff:on", JSON.stringify({ ebay: false }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.equal(X.epnUrl(EPN, "https://www.ebay.com/itm/1", "prowl-alerts"), "https://www.ebay.com/itm/1");
  assert.equal(X.affNote(), "");
});

test("wired in: every request and cron run loads the switches; /aff answers them; footers use affNote", () => {
  assert.match(INDEX, /async function handleFetch\(request, env, ctx\) \{\n    G_ENV = env;\n    try \{ await affLoad\(env\); \} catch \(e\) \{\}/);
  assert.match(INDEX, /async scheduled\(event, env, ctx\) \{\n    G_ENV = env;\n    try \{ await affLoad\(env\); \} catch \(e\) \{\}/);
  assert.match(INDEX, /if \(url\.pathname === "\/aff" && request\.method === "GET"\) return json\(\{ on: AFF_ON \}, 200, origin, \{ "Cache-Control": "public, max-age=300" \}\);/);
  assert.match(INDEX, /\(affNote\(\) \? alEsc\(affNote\(\)\) \+ '<br>' : ''\)/);
  assert.match(INDEX, /sub \? affNote\(\) : ""/);
  assert.doesNotMatch(INDEX, /AL_AFF_NOTE/);
  assert.match(INDEX, /if \(camp && AFF_ON\.ebay === true\) h\["X-EBAY-C-ENDUSERCTX"\]/);
  assert.match(INDEX, /affLoad, AFF_PROGRAMS, AFF_KEY,/, "the admin area gets the switches");
  const v = /const WORKER_VERSION = "v(\d+)[a-z]?";/.exec(INDEX);
  assert.ok(v && Number(v[1]) >= 89);
});

/* ---------- the admin area's Affiliates switches ---------- */
const KEY = "test-admin-key-0123456789", ORIGIN = "https://prowl.example.workers.dev";
function admin() {
  const X = lift(), kv = new FakeKV(), audits = [];
  const env = { PROWL_ALERTS: kv, ADMIN_KEY: KEY };
  const H = { kvGet, kvPut, affLoad: X.affLoad, AFF_PROGRAMS: X.AFF_PROGRAMS, AFF_KEY: X.AFF_KEY, vCount: async () => true,
    capsCall: async (n, op, body) => { audits.push(...(body && body.a || [])); return {}; } };
  const call = async (method, path, body, headers = {}) => {
    const h = { Cookie: "prowl_admin=" + await signSession(KEY, Date.now() + 3600000) };
    if (body !== undefined) Object.assign(h, { "Content-Type": "application/json", "X-Prowl-Admin": "1", Origin: ORIGIN });
    Object.assign(h, headers);
    const pending = [];
    const res = await adminFetch(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil: (p) => pending.push(p) }, H);
    await Promise.all(pending);
    return { status: res.status, j: await res.json() };
  };
  return { X, kv, env, call, audits };
}

test("admin: Affiliates lists each program with its state, and a switch turns it on or off", async () => {
  const A = admin();
  let r = await A.call("GET", "/admin/api/affiliates");
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.programs.map((p) => [p.id, p.name, p.on]), [["ebay", "eBay", true], ["depop", "Depop", false]]);
  assert.match(r.j.programs[1].net, /Rakuten/);
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop", on: true });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true);
  assert.match(r.j.message, /^Depop links are tagged again/);
  assert.deepEqual(A.kv.json("aff:on"), { depop: true });
  assert.equal(r.j.programs.find((p) => p.id === "depop").on, true);
  assert.equal(A.X.depopAff("https://www.depop.com/x"), RAN + encodeURIComponent("https://www.depop.com/x"), "this isolate follows at once");
  r = await A.call("POST", "/admin/api/affiliate", { id: "ebay", on: false });
  assert.deepEqual(A.kv.json("aff:on"), { depop: true, ebay: false }, "the other switch is kept");
  assert.match(r.j.message, /^eBay links are plain now/);
  assert.deepEqual(A.audits.map((a) => [a.action, a.id]), [["aff-on", "depop"], ["aff-off", "ebay"]]);
});

test("admin: unknown programs, non-boolean values and requests from elsewhere change nothing", async () => {
  const A = admin();
  let r = await A.call("POST", "/admin/api/affiliate", { id: "etsy", on: true });
  assert.equal(r.status, 400);
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop", on: "yes" });
  assert.equal(r.status, 400);
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop", on: true }, { "X-Prowl-Admin": "0" });
  assert.equal(r.status, 403);
  assert.equal(A.kv.json("aff:on"), null);
  const out = await adminFetch(new Request(ORIGIN + "/admin/api/affiliates"), A.env, {}, {});
  assert.equal(out.status, 401, "signed out");
});
