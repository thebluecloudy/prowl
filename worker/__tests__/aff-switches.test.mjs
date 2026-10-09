/* v89: affiliate switches. The owner turns each program on or off in the admin area (Affiliates); KV aff:on keeps it,
   AFF_PROGRAMS has the defaults (eBay on, the rest off), and every link builder follows it.
   v90: each program's IDs too (KV aff:ids), checked against their formats; a program is on only with complete IDs.
   v92: Depop has no affiliate program (Rakuten closed the publisher account); a stored Depop switch or ID does nothing.
   v95: Depop is back (approved through Rakuten Advertising 2026-10-09), off, with a new publisher ID field (ranid), so a
   v84-v91 switch or ID left in KV never turns it on; only the Prowl page tags Depop links, never the alert emails.
   Run: node --test worker/__tests__/aff-switches.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminFetch, signSession } from "../admin.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
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
  const src = [lineOf(/^const DEPOP_URL = [^\n]*;/m), lineOf(/^const AFF_RE = [^\n]*;/m),
    lineOf(/^const AFF_PROGRAMS = \[[\s\S]*?\n\];/m), lineOf(/^const AFF_KEY = [^\n]*;/m), lineOf(/^const affObj = [^\n]*;/m),
    ...["affIdsClean", "affReady", "affClean"].map(indexFn), lineOf(/^let AFF_IDS = [^\n]*;/m),
    ...["affId", "affLoad", "affNote", "epnUrl", "ctbUrl"].map(indexFn), "const AL_ALSO = " + /const AL_ALSO = (\[[\s\S]*?\n\]);/.exec(INDEX)[1] + ";"].join("\n");
  return new Function("kvGet", src + "\nreturn { AFF_PROGRAMS, AFF_KEY, AFF_IDS_KEY, affClean, affIdsClean, affReady, affLoad, affNote, epnUrl, AL_ALSO, on: () => AFF_ON, ids: () => AFF_IDS };")(kvGet);
}
const EPN = { EPN_CAMPAIGN_ID: "5339216838" };

const OFF = { depop_rak: false, etsy: false, reverb: false, "1stdibs": false, amazon: false };
test("defaults: eBay on, the rest off; Depop's advertiser ID is filled in, its publisher ID is not; a stored choice wins", async () => {
  const X = lift(), ids = X.affIdsClean(null, null);
  assert.deepEqual(ids, { ebay: { camp: "5339216838" }, depop_rak: { mid: "53555", ranid: "" }, etsy: { mid: "", aff: "" }, reverb: { mid: "", aff: "" }, "1stdibs": { camref: "" }, amazon: { tag: "" } });
  assert.deepEqual(X.affClean(null, ids), { ebay: true, ...OFF });
  assert.deepEqual(X.affClean({ ebay: false }, ids), { ebay: false, ...OFF });
  assert.deepEqual(X.affClean({ ebay: "no", depop: true, depop_rak: true, etsy: true }, ids), { ebay: true, ...OFF }, "only booleans; Depop and Etsy need their IDs; the old depop key is no program");
  assert.deepEqual(X.AFF_PROGRAMS.map((p) => [p.id, p.def]), [["ebay", true], ["depop_rak", false], ["etsy", false], ["reverb", false], ["1stdibs", false], ["amazon", false]]);
  const kv = new FakeKV();
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }, true), { ebay: true, ...OFF }, "nothing stored: defaults");
  await kv.put("aff:on", JSON.stringify({ ebay: false, depop: true }));
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }), { ebay: true, ...OFF }, "read at most once a minute");
  assert.deepEqual(await X.affLoad({ PROWL_ALERTS: kv }, true), { ebay: false, ...OFF }, "an old Depop switch does nothing without the publisher ID");
});

test("v90 IDs: stored values over the defaults, off-format values dropped, eBay falls back to EPN_CAMPAIGN_ID", () => {
  const X = lift();
  const ids = X.affIdsClean({ etsy: { mid: " 6220 ", aff: "1234567" }, amazon: { tag: "owltwig-20" }, depop: { pub: "Abc123/x*Y" }, "1stdibs": { camref: "1l3vabc" }, junk: { a: 1 } }, null);
  assert.deepEqual(ids.etsy, { mid: "6220", aff: "1234567" });
  assert.equal(ids.amazon.tag, "owltwig-20");
  assert.deepEqual(ids.depop_rak, { mid: "53555", ranid: "" }, "v95: nothing under the old depop key is reused");
  assert.equal("depop" in ids, false);
  assert.deepEqual(X.affIdsClean({ depop_rak: { mid: "53555", ranid: "Abc123/x*Y" } }, null).depop_rak, { mid: "53555", ranid: "Abc123/x*Y" });
  assert.equal(ids["1stdibs"].camref, "1l3vabc");
  assert.equal("junk" in ids, false);
  assert.equal(X.affIdsClean(null, { EPN_CAMPAIGN_ID: "1111111111" }).ebay.camp, "1111111111");
  assert.equal(X.affIdsClean({ ebay: { camp: "2222222222" } }, { EPN_CAMPAIGN_ID: "1111111111" }).ebay.camp, "2222222222", "the admin's value wins");
  assert.equal(X.affIdsClean(null, { EPN_CAMPAIGN_ID: "nope" }).ebay.camp, "5339216838");
  assert.equal(X.affIdsClean({ ebay: { camp: "12" } }, null).ebay.camp, "", "a stored value in the wrong form is dropped, not replaced by the default");
  for (const [p, f, bad] of [["ebay", "camp", "123"], ["depop_rak", "mid", "5a555"], ["depop_rak", "ranid", "a&murl=https://evil.example"], ["depop_rak", "ranid", "Abc 123"], ["depop_rak", "ranid", "3912345"], ["depop_rak", "ranid", "x\"><b>"], ["etsy", "mid", "12a"], ["etsy", "aff", "1"], ["1stdibs", "camref", "a/b"], ["amazon", "tag", "owltwig"], ["amazon", "tag", "x\"><script>-20"]]) {
    assert.equal(X.affIdsClean({ [p]: { [f]: bad } }, null)[p][f], "", p + "." + f + " " + bad);
  }
});

test("v90: the eBay link uses the stored ID; v95: an old Depop switch and ID (v84-v91) tag nothing; Depop on tags no email link", async () => {
  const X = lift(), kv = new FakeKV();
  await kv.put("aff:on", JSON.stringify({ depop: true }));
  await kv.put("aff:ids", JSON.stringify({ depop: { pub: "Abc123/x*Y" }, ebay: { camp: "2222222222" } }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.match(X.epnUrl(EPN, "https://www.ebay.com/itm/1", "prowl-alerts"), /campid=2222222222/, "the admin's ID, not the variable");
  assert.equal(X.on().depop_rak, false, "nothing under the new key: off");
  assert.deepEqual(X.ids().depop_rak, { mid: "53555", ranid: "" });
  assert.equal("depop" in X.on(), false, "/aff never answers on.depop: old pages and extension 1.6.3 would tag the closed account's link");
  assert.equal("depop" in X.ids(), false);
  assert.equal(X.AL_ALSO.find((a) => a[0] === "Depop")[1]("hull pottery"), "https://www.depop.com/search/?q=hull%20pottery");
  assert.equal(X.affNote(), "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.");
  await kv.put("aff:on", JSON.stringify({ depop_rak: true }));
  await kv.put("aff:ids", JSON.stringify({ depop_rak: { mid: "53555", ranid: "Abc123/x*Y" } }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.equal(X.on().depop_rak, true, "on, with both IDs");
  assert.equal("depop" in X.on(), false, "and still no on.depop");
  assert.equal(X.AL_ALSO.find((a) => a[0] === "Depop")[1]("hull pottery"), "https://www.depop.com/search/?q=hull%20pottery", "emails stay plain");
  assert.equal(X.affNote(), "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.", "and their footer does not name Depop");
  await kv.put("aff:on", JSON.stringify({ amazon: true, etsy: true }));
  await kv.put("aff:ids", JSON.stringify({ amazon: { tag: "owltwig-20" }, etsy: { mid: "6220", aff: "1234567" } }));
  await X.affLoad({ PROWL_ALERTS: kv }, true);
  assert.equal(X.on().amazon, true);
  assert.equal(X.affNote(), "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.", "emails tag no Amazon or Etsy links, so the footer does not name them");
});

test("v92/v95: every alert email link is plain except eBay's; nothing in the worker builds a Rakuten link", async () => {
  const X = lift();
  await X.affLoad({ PROWL_ALERTS: new FakeKV() }, true);
  assert.equal(X.AL_ALSO.find((a) => a[0] === "Depop")[1]("hull pottery"), "https://www.depop.com/search/?q=hull%20pottery");
  assert.ok(X.AL_ALSO.every((a) => !/linksynergy|jh1j|mid=53555/.test(a[1]("x"))));
  assert.equal(X.affNote(), "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.");
  assert.match(X.epnUrl(EPN, "https://www.ebay.com/itm/1", "prowl-alerts"), /campid=5339216838/);
  assert.doesNotMatch(INDEX, /DEPOP_AFF_T|function depopAff|linksynergy\.com|jh1j/);
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
  assert.deepEqual(r.j.programs.map((p) => [p.id, p.name, p.on, p.ready]), [["ebay", "eBay", true, true], ["depop_rak", "Depop", false, false], ["etsy", "Etsy", false, false],
    ["reverb", "Reverb", false, false], ["1stdibs", "1stDibs", false, false], ["amazon", "Amazon", false, false]]);
  assert.deepEqual(r.j.programs[0].fields, [{ k: "camp", label: "Campaign ID", hint: "10 digits", value: "5339216838" }]);
  const dp = r.j.programs[1];
  assert.equal(dp.net, "Rakuten Advertising");
  assert.deepEqual(dp.fields.map((f) => [f.k, f.value]), [["mid", "53555"], ["ranid", ""]], "v95: Depop's advertiser ID filled in, the publisher ID to paste");
  r = await A.call("POST", "/admin/api/affiliate", { id: "ebay", on: false });
  assert.equal(r.status, 200); assert.equal(r.j.ok, true);
  assert.match(r.j.message, /^eBay links are plain now/);
  assert.deepEqual(A.kv.json("aff:on"), { ebay: false });
  assert.equal(r.j.programs.find((p) => p.id === "ebay").on, false);
  assert.equal(A.X.epnUrl(EPN, "https://www.ebay.com/itm/1", "prowl-alerts"), "https://www.ebay.com/itm/1", "this isolate follows at once");
  r = await A.call("POST", "/admin/api/affiliate", { id: "ebay", on: true });
  assert.match(r.j.message, /^eBay links are tagged now/);
  assert.deepEqual(A.kv.json("aff:on"), { ebay: true });
  assert.deepEqual(A.audits.map((a) => [a.action, a.id]), [["aff-off", "ebay"], ["aff-on", "ebay"]]);
});

test("admin: unknown programs, non-boolean values and requests from elsewhere change nothing", async () => {
  const A = admin();
  let r = await A.call("POST", "/admin/api/affiliate", { id: "etsy", on: true });
  assert.equal(r.status, 400);
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop_rak", on: true });
  assert.equal(r.status, 400, "v95: Depop needs its publisher ID first");
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop", on: true });
  assert.equal(r.status, 400, "the old key is no program");
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "depop_rak", values: { mid: "53555", ranid: "Abc123/x*Y&murl=https://evil.example" } });
  assert.equal(r.status, 400, "a publisher ID that could carry another parameter is refused");
  r = await A.call("POST", "/admin/api/affiliate", { id: "ebay", on: "yes" });
  assert.equal(r.status, 400);
  r = await A.call("POST", "/admin/api/affiliate", { id: "ebay", on: false }, { "X-Prowl-Admin": "0" });
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

test("admin v95: Depop's IDs complete for the first time leave it off, even with an old switch in KV; Turn on then works", async () => {
  const A = admin();
  /* left from v84-v91 under the old key, and (as if a v95 KV had one) an "on" under the new key before any IDs */
  await A.kv.put("aff:on", JSON.stringify({ ebay: true, depop: true, depop_rak: true }));
  await A.kv.put("aff:ids", JSON.stringify({ depop: { pub: "jx0OLDx*ID" } }));
  let r = await A.call("GET", "/admin/api/affiliates");
  assert.deepEqual(r.j.programs.find((p) => p.id === "depop_rak").on, false, "not before its publisher ID is saved");
  assert.equal(r.j.programs.find((p) => p.id === "depop_rak").mail, false, "page only");
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "depop_rak", values: { mid: "53555", ranid: " Abc123/x*Y " } });
  assert.equal(r.status, 200);
  assert.match(r.j.message, /^Depop IDs saved\. Press Turn on when you want Depop links tagged\./);
  assert.deepEqual(A.kv.json("aff:ids").depop_rak, { mid: "53555", ranid: "Abc123/x*Y" }, "trimmed");
  assert.equal(A.kv.json("aff:on").depop_rak, false, "the switch is set off");
  assert.equal(A.X.on().depop_rak, false);
  r = await A.call("POST", "/admin/api/affiliate", { id: "depop_rak", on: true });
  assert.equal(r.status, 200);
  assert.match(r.j.message, /^Depop links are tagged now \(Rakuten Advertising\)\. The Prowl page picks this up within about 5 minutes\. Alert emails keep plain Depop links\.$/);
  assert.equal(A.X.on().depop_rak, true);
  /* changing an ID of a program that is on keeps it on */
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "depop_rak", values: { mid: "53555", ranid: "Xyz789/a*B" } });
  assert.match(r.j.message, /Links use them within about 5 minutes/);
  assert.equal(A.X.on().depop_rak, true);
  /* eBay's IDs were complete from the start (its default): saving them changes nothing about its switch */
  r = await A.call("POST", "/admin/api/affiliate/ids", { id: "ebay", values: { camp: "2222222222" } });
  assert.equal(A.X.on().ebay, true);
});
