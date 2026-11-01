/* v210: live Shopify listings in hunts through Shopify's Global Catalog (shopcat.js). GET /shop-live is off without the
   two secrets; with them it trades the client ID and secret for a token (kept in memory until a minute before it
   expires), sends search_catalog the hunt's words, the US and the filters (no member data), keeps titles with every
   word (sgwExact from index.js), secondhand first, drops Owl & Twig's own products, caps per IP and for the site,
   honours a 429 and a timeout, and caches nothing. fetch is mocked throughout.
   Run: node --test worker/__tests__/shop-catalog-v210.test.mjs */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as SC from "../shopcat.js";
import * as SP from "../spend.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
function build(name, deps) {
  const keys = Object.keys(deps);
  return new Function(...keys, indexFn(name) + "\nreturn " + name + ";")(...keys.map((k) => deps[k]));
}
const alExWords = build("alExWords", {});
const sgwExact = build("sgwExact", { alExWords });

const ENV = { SHOPIFY_CATALOG_CLIENT_ID: "cid-test-0001", SHOPIFY_CATALOG_CLIENT_SECRET: "csecret-test-0001", SHOPIFY_CATALOG_ID: "none" };   /* v212: no saved catalog here (shop-catalog-keyless-v212 covers it) */
const ORIGIN = "https://www.owlandtwigvintage.com";
const json = (body, status, origin, extra) => ({ status: status || 200, body, headers: Object.assign({}, extra || {}) });

function product(id, title, o = {}) {
  return {
    id: "gid://shopify/p/" + id, title,
    media: [{ type: "image", url: o.img || "https://cdn.shopify.com/s/files/1/0001/" + id + ".jpg" }],
    price_range: { min: { amount: o.amount || 5900, currency: "USD" }, max: { amount: o.amount || 5900, currency: "USD" } },
    variants: [{
      id: "gid://shopify/ProductVariant/" + id, url: o.url || "https://shop" + id + ".example/products/p?variant=" + id + "&_gsid=x",
      price: { amount: o.amount || 5900, currency: o.cur || "USD" }, availability: { available: o.available !== false },
      condition: o.cond || ["secondhand"], source: o.source || "shopify",
      seller: { id: "gid://shopify/Shop/" + id, name: o.shop || "Shop " + id, url: o.sellerUrl || "https://shop" + id + ".example", domain: o.domain || "shop" + id + ".myshopify.com" },
    }],
  };
}
function catalogAnswer(products) { return { jsonrpc: "2.0", id: 1, result: { structuredContent: { ucp: { version: "2026-08-25" }, products, messages: [], pagination: { has_next_page: false } } } }; }
function res(status, body, headers = {}) { return { status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null }, json: async () => body }; }

/* a mocked Shopify: the token endpoint and the catalog, each answer picked by the test */
function shopify({ token = { access_token: "tok-1", token_type: "Bearer", expires_in: 3600 }, answers = [], tokenStatus = 200 } = {}) {
  const calls = [];
  let n = 0, t = 0;
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? (() => { try { return JSON.parse(init.body); } catch (e) { return String(init.body); } })() : null });   /* v211: the Basic try sends a form body */
    if (String(url) === SC.SHOPCAT_TOKEN_URL) { t++; return res(tokenStatus, typeof token === "function" ? token(t) : token); }
    if (String(url) === SC.SHOPCAT_MCP_URL) { const a = answers[Math.min(n++, answers.length - 1)]; return typeof a === "function" ? a(init) : a; }
    throw new Error("unexpected fetch " + url);
  };
  return { f, calls, tokens: () => calls.filter((c) => c.url === SC.SHOPCAT_TOKEN_URL), searches: () => calls.filter((c) => c.url === SC.SHOPCAT_MCP_URL) };
}
function deps(f, o = {}) {
  const counts = {};
  const vCount = async (name, limit) => { counts[name] = (counts[name] || 0) + 1; return o.vCount ? o.vCount(name, limit, counts[name]) : counts[name] <= limit; };
  return { D: { vCount, ipKey: (x) => String(x || "anon"), json, sgwExact, fetch: f }, counts };
}
function ask(D, q, env = ENV, ip = "203.0.113.9") {
  const url = new URL("https://prowl.example.workers.dev/shop-live?" + q);
  const req = new Request(url, { headers: { "CF-Connecting-IP": ip, "X-Prowl-Email": "member@example.com", "X-Prowl-Tok": "T".repeat(24), "Cookie": "s=1" } });
  return SC.shopLive(req, env, url, ORIGIN, D);
}

beforeEach(() => SC.shopcatReset());

test("v212: without the two secrets it is not off: it searches keyless (no token exchange, no Authorization header)", async () => {
  for (const env of [{ SHOPIFY_CATALOG_ID: "none" }, { SHOPIFY_CATALOG_CLIENT_ID: "x", SHOPIFY_CATALOG_ID: "none" }, { SHOPIFY_CATALOG_CLIENT_SECRET: "y", SHOPIFY_CATALOG_ID: "none" }, { SHOPIFY_CATALOG_CLIENT_ID: " ", SHOPIFY_CATALOG_CLIENT_SECRET: " ", SHOPIFY_CATALOG_ID: "none" }]) {
    SC.shopcatReset();
    const s = shopify({ answers: [res(200, catalogAnswer([product(1, "Ceramic panther")]))] }), { D } = deps(s.f);
    const r = await ask(D, "term=ceramic+panther&max=1", env);
    assert.equal(r.status, 200);
    assert.equal(r.body.on, true); assert.equal(r.body.mode, "keyless"); assert.equal(r.body.items.length, 1);
    assert.equal(s.tokens().length, 0);
    assert.equal(s.searches()[0].init.headers.Authorization, undefined);
  }
  assert.equal(SC.shopcatOn(ENV), true);
  assert.equal(SC.shopcatOn({}), false);
});

test("token exchange: client credentials as JSON to api.shopify.com, then kept in memory until a minute before it expires", async () => {
  let now = 1_800_000_000_000;
  const s = shopify({ answers: [res(200, catalogAnswer([]))] });
  const D = { fetch: s.f };
  const t1 = await SC.shopcatToken(ENV, D, now);
  assert.equal(t1, "tok-1");
  const tc = s.tokens();
  assert.equal(tc.length, 1);
  assert.equal(tc[0].url, "https://api.shopify.com/auth/access_token");
  assert.equal(tc[0].init.method, "POST");
  assert.equal(tc[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(tc[0].body, { client_id: "cid-test-0001", client_secret: "csecret-test-0001", grant_type: "client_credentials" });
  assert.equal(await SC.shopcatToken(ENV, D, now + 30 * 60000), "tok-1", "cached at 30 minutes");
  assert.equal(s.tokens().length, 1);
  await SC.shopcatToken(ENV, D, now + 59.5 * 60000);
  assert.equal(s.tokens().length, 2, "renewed inside the last minute");
  /* a token with no expires_in: its JWT exp is read; never kept past 60 minutes */
  SC.shopcatReset();
  const exp = Math.floor(now / 1000) + 20 * 60, jwt = "h." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".s";
  const s2 = shopify({ token: { access_token: jwt } });
  await SC.shopcatToken(ENV, { fetch: s2.f }, now);
  await SC.shopcatToken(ENV, { fetch: s2.f }, now + 18 * 60000);
  assert.equal(s2.tokens().length, 1);
  await SC.shopcatToken(ENV, { fetch: s2.f }, now + 19.5 * 60000);
  assert.equal(s2.tokens().length, 2, "the JWT's own exp, less a minute");
  /* two asks at once share one exchange */
  SC.shopcatReset();
  const s3 = shopify();
  await Promise.all([SC.shopcatToken(ENV, { fetch: s3.f }, now), SC.shopcatToken(ENV, { fetch: s3.f }, now)]);
  assert.equal(s3.tokens().length, 1);
});

test("the search: one search_catalog tools/call with the bearer token, the profile, the hunt's words, US and the filters, and nothing about the member", async () => {
  const s = shopify({ answers: [res(200, catalogAnswer([product(1, "Black Ceramic Panther TV Lamp")]))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic%20panther&max=1");
  assert.equal(r.status, 200);
  const q = s.searches();
  assert.equal(q.length, 1, "max met by the secondhand search: no second call");
  assert.equal(q[0].url, "https://catalog.shopify.com/api/ucp/mcp");
  assert.equal(q[0].init.headers.Authorization, "Bearer tok-1");
  assert.equal(q[0].body.method, "tools/call");
  assert.equal(q[0].body.params.name, "search_catalog");
  const a = q[0].body.params.arguments;
  assert.equal(a.meta["ucp-agent"].profile, "https://prowl.example.workers.dev/ucp/profile.json");
  assert.equal(a.catalog.query, "ceramic panther");
  assert.deepEqual(a.catalog.filters, { available: true, ships_to: { country: "US" }, condition: ["secondhand"] });
  assert.deepEqual(a.catalog.context, { address_country: "US", language: "en", currency: "USD" });
  assert.equal(a.catalog.signals, undefined, "no buyer IP or user agent");
  for (const c of s.calls) {
    const sent = JSON.stringify(c.init.headers) + String(c.init.body || "");
    assert.doesNotMatch(sent, /member@example\.com|203\.0\.113\.9|TTTTTTTT|Cookie|X-Prowl/i, "no member data to Shopify: " + c.url);
  }
  assert.equal(r.headers["Cache-Control"], "no-store", "Shopify: don't cache search results");
  assert.deepEqual(r.body.items, [{ title: "Black Ceramic Panther TV Lamp", price: 59, currency: "USD", img: "https://cdn.shopify.com/s/files/1/0001/1.jpg",
    shop: "Shop 1", domain: "shop1.myshopify.com", url: "https://shop1.example/products/p?variant=1&_gsid=x", secondhand: true }], "the variant URL as Shopify gave it");   /* v212: + domain */
  assert.equal(r.body.on, true);
  /* an owner override of the profile URL */
  SC.shopcatReset();
  const s2 = shopify({ answers: [res(200, catalogAnswer([product(1, "Ceramic Panther")]))] });
  await ask(deps(s2.f).D, "term=ceramic+panther&max=1", Object.assign({ SHOPIFY_CATALOG_PROFILE: "https://example.org/p.json" }, ENV));
  assert.equal(s2.searches()[0].body.params.arguments.meta["ucp-agent"].profile, "https://example.org/p.json");
});

test("word match, secondhand first, then a search without the condition filter; images only from Shopify's CDN; prices in major units", async () => {
  const used = [
    product(1, "Ceramic panther planter"),
    product(2, "Panther tank top", { cond: ["secondhand"] }),   /* no "ceramic": dropped */
    product(3, "Ceramic Panthers pair", { img: "https://evil.example/x.jpg" }),
  ];
  const any = [
    product(4, "Ceramic Panther lamp, new", { cond: ["new"], amount: 12550 }),
    product(1, "Ceramic panther planter"),   /* the same listing again: once */
    product(5, "Ceramic panther", { cur: "JPY", amount: 4800, cond: ["new"] }),
    product(6, "Ceramic panther sold out", { available: false }),
  ];
  const s = shopify({ answers: [res(200, catalogAnswer(used)), res(200, catalogAnswer(any))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic+panther");
  const q = s.searches();
  assert.equal(q.length, 2);
  assert.deepEqual(q[1].body.params.arguments.catalog.filters, { available: true, ships_to: { country: "US" } });
  const t = r.body.items.map((x) => x.title);
  assert.deepEqual(t, ["Ceramic panther planter", "Ceramic Panthers pair", "Ceramic Panther lamp, new", "Ceramic panther"]);
  assert.equal(r.body.items[0].secondhand, true);
  assert.equal(r.body.items[2].secondhand, undefined);
  assert.equal(r.body.items[1].img, "https://evil.example/x.jpg", "v212: any https photo is passed on (the page loads it from its host)");
  assert.equal(r.body.items[2].price, 125.5);
  assert.deepEqual([r.body.items[3].price, r.body.items[3].currency], [4800, "JPY"]);
  /* max caps the list */
  SC.shopcatReset();
  const s2 = shopify({ answers: [res(200, catalogAnswer(used)), res(200, catalogAnswer(any))] });
  const r2 = await ask(deps(s2.f).D, "term=ceramic+panther&max=3");
  assert.equal(r2.body.items.length, 3);
  assert.equal(SC.shopcatItem(product(9, "x", { source: "external" })).offShopify, true, "v212: off-Shopify offers are kept, marked");
});

test("Owl & Twig's own products are hidden, by its domain or its myshopify name", async () => {
  const ps = [
    product(1, "Ceramic panther, Owl & Twig", { url: "https://www.owlandtwigvintage.com/products/panther?variant=1", sellerUrl: "https://www.owlandtwigvintage.com", domain: "tz7xkc-du.myshopify.com" }),
    product(2, "Ceramic panther on the myshopify name", { url: "https://tz7xkc-du.myshopify.com/products/p", sellerUrl: "https://x.example", domain: "tz7xkc-du.myshopify.com" }),
    product(3, "Ceramic panther elsewhere"),
    product(4, "Ceramic panther, owlandtwigvintage.com.evil", { url: "https://owlandtwigvintage.com.evil.example/products/p", sellerUrl: "https://owlandtwigvintage.com.evil.example", domain: "evil.myshopify.com" }),
  ];
  const s = shopify({ answers: [res(200, catalogAnswer(ps)), res(200, catalogAnswer([]))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic+panther");
  assert.deepEqual(r.body.items.map((x) => x.title), ["Ceramic panther elsewhere", "Ceramic panther, owlandtwigvintage.com.evil"]);
  SC.shopcatReset();
  const s2 = shopify({ answers: [res(200, catalogAnswer([ps[0]])), res(200, catalogAnswer([]))] });
  const r2 = await ask(deps(s2.f).D, "term=ceramic+panther");
  assert.deepEqual(r2.body.items, []);
  assert.deepEqual(r2.body.why, { raw: 1, words: 0, own: 1 }, "an empty answer says why");
});

test("an empty answer says why: how many Shopify had, how many had every word", async () => {
  const s = shopify({ answers: [res(200, catalogAnswer([product(1, "Panther shirt"), product(2, "Lamp")])), res(200, catalogAnswer([product(3, "Ceramic dish")]))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic+panther");
  assert.deepEqual(r.body, { on: true, term: "ceramic panther", mode: "token", items: [], why: { raw: 3, words: 0, own: 0 } });   /* v212: + mode */
});

test("caps: a day per IP and catalog calls a day for the site; a refusal never reaches Shopify", async () => {
  const s = shopify({ answers: [res(200, catalogAnswer([product(1, "Ceramic panther")]))] });
  const ip = deps(s.f, { vCount: (name) => !/^shopcat:203/.test(name) });
  const r = await ask(ip.D, "term=ceramic+panther");
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "slow down");
  assert.ok(ip.counts["shopcat:203.0.113.9"], "counted under the IP key");
  const site = deps(s.f, { vCount: (name) => name !== "shopcat:all" });
  const r2 = await ask(site.D, "term=ceramic+panther");
  assert.equal(r2.status, 429);
  assert.equal(r2.body.error, "daily limit");
  assert.equal(s.calls.length, 0);
  assert.equal(SC.SHOPCAT_PER_IP, 200);
  assert.equal(SC.SHOPCAT_PER_DAY, 10000);
  /* the second (any condition) search counts against the site too, and is skipped once the site cap is spent */
  SC.shopcatReset();
  const s3 = shopify({ answers: [res(200, catalogAnswer([product(1, "Ceramic panther")])), res(200, catalogAnswer([]))] });
  const two = deps(s3.f, { vCount: (name, lim, n) => name !== "shopcat:all" || n <= 1 });
  const r3 = await ask(two.D, "term=ceramic+panther");
  assert.equal(r3.status, 200);
  assert.equal(r3.body.items.length, 1);
  assert.equal(s3.searches().length, 1);
  assert.equal(two.counts["shopcat:all"], 2);
});

test("Shopify's 429: answered 429 and Shopify is left alone for its Retry-After, in this isolate", async () => {
  const s = shopify({ answers: [res(429, {}, { "Retry-After": "12" }), res(200, catalogAnswer([product(1, "Ceramic panther")]))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic+panther");
  assert.equal(r.status, 429);
  assert.equal(r.body.error, "busy");
  const r2 = await ask(D, "term=ceramic+panther");
  assert.equal(r2.status, 429);
  assert.equal(s.searches().length, 1, "not asked again while it said wait");
  /* past the wait it is asked again */
  const late = new URL("https://prowl.example.workers.dev/shop-live?term=ceramic+panther");
  const r3 = await SC.shopLive(new Request(late), ENV, late, ORIGIN, D, Date.now() + 13000);
  assert.equal(r3.status, 200);
  assert.equal(r3.body.items.length, 1);
});

test("a stale token (401) is renewed once; a refused token exchange, a 500, an error answer and a timeout are 502 with no items", async () => {
  const s = shopify({ token: (n) => ({ access_token: "tok-" + n, expires_in: 3600 }), answers: [res(401, {}), res(200, catalogAnswer([product(1, "Ceramic panther")])), res(200, catalogAnswer([]))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic+panther");
  assert.equal(r.status, 200);
  assert.equal(s.tokens().length, 2);
  assert.equal(s.searches()[1].init.headers.Authorization, "Bearer tok-2");
  /* v212: a refused token exchange searches keyless */
  SC.shopcatReset();
  const quietErr = console.error; console.error = () => {};
  try {
    const kr = shopify({ tokenStatus: 401, token: { error: "invalid_client" }, answers: [res(200, catalogAnswer([product(1, "Ceramic panther")]))] });
    const kx = await ask(deps(kr.f).D, "term=ceramic+panther&max=1");
    assert.equal(kx.status, 200); assert.equal(kx.body.mode, "keyless"); assert.equal(kr.searches()[0].init.headers.Authorization, undefined);
  } finally { console.error = quietErr; }
  for (const [label, sh] of [
    ["catalog 500", shopify({ answers: [res(500, {})] })],
    ["JSON-RPC error", shopify({ answers: [res(200, { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } })] })],
    ["tool error", shopify({ answers: [res(200, { jsonrpc: "2.0", id: 1, result: { isError: true, content: [] } })] })],
  ]) {
    SC.shopcatReset();
    const x = await ask(deps(sh.f).D, "term=ceramic+panther");
    assert.equal(x.status, 502, label);
    assert.deepEqual(x.body.items, [], label);
    assert.equal(x.body.on, true, label);
  }
  /* a timeout: the call is aborted after SHOPCAT_TIMEOUT_MS */
  SC.shopcatReset();
  let signal = null;
  const hang = shopify({ answers: [(init) => { signal = init.signal; return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))); }] });
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => realSet(fn, ms === SC.SHOPCAT_TIMEOUT_MS ? 5 : ms);
  try {
    const x = await ask(deps(hang.f).D, "term=ceramic+panther");
    assert.equal(x.status, 502);
    assert.equal(x.body.error, "timeout");
    assert.ok(signal && signal.aborted);
  } finally { globalThis.setTimeout = realSet; }
});

test("the term: required, cut at a whole word, no markup; max between 1 and 12", async () => {
  const s = shopify({ answers: [res(200, catalogAnswer([]))] }), { D } = deps(s.f);
  assert.equal((await ask(D, "term=")).status, 400);
  assert.equal((await ask(D, "term=%20a%20")).status, 400);
  assert.equal(s.calls.length, 0);
  assert.equal(SC.shopcatTerm('  <b>"ceramic"</b>   panther '), "b ceramic /b panther");
  const long = SC.shopcatTerm("word ".repeat(30));
  assert.ok(long.length <= 80 && !/\s$/.test(long) && /word$/.test(long), long);
  SC.shopcatReset();
  const many = Array.from({ length: 20 }, (_, i) => product(i + 1, "Ceramic panther " + i));
  const s2 = shopify({ answers: [res(200, catalogAnswer(many))] });
  assert.equal((await ask(deps(s2.f).D, "term=ceramic+panther&max=99")).body.items.length, 12);
});

test("the agent profile: catalog search and lookup, and the Global Catalog extension that extends them", () => {
  const p = SC.shopcatProfile().ucp, v = "2026-08-25";
  assert.equal(p.version, v);
  assert.equal(p.capabilities["dev.ucp.shopping.catalog.search"][0].version, v);
  assert.equal(p.capabilities["dev.ucp.shopping.catalog.lookup"][0].version, v);
  assert.deepEqual(p.capabilities["dev.shopify.catalog.global"][0].extends, ["dev.ucp.shopping.catalog.lookup", "dev.ucp.shopping.catalog.search"]);
  assert.equal(p.capabilities["dev.ucp.shopping.checkout"], undefined, "search only: no checkout");
});

test("index.js: the routes, the deps, the version; spend.js counts the catalog calls as shopcat at no fee", () => {
  assert.ok(Number((/const WORKER_VERSION = "v(\d+)";/.exec(INDEX) || [])[1]) >= 210, "v210 or later");
  assert.match(INDEX, /import \{ shopLive, shopcatProfile, SHOPCAT_PROFILE_PATH[^}]*\} from "\.\/shopcat\.js";/);
  assert.match(INDEX, /if \(url\.pathname === "\/shop-live"\) return shopLive\(request, env, url, origin, shopDeps\(\)\);/);
  assert.match(INDEX, /function shopDeps\(\) \{ return \{ vCount, ipKey, json, sgwExact \}; \}/);
  assert.ok(INDEX.indexOf('url.pathname === "/shop-live"') > INDEX.indexOf('return json({ error: "GET only" }, 405, origin);'), "GET only");
  const svc = SP.SPEND_SERVICES.find((x) => x.key === "shopcat");
  assert.ok(svc);
  assert.deepEqual(svc.price, { call: 0 });
  assert.match(svc.srcNote, /no published fee/);
  assert.equal(SP.paidKey("https://catalog.shopify.com/api/ucp/mcp"), "shopcat");
  assert.equal(SP.paidKey("https://api.shopify.com/auth/access_token"), "", "the token exchange is not a counted call");
  const SRC = readFileSync(new URL("../shopcat.js", import.meta.url), "utf8");
  /* v211: the one KV use is the exchange's outcome (SHOPCAT_LAST_KEY: time, status, Shopify's error code), never results or the token */
  assert.doesNotMatch(SRC.split("\n").filter((l) => !/SHOPCAT_LAST_KEY/.test(l)).join("\n"), /PROWL_ALERTS\.|kvPut|caches\.|PCACHE/, "no KV and no cache for results or the token");
});

/* ---------- review fixes ---------- */
test("review: the timeout covers the body read too (headers come, the body stalls)", async () => {
  let signal = null;
  const stall = shopify({ answers: [(init) => { signal = init.signal; return { status: 200, ok: true, headers: { get: () => null }, json: () => new Promise(() => {}) }; }] });
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => realSet(fn, ms > 1000 && ms <= SC.SHOPCAT_TIMEOUT_MS ? 5 : ms);
  try {
    const x = await ask(deps(stall.f).D, "term=ceramic+panther");
    assert.equal(x.status, 502);
    assert.equal(x.body.error, "timeout");
    assert.ok(signal && signal.aborted);
  } finally { globalThis.setTimeout = realSet; }
});

test("review: no fallback search once the request has run past SHOPCAT_SECOND_PASS_MS; the whole request has a deadline", async () => {
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  try {
    const s = shopify({ answers: [async () => { t += SC.SHOPCAT_SECOND_PASS_MS + 1; return res(200, catalogAnswer([product(1, "Ceramic panther")])); }, res(200, catalogAnswer([product(2, "Ceramic panther two")]))] });
    const r = await ask(deps(s.f).D, "term=ceramic+panther");
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 1);
    assert.equal(s.searches().length, 1, "short on time: the secondhand listings alone");
  } finally { Date.now = realNow; }
  assert.ok(SC.SHOPCAT_DEADLINE_MS <= 15000);
});

test("review: a failed token exchange is remembered for SHOPCAT_TOKEN_FAIL_MS: no POST per request meanwhile", async () => {
  const realErr = console.error; console.error = () => {};
  try {
    const s = shopify({ tokenStatus: 401, token: { error: "invalid_client" }, answers: [res(200, catalogAnswer([]))] }), { D } = deps(s.f);
    const a = await ask(D, "term=ceramic+panther");
    const b = await ask(D, "term=ceramic+panther");
    const c = await ask(D, "term=fire+king");
    /* v212: meanwhile it searches keyless (the mocked catalog answers nothing for these) */
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
    assert.deepEqual([a.body.mode, b.body.mode, c.body.mode], ["keyless", "keyless", "keyless"]);
    assert.equal(s.tokens().length, 2, "one exchange (v211: the JSON body, then once with HTTP Basic), then it waits");
    assert.ok(s.searches().length >= 3 && s.searches().every((q) => !q.init.headers.Authorization));
    assert.equal(SC.shopcatTokenDown(Date.now() + SC.SHOPCAT_TOKEN_FAIL_MS + 1000), false, "tried again after the wait");
  } finally { console.error = realErr; }
});

test("review: the same listing from both searches (different _gsid) shows once", async () => {
  const one = (g) => { const p = product(1, "Ceramic panther planter"); p.variants[0].url = "https://shopa.example/products/p?variant=1&_gsid=" + g; return p; };
  const s = shopify({ answers: [res(200, catalogAnswer([one("g1")])), res(200, catalogAnswer([one("g2"), product(2, "Ceramic panther lamp", { cond: ["new"] })]))] }), { D } = deps(s.f);
  const r = await ask(D, "term=ceramic+panther");
  assert.equal(s.searches().length, 2);
  assert.deepEqual(r.body.items.map((x) => x.url), ["https://shopa.example/products/p?variant=1&_gsid=g1", "https://shop2.example/products/p?variant=2&_gsid=x"]);
  assert.equal(JSON.stringify(r.body).indexOf('"key"'), -1, "the match key is not sent");
});

test("review: a cluster whose first offer is Owl & Twig's keeps the other stores' offers", () => {
  const p = product(1, "Ceramic panther", { url: "https://www.owlandtwigvintage.com/products/panther", sellerUrl: "https://www.owlandtwigvintage.com", domain: "tz7xkc-du.myshopify.com" });
  p.variants.push({ id: "gid://shopify/ProductVariant/77", url: "https://other.example/products/panther", price: { amount: 7000, currency: "USD" }, availability: { available: true },
    condition: ["secondhand"], source: "shopify", seller: { name: "Other Store", url: "https://other.example", domain: "other.myshopify.com" } });
  const c = SC.shopcatItem(p, {});
  assert.equal(c.own, undefined);
  assert.equal(c.shop, "Other Store");
  assert.equal(c.url, "https://other.example/products/panther");
  p.variants.pop();
  assert.deepEqual(SC.shopcatItem(p, {}), { own: true }, "Owl & Twig's alone: hidden");
});
