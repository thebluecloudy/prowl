/* v211: Shopify Global Catalog diagnostics (shopcat.js, admin.js, admin-page.js). Live v210 answered "unavailable" with
   Matt's key set and logged only the status. Now: Shopify's error code and a trimmed description are kept (memory and
   KV shopcat:last) with the id and secret cut out; a refused JSON-body exchange is tried once with HTTP Basic and the
   method that worked is remembered; the 5-minute wait belongs to the credentials it failed with; the admin's Diagnose
   card (owner only, behind the admin session) shows it all and runs one exchange + one search.
   Run: node --test worker/__tests__/shop-catalog-diag-v211.test.mjs */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as SC from "../shopcat.js";
import { adminFetch } from "../admin.js";
import { adminPage } from "../admin-page.js";

const ID = "0123456789abcdef0123456789abcdef", SECRET = "shpss_5ecretValueThatMustNeverLeak_42";
const ENV = { SHOPIFY_CATALOG_CLIENT_ID: ID, SHOPIFY_CATALOG_CLIENT_SECRET: SECRET };
const ORIGIN = "https://www.owlandtwigvintage.com";
const json = (body, status, origin, extra) => ({ status: status || 200, body, headers: Object.assign({}, extra || {}) });
function res(status, body, headers = {}) { return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k] ?? null }, json: async () => body }; }
function kv() { const m = new Map(); return { m, put: async (k, v) => { m.set(k, v); }, get: async (k, t) => { const v = m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; } }; }
function fake(tokenAnswer, catalog) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === SC.SHOPCAT_TOKEN_URL) return tokenAnswer(init, calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL).length);
    if (String(url) === SC.SHOPCAT_MCP_URL) return catalog ? catalog(init) : res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { products: [] } } });
    throw new Error("unexpected " + url);
  };
  return { f, calls, tokens: () => calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL) };
}
const D = (f) => ({ vCount: async () => true, ipKey: (x) => String(x || "anon"), json, sgwExact: (items) => items, fetch: f });
function ask(d, env) {
  const url = new URL("https://prowl.example.workers.dev/shop-live?term=pyrex+bowl");
  return SC.shopLive(new Request(url, { headers: { "CF-Connecting-IP": "203.0.113.9" } }), env, url, ORIGIN, d);
}
const quiet = async (fn) => { const e = console.error, logs = []; console.error = (...a) => logs.push(a.join(" ")); try { await fn(logs); } finally { console.error = e; } return logs; };

beforeEach(() => SC.shopcatReset());

test("a refused exchange keeps Shopify's error code and a trimmed description, without the id or the secret", async () => {
  const store = kv(), env = Object.assign({ PROWL_ALERTS: store }, ENV);
  const s = fake(() => res(400, { error: "application_cannot_be_found", error_description: "Could not find Shopify API application with client_id \"" + ID + "\". Secret " + SECRET + " " + "x".repeat(400) }));
  const logs = await quiet(async () => { const r = await ask(D(s.f), env); assert.equal(r.status, 503); });
  assert.equal(s.tokens().length, 1, "application_cannot_be_found: the id is unknown, so no Basic retry");
  const last = SC.shopcatLast();
  assert.equal(last.ok, false); assert.equal(last.status, 400); assert.equal(last.error, "application_cannot_be_found");
  assert.match(last.desc, /^Could not find Shopify API application with client_id/);
  assert.ok(last.desc.length <= 200);
  const saved = store.m.get(SC.SHOPCAT_LAST_KEY);
  assert.ok(saved, "a KV record shopcat:last");
  const rec = JSON.parse(saved);
  assert.deepEqual(Object.keys(rec).sort(), ["at", "desc", "error", "method", "ok", "status", "tried"]);
  for (const blob of [saved, JSON.stringify(last), logs.join("\n")]) {
    assert.ok(!blob.includes(ID), "no client id"); assert.ok(!blob.includes(SECRET), "no secret"); assert.ok(!blob.includes("5ecretValue"), "no part of the secret");
  }
  assert.match(logs.join("\n"), /shopcat token 400 application_cannot_be_found/);
  const st = await SC.shopcatStatus(Object.assign({ PROWL_ALERTS: store }, ENV));
  assert.equal(st.last.error, "application_cannot_be_found");
  /* a fresh isolate reads the KV record */
  SC.shopcatReset();
  const st2 = await SC.shopcatStatus(Object.assign({ PROWL_ALERTS: store }, ENV));
  assert.equal(st2.last.status, 400);
  assert.ok(!JSON.stringify(st2).includes(SECRET) && !JSON.stringify(st2).includes(ID));
});

test("invalid_client on the JSON body: one more try with HTTP Basic and a form body; the method that worked is remembered", async () => {
  const s = fake((init) => {
    if (init.headers.Authorization) return res(200, { access_token: "tok-basic", token_type: "Bearer", expires_in: 3600 });
    return res(401, { error: "invalid_client", error_description: "Client authentication failed" });
  });
  const r = await ask(D(s.f), ENV);
  assert.equal(r.status, 200);
  const [a, b] = s.tokens();
  assert.equal(a.init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(a.init.body), { client_id: ID, client_secret: SECRET, grant_type: "client_credentials" });
  assert.equal(b.init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(b.init.body, "grant_type=client_credentials", "no secret in the Basic body");
  assert.equal(b.init.headers.Authorization, "Basic " + btoa(ID + ":" + SECRET));
  assert.equal(SC.shopcatMethod(), "basic");
  assert.equal(SC.shopcatLast().ok, true);
  assert.deepEqual(SC.shopcatLast().tried, ["post", "basic"]);
  /* the next exchange (the token gone) starts with Basic */
  const keep = SC.shopcatMethod();
  SC.shopcatReset();
  assert.equal(keep, "basic");
});

test("the 5-minute wait belongs to the credentials: a new secret is tried at once", async () => {
  let good = false;
  const s = fake((init) => good ? res(200, { access_token: "tok-new", expires_in: 3600 }) : res(400, { error: "application_cannot_be_found" }));
  await quiet(async () => {
    assert.equal((await ask(D(s.f), ENV)).status, 503);
    assert.equal((await ask(D(s.f), ENV)).status, 503);
  });
  assert.equal(s.tokens().length, 1, "same key: it waits");
  assert.equal(SC.shopcatTokenDown(Date.now(), ENV), true);
  const ENV2 = { SHOPIFY_CATALOG_CLIENT_ID: ID, SHOPIFY_CATALOG_CLIENT_SECRET: SECRET.replace("42", "43") };   /* same length, other value */
  assert.equal(SC.shopcatTokenDown(Date.now(), ENV2), false);
  good = true;
  assert.equal((await ask(D(s.f), ENV2)).status, 200);
  assert.equal(s.tokens().length, 2, "new secret: tried straight away");
  assert.notEqual(SC.shopcatFp(ENV), SC.shopcatFp(ENV2));
  assert.ok(!SC.shopcatFp(ENV).includes(SECRET.slice(0, 8)));
});

test("shopcatTest: one fresh exchange (past the wait) and one search; the count and 3 titles, or the JSON-RPC error", async () => {
  const prods = ["Pyrex bowl", "Pyrex butterprint", "Pyrex dish", "Pyrex lid"].map((t, i) => ({ id: "p" + i, title: t }));
  let rpcErr = false;
  const s = fake(() => res(200, { access_token: "tok-t", expires_in: 3600 }),
    () => rpcErr ? res(200, { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid params: meta.ucp-agent.profile unreachable" } })
      : res(200, { jsonrpc: "2.0", id: 1, result: { structuredContent: { products: prods } } }));
  const r = await SC.shopcatTest(ENV, D(s.f), "pyrex", "https://prowl.example.workers.dev");
  assert.equal(r.exchange.ok, true); assert.equal(r.exchange.method, "post");
  assert.deepEqual(r.search, { ok: true, status: 200, count: 4, titles: ["Pyrex bowl", "Pyrex butterprint", "Pyrex dish"] });
  assert.equal(JSON.parse(s.calls[1].init.body).params.arguments.catalog.query, "pyrex");
  rpcErr = true;
  const e = await SC.shopcatTest(ENV, D(s.f), "", "https://prowl.example.workers.dev");
  assert.equal(e.term, "pyrex", "pyrex unless given");
  assert.deepEqual(e.search.rpc, { code: -32602, message: "Invalid params: meta.ucp-agent.profile unreachable", data: "" });
  assert.equal(s.tokens().length, 2, "a fresh exchange each test");
  assert.equal((await SC.shopcatTest({}, D(s.f), "pyrex", "")).on, false);
});

/* ---------- the admin routes: behind the admin session only ---------- */
const ADMIN_KEY = "k".repeat(32);
function H(over) {
  return Object.assign({ vCount: async () => true, capsCall: async () => null, ipKey: (x) => String(x || ""), WORKER_VERSION: "v211",
    shopcatStatus: (env, now) => SC.shopcatStatus(env, now), shopcatTestRun: async () => ({ on: true, term: "pyrex", exchange: { ok: false, status: 401, error: "invalid_client", desc: "Client authentication failed", method: "basic", tried: ["post", "basic"] }, search: null }) }, over || {});
}
async function signIn(env, h) {
  const body = "key=" + ADMIN_KEY;
  const r = await adminFetch(new Request("https://prowl.example.workers.dev/admin/login", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://prowl.example.workers.dev", "CF-Connecting-IP": "203.0.113.5" } }), env, {}, h);
  assert.equal(r.status, 303);
  return String(r.headers.get("Set-Cookie")).split(";")[0];
}
test("the diag routes answer only inside the admin session; the answer has Shopify's code, no secret", async () => {
  const env = Object.assign({ ADMIN_KEY, PROWL_ALERTS: kv() }, ENV), h = H();
  const get = (cookie) => adminFetch(new Request("https://prowl.example.workers.dev/admin/api/shopcat", { headers: cookie ? { Cookie: cookie } : {} }), env, {}, h);
  const post = (cookie, hdr) => adminFetch(new Request("https://prowl.example.workers.dev/admin/api/shopcat/test", { method: "POST", body: JSON.stringify({ term: "pyrex" }),
    headers: Object.assign({ "Content-Type": "application/json", Origin: "https://prowl.example.workers.dev" }, cookie ? { Cookie: cookie } : {}, hdr || { "X-Prowl-Admin": "1" }) }), env, {}, h);
  assert.equal((await get()).status, 401);
  assert.equal((await post()).status, 401);
  assert.equal((await get("prowl_admin=forged.value")).status, 401);
  const cookie = await signIn(env, h);
  const g = await get(cookie);
  assert.equal(g.status, 200);
  const gj = await g.json();
  assert.equal(gj.on, true);
  assert.equal(gj.shape.id.len, ID.length); assert.equal(gj.shape.secret.len, SECRET.length);
  assert.equal((await post(cookie, {})).status, 403, "a POST needs the admin header");
  const p = await post(cookie);
  assert.equal(p.status, 200);
  const txt = await p.text();
  assert.match(txt, /invalid_client/);
  assert.ok(!txt.includes(SECRET) && !txt.includes(ID));
  assert.ok(!JSON.stringify(gj).includes(SECRET) && !JSON.stringify(gj).includes(ID));
});

test("the swapped-keys hint: an id that starts shpss_ is flagged, values never shown", () => {
  const sh = SC.shopcatShape({ SHOPIFY_CATALOG_CLIENT_ID: SECRET, SHOPIFY_CATALOG_CLIENT_SECRET: " " + ID + " " });
  assert.equal(sh.swapped, true); assert.equal(sh.secret.spaces, true); assert.equal(sh.id.spaces, false);
  assert.ok(!JSON.stringify(sh).includes(ID) && !JSON.stringify(sh).includes(SECRET));
});

test("the Diagnose card: status, Shopify's error, the hints, and a test search showing the count and titles", async (t) => {
  const sent = [];
  const dom = new JSDOM(adminPage("n0nce", "v211"), { url: "https://prowl.example.workers.dev/admin#diagnose", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = async (path, o) => {
        const p = String(path); sent.push(p);
        const j = p === "/admin/api/shopcat" ? { on: true, method: "", waitUntil: 0, last: { at: Date.now(), ok: false, status: 400, error: "application_cannot_be_found", desc: "Could not find Shopify API application with client_id \"[hidden]\".", method: "post", tried: ["post"] }, shape: { id: { len: 32, set: true }, secret: { len: 38, set: true }, swapped: false } }
          : p === "/admin/api/shopcat/test" ? { on: true, term: "pyrex", exchange: { ok: true, status: 200, method: "basic" }, search: { ok: true, status: 200, count: 7, titles: ["Pyrex bowl", "Pyrex dish", "Pyrex lid"] } } : {};
        return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
      };
    } });
  const w = dom.window, d = w.document;
  t.after(() => w.close());
  const wait = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); assert.ok(f()); };
  const card = d.querySelector("#v-diagnose #shccard");
  assert.ok(card); assert.match(card.textContent, /Shopify stores \(Global Catalog\)/);
  await wait(() => /application_cannot_be_found/.test(card.textContent));
  assert.match(card.textContent, /Could not find Shopify API application/);
  assert.match(card.textContent, /swapped/); assert.match(card.textContent, /Extra spaces/); assert.match(card.textContent, /Dev Dashboard › Catalogs/);
  d.querySelector("#shc-run").click();
  await wait(() => /7 items/.test(card.textContent));
  assert.match(card.textContent, /Pyrex lid/);
  assert.match(card.textContent, /HTTP Basic/);
  assert.ok(sent.includes("/admin/api/shopcat/test"));
});
