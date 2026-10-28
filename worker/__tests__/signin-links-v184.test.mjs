/* v184 (the security and trust plan, 2026-10-28): email links and gate redirects carry a signed sign-in ticket in place
   of the member's permanent token; POST /alerts/redeem trades one for the sign-in, once; POST /alerts/signout-others
   gives a new token and ends every other device, store sessions too.
   Run: node --test worker/__tests__/signin-links-v184.test.mjs */
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
function fromIndex(names, deps = {}, pre = "") {
  const keys = Object.keys(deps);
  return new Function(...keys, pre + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
}
class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); if (o && o.expirationTtl) this.ttl.set(k, o.expirationTtl); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
let toks = 0, capsDown = false, deny = new Set();
const capsTaken = new Map();
const deps = {
  kvGet, kvPut, alReady: (env) => !!env.PROWL_ALERTS, alToken: () => "NEW-TOKEN-" + (++toks),
  alEmail: (v) => { const e = String(v || "").trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) ? e : ""; },
  json: (o, status) => ({ status: status || 200, body: o }), readJson: async (r) => r.body || {},
  ipKey: (ip) => "ip-" + ip, vCount: async (name) => !deny.has(name.split(":")[0]),
  capsDay: () => "day", capsCall: async (shard, op, b) => { if (capsDown) throw new Error("caps down"); const n = (capsTaken.get(b.k) || 0) + 1; capsTaken.set(b.k, n); return { left: b.lim - n }; },
  alFree: () => 3, alActive: (env, sub) => sub.hunts, tripAcctLink: async () => {}, tripIdOf: async (env, sub, email) => "e" + email.length,
  acctHash: async (e) => "h" + e.length, console: { log() {}, error() {} },
  PROWL_APP: "https://shop.example/pages/prowl-app", PROWL_PAGE: "https://shop.example/pages/prowl", WORKER_BASE: "https://w.example",
  AL_TICKET_TTL: { m: 3 * 86400, g: 600 }, AL_REDEEM_PER_IP: 30, AL_SIGNOUT_PER_DAY: 5, affNote: () => "", alAddr: () => "Novi, Michigan",
};
const W = fromIndex(["alRedeem", "alTicket", "alTicketSig", "alTicketOk", "alTokTag", "alCodeKey", "pxHmac", "alSame", "alSignOutAll", "alCancelMove", "alSignoutOthers",
  "alMerge", "alMailSub", "alLinkHash", "alHomeUrl", "alDailyUrl", "alUpgradeUrl", "alLetterOffUrl", "alTryUrl", "alUnsubUrl", "alLetterUnsubUrl", "alFootText", "alGateGo",
  "b64u", "b64uStr", "unb64u", "sessKey", "sessMint", "sessRead", "sessVerify", "sessStale", "sessMember", "tripWho"], deps, "const SESS_DAYS = 30;");

const EMAIL = "jane@example.com", TOK = "a".repeat(36), SECRET = "s".repeat(40);
const member = (over) => Object.assign({ email: EMAIL, tok: TOK, utok: "u".repeat(36), hunts: ["pyrex"], pro: false, cid: "" }, over || {});
function envOf(sub) { const kv = new FakeKV(), env = { PROWL_ALERTS: kv, PROWL_SESSION_SECRET: SECRET }; if (sub) kv.set("sub:" + sub.email, sub); return env; }
const post = (body, ip = "1.2.3.4") => ({ body, headers: { get: (h) => (h === "CF-Connecting-IP" ? ip : null) } });
const bearer = (t, extra = {}) => ({ headers: { get: (h) => (h === "Authorization" ? (t ? "Bearer " + t : null) : extra[h] || null) } });
const redeem = (env, body, ip) => W.alRedeem(post(body, ip), env, "o");

test("a ticket is exp.sig, good for its own member and kind, and a tamper, another member or a lapsed one is refused", async () => {
  const env = envOf(), sub = member();
  const k = await W.alTicket(env, sub, 600, "g");
  assert.match(k, /^\d{10}\.[0-9a-f]{64}$/);
  const exp = Number(k.split(".")[0]);
  assert.ok(Math.abs(exp - (Date.now() / 1000 + 600)) < 3, "lasts 10 minutes");
  assert.ok(await W.alTicketOk(env, sub, k, "g"));
  assert.equal(await W.alTicketOk(env, sub, k, "m"), "", "the kind is in the signature");
  assert.equal(await W.alTicketOk(env, member({ email: "other@example.com" }), k, "g"), "", "another address");
  assert.equal(await W.alTicketOk(env, member({ tok: "b".repeat(36) }), k, "g"), "", "a new token kills every ticket");
  assert.equal(await W.alTicketOk(env, sub, (exp + 1) + "." + k.split(".")[1], "g"), "", "a moved expiry breaks the signature");
  assert.equal(await W.alTicketOk(env, sub, k.slice(0, -1) + (k.endsWith("0") ? "1" : "0"), "g"), "");
  assert.equal(await W.alTicketOk({ PROWL_SESSION_SECRET: "t".repeat(40) }, sub, k, "g"), "", "another key");
  for (const bad of ["", "x", "123.abc", k + "0", "1." + k.split(".")[1]]) assert.equal(await W.alTicketOk(env, sub, bad, "g"), "", bad);
  const old = await W.alTicket(env, sub, -5, "g");
  assert.equal(await W.alTicketOk(env, sub, old, "g"), "", "expired");
  const long = await W.alTicket(env, sub, 3 * 86400, "g");
  assert.equal(await W.alTicketOk(env, sub, long, "g"), "", "a gate ticket can never last longer than 10 minutes");
  assert.ok(await W.alTicketOk(env, sub, await W.alTicket(env, sub, 3 * 86400, "m"), "m"), "an email ticket lasts 3 days");
  assert.equal(await W.alTicket({}, sub, 600, "g"), "", "no key, no ticket");
  assert.equal(await W.alTokTag(TOK), (await W.alTokTag(TOK)).slice(0, 12)); assert.equal((await W.alTokTag(TOK)).length, 12);
});

test("POST /alerts/redeem: answers like alVerify, works once (inu: until it runs out), and says expired otherwise", async () => {
  const sub = member({ cid: "1234567", pro: true }), env = envOf(sub);
  const k = await W.alTicket(env, sub, 3 * 86400, "m");
  let r = await redeem(env, { email: EMAIL, k });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["active", "email", "free", "hunts", "member", "ok", "pro", "session", "tok"]);
  assert.deepEqual([r.body.ok, r.body.member, r.body.email, r.body.tok, r.body.pro, r.body.free, r.body.active], [true, true, EMAIL, TOK, true, 3, 1]);
  assert.ok(await W.sessVerify(bearer(r.body.session), env) === "1234567", "a store session for a linked member");
  const sig = k.split(".")[1], ttl = env.PROWL_ALERTS.ttl.get("inu:" + sig);
  assert.ok(env.PROWL_ALERTS.m.has("inu:" + sig)); assert.ok(ttl > 3 * 86400 - 10 && ttl <= 3 * 86400 + 60, "kept until the ticket runs out");
  r = await redeem(env, { email: EMAIL, k });
  assert.equal(r.status, 400); assert.deepEqual([r.body.expired, r.body.used], [true, true]); assert.equal(r.body.tok, undefined);
  /* the KV mark lost (KV is not atomic): Caps still takes it once */
  env.PROWL_ALERTS.m.delete("inu:" + sig);
  assert.equal((await redeem(env, { email: EMAIL, k })).body.used, true);
  /* Caps down: the KV mark alone */
  capsDown = true;
  const k2 = await W.alTicket(env, sub, 3 * 86400, "m");
  assert.equal((await redeem(env, { email: EMAIL, k: k2 })).status, 200);
  assert.equal((await redeem(env, { email: EMAIL, k: k2 })).body.used, true);
  capsDown = false;
  // a gate ticket needs g; an email ticket sent as g fails
  const g = await W.alTicket(env, sub, 600, "g");
  assert.equal((await redeem(env, { email: EMAIL, k: g })).status, 400, "a gate ticket is not an email ticket");
  assert.equal((await redeem(env, { email: EMAIL, k: g, g: 1 })).status, 200);
  assert.equal((await redeem(env, { email: EMAIL, k: await W.alTicket(env, sub, 3 * 86400, "m"), g: 1 })).status, 400, "an email ticket claimed as a gate one");
  for (const [b, why] of [[{ email: EMAIL, k: await W.alTicket(env, sub, -1, "m") }, "expired"], [{ email: "nobody@example.com", k: await W.alTicket(env, member({ email: "nobody@example.com" }), 600, "m") }, "no member"],
    [{ email: EMAIL }, "nothing to redeem"], [{ email: "bad", k: "1.2" }, "bad address"], [{ email: EMAIL, k: "garbage" }, "garbage"]]) {
    r = await redeem(env, b);
    assert.equal(r.status, 400, why); assert.equal(r.body.expired, true, why); assert.equal(r.body.tok, undefined, why);
  }
  deny.add("alrd");
  assert.equal((await redeem(env, { email: EMAIL, k: await W.alTicket(env, sub, 600, "m") })).status, 429, "a per-IP limit");
  deny.delete("alrd");
  assert.equal((await W.alRedeem(post({ email: EMAIL, k }), {}, "o")).status, 503);
});

test("redeem checks an old #e=&t= pair before the page stores it; a rotated token turns it and every ticket away", async () => {
  const sub = member(), env = envOf(sub);
  const k = await W.alTicket(env, sub, 3 * 86400, "m");
  let r = await redeem(env, { email: EMAIL, t: TOK });
  assert.equal(r.status, 200); assert.equal(r.body.tok, TOK); assert.equal(r.body.session, "");
  assert.equal((await redeem(env, { email: EMAIL, t: "f".repeat(36) })).status, 400);
  assert.equal((await redeem(env, { email: EMAIL, t: sub.utok })).status, 400, "the unsubscribe token signs nobody in");
  await W.alSignOutAll(env, member(), EMAIL);
  assert.equal((await redeem(env, { email: EMAIL, t: TOK })).status, 400, "the old token is dead");
  assert.equal((await redeem(env, { email: EMAIL, k })).status, 400, "so is every ticket made with it");
});

test("email links carry a ticket (#e=&k=), never the token; the copy is never saved; a member without a utok gets one first", async () => {
  const sub = member({ utok: "" }), env = envOf(sub);
  const ms = await W.alMailSub(env, sub);
  assert.match(ms.k, /^\d{10}\.[0-9a-f]{64}$/);
  assert.ok(await W.alTicketOk(env, sub, ms.k, "m"), "a 3-day email ticket");
  assert.equal(env.PROWL_ALERTS.json("sub:" + EMAIL).k, undefined, "the ticket is never saved");
  const utok = env.PROWL_ALERTS.json("sub:" + EMAIL).utok;
  assert.match(utok, /^NEW-TOKEN-/); assert.equal(ms.utok, utok);
  const hash = "#e=jane%40example.com&k=" + ms.k;
  assert.equal(W.alHomeUrl(ms), "https://shop.example/pages/prowl-app?alerts=in" + hash);
  assert.equal(W.alDailyUrl(ms), "https://shop.example/pages/prowl-app?alerts=in&daily=1" + hash);
  assert.equal(W.alUpgradeUrl(ms), "https://shop.example/pages/prowl-app?alerts=in&upgrade=1" + hash);
  assert.equal(W.alLetterOffUrl(ms), "https://shop.example/pages/prowl-app?alerts=in&letter=1" + hash);
  assert.equal(W.alTryUrl(ms, "fire king"), "https://shop.example/pages/prowl-app?alerts=in&hunt=fire%20king" + hash);
  assert.equal(W.alUnsubUrl(ms), "https://w.example/alerts/unsub?e=jane%40example.com&t=" + utok);
  const foot = W.alFootText(env, ms);
  assert.match(foot, /\nOpen Prowl: https:\/\/shop\.example\/pages\/prowl-app\?alerts=in#e=jane%40example\.com&k=\d{10}\.[0-9a-f]{64}\n/);
  assert.doesNotMatch(foot, /signed in/);
  for (const u of [W.alHomeUrl(ms), W.alDailyUrl(ms), W.alUnsubUrl(ms), W.alLetterUnsubUrl(ms), foot]) assert.ok(!u.includes(TOK), u);
  assert.equal(W.alUnsubUrl(member({ utok: "" })), "https://w.example/alerts/unsub?e=jane%40example.com&t=", "no fallback to the sign-in token");
  assert.equal(W.alHomeUrl(member()), "https://shop.example/pages/prowl-app?alerts=in#e=jane%40example.com", "a record without a ticket carries no credential");
  // every sender builds from alMailSub, and no builder reads sub.tok
  for (const f of ["alLetterSend", "alDigest", "alTest"]) assert.match(indexFn(f), /await alMailSub\(env, sub\)/, f);
  assert.match(indexFn("alSendGift"), /alHomeUrl\(await alMailSub\(env, sub\)\)/);
  for (const f of ["alLinkHash", "alHomeUrl", "alDailyUrl", "alUpgradeUrl", "alLetterOffUrl", "alTryUrl", "alUnsubUrl", "alFootText"]) assert.doesNotMatch(indexFn(f), /\.tok\b/, f);
});

test("the confirm, gift start, sign-in and move redirects carry a 10-minute gate ticket, never the token", async () => {
  const sub = member(), env = envOf(sub);
  const r = await W.alGateGo(env, "https://shop.example/pages/prowl?alerts=on", sub);
  assert.equal(r.status, 302);
  const loc = r.headers.get("Location"), m = /^https:\/\/shop\.example\/pages\/prowl\?alerts=on#e=jane%40example\.com&k=(\d{10}\.[0-9a-f]{64})&g=1$/.exec(loc);
  assert.ok(m, loc); assert.ok(!loc.includes(TOK));
  assert.ok(await W.alTicketOk(env, sub, m[1], "g"));
  assert.match(indexFn("alConfirm"), /return alGateGo\(env, PROWL_PAGE \+ "\?alerts=on", sub\);/);
  assert.match(indexFn("alGiftStart"), /return alGateGo\(env, PROWL_PAGE \+ "\?alerts=in", s\);/);
  assert.match(indexFn("alIn"), /delete\("in:" \+ email\);\n {2}return alGateGo\(env, PROWL_APP \+ "\?alerts=in", sub\);/);
  assert.match(indexFn("alMoveConfirm"), /return alGateGo\(env, PROWL_PAGE \+ "\?alerts=moved", moved\);/);
  assert.doesNotMatch(INDEX, /"&t=" \+ (sub|s)\.tok/, "no link anywhere is built from the token");
});

test("POST /alerts/signout-others: a new token for this device, the old one and every other device's sessions end", async () => {
  const sub = member({ cid: "1234567", prev: ["old@example.com"] }), env = envOf(sub), kv = env.PROWL_ALERTS;
  kv.set("cid:1234567", { email: EMAIL });
  kv.set("in:" + EMAIL, { code: "c" }); kv.set("code:" + EMAIL, { h: "x" }); kv.set("conf:" + EMAIL, { code: "c" });
  kv.set("mvf:" + EMAIL, { to: "new@example.com" }); kv.set("mv:new@example.com", { code: "m", from: EMAIL });
  kv.set("moved:old@example.com", { to: EMAIL, tok: TOK, at: Date.now() - 86400000 });
  const before = Date.now();
  const oldSess = await W.sessMint(env, "1234567", before - 5000);
  assert.ok(await W.sessMember(bearer(oldSess), env), "the store session works before");
  assert.equal((await W.tripWho(bearer(oldSess), env)).id, "1234567");
  // only with the member's own token
  assert.equal((await W.alSignoutOthers(post({ email: EMAIL, tok: "f".repeat(36) }), env, "o")).status, 404);
  assert.equal((await W.alSignoutOthers(post({ email: EMAIL }), env, "o")).status, 404);
  assert.equal(kv.json("sub:" + EMAIL).tok, TOK, "nothing changed");
  const r = await W.alSignoutOthers(post({ email: EMAIL, tok: TOK }), env, "o");
  assert.equal(r.status, 200);
  const now = kv.json("sub:" + EMAIL);
  assert.deepEqual([r.body.ok, r.body.tok, r.body.moved], [true, now.tok, true]);
  assert.notEqual(now.tok, TOK); assert.match(now.tok, /^NEW-TOKEN-/);
  assert.ok(now.sessFrom >= before && now.sessFrom <= Date.now(), "sessFrom is now");
  assert.equal(now.utok, sub.utok, "the unsubscribe token stays");
  for (const k of ["in:", "code:", "conf:", "mvf:"]) assert.equal(kv.m.has(k + EMAIL), false, k);
  assert.equal(kv.m.has("mv:new@example.com"), false, "a waiting change of address is cancelled");
  const fw = kv.json("moved:old@example.com");
  assert.equal(fw.to, EMAIL); assert.notEqual(fw.tok, TOK); assert.notEqual(fw.tok, now.tok);
  // other devices: the old token and the old store session are refused
  assert.equal((await redeem(env, { email: EMAIL, t: TOK })).status, 400);
  assert.equal(await W.sessMember(bearer(oldSess), env), null, "a session from before sessFrom");
  assert.equal(await W.tripWho(bearer(oldSess), env), null, "trips too");
  assert.equal(await W.sessVerify(bearer(oldSess), env), "1234567", "the signature itself is still good; the member link decides");
  // this device: the new token, and a session made after sessFrom
  assert.ok(await W.sessMember(bearer(r.body.session), env), "this device's new store session works");
  assert.equal((await W.tripWho(bearer(r.body.session), env)).id, "1234567");
  assert.equal((await redeem(env, { email: EMAIL, t: r.body.tok })).status, 200);
  // a session for a customer id that is not (or no longer) a member is not touched by sessFrom
  assert.equal((await W.tripWho(bearer(await W.sessMint(env, "999", before - 5000)), env)).id, "999");
  // the daily cap, and a member gone in between
  deny.add("also");
  assert.equal((await W.alSignoutOthers(post({ email: EMAIL, tok: now.tok }), env, "o")).status, 429);
  deny.delete("also");
  const e2 = envOf(member());
  assert.equal(await W.alSignOutAll(e2, member({ email: "gone@example.com" }), "gone@example.com"), null);
});

test("sessStale: only a session made before sessFrom; no sessFrom, nothing stale", () => {
  assert.equal(W.sessStale({}, { iat: 1 }), false);
  assert.equal(W.sessStale({ sessFrom: 2000 }, { iat: 1 }), true);
  assert.equal(W.sessStale({ sessFrom: 2000 }, { iat: 2 }), false);
  assert.equal(W.sessStale(null, { iat: 1 }), false);
});

test("the routes: redeem and signout-others are POST, behind the cross-origin guard; the admin shares alSignOutAll", () => {
  const guard = INDEX.indexOf('if (request.method === "POST" && ALLOW_ORIGINS.indexOf(origin) === -1) return json({ error: "forbidden" }, 403, origin);');
  const rd = INDEX.indexOf('if (url.pathname === "/alerts/redeem" && request.method === "POST") return alRedeem(request, env, origin);');
  const so = INDEX.indexOf('if (url.pathname === "/alerts/signout-others" && request.method === "POST") return alSignoutOthers(request, env, origin);');
  assert.ok(guard > 0 && rd > guard && so > guard);
  assert.match(INDEX, /alProSet, alMerge, alSendSignin, alToken, alSignOutAll,/);
  const ADMIN = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
  assert.match(ADMIN, /await H\.alSignOutAll\(env, sub, email\)/);
  assert.doesNotMatch(ADMIN, /async function cancelMove/, "one copy of the rotation, in index.js");
});
