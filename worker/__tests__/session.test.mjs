/* v82 store sessions and Pro from the signed-in customer's own orders.
   Run: node --test worker/__tests__/session.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { giftPro } from "../admin.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
function fromIndex(names, deps = {}, pre = "") {
  const keys = Object.keys(deps);
  return new Function(...keys, pre + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
}
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
}
const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const SECRET = "x".repeat(40);
const S = fromIndex(["b64u", "b64uStr", "unb64u", "sessKey", "sessMint", "sessVerify", "sessMember", "pxHmac", "alSame", "alEmail", "proMember"], { kvGet }, "const SESS_DAYS = 30;");
const req = (tok) => ({ headers: { get: (h) => (h.toLowerCase() === "authorization" && tok ? "Bearer " + tok : null) } });

test("a session names the store customer, expires in 30 days, and is signed", async () => {
  const env = { PROWL_SESSION_SECRET: SECRET };
  const now = Date.parse("2026-10-07T20:00:00Z");
  const tok = await S.sessMint(env, "1234567", now);
  assert.match(tok, /^[A-Za-z0-9_-]+$/);
  const raw = Buffer.from(tok.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  const [cid, exp, mac] = raw.split(".");
  assert.equal(cid, "1234567");
  assert.equal(Number(exp), now / 1000 + 30 * 86400);
  assert.equal(mac, createHmac("sha256", SECRET).update("prowl-session-v1:" + cid + "." + exp).digest("hex"));
  assert.equal(await S.sessVerify(req(await S.sessMint(env, "1234567")), env), "1234567");
});

test("expired, tampered, foreign and malformed tokens are refused", async () => {
  const env = { PROWL_SESSION_SECRET: SECRET };
  const old = await S.sessMint(env, "1234567", Date.now() - 31 * 86400000);
  assert.equal(await S.sessVerify(req(old), env), null, "expired");
  const good = await S.sessMint(env, "1234567");
  const raw = Buffer.from(good.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  const forged = Buffer.from(raw.replace(/^1234567/, "7654321")).toString("base64url");
  assert.equal(await S.sessVerify(req(forged), env), null, "another customer id");
  const other = await S.sessMint({ PROWL_SESSION_SECRET: "y".repeat(40) }, "1234567");
  assert.equal(await S.sessVerify(req(other), env), null, "signed with another secret");
  for (const bad of ["", "not-base64!", Buffer.from("a.b.c").toString("base64url"), Buffer.from("123.999.zz").toString("base64url")]) {
    assert.equal(await S.sessVerify(req(bad), env), null, bad);
  }
});

test("with no secret (or a short one) nothing is minted and Bearer is ignored", async () => {
  assert.equal(await S.sessMint({}, "1234567"), "");
  assert.equal(await S.sessMint({ PROWL_SESSION_SECRET: "short" }, "1234567"), "");
  const tok = await S.sessMint({ PROWL_SESSION_SECRET: SECRET }, "1234567");
  assert.equal(await S.sessVerify(req(tok), {}), null);
  assert.equal(await S.sessMint({ PROWL_SESSION_SECRET: SECRET }, "abc"), "", "only numeric Shopify ids");
});

test("proMember: the email token as before, or a session linked to a Pro member", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv, PROWL_SESSION_SECRET: SECRET };
  kv.set("sub:pro@example.com", { email: "pro@example.com", tok: "T1", pro: true, cid: "111" });
  kv.set("cid:111", { email: "pro@example.com" });
  kv.set("sub:free@example.com", { email: "free@example.com", tok: "T2", pro: false, cid: "222" });
  kv.set("cid:222", { email: "free@example.com" });
  assert.equal(await S.proMember(env, { e: "pro@example.com", t: "T1" }), "pro@example.com", "the old way still works");
  assert.equal(await S.proMember(env, {}, req(await S.sessMint(env, "111"))), "pro@example.com");
  assert.equal(await S.proMember(env, {}, req(await S.sessMint(env, "222"))), null, "signed in but not Pro");
  assert.equal(await S.proMember(env, {}, req(await S.sessMint(env, "333"))), null, "no member linked");
  kv.set("cid:444", { email: "pro@example.com" });
  assert.equal(await S.proMember(env, {}, req(await S.sessMint(env, "444"))), null, "the member must point back at the same customer");
});

test("wired in: login answers carry the session, status and AI routes accept it, CORS allows it", () => {
  assert.equal((INDEX.match(/session: await sessMint\(env, id\)/g) || []).length, 2, "member and non-member sign-in answers");
  assert.equal((INDEX.match(/await proMember\(env, b, request\)/g) || []).length, 4, "Fair price, photo check, guide, and the photo price step (v93)");
  assert.match(INDEX, /const ss = await sessMember\(request, env\);/);
  assert.match(INDEX, /"Access-Control-Allow-Headers": "Content-Type, X-Prowl-Owner, Authorization"/);
});

/* the shop side: alProSet with KV and Shopify stubbed (same harness shape as admin.test.mjs) */
function realPro(env, answer) {
  const asked = [];
  const fetch = async (u, o) => { const q = JSON.parse(o.body).variables.q; asked.push(q); const nodes = answer(q); if (!nodes) throw new Error("offline"); return { status: 200, json: async () => ({ data: { orders: { nodes } } }) }; };
  const giftHash = async (e) => "h" + e;
  const deps = { kvGet, kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)), giftHash, giftPro, proListHas: (env, e) => false,
    alNow: () => ({ day: "2026-10-07", hour: 10, wday: 1 }), PRO_SKU: "PROWL-PRO-MONTHLY", PRO_DAYS: 35, PRO_TRIAL_CODE: "PROWLMONTH", fetch };
  return Object.assign(fromIndex(["alFreePro", "alProShop", "alProSet"], deps), { asked });
}
const order = (email, attrs = []) => ({ name: "#2001", createdAt: "2026-10-01T10:00:00Z", cancelledAt: null, displayFinancialStatus: "PAID", email, statusPageUrl: "https://store.example/r", discountCodes: [],
  totalPriceSet: { shopMoney: { amount: "7.00", currencyCode: "USD" } }, lineItems: { nodes: [{ sku: "PROWL-PRO-MONTHLY", customAttributes: attrs }] } });

test("Pro from the customer's own orders: checked out under another email, no tag, still Pro", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv, SHOPIFY_ORDERS_TOKEN: "t" };
  const X = realPro(env, (q) => (q.startsWith("customer_id:555 ") ? [order("shoppay@other.example")] : []));
  const sub = { email: "member@example.com", cid: "555", hunts: [] };
  assert.equal(await X.alProSet(env, sub, true), true);
  assert.equal(sub.plan.order, "#2001");
  assert.match(X.asked[0], /^customer_id:555 AND sku:PROWL-PRO-MONTHLY AND created_at:>=/);
  assert.equal(JSON.parse(kv.m.get("pro:cid:555")).pro, true, "cached per customer");
});

test("no customer order: the email and tag check still runs, so no paying member is lost", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv, SHOPIFY_ORDERS_TOKEN: "t" };
  const X = realPro(env, (q) => (q.startsWith("customer_id:") ? [] : [order("someone@else.example", [{ key: "Prowl Alerts email", value: "member@example.com" }])]));
  const sub = { email: "member@example.com", cid: "555", hunts: [] };
  assert.equal(await X.alProSet(env, sub, true), true);
  assert.ok(X.asked.some((q) => q.startsWith('email:"member@example.com"')), "fell through to the email check");
});

test("members without a store link never trigger the customer query", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv, SHOPIFY_ORDERS_TOKEN: "t" };
  const X = realPro(env, () => [order("member@example.com")]);
  await X.alProSet(env, { email: "member@example.com", hunts: [] }, true);
  assert.ok(!X.asked.some((q) => q.startsWith("customer_id:")));
});

test("a gift comes before any shop question; a shop outage never downgrades", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv, SHOPIFY_ORDERS_TOKEN: "t" };
  kv.set("gift:hmember@example.com", { until: "" });
  const X = realPro(env, () => null);
  const sub = { email: "member@example.com", cid: "555", hunts: [] };
  assert.equal(await X.alProSet(env, sub, true), true);
  assert.equal(X.asked.length, 0);
  const kv2 = new FakeKV(), env2 = { PROWL_ALERTS: kv2, SHOPIFY_ORDERS_TOKEN: "t" };
  const Y = realPro(env2, () => null);
  const paying = { email: "p@example.com", cid: "777", pro: true, plan: { via: "order" }, hunts: [] };
  assert.equal(await Y.alProSet(env2, paying, true), true, "still Pro when Shopify cannot be reached");
  assert.ok(paying.proCheck, "the admin sees the failing check");
});
