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
  alPage: (title, msg) => ({ page: title, msg }),
  alGate: (title) => ({ gate: title }),
});

const EMAIL = "jane@example.com", CID = "7712345678901";
function seeded() {
  const kv = new FakeKV();
  const sub = { email: EMAIL, tok: "T".repeat(24), utok: "U".repeat(24), hunts: ["Hull pottery", "Pyrex"], cid: CID, mail: "on", pro: true };
  kv.set("sub:" + EMAIL, sub);
  for (const p of ["pend:", "seen:", "mvf:", "in:", "pro:", "last:", "likes:"]) kv.set(p + EMAIL, { x: 1 });
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
  assert.deepEqual(gone, ["sub:", "pend:", "seen:", "mvf:", "in:", "pro:", "last:", "likes:", "cid:", "pro:cid:"]);
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

test("every email with an unsubscribe link carries both List-Unsubscribe entries", async () => {
  const sent = [];
  const S = fromIndex(["alSend"], {
    fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return { status: 200, text: async () => "{}" }; },
    AbortController, setTimeout, clearTimeout,
  }, 'const AL_UNSUB_MAIL = "hello@owlandtwigvintage.com";');
  const env = { RESEND_API_KEY: "k" };
  await S.alSend(env, EMAIL, "s", "<p>h</p>", "t", "https://prowl.example/alerts/unsub?e=x&t=y");
  assert.equal(sent[0].headers["List-Unsubscribe"], "<mailto:hello@owlandtwigvintage.com?subject=unsubscribe>, <https://prowl.example/alerts/unsub?e=x&t=y>");
  assert.equal(sent[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  await S.alSend(env, EMAIL, "s", "<p>h</p>", "t", "");
  assert.equal(sent[1].headers, undefined, "no unsubscribe link, no header");
  assert.match(INDEX, /^const AL_UNSUB_MAIL = "hello@owlandtwigvintage\.com";/m);
});

test("footers say a reply works too", () => {
  const F = fromIndex(["alShell", "alCopy", "alAddr", "alEsc", "alFootText"], {
    PROWL_PAGE: "https://p", alHomeUrl: () => "https://home", alUnsubUrl: () => "https://unsub",
    AL_AFF_NOTE: "Some links (eBay, Depop) earn Owl & Twig a small commission, at no cost to you.",
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
  assert.match(INDEX, /const WORKER_VERSION = "v8\d";/);
});
