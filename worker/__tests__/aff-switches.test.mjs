/* v89: affiliate switches. The owner turns each program on or off in the admin area (Affiliates); KV aff:on keeps it,
   AFF_PROGRAMS has the defaults (eBay on, Depop off since Rakuten declined), and every link builder follows it.
   v90: each program's IDs too (KV aff:ids), checked against their formats; a program is on only with complete IDs.
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
  const src = [lineOf(/^const DEPOP_URL = [^\n]*;/m), lineOf(/^const DEPOP_AFF_T = [^\n]*;/m), lineOf(/^const AFF_RE = [^\n]*;/m),
    lineOf(/^const AFF_PROGRAMS = \[[\s\S]*?\n\];/m), lineOf(/^const AFF_KEY = [^\n]*;/m), lineOf(/^const affObj = [^\n]*;/m),
    ...["affIdsClean", "affReady", "affClean"].map(indexFn), lineOf(/^let AFF_IDS = [^\n]*;/m),
    ...["affId", "affLoad", "affNote", "depopAff", "epnUrl"].map(indexFn), "const AL_ALSO = " + /const AL_ALSO = (\[[\s\S]*?\n\]);/.exec(INDEX)[1] + ";"].join("\n");
  return new Function("kvGet", src + "\nreturn { AFF_PROGRAMS, AFF_KEY, AFF_IDS_KEY, affClean, affIdsClean, affReady, affLoad, affNote, depopAff, epnUrl, AL_ALSO, on: () => AFF_ON, ids: () => AFF_IDS };")(kvGet);
}
const EPN = { EPN_CAMPAIGN_ID: "5339216838" };

const OFF = { etsy: false, reverb: false, "1stdibs": false, amazon: false };
test("defaults: eBay on, Depop off, the new programs off with no IDs; a stored choice wins, junk is ignored", async () => {
  const X = lift(), ids = X.affIdsClean(null, null);
  assert.deepEqual(ids, { ebay: { camp: "5339216838" }, depop: { pub: "jh1j/r7*wkQ" }, etsy: { mid: "", aff: "" }, reverb: { mid: "", aff: "" }, "1stdibs": { camref: "" }, amazon: { tag: "" } });
  assert.deepEqual(X.affClean(null, ids), { ebay: true, depop: false, ...OFF });
  assert.deepEqual(X.affClean({ depop: true }, ids), { ebay: true, depop: true, ...OFF });
  assert.deepEqual(X.affClean({ ebay: "no", depop: 1, etsy: true }, ids), { ebay: true, depop: false, ...OFF }, "only booleans; Etsy needs its IDs");
  assert.deepEqual(X.AFF_PROGRAMS.map((p) => [p.id, p.def]), [["ebay", true], ["depop", false], ["etsy", false], ["reverb", false], ["1stdibs", false], ["amazon", false]]);
  const kv = new FakeKV();
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }, true), { ebay: true, depop: false, ...OFF }, "nothing stored: defaults");
  await kv.put("aff:on", JSON.stringify({ ebay: false, depop: true }));
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }), { ebay: true, depop: false, ...OFF }, "read at most once a minute");
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }, true), { ebay: false, depop: true, ...OFF });
});

test("v90 IDs: stored values over the defaults, off-format values dropped, eBay falls back to EPN_CAMPAIGN_ID", () => {
  const X = lift();
  const ids = X.affIdsClean({ etsy: { mid: " 6220 ", aff: "1234567" }, amazon: { tag: "owltwig-20" }, depop: { pub: "bad id&x=1" }, "1stdibs": { camref: "1l3vabc" }, junk: { a: 1 } }, null);
  assert.deepEqual(ids.etsy, { mid: "6220", aff: "1234567" });
  assert.equal(ids.amazon.tag, "owltwig-20");
  assert.equal(ids.depop.pub, "", "a stored value in the wrong form is dropped, not replaced by the default");
  assert.equal(ids["1stdibs"].camref, "1l3vabc");
  assert.equal("junk" in ids, false);
  assert.equal(X.affIdsClean(null, { EPN_CAMPAIGN_ID: "1111111111" }).ebay.camp, "1111111111");
  assert.equal(X.affIdsClean({ ebay: { camp: "2222222222" } }, { EPN_CAMPAIGN_ID: "1111111111" }).ebay.camp, "2222222222", "the admin's value wins");
  assert.equal(X.affIdsClean(null, { EPN_CAMPAIGN_ID: "nope" }).ebay.camp, "5339216838");
  for (const [p, f, bad] of [["ebay", "camp", "123"], ["etsy", "mid", "12a"], ["etsy", "aff", "1"], ["1stdibs", "camref", "a/b"], ["amazon", "tag", "owltwig"], ["amazon", "tag", "x\"><script>-20"], ["depop", "pub", "a?b=c&d"]]) {
    assert.equal(X.affIdsClean({ [p]: { [f]: bad } }, null)[p][f], "", p + "." + f + " " + bad);
  }
});

test("v90: the Depop and eBay links use the stored IDs", async () => {
  const X = lift(), kv = new FakeKV();
  await kv.put("aff:on", JSON.stringify({ depop: true }));
  await kv.put("aff:ids", JSON.stringify({ depop: { pub: "Abc123/x*Y" }, ebay: { camp: "2222222222" } }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.equal(X.depopAff("https://www.depop.com/x"), "https://click.linksynergy.com/deeplink?id=Abc123/x*Y&mid=53555&murl=" + encodeURIComponent("https://www.depop.com/x"));
  assert.match(X.epnUrl(EPN, "https://www.ebay.com/itm/1", "prowl-alerts"), /campid=2222222222/, "the admin's ID, not the variable");
  await kv.put("aff:ids", JSON.stringify({ depop: { pub: "" } }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.equal(X.on().depop, false, "switched on but no ID: off");
  await kv.put("aff:on", JSON.stringify({ amazon: true, etsy: true }));
  await kv.put("aff:ids", JSON.stringify({ amazon: { tag: "owltwig-20" }, etsy: { mid: "6220", aff: "1234567" } }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.equal(X.on().amazon, true);
  assert.equal(X.affNote(), "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.", "emails tag no Amazon or Etsy links, so the footer does not name them");
  assert.equal(X.depopAff("https://www.depop.com/x"), "https://www.depop.com/x");
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
  assert.match(INDEX, /if \(url\.pathname === "\/aff" && request\.method === "GET"\) return json\(\{ on: AFF_ON, ids: AFF_IDS \}, 200, origin, \{ "Cache-Control": "public, max-age=300" \}\);/);
  assert.match(INDEX, /\(affNote\(\) \? alEsc\(affNote\(\)\) \+ '<br>' : ''\)/);
  assert.match(INDEX, /sub \? affNote\(\) : ""/);
  assert.doesNotMatch(INDEX, /AL_AFF_NOTE/);
  assert.match(INDEX, /const camp = affId\("ebay", "camp"\);[^\n]*\n[^\n]*\n    if \(camp && AFF_ON\.ebay === true\) h\["X-EBAY-C-ENDUSERCTX"\]/);
  assert.match(INDEX, /affLoad, AFF_PROGRAMS, AFF_KEY, AFF_IDS_KEY, affIdsClean, affReady,/, "the admin area gets the switches and IDs");
  const v = /const WORKER_VERSION = "v(\d+)[a-z]?";/.exec(INDEX);
  assert.ok(v && Number(v[1]) >= 90);
});

/* ---------- the admin area's Affiliates switches ---------- */
const KEY = "test-admin-key-0123456789", ORIGIN = "https://prowl.example.workers.dev";
function admin() {
  const X = lift(), kv = new FakeKV(), audits = [];
  const env = { PROWL_ALERTS: kv, ADMIN_KEY: KEY };
  const H = { kvGet, kvPut, affLoad: X.affLoad, AFF_PROGRAMS: X.AFF_PROGRAMS, AFF_KEY: X.AFF_KEY, AFF_IDS_KEY: X.AFF_IDS_KEY, affIdsClean: X.affIdsClean, affReady: X.affReady, vCount: async () => true,
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
  assert.deepEqual(r.j.programs.map((p) => [p.id, p.name, p.on, p.ready]), [["ebay", "eBay", true, true], ["depop", "Depop", false, true], ["etsy", "Etsy", false, false],
    ["reverb", "Reverb", false, false], ["1stdibs", "1stDibs", false, false], ["amazon", "Amazon", false, false]]);
  assert.deepEqual(r.j.programs[0].fields, [{ k: "camp", label: "Campaign ID", hint: "10 digits", value: "5339216838" }]);
  assert.match(r.j.programs[1].net, /Rakuten/);
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop", on: true });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true);
  assert.match(r.j.message, /^Depop links are tagged now/);
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

test("admin v90: Save IDs checks each format, saves, and only then can Turn on work", async () => {
  const A = admin();
  let r = await A.call("POST", "/admin/api/affiliate", { id: "amazon", on: true });
  assert.equal(r.status, 400); assert.match(r.j.error, /Fill in and save Amazon's IDs first/);
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "amazon", values: { tag: "owltwig" } });
  assert.equal(r.status, 400); assert.match(r.j.error, /^Tracking ID is not in the right form \(ends in -20, like owltwig-20\)\. Nothing was saved\./);
  assert.equal(A.kv.json("aff:ids"), null);
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "amazon", values: { tag: " owltwig-20 ", extra: "x" } });
  assert.equal(r.status, 200); assert.match(r.j.message, /^Amazon IDs saved\. Press Turn on when you want Amazon links tagged\./);
  assert.deepEqual(A.kv.json("aff:ids"), { amazon: { tag: "owltwig-20" } }, "trimmed; unknown fields dropped");
  const am = r.j.programs.find((p) => p.id === "amazon");
  assert.equal(am.ready, true); assert.equal(am.fields[0].value, "owltwig-20");
  r = await A.call("POST", "/admin/api/affiliate", { id: "amazon", on: true });
  assert.equal(r.status, 200); assert.equal(A.X.on().amazon, true);
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "etsy", values: { mid: "6220" } });
  assert.match(r.j.message, /^Etsy IDs saved\. They are not complete, so Etsy is off\./);
  assert.deepEqual(A.kv.json("aff:ids"), { amazon: { tag: "owltwig-20" }, etsy: { mid: "6220", aff: "" } }, "the other program's IDs are kept");
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "amazon", values: { tag: "" } });
  assert.match(r.j.message, /not complete, so Amazon is off/);
  assert.equal(A.kv.json("aff:on").amazon, false, "clearing the IDs turns it off and keeps it off");
  assert.equal(A.X.on().amazon, false);
  assert.deepEqual(A.audits.map((a) => a.action), ["aff-ids", "aff-on", "aff-ids", "aff-ids"]);
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "nope", values: {} });
  assert.equal(r.status, 400);
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "etsy", values: "6220" });
  assert.equal(r.status, 400);
});
