/* v186 (the security and trust plan, 2026-10-28): the iPhone app carry. POST /alerts/handoff {email, tok} (or a store
   session) mints a one-time code kept only as a keyed hash under ho: for 15 minutes; POST /alerts/handoff/take {code}
   trades it once for the sign-in, answering as /alerts/verify does, and is refused once the member's token changes.
   Run: node --test worker/__tests__/handoff-v186.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const CONSTS = /^const HO_TTL = .*$/m.exec(INDEX)[0];
class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); if (o && o.expirationTtl) this.ttl.set(k, o.expirationTtl); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  keys(p) { return [...this.m.keys()].filter((k) => k.startsWith(p)); }
}
function rig({ limits = {}, session = null, capsDown = false } = {}) {
  const kv = new FakeKV(), counters = {}, caps = new Map(), linked = [];
  const env = { PROWL_ALERTS: kv, PROWL_SESSION_SECRET: "s".repeat(40) };
  const deps = {
    crypto: webcrypto,
    alReady: (e) => !!e.PROWL_ALERTS,
    readJson: async (r) => r.body || {},
    json: (body, status) => ({ body, status: status || 200 }),
    ipKey: (ip) => "ip-" + ip,
    vCount: async (name, lim) => { const k = name.split(":")[0]; counters[name] = (counters[name] || 0) + 1; return counters[name] <= (k in limits ? limits[k] : lim); },
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    sessMember: async () => session,
    capsDay: () => "day",
    capsCall: async (shard, op, b) => { if (capsDown) throw new Error("caps down"); const n = (caps.get(b.k) || 0) + 1; caps.set(b.k, n); return { left: b.lim - n }; },
    tripAcctLink: async (e, id, email) => { linked.push(email); }, tripIdOf: async () => "t1",
    alFree: () => 3, alActive: (e, sub) => sub.hunts,
    sessMint: async (e, cid) => "sess-" + cid,
    console: { log() {}, error() {} },
  };
  const names = ["alCodeKey", "hoKey", "alHandoff", "alHandoffTake", "alEmail", "alToken", "alSame", "pxHmac", "sha16"];
  const keys = Object.keys(deps);
  const X = new Function(...keys, CONSTS + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  const req = (body, ip = "1.2.3.4") => ({ body, headers: { get: () => ip } });
  return { X, env, kv, counters, req, linked };
}
const MEMBER = { email: "a@b.co", tok: "a".repeat(36), hunts: ["pyrex"], pro: true, cid: "77" };

test("a code is minted for the right email and token, stored only as a keyed hash, and works once", async () => {
  const { X, env, kv, req, linked } = rig();
  kv.set("sub:a@b.co", MEMBER);
  const m = await X.alHandoff(req({ email: " A@B.co ", tok: MEMBER.tok }), env, "o");
  assert.equal(m.status, 200);
  assert.match(m.body.code, /^[0-9a-f]{36}$/);
  assert.equal(m.body.ttl, 900);
  const ho = kv.keys("ho:");
  assert.equal(ho.length, 1);
  assert.equal(ho[0].indexOf(m.body.code), -1, "the raw code is never a key");
  assert.equal(kv.ttl.get(ho[0]), 900);
  const rec = JSON.parse(kv.m.get(ho[0]));
  assert.equal(rec.email, "a@b.co");
  assert.equal(rec.tk, await X.sha16(MEMBER.tok));
  assert.equal(JSON.stringify(rec).indexOf(MEMBER.tok), -1, "the token is not stored with it");
  const t = await X.alHandoffTake(req({ code: m.body.code }), env, "o");
  assert.deepEqual(t.body, { ok: true, member: true, email: "a@b.co", tok: MEMBER.tok, pro: true, free: 3, hunts: ["pyrex"], active: 1, session: "sess-77" });
  assert.deepEqual(linked, ["a@b.co"]);
  assert.equal(kv.keys("ho:").length, 0, "the record is gone");
  const again = await X.alHandoffTake(req({ code: m.body.code }), env, "o");
  assert.equal(again.status, 400);
  assert.equal(again.body.expired, true);
  assert.equal(again.body.tok, undefined);
});

test("a wrong token mints nothing; a valid store session does", async () => {
  const { X, env, kv, req } = rig();
  kv.set("sub:a@b.co", MEMBER);
  const bad = await X.alHandoff(req({ email: "a@b.co", tok: "b".repeat(36) }), env, "o");
  assert.equal(bad.status, 404);
  assert.equal((await X.alHandoff(req({}), env, "o")).status, 404);
  assert.equal(kv.keys("ho:").length, 0);
  const s = rig({ session: MEMBER });
  const ok = await s.X.alHandoff(s.req({}), s.env, "o");
  assert.match(ok.body.code, /^[0-9a-f]{36}$/);
});

test("a code past its 15 minutes, a made-up code or a malformed one: {error, expired:true}", async () => {
  const { X, env, kv, req } = rig();
  kv.set("sub:a@b.co", MEMBER);
  const m = await X.alHandoff(req({ email: "a@b.co", tok: MEMBER.tok }), env, "o");
  const k = kv.keys("ho:")[0], rec = JSON.parse(kv.m.get(k));
  rec.at = Date.now() - 901 * 1000; kv.m.set(k, JSON.stringify(rec));   /* KV's TTL is not exact: the age is checked too */
  const old = await X.alHandoffTake(req({ code: m.body.code }), env, "o");
  assert.equal(old.status, 400);
  assert.equal(old.body.expired, true);
  assert.equal(old.body.tok, undefined);
  for (const code of ["f".repeat(36), "nope", "", "<script>"]) {
    const r = await X.alHandoffTake(req({ code }), env, "o");
    assert.equal(r.body.expired, true, code);
    assert.equal(r.body.tok, undefined, code);
  }
});

test("a code is refused once the token changes (Sign out every other device)", async () => {
  const { X, env, kv, req } = rig();
  kv.set("sub:a@b.co", MEMBER);
  const m = await X.alHandoff(req({ email: "a@b.co", tok: MEMBER.tok }), env, "o");
  kv.set("sub:a@b.co", Object.assign({}, MEMBER, { tok: "c".repeat(36) }));
  const r = await X.alHandoffTake(req({ code: m.body.code }), env, "o");
  assert.equal(r.status, 400);
  assert.equal(r.body.expired, true);
  assert.equal(r.body.tok, undefined);
  kv.m.delete("sub:a@b.co");
  const m2 = rig();
  m2.kv.set("sub:a@b.co", MEMBER);
  const c2 = await m2.X.alHandoff(m2.req({ email: "a@b.co", tok: MEMBER.tok }), m2.env, "o");
  m2.kv.m.delete("sub:a@b.co");   /* the account was deleted */
  assert.equal((await m2.X.alHandoffTake(m2.req({ code: c2.body.code }), m2.env, "o")).body.expired, true);
});

test("Caps takes each code once even if two trades race past the KV read", async () => {
  const { X, env, kv, req } = rig();
  kv.set("sub:a@b.co", MEMBER);
  const m = await X.alHandoff(req({ email: "a@b.co", tok: MEMBER.tok }), env, "o");
  const [a, b] = await Promise.all([X.alHandoffTake(req({ code: m.body.code }), env, "o"), X.alHandoffTake(req({ code: m.body.code }), env, "o")]);
  assert.equal([a, b].filter((r) => r.body.tok).length, 1);
});

test("rate limits: minting per address and per network address, trading per network address", async () => {
  const { X, env, kv, req } = rig({ limits: { alho: 2, alhot: 2 } });
  kv.set("sub:a@b.co", MEMBER);
  for (let i = 0; i < 2; i++) assert.equal((await X.alHandoff(req({ email: "a@b.co", tok: MEMBER.tok }), env, "o")).status, 200);
  const third = await X.alHandoff(req({ email: "a@b.co", tok: MEMBER.tok }), env, "o");
  assert.equal(third.status, 429);
  assert.equal(third.body.code, undefined);
  for (let i = 0; i < 2; i++) await X.alHandoffTake(req({ code: "f".repeat(36) }), env, "o");
  assert.equal((await X.alHandoffTake(req({ code: "f".repeat(36) }), env, "o")).status, 429);
  const ip = rig({ limits: { alhoi: 1 } });
  ip.kv.set("sub:a@b.co", MEMBER);
  await ip.X.alHandoff(ip.req({ email: "a@b.co", tok: MEMBER.tok }), ip.env, "o");
  assert.equal((await ip.X.alHandoff(ip.req({ email: "a@b.co", tok: MEMBER.tok }), ip.env, "o")).status, 429);
});

test("the routes are wired behind the cross-origin POST guard", () => {
  const guard = INDEX.indexOf('if (request.method === "POST" && ALLOW_ORIGINS.indexOf(origin) === -1)');
  for (const r of ['"/alerts/handoff"', '"/alerts/handoff/take"']) assert.ok(INDEX.indexOf(r) > guard, r);
});
