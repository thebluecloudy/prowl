/* v86: re-confirming keeps the member whole; confirm links go wherever the member is purged, signed out or moved;
   the unsubscribe page for a moved address never shows the new address to whoever holds the old one.
   Run: node --test "worker/__tests__/*.test.mjs" */
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
function fromIndex(names, deps = {}) {
  const keys = Object.keys(deps);
  return new Function(...keys, names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
}
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
const TODAY = "2026-10-08";
const pages = [];
const deps = {
  kvGet, kvPut, alReady: (env) => !!env.PROWL_ALERTS, alToken: () => "NEW-TOKEN", alSame: (a, b) => String(a || "") !== "" && String(a) === String(b),
  alEmail: (v) => String(v || "").trim().toLowerCase(), alHunts: (a) => a.map(String).filter((x, i, l) => x && l.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i),
  alProSet: async (env, sub) => { sub.proSetCalled = (sub.proSetCalled || 0) + 1; return !!sub.pro; },
  alNow: () => ({ day: TODAY, hour: 9, wday: 3 }), alLocal: (sub, now) => now, PROWL_PAGE: "https://shop.example/pages/prowl",
  alPage: (t, m) => { pages.push(["page", t, m]); return new Response(t + "|" + m); },
  alGate: (t, m, b) => { pages.push(["gate", t, m, b]); return new Response(t + "|" + m + "|" + b); },
};
const X = fromIndex(["alConfirm"], deps);
const EMAIL = "jane@example.com";
const link = (code) => new URL("https://prowl.example/alerts/confirm?e=" + encodeURIComponent(EMAIL) + "&c=" + code);
const confirm = (env, method) => X.alConfirm(new Request(link("C1").href, { method }), env, link("C1"));
function member(over) {
  return Object.assign({
    email: EMAIL, tok: "TOK-OLD", utok: "UTOK-OLD", hunts: ["Pyrex"], day: "2026-10-07", done: ["pyrex"], sent: "2026-10-07", mailed: "2026-10-07",
    created: "2026-09-01T10:00:00.000Z", prefs: { freq: "mwf", tz: "America/Chicago", slot: 8, max: 40 }, pro: true, plan: { via: "gift", until: "" }, proDay: "2026-10-07",
    hadPro: true, cid: "7712345678901", prev: ["older@example.com"], movedAt: "2026-09-20T10:00:00.000Z", proCheck: "", someLaterField: { kept: true }
  }, over || {});
}

test("re-confirming as a member keeps every field; only the hunts merge (prev, hadPro, the shop link and settings used to be dropped)", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, old = member();
  kv.set("sub:" + EMAIL, old); kv.set("conf:" + EMAIL, { code: "C1", hunts: ["Fire King", "pyrex"] });
  let r = await confirm(env, "GET");
  assert.equal(await r.text(), "Turn on Prowl Alerts|One tap and your morning email starts for " + EMAIL + ".|Yes, email me");
  assert.deepEqual(kv.json("sub:" + EMAIL), old, "a GET (a mail scanner) changes nothing");
  r = await confirm(env, "POST");
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://shop.example/pages/prowl?alerts=on#e=" + encodeURIComponent(EMAIL) + "&t=TOK-OLD");
  const now = kv.json("sub:" + EMAIL);
  assert.deepEqual(now.hunts, ["Pyrex", "Fire King"], "hunts merge, no duplicates");
  const { hunts, proSetCalled, ...rest } = now;
  const { hunts: oh, ...oldRest } = old;
  assert.deepEqual(rest, oldRest, "every other field is exactly as it was");
  assert.equal(proSetCalled, 1);
  assert.equal(kv.json("conf:" + EMAIL), null, "the link works once");
});

test("re-confirming with emails off: the page says it turns them back on, and they come back from the next email day", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, old = member({ mail: "off", mailOffAt: "2026-10-01T08:00:00.000Z", sent: "2026-09-30" });
  kv.set("sub:" + EMAIL, old); kv.set("conf:" + EMAIL, { code: "C1", hunts: [] });
  let r = await confirm(env, "GET");
  assert.equal(await r.text(), "Turn on Prowl Alerts|Your Prowl emails are off. One tap turns them back on for " + EMAIL + ".|Yes, email me");
  assert.equal(kv.json("sub:" + EMAIL).mail, "off", "nothing changes until the tap");
  await confirm(env, "POST");
  const now = kv.json("sub:" + EMAIL);
  assert.deepEqual([now.mail, now.mailOffAt, now.sent], ["on", "", TODAY], "on, as Settings turns it on: today counts as sent");
  assert.deepEqual([now.prev, now.hadPro, now.cid, now.prefs.freq], [["older@example.com"], true, "7712345678901", "mwf"]);
});

test("a first confirm still makes a fresh member, as before", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv };
  kv.set("conf:" + EMAIL, { code: "C1", hunts: ["Pyrex"] });
  const r = await confirm(env, "POST");
  assert.match(r.headers.get("Location"), /\?alerts=on#e=jane%40example\.com&t=NEW-TOKEN$/);
  const s = kv.json("sub:" + EMAIL);
  assert.deepEqual(Object.keys(s).sort(), ["created", "day", "done", "email", "hunts", "proSetCalled", "sent", "tok", "utok"]);
  assert.deepEqual([s.email, s.hunts, s.tok, s.utok, s.day, s.sent], [EMAIL, ["Pyrex"], "NEW-TOKEN", "NEW-TOKEN", "", ""]);
  assert.equal(s.mail, undefined);
});

test("a wrong or used code changes nothing", async () => {
  const kv = new FakeKV(), env = { PROWL_ALERTS: kv }, old = member({ mail: "off" });
  kv.set("sub:" + EMAIL, old); kv.set("conf:" + EMAIL, { code: "OTHER", hunts: ["x"] });
  const r = await confirm(env, "POST");
  assert.match(await r.text(), /^Link expired\|/);
  assert.deepEqual(kv.json("sub:" + EMAIL), old);
});

/* confirm links (conf:) are dropped wherever the member's other keys are */
test("conf: goes in the purge (Delete in Prowl and the admin delete) and when an address moves", () => {
  const purge = /async function alPurge[\s\S]*?for \(const p of (\[[^\]]*\])\)/.exec(INDEX);
  assert.ok(purge && JSON.parse(purge[1]).includes("conf:"), "alPurge drops conf:");
  const move = INDEX.slice(INDEX.indexOf("async function alMoveConfirm"), INDEX.indexOf("\n}\n", INDEX.indexOf("async function alMoveConfirm")));
  const del = /for \(const k of (\[[^\]]*\])\) await env\.PROWL_ALERTS\.delete\(k \+ from\);/.exec(move);
  assert.ok(del && JSON.parse(del[1]).includes("conf:") && JSON.parse(del[1]).includes("sub:"), "a move drops the old address's conf:");
});

/* the unsubscribe page for an address that moved */
const U = fromIndex(["alUnsub", "alParams", "alMask"], {
  kvGet, kvPut, alEmail: deps.alEmail, alSame: deps.alSame, json: (body, status) => ({ status: status || 200, body }), ALLOW_ORIGINS: [],
  readJson: async (r) => r.body || {}, alPage: (t, m) => ({ page: t, msg: m }), alGate: (t) => ({ gate: t }),
  alMerge: async () => null, alPurge: async () => [], vClean: (v) => String(v || ""), console: { log() {}, error() {} },
});
const NEW = "jane.newname@example.org";
const get = (q) => { const u = new URL("https://prowl.example/alerts/unsub"); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); return U.alUnsub({ method: "GET", headers: { get: () => null } }, env2, u, ""); };
const kv2 = new FakeKV(), env2 = { PROWL_ALERTS: kv2 };
kv2.set("moved:" + EMAIL, { to: NEW, tok: "TOK-OLD", at: 1 });

test("unsubscribe page for a moved address: no token (or a wrong one) never shows the new address", async () => {
  for (const q of [{ e: EMAIL }, { e: EMAIL, t: "" }, { e: EMAIL, t: "WRONG" }, { e: EMAIL, t: "UTOK-OLD" }]) {
    const r = await get(q);
    assert.equal(r.page, "This address changed", JSON.stringify(q));
    assert.equal(r.msg, "Prowl Alerts for this account moved to a newer address. To stop them, use Unsubscribe in your newest Prowl email, or open Prowl and go to Den, then Settings.");
    for (const bit of [NEW, "newname", "example.org"]) assert.ok(!r.msg.includes(bit), "leaked " + bit);
  }
});

test("unsubscribe page for a moved address: a device with the member's token sees it masked, never in full", async () => {
  const r = await get({ e: EMAIL, t: "TOK-OLD" });
  assert.equal(r.msg, "Prowl Alerts for this account now go to j•••e@example.org. To stop them, use Unsubscribe in your newest Prowl email, or open Prowl and go to Den, then Settings.");
  assert.ok(!r.msg.includes(NEW));
});
