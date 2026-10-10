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
  assert.ok(ex("pfaltzgraff's yorktowne", "Pfaltzgraff’s Yorktowne plate"));
  assert.ok(!ex("hull", "Hullabaloo poster"), "whole words only");
});

test("alHunt filters before it returns, so alCheck's seen-store and the email only see the exact ones", () => {
  const body = indexFn("alHunt");
  assert.match(body, /return alExact\(out, term\);\s*\/\*[^*]*\*\/\s*\}$/, "the last thing alHunt does");
  const check = indexFn("alCheck");
  assert.match(check, /alHunt\(env, h, sub\)/, "alerts get their listings from alHunt");
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
    PROWL_PAGE: "https://www.owlandtwigvintage.com/pages/prowl", AL_UNSUB_MAIL: "hello@owlandtwigvintage.com",
  };
  const consts = INDEX.match(/^const SHARE_[A-Z_]+ = .*$/m)[0];
  const names = ["ip6Parts", "ipKey", "ipNet", "isOwner", "capsDay", "ctrName", "vCount", "alEmail", "alEsc", "alSend", "shareEmail"];
  const keys = Object.keys(deps);
  const f = new Function(...keys, consts + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, sent };
}
const ENV = { RESEND_API_KEY: "re_test" };
const PNG = "data:image/png;base64," + Buffer.from("fake png bytes").toString("base64");
const req = (body, ip = "203.0.113.7", hdr = {}) => ({ body, headers: { get: (h) => (h === "CF-Connecting-IP" ? ip : hdr[h] || null) } });
const good = (o = {}) => ({ to: "friend@example.com", from: "me@example.com", item: "Black panther TV lamp", text: "Black panther TV lamp, fair price $40-60.\nChecked with Prowl: https://www.owlandtwigvintage.com/pages/prowl?utm_source=share", card: PNG, ...o });

test("Email this sends the notes and the photo card through Resend", async () => {
  const L = load();
  const r = await L.shareEmail(req(good()), ENV, "o");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(L.sent.length, 1);
  const b = L.sent[0].body;
  assert.deepEqual(b.to, ["friend@example.com"]);
  assert.equal(b.subject, "A find from Prowl: Black panther TV lamp");
  assert.deepEqual(b.attachments, [{ filename: "prowl-find.png", content: Buffer.from("fake png bytes").toString("base64") }]);
  assert.match(b.html, /Sent from Prowl by me@example\.com\./);
  assert.match(b.html, /<a href="https:\/\/www\.owlandtwigvintage\.com\/pages\/prowl\?utm_source=share"/, "an Owl & Twig link is a link");
  assert.equal(b.reply_to, "hello@owlandtwigvintage.com", "the sender's address is never the Reply-To");
  assert.ok(!/me@example\.com/.test(b.from));
  assert.equal(b.headers, undefined, "no unsubscribe headers on a one-off");
});

test("Email this is text only: markup is escaped and only Owl & Twig links become links", async () => {
  const L = load();
  await L.shareEmail(req(good({ text: 'Look <img src=x onerror=alert(1)> https://evil.example/win and "quotes"', item: "<b>x</b>" })), ENV, "o");
  const b = L.sent[0].body;
  assert.ok(!/<img/.test(b.html) && /&lt;img src=x/.test(b.html));
  assert.ok(!/href="https:\/\/evil/.test(b.html), "an outside address stays plain text");
  assert.match(b.html, /https:\/\/evil\.example\/win/);
  assert.equal(b.subject, "A find from Prowl: <b>x</b>", "the subject is plain text (Resend does not render it)");
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
  assert.ok(L.sent[2].body.text.length < 4200, "the notes are cut to 4000");
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
