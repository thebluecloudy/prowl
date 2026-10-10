/* v83 privacy: one purge list, unsubscribe clears held and seen listings, mailto List-Unsubscribe, reply line in footers.
   Run: node --test worker/__tests__/privacy.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
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
const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
const logs = [];
const quiet = { log: (...a) => logs.push(a.join(" ")), error() {} };
const json = (body, status) => ({ status: status || 200, body });
const P = fromIndex(["alPurge", "alMerge", "alEmail", "alSame", "vClean", "alParams", "alUnsub", "alDelete"], {
  kvGet, kvPut, console: quiet, json, ALLOW_ORIGINS: ["https://www.owlandtwigvintage.com"],
  alReady: (env) => !!env.PROWL_ALERTS,
  readJson: async (r) => r.body || {},
  alPage: (title, msg, status) => ({ page: title, msg, status: status || 200 }),
  alGate: (title) => ({ gate: title }),
});

const EMAIL = "jane@example.com", CID = "7712345678901";
function seeded() {
  const kv = new FakeKV();
  const sub = { email: EMAIL, tok: "T".repeat(24), utok: "U".repeat(24), hunts: ["Hull pottery", "Pyrex"], cid: CID, mail: "on", pro: true };
  kv.set("sub:" + EMAIL, sub);
  for (const p of ["pend:", "seen:", "mvf:", "in:", "conf:", "pro:", "last:", "likes:", "pj:", "gm:"]) kv.set(p + EMAIL, { x: 1 });
  kv.set("cid:" + CID, { email: EMAIL });
  kv.set("pro:cid:" + CID, { pro: true, at: 1 });
  kv.set("gift:abc123", { until: "2027-01-01" });
  kv.set("giftoff:abc123", { at: 1 });
  kv.set("giftnomail:abc123", { at: 1 });
  kv.set("sub:other@example.com", { email: "other@example.com", hunts: [] });
  kv.set("seen:other@example.com", { x: 1 });
  return { env: { PROWL_ALERTS: kv }, kv, sub };
}
const post = (body) => ({ method: "POST", body, headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) } });
const UNSUB = new URL("https://prowl.example/alerts/unsub");

test("alPurge removes every key for the member, keeps gifts and other members, logs key names only", async () => {
  const { env, kv, sub } = seeded();
  logs.length = 0;
  const gone = await P.alPurge(env, EMAIL, sub);
  for (const k of kv.m.keys()) assert.ok(!k.includes(EMAIL), "left behind: " + k);
  assert.equal(kv.m.has("cid:" + CID), false);
  assert.equal(kv.m.has("pro:cid:" + CID), false);
  for (const k of ["gift:abc123", "giftoff:abc123", "giftnomail:abc123", "sub:other@example.com", "seen:other@example.com"]) assert.ok(kv.m.has(k), k);
  assert.deepEqual(gone, ["sub:", "pend:", "seen:", "mvf:", "in:", "conf:", "pro:", "last:", "likes:", "pj:", "gm:", "cid:", "pro:cid:"]);
  assert.ok(logs.length && logs.every((l) => !l.includes(EMAIL) && !l.includes(CID)), "no email or id in the log");
});

test("alPurge keeps a cid link that now points at someone else", async () => {
  const { env, kv, sub } = seeded();
  kv.set("cid:" + CID, { email: "other@example.com" });
  await P.alPurge(env, EMAIL, sub);
  assert.deepEqual(JSON.parse(kv.m.get("cid:" + CID)), { email: "other@example.com" });
});

test("Delete in Prowl leaves no key for the email; a wrong token changes nothing", async () => {
  let { env, kv } = seeded();
  const bad = await P.alDelete(post({ email: EMAIL, tok: "nope" }), env, "");
  assert.equal(bad.status, 404);
  assert.ok(kv.m.has("sub:" + EMAIL));
  const ok = await P.alDelete(post({ email: EMAIL, tok: "T".repeat(24) }), env, "");
  assert.equal(ok.status, 200); assert.equal(ok.body.wasPro, true);
  for (const k of kv.m.keys()) assert.ok(!k.includes(EMAIL), "left behind: " + k);
  assert.ok(kv.m.has("gift:abc123") && kv.m.has("giftnomail:abc123"));
});

test("unsubscribe (all emails) turns mail off, keeps the member, clears held and seen listings", async () => {
  const { env, kv } = seeded();
  const r = await P.alUnsub(post({ email: EMAIL, tok: "U".repeat(24) }), env, UNSUB, "https://www.owlandtwigvintage.com");
  assert.equal(r.status, 200); assert.equal(r.body.mail, "off");
  const sub = JSON.parse(kv.m.get("sub:" + EMAIL));
  assert.equal(sub.mail, "off"); assert.deepEqual(sub.hunts, ["Hull pottery", "Pyrex"]); assert.equal(sub.pro, true);
  assert.equal(kv.m.has("pend:" + EMAIL), false);
  assert.equal(kv.m.has("seen:" + EMAIL), false);
  assert.ok(kv.m.has("cid:" + CID), "sign-in stays");
  assert.ok(kv.m.has("giftnomail:abc123"));
});

test("unsubscribe from one hunt keeps everything else", async () => {
  const { env, kv } = seeded();
  const r = await P.alUnsub(post({ email: EMAIL, tok: "U".repeat(24), h: "pyrex" }), env, UNSUB, "https://www.owlandtwigvintage.com");
  assert.equal(r.body.hunts, 1);
  assert.deepEqual(JSON.parse(kv.m.get("sub:" + EMAIL)).hunts, ["Hull pottery"]);
  assert.ok(kv.m.has("seen:" + EMAIL) && kv.m.has("pend:" + EMAIL));
});

test("a GET unsubscribe link only asks; it changes nothing", async () => {
  const { env, kv } = seeded();
  const u = new URL(UNSUB); u.searchParams.set("e", EMAIL); u.searchParams.set("t", "U".repeat(24));
  const r = await P.alUnsub({ method: "GET", headers: { get: () => null } }, env, u, "");
  assert.ok(r.gate);
  assert.equal(JSON.parse(kv.m.get("sub:" + EMAIL)).mail, "on");
  assert.ok(kv.m.has("seen:" + EMAIL));
});

/* v93: what a mail client's one-click button really sends (RFC 8058): a form POST, List-Unsubscribe=One-Click in the body,
   e and t in the link itself. Any 2xx reads as done, so an old token must not answer 200. */
const oneClick = (t) => {
  const u = new URL(UNSUB); u.searchParams.set("e", EMAIL); u.searchParams.set("t", t);
  return [{ method: "POST", body: "List-Unsubscribe=One-Click", headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/x-www-form-urlencoded" : null) } }, u];
};
test("v93: a one-click unsubscribe turns emails off; one with an old token answers 400 and changes nothing", async () => {
  let { env, kv } = seeded();
  const [req, u] = oneClick("U".repeat(24));
  const r = await P.alUnsub(req, env, u, "");
  assert.equal(r.page, "Prowl emails are off");
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(kv.m.get("sub:" + EMAIL)).mail, "off");
  ({ env, kv } = seeded());
  const [req2, u2] = oneClick("an-old-token-from-before");
  const bad = await P.alUnsub(req2, env, u2, "");
  assert.equal(bad.page, "This link is out of date");
  assert.equal(bad.status, 400, "a one-click client reads 2xx as done");
  assert.equal(JSON.parse(kv.m.get("sub:" + EMAIL)).mail, "on");
  /* the same old link opened in a browser (GET) still answers 200 with the page */
  const g = new URL(u2);
  const page = await P.alUnsub({ method: "GET", headers: { get: () => null } }, env, g, "");
  assert.equal(page.status, 200);
});

test("v93: a purge also removes a pending address change and earlier addresses' forwarding records", async () => {
  const { env, kv, sub } = seeded();
  sub.prev = ["old@example.com", "older@example.com"];
  kv.set("sub:" + EMAIL, sub);
  kv.set("mvf:" + EMAIL, { to: "new@example.com" });
  kv.set("mv:new@example.com", { code: "123456", from: EMAIL });
  kv.set("moved:old@example.com", { to: EMAIL, tok: "T".repeat(24), at: 1 });
  sub.prev.push("oldest@example.com");
  kv.set("sub:" + EMAIL, sub);
  kv.set("moved:oldest@example.com", { to: "old@example.com", tok: "S".repeat(24), at: 0 });   /* two changes ago: points at the next address, not the last */
  kv.set("moved:older@example.com", { to: "someone-else@example.com", tok: "x", at: 1 });   /* moved on to another member since */
  kv.set("mv:pending@example.com", { code: "1", from: "other@example.com" });
  for (const old of sub.prev) kv.set("pro:" + old, { pro: true, at: 1, plan: { order: "#1042", receipt: "https://store.example/r/key" } });
  await P.alPurge(env, EMAIL, sub);
  for (const [k, v] of kv.m) assert.ok(!k.includes(EMAIL) && !String(v).includes(EMAIL), "left behind: " + k + " = " + v);
  assert.equal(kv.m.has("moved:oldest@example.com"), false, "the chain from two changes ago goes too");
  for (const old of sub.prev) assert.equal(kv.m.has("pro:" + old), false, "the Pro cache of an earlier address: " + old);
  for (const [, v] of kv.m) assert.ok(!String(v).includes("old@example.com\""), "no earlier address left in a value");
  assert.ok(kv.m.has("moved:older@example.com"), "a record that now points at someone else stays");
  assert.ok(kv.m.has("mv:pending@example.com"), "another member's pending change stays");
});

test("every email with an unsubscribe link carries both List-Unsubscribe entries", async () => {
  const sent = [];
  const S = fromIndex(["alSend"], {
    fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return { status: 200, text: async () => "{}" }; },
    AbortController, setTimeout, clearTimeout,
  }, 'const AL_UNSUB_MAIL = "hello@owlandtwigvintage.com";');
  const env = { RESEND_API_KEY: "k" };
  await S.alSend(env, EMAIL, "s", "<p>h</p>", "t", "https://prowl.example/alerts/unsub?e=x&t=y");
  /* v93: the one-click link first: clients use the leftmost entry they support */
  assert.equal(sent[0].headers["List-Unsubscribe"], "<https://prowl.example/alerts/unsub?e=x&t=y>, <mailto:hello@owlandtwigvintage.com?subject=unsubscribe>");
  assert.equal(sent[0].reply_to, "hello@owlandtwigvintage.com", "v93: a reply reaches hello@ even with no ALERT_REPLY_TO");
  assert.equal(sent[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  await S.alSend(env, EMAIL, "s", "<p>h</p>", "t", "");
  assert.equal(sent[1].headers, undefined, "no unsubscribe link, no header");
  assert.match(INDEX, /^const AL_UNSUB_MAIL = "hello@owlandtwigvintage\.com";/m);
});

test("footers say a reply works too", () => {
  const F = fromIndex(["alShell", "alCopy", "alAddr", "alEsc", "alFootText"], {
    PROWL_PAGE: "https://p", alHomeUrl: () => "https://home", alUnsubUrl: () => "https://unsub",
    affNote: () => "Some links (eBay) earn Owl & Twig a small commission, at no cost to you.",
  });
  assert.match(F.alShell({}, "", "why", '<a href="u">Unsubscribe</a>'), /Or just reply &quot;unsubscribe&quot; to this email\./);
  assert.doesNotMatch(F.alShell({}, "", "why", ""), /reply/, "notices without an unsubscribe link do not say it");
  assert.match(F.alFootText({}, { email: EMAIL }), /Unsubscribe: https:\/\/unsub\nOr just reply "unsubscribe" to this email\./);
  assert.doesNotMatch(F.alFootText({}, null), /reply "unsubscribe"/);
  assert.match(INDEX, /links \? "Stop gift emails to this address: " \+ links\.stop : null, links \? 'Or just reply "unsubscribe" to this email\.' : null,/, "gift email text");
});

test("wired in: Delete in Prowl and the admin delete share alPurge", () => {
  assert.match(INDEX, /await alPurge\(env, email, sub\);   \/\* v83: the shared list \*\//);
  assert.match(INDEX, /alSendGift, alPurge,/, "handed to the admin");
  assert.match(ADMIN, /await H\.alPurge\(env, email, sub\);/);
  assert.doesNotMatch(ADMIN, /\["sub:", "pend:"/, "no second copy of the list");
  const v = /const WORKER_VERSION = "v(\d+)[a-z]?";/.exec(INDEX);
  assert.ok(v && Number(v[1]) >= 83, "v83 or later");
});

/* v93: one pending change of address per member. A second request (say, after a typo) retires the first link, so a
   purge, which follows mvf:, leaves nothing; and a confirm link that is not the member's current one is turned away. */
test("v93: a newer change-of-address request retires the older link; a purge then leaves no pending change", async () => {
  let n = 0;
  const M = fromIndex(["alEmail", "alSame", "alMask", "alMove", "alMoveConfirm", "alPurge"], {
    kvGet, kvPut, console: quiet, json, ALLOW_ORIGINS: ["o"], alReady: () => true, AL_MOVE_PER_EMAIL: 3,
    readJson: async (r) => r.body, alAllowed: () => true, vCount: async () => true, alToken: () => "code" + (++n),
    WORKER_BASE: "https://w", alShell: () => "", alEsc: (x) => x, alSend: async () => ({ ok: true }), alFootText: () => "",
    alPage: (title) => ({ page: title }), alGate: (title) => ({ gate: title }), alProSet: async () => {}, PROWL_PAGE: "https://p",
    Response: { redirect: (u) => ({ redirect: u }) },
  });
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, T = "T".repeat(24);
  kv.set("sub:" + EMAIL, { email: EMAIL, tok: T, hunts: [] });
  assert.equal((await M.alMove({ body: { email: EMAIL, to: "t1@example.com", tok: T } }, env, "o")).status, 200);
  assert.equal((await M.alMove({ body: { email: EMAIL, to: "t2@example.com", tok: T } }, env, "o")).status, 200);
  assert.equal(kv.m.has("mv:t1@example.com"), false, "the typo'd address's link is retired");
  assert.ok(kv.m.has("mv:t2@example.com"));
  /* a link that is not the current pending change is turned away, even with the right code */
  kv.set("mv:t1@example.com", { code: "code1", from: EMAIL });
  const stale = await M.alMoveConfirm({ method: "POST" }, env, new URL("https://w/alerts/move-confirm?e=t1%40example.com&c=code1"));
  assert.equal(stale.page, "Link expired");
  assert.ok(kv.m.has("sub:" + EMAIL), "nothing moved");
  kv.m.delete("mv:t1@example.com");
  await M.alPurge(env, EMAIL, JSON.parse(kv.m.get("sub:" + EMAIL)));
  for (const [k, v] of kv.m) assert.ok(!k.includes(EMAIL) && !String(v).includes(EMAIL), "left behind: " + k);
});

