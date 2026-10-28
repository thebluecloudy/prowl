/* v98: alert emails send exact matches only (alExact, the page's v6.72 rule), and POST /share/email brings back page
   v5.99's "Email this". The share limits run on the real counters (vCount over the real Caps Durable Object code,
   in memory), the way ai-caps.test.mjs runs the AI limits.
   Run: node --test worker/__tests__/share-exact.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}

/* ---------- exact matches in alerts ---------- */
const EX = new Function(indexFn("alExWords") + "\n" + indexFn("alExact") + "\nreturn { alExWords, alExact };")();
const T = (a) => a.map((x) => x.title);

test("an alert keeps only the listings whose title holds every word of the hunt", () => {
  const items = ["Jay King Jadeite Ring", "Fire-King Jadeite Restaurant Mug", "FIRE KING jadeite bowls", "Fire King Peach Lustre"].map((title) => ({ title }));
  assert.deepEqual(T(EX.alExact(items, "fire king jadeite")), ["Fire-King Jadeite Restaurant Mug", "FIRE KING jadeite bowls"]);
});

test("a hunt with no exact listing sends all of them, as before", () => {
  const items = ["Jay King Jadeite Ring", "Jadeite pendant"].map((title) => ({ title }));
  assert.deepEqual(T(EX.alExact(items, "fire king jadeite")), T(items));
  assert.deepEqual(EX.alExact([], "pyrex"), []);
  assert.deepEqual(T(EX.alExact(items, "  ")), T(items), "no words: nothing is filtered");
});

test("the worker's words match the page's (plurals, apostrophes, punctuation, whole words)", () => {
  const PAGE = readFileSync(new URL("../../page/prowl.html", import.meta.url), "utf8");
  const pageWords = new Function(/^function exWords\(v\)\{.*\}$/m.exec(PAGE)[0] + "\nreturn exWords;")();
  for (const s of ["Pyrex Bowls", "Pfaltzgraff’s Yorktowne", "1/2 pint creamer", "Fire-King jade-ite", "Hullabaloo", "dishes", "glass", "Noritake 日本"]) {
    assert.deepEqual(EX.alExWords(s), pageWords(s), JSON.stringify(s));
  }
  const ex = (t, title) => EX.alExact([{ title }, { title: "zzz" }], t).length === 1;
  assert.ok(ex("pyrex bowl", "PYREX mixing bowls, set of 4"));
  for (const [a, b] of [["fenton vase", "Pair of Fenton Vases"], ["plate", "Dinner plates"], ["glass", "Amber glasses"], ["dresses", "1950s dress"]]) assert.ok(ex(a, b), a + " / " + b);
  assert.ok(ex("pfaltzgraff's yorktowne", "Pfaltzgraff’s Yorktowne plate"));
  assert.ok(!ex("hull", "Hullabaloo poster"), "whole words only");
});

/* alCheck run for real, with alHunt stubbed: what goes in the email (pend) and what is remembered (seen) */
function checkWorld(days) {
  const kv = new Map(), day = { n: 0 };
  const deps = {
    alHunt: async () => days[day.n].map((title, i) => ({ title, url: "https://www.ebay.com/itm/" + title.replace(/\W+/g, "-") })),
    alActive: () => ["fire king jadeite"], alPrefs: () => ({ freq: "daily" }), alMerge: async () => {},
    kvGet: async (env, k, d) => (kv.has(k) ? JSON.parse(kv.get(k)) : d), kvPut: async (env, k, v) => { kv.set(k, JSON.stringify(v)); },
    AL_PEND_CAP: 30, AL_SEEN_CAP: 6000,
  };
  const keys = Object.keys(deps);
  const f = new Function(...keys, [indexFn("alWords"), indexFn("alTitleKey"), indexFn("alExWords"), indexFn("alExact"), indexFn("alPendAdd"), indexFn("alPendCap"), indexFn("alCheck")].join("\n") + "\nreturn alCheck;")(...keys.map((k) => deps[k]));
  kv.set("sub:me@x.com", JSON.stringify({ email: "me@x.com" }));
  return { kv, day, run: async () => { const sub = { email: "me@x.com", day: "d" + day.n, done: [] }; await f({}, sub, 5, { day: "d" + day.n }); kv.set("pend:me@x.com", JSON.stringify(JSON.parse(kv.get("pend:me@x.com") || "{}"))); } };
}
test("alerts keep the exact matches, and remember the close ones so they never go out later as new", async () => {
  const W = checkWorld([["Fire-King Jadeite Mug", "Jay King Jadeite Ring", "Jay King Jadeite Pendant"], ["Jay King Jadeite Ring", "Jay King Jadeite Pendant", "Jadeite Bead Necklace"]]);
  await W.run();
  const pend = () => (JSON.parse(W.kv.get("pend:me@x.com"))["fire king jadeite"] || []).map((x) => x.title);
  assert.deepEqual(pend(), ["Fire-King Jadeite Mug"], "day 1: the exact one only");
  W.kv.set("pend:me@x.com", "{}");   /* the email went out */
  W.day.n = 1;   /* day 2: the mug is gone, nothing is exact, so the hunt falls back to everything */
  await W.run();
  assert.deepEqual(pend(), ["Jadeite Bead Necklace"], "only the listing never seen before, not the rings from day 1");
});

/* ---------- Email this ---------- */
const capsSrc = (() => { const m = /^export class Caps \{/m.exec(INDEX); return INDEX.slice(m.index + "export ".length, INDEX.indexOf("\n}\n", m.index) + 2); })();
const Caps = new Function("metricsOp", "metricsPrune", capsSrc + "\nreturn Caps;")(() => ({}), () => {});
function load() {
  const objs = new Map(), sent = [];
  const storage = () => { const m = new Map(); let alarm = null; return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, list: async () => new Map(m) }; };
  const capsCall = async (name, op, b) => { let o = objs.get(name); if (!o) objs.set(name, (o = new Caps({ storage: storage() }))); return JSON.parse(await (await o.op(op, b)).text()); };
  const deps = {
    console: { error() {}, log() {} },
    json: (body, status) => ({ status: status || 200, body }),
    readJson: async (r) => r.body,
    caches: { default: { match: async () => null, put: async () => {} } },
    capsCall,
    Request: class { constructor(u) { this.url = u; } },
    Response: class { constructor(b) { this.b = b; } async text() { return this.b; } },
    fetch: async (u, o) => { sent.push({ u, body: JSON.parse(o.body) }); return { status: 200, text: async () => "{}" }; },
    AbortController, setTimeout, clearTimeout,
    PROWL_PAGE: "https://www.owlandtwigvintage.com/pages/prowl", AL_UNSUB_MAIL: "hello@owlandtwigvintage.com", G_ENV: null,
    WORKER_BASE: "https://prowl.thebluecloud.workers.dev", crypto, TextEncoder,
    alGate: (title, msg) => ({ status: 200, gate: title, msg }), alPage: (title, msg) => ({ status: 200, page: title, msg }), alBadLink: () => ({ status: 400, bad: true }),
  };
  const consts = INDEX.match(/^const SHARE_[A-Z_]+ = .*$/m)[0] + "\n" + INDEX.match(/^const GIFT_KEY_RE = .*$/m)[0];
  /* v179: the stop link and the do-not-email mark */
  const names = ["ip6Parts", "ipKey", "ipNet", "isOwner", "capsDay", "ctrName", "vCount", "alEmail", "alEsc", "sha16", "alSend", "shareLinks", "kvGet", "kvPut", "pxHmac", "giftKey", "giftSig", "alSame", "alAddr", "shareNoKey", "shareStopUrl", "shareStop", "shareEmail"];
  const keys = Object.keys(deps);
  const f = new Function(...keys, consts + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, sent };
}
const kvMap = new Map();
const ENV = { RESEND_API_KEY: "re_test", ALERT_ADDRESS: "Owl & Twig Vintage · 6311 Haggerty Rd, Unit #699 · West Bloomfield, MI 48322",
  PROWL_ALERTS: { get: async (k, t) => (kvMap.has(k) ? (t === "json" ? JSON.parse(kvMap.get(k)) : kvMap.get(k)) : null), put: async (k, v) => { kvMap.set(k, v); }, delete: async (k) => { kvMap.delete(k); } } };
const PNG = "data:image/png;base64," + Buffer.from("fake png bytes").toString("base64");
const req = (body, ip = "203.0.113.7", hdr = {}) => ({ body, headers: { get: (h) => (h === "CF-Connecting-IP" ? ip : hdr[h] || null) } });
let nTo = 0;
const good = (o = {}) => ({ to: "friend" + (++nTo) + "@example.com", from: "me@example.com", item: "Black panther TV lamp", text: "Black panther TV lamp, fair price $40-60.\nChecked with Prowl: https://www.owlandtwigvintage.com/pages/prowl?utm_source=share", card: PNG, ...o });

test("Email this sends the notes and the photo card through Resend", async () => {
  const L = load();
  const r = await L.shareEmail(req(good({ to: "friend@example.com" })), ENV, "o");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(L.sent.length, 1);
  const b = L.sent[0].body;
  assert.deepEqual(b.to, ["friend@example.com"]);
  assert.equal(b.subject, "A find from Prowl: Black panther TV lamp");
  assert.deepEqual(b.attachments, [{ filename: "prowl-find.png", content: Buffer.from("fake png bytes").toString("base64") }]);
  assert.match(b.html, /Someone using Prowl sent you this find\./);
  assert.ok(!/me@example\.com/.test(b.html + b.text), "the address the visitor typed as theirs is never shown: nothing proves it");
  assert.match(b.text, /Stop emails from Prowl to this address: https:\/\/prowl\.thebluecloud\.workers\.dev\/alerts\/sharestop\?e=friend%40example\.com&s=[0-9a-f]{64}/);
  assert.match(b.html, /<a href="https:\/\/prowl\.thebluecloud\.workers\.dev\/alerts\/sharestop\?e=friend%40example\.com&amp;s=[0-9a-f]{64}"[^>]*>Stop emails from Prowl to this address<\/a>/);
  for (const part of [b.html, b.text]) assert.match(part, /6311 Haggerty Rd, Unit #699 · West Bloomfield, MI 48322/, "the postal address (CAN-SPAM)");
  assert.match(b.html, /<a href="https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl\?utm_source=share"/, "an Owl & Twig link is a link");
  assert.equal(b.reply_to, "hello@owlandtwigvintage.com", "the sender's address is never the Reply-To");
  assert.ok(!/me@example\.com/.test(b.from));
  assert.match(b.headers["List-Unsubscribe"], /^<https:\/\/prowl\.thebluecloud\.workers\.dev\/alerts\/sharestop\?e=friend%40example\.com&s=[0-9a-f]{64}>, <mailto:hello@owlandtwigvintage\.com\?subject=unsubscribe>$/, "v179: one-click stop");
  assert.equal(b.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("Email this is text only: markup is escaped and every outside web address is taken out (mail apps link bare ones)", async () => {
  const L = load();
  await L.shareEmail(req(good({ text: 'Look <img src=x onerror=alert(1)> https://evil.example/win, www.bad.co/x and evil.example/login and "quotes". Sold at $40.00, St. Louis. https://www.owlandtwigvintage.com/pages/prowl', item: "<b>x</b> see evil.example" })), ENV, "o");
  const b = L.sent[0].body;
  assert.ok(!/<img/.test(b.html) && /&lt;img src=x/.test(b.html));
  for (const part of [b.html, b.text, b.subject]) assert.ok(!/evil\.example|bad\.co/.test(part), "no outside address anywhere: " + part.slice(0, 80));
  assert.equal((b.text.match(/\[link removed\]/g) || []).length, 3);
  assert.match(b.text, /Sold at \$40\.00, St\. Louis\./, "prices and abbreviations are not addresses");
  assert.match(b.html, /<a href="https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl"/, "Owl & Twig's own link stays a link");
  assert.equal(b.subject, "A find from Prowl: <b>x</b> see [link removed]", "the subject is plain text (Resend does not render it)");
});

test("Email this refuses a bad address, an empty note, and drops a card that is not a small PNG", async () => {
  const L = load();
  assert.equal((await L.shareEmail(req(good({ to: "not an email" })), ENV, "o")).status, 400);
  assert.equal((await L.shareEmail(req(good({ to: "a@b.c, d@e.com" })), ENV, "o")).status, 400, "one address only");
  assert.equal((await L.shareEmail(req(good({ text: "   " })), ENV, "o")).status, 400);
  assert.equal(L.sent.length, 0);
  await L.shareEmail(req(good({ card: "data:image/svg+xml;base64,PHN2Zz4=" })), ENV, "o");
  assert.equal(L.sent[0].body.attachments, undefined, "not a PNG: sent without the card");
  await L.shareEmail(req(good({ card: "data:image/png;base64," + "A".repeat(2200000) })), ENV, "o");
  assert.equal(L.sent[1].body.attachments, undefined, "over 1.5MB: sent without the card");
  await L.shareEmail(req(good({ text: "x".repeat(9000) })), ENV, "o");
  assert.equal((L.sent[2].body.text.match(/x+/) || [""])[0].length, 4000, "the notes are cut to 4000");
});

test("Email this: 2 a day to any one address, whoever sends them", async () => {
  const L = load();
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await L.shareEmail(req(good({ to: "Victim@Example.com" }), "192.0.2." + (10 + i * 50)), ENV, "o")).status);
  assert.deepEqual(codes, [200, 200, 429]);
});

test("Email this: 6 a day per visitor, 12 per neighbourhood; the owner is not counted", async () => {
  const L = load();
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await L.shareEmail(req(good(), "198.51.100.5"), ENV, "o")).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429]);
  const net = [];
  for (let i = 0; i < 8; i++) net.push((await L.shareEmail(req(good(), "198.51.100." + (20 + i)), ENV, "o")).status);
  assert.deepEqual(net, [200, 200, 200, 200, 200, 200, 429, 429], "the /24 had 6 already: 6 more, then no");
  const OWN = { ...ENV, OWNER_KEY: "owner-key-0123456789" };
  for (let i = 0; i < 3; i++) assert.equal((await L.shareEmail(req(good(), "198.51.100.5", { "X-Prowl-Owner": "owner-key-0123456789" }), OWN, "o")).status, 200);
});

test("the route is wired: POST /share/email", () => {
  assert.match(INDEX, /url\.pathname === "\/share\/email" && request\.method === "POST"\) \{[^}]*return shareEmail\(request, env, origin\);/);
});

/* ---------- v99: the garage-sale finders, for the admin area's button ---------- */
test("salesProbe asks exactly the four fixed garage-sale addresses (v101: gsalr is out) and says which a Worker can read", async () => {
  const asked = [];
  const pages = {
    "https://detroit.craigslist.org/search/gms": [200, "<html>" + "x".repeat(5000) + "</html>"],
    "https://www.yardsalesearch.com/": [403, "<title>Just a moment...</title>"],
    "https://detroit.craigslist.org/search/gms?format=rss": [200, "tiny"],
  };
  const deps = {
    fetch: async (u) => { asked.push(u); if (u.includes("estatesales")) throw new Error("boom"); const p = pages[u] || [200, "y".repeat(3000)]; return { status: p[0], text: async () => p[1] }; },
    AbortController, setTimeout, clearTimeout, PROBE_UA: "UA",
  };
  const keys = Object.keys(deps);
  const consts = INDEX.match(/^const SALES_PROBES = .*$/m)[0];
  const f = new Function(...keys, consts + "\n" + indexFn("buildCandidates") + "\n" + indexFn("salesProbe") + "\nreturn salesProbe;")(...keys.map((k) => deps[k]));
  const r = await f();
  assert.deepEqual(asked.sort(), ["https://detroit.craigslist.org/search/gms", "https://detroit.craigslist.org/search/gms?format=rss", "https://www.estatesales.net/MI/Novi", "https://www.yardsalesearch.com/"]);
  const by = Object.fromEntries(r.map((x) => [x.name, x]));
  assert.equal(by["craigslist-gms"].readable, true);
  assert.equal(by.yardsalesearch.wall, true); assert.equal(by.yardsalesearch.readable, false);
  assert.equal(by["craigslist-gms-rss"].readable, false, "an almost empty page is not readable");
  assert.equal(by.gsalr, undefined, "v101: never gsalr");
  assert.equal(by["estatesales-city"].status, 0); assert.equal(by["estatesales-city"].err, "boom");
});

/* ---------- v102: what a sale-finder page carries ---------- */
const SHAPE = new Function(indexFn("salesShape") + "\nreturn salesShape;")();
test("salesShape finds the list of sales in a Next.js data block: its path, size, fields and first entry", () => {
  const sales = [1, 2, 3].map((i) => ({ id: 100 + i, name: "Estate sale " + i, latitude: [0, 42.49, 42.5, 42.51][i], longitude: -83.47, firstStartAt: "2026-10-1" + i, cityName: "Novi", photos: [{}, {}] }));
  const html = `<html><head><script type="application/ld+json">{"@type":"Organization","name":"x"}</script></head><body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { menu: [{ a: 1 }, { a: 2 }], sales } } })}</script></body></html>`;
  const s = SHAPE(html);
  assert.equal(s.next, true);
  assert.deepEqual(s.ldTypes, ["Organization"]);
  assert.equal(s.best.path, "block1.props.pageProps.sales");
  assert.equal(s.best.count, 3);
  assert.deepEqual(s.best.fields, ["id", "name", "latitude", "longitude", "firstStartAt", "cityName", "photos"]);
  assert.equal(s.best.first.latitude, "42.49");
  assert.equal(s.best.first.photos, "[2]", "nested values are summarised, not copied");
});
test("salesShape reads other layouts too (a state block, schema.org events) and never throws on junk", () => {
  const ev = [1, 2].map((i) => ({ "@type": "Event", name: "Sale " + i, startDate: "2026-10-1" + i, location: { address: "x" } }));
  const s = SHAPE(`<script>window.__INITIAL_STATE__ = ${JSON.stringify({ list: { items: ev } })};</script><script type="application/json">{broken</script>`);
  assert.equal(s.initialState, true);
  assert.equal(s.best.path, "block0.list.items");
  assert.equal(s.best.first.location, "{address}");
  const none = SHAPE("<html>nothing here</html>");
  assert.equal(none.best, null); assert.equal(none.blocks, 0);
  assert.equal(SHAPE(null).best, null);
});

test("v179: the stop link (or a mail app's one-click unsubscribe) stops every later Email this to that address, and keeps no address", async () => {
  const L = load();
  const to = "stopme@example.com";
  await L.shareEmail(req(good({ to })), ENV, "o");
  const link = new URL(/<(https:[^>]+)>/.exec(L.sent[0].body.headers["List-Unsubscribe"])[1]);
  const get = await L.shareStop({ method: "GET" }, ENV, link);
  assert.equal(get.gate, "Stop emails from Prowl", "a GET (a link scanner) only shows the button");
  assert.equal((await L.shareEmail(req(good({ to })), ENV, "o")).status, 200, "nothing stopped yet");
  const post = await L.shareStop({ method: "POST" }, ENV, link);
  assert.equal(post.page, "Done");
  const before = L.sent.length;
  const r = await L.shareEmail(req(good({ to })), ENV, "o");
  assert.equal(r.status, 403);
  assert.match(r.body.error, /asked not to get emails from Prowl/);
  assert.equal(L.sent.length, before, "nothing went out");
  assert.equal((await L.shareEmail(req(good({ to: "someone-else@example.com" })), ENV, "o")).status, 200, "other addresses still work");
  for (const [k, v] of kvMap) assert.ok(!/stopme/.test(k + v), "no address in KV: " + k);
  const forged = new URL(link); forged.searchParams.set("e", "victim@example.com");
  assert.equal((await L.shareStop({ method: "POST" }, ENV, forged)).bad, true, "the signature is tied to the address");
});

test("v179: the stop route is wired before the cross-site POST block, so a mail app's one-click POST reaches it", () => {
  const route = INDEX.indexOf('if (url.pathname === "/alerts/sharestop") return shareStop(request, env, url);');
  assert.ok(route > 0);
  assert.ok(route < INDEX.indexOf('if (url.pathname === "/share/email"'), "before the POST routes");
  assert.ok(Math.abs(route - INDEX.indexOf('if (url.pathname === "/alerts/giftstop")')) < 200, "next to the gift stop, which takes one-click POSTs");
});
