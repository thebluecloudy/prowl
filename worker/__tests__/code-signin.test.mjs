/* v108: one sign-in inside the app. POST /alerts/code emails a 6-digit code; POST /alerts/verify signs in with it.
   The answer to a send never says whether the email has a membership; the code is kept only as an HMAC; it lasts 10
   minutes, works once and allows 5 tries; a new email becomes a member, as a confirm link does.
   Run: node --test worker/__tests__/code-signin.test.mjs */
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
const CONSTS = /^const AL_CODE_TTL = .*$/m.exec(INDEX)[0];
class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
}
function rig({ counts = {} } = {}) {
  const kv = new FakeKV(), sent = [], counters = {}, takes = {};
  const env = { PROWL_ALERTS: kv, PROWL_SESSION_SECRET: "s".repeat(40), ALERTS: "public" };
  const deps = {
    alReady: () => true,
    readJson: async (r) => r.body,
    json: (body, status) => ({ body, status: status || 200 }),
    ipKey: (ip) => ip || "anon", ipNet: (k) => "net:" + k,
    vCount: async (name, lim) => { counters[name] = (counters[name] || 0) + 1; return counters[name] <= (counts[name] || lim); },
    vTake: async (name, lim) => { takes[name] = (takes[name] || 0) + 1; return lim - takes[name]; },
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    kvPut: async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v)),
    alAllowed: () => true,
    alShell: (e, inner) => inner, alFootText: () => "",
    alSend: async (e, to, subject, html, text) => { sent.push({ to, subject, html, text }); return { ok: true }; },
    scrubPII: (s) => s,
    alProSet: async (e, sub) => { sub.pro = false; return false; },
    alFree: () => 1, alActive: (e, sub) => sub.hunts,
    sessMint: async (e, cid) => "sess-" + cid,
    vClean: (s, n) => String(s || "").trim().slice(0, n),
    AL_SUB_PER_IP: 12, AL_MAX_HUNTS: 25,
  };
  const names = ["alCodeKey", "alCodeMake", "alCode", "alVerify", "alEmail", "alToken", "alHunts", "pxHmac", "alSame"];
  const keys = Object.keys(deps);
  const X = new Function(...keys, CONSTS + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  const req = (body, ip = "1.2.3.4") => ({ body, headers: { get: () => ip } });
  return { X, env, kv, sent, counters, req };
}
const codeOf = (mail) => /(\d{6}) is your Prowl sign-in code/.exec(mail.text)[1];

test("a code goes to the email, is stored only as an HMAC, and signs an existing member in with their own token", async () => {
  const { X, env, kv, sent, req } = rig();
  await kv.put("sub:a@b.co", JSON.stringify({ email: "a@b.co", tok: "TOK", hunts: ["pyrex"], cid: "77" }));
  await kv.put("in:a@b.co", JSON.stringify({ code: "old-link" }));
  const r = await X.alCode(req({ email: " A@B.co " }), env, "o");
  assert.deepEqual(r.body, { ok: true, sent: true });
  assert.equal(sent.length, 1);
  const code = codeOf(sent[0]);
  assert.equal(sent[0].subject, "Your Prowl code: " + code);
  const rec = JSON.parse(kv.m.get("code:a@b.co"));
  assert.ok(!JSON.stringify(rec).includes(code), "no plain code in KV");
  const v = await X.alVerify(req({ email: "a@b.co", code }), env, "o");
  assert.equal(v.status, 200);
  assert.equal(v.body.tok, "TOK", "the member's token, never a new one");
  assert.equal(v.body.session, "sess-77");
  assert.equal(kv.m.has("code:a@b.co"), false, "a code works once");
  assert.equal(kv.m.has("in:a@b.co"), false, "and a waiting sign-in link is gone too");
  const again = await X.alVerify(req({ email: "a@b.co", code }), env, "o");
  assert.equal(again.body.expired, true);
});

test("a new email gets the same answer and becomes a member with this device's hunts when the code is typed", async () => {
  const { X, env, kv, sent, req } = rig();
  const r = await X.alCode(req({ email: "new@b.co" }), env, "o");
  assert.deepEqual(r.body, { ok: true, sent: true }, "same answer as for a member");
  const v = await X.alVerify(req({ email: "new@b.co", code: codeOf(sent[0]), hunts: ["fiesta", "fiesta", "hull"] }), env, "o");
  assert.equal(v.status, 200);
  const sub = JSON.parse(kv.m.get("sub:new@b.co"));
  assert.equal(sub.via, "code");
  assert.deepEqual(sub.hunts, ["fiesta", "hull"]);
  assert.equal(v.body.tok, sub.tok);
  assert.equal(v.body.session, "", "no store link, no session; the token does the work");
  const none = rig();
  const z = await none.X.alVerify(none.req({ email: "z@b.co", code: "123456" }), none.env, "o");
  assert.equal(z.body.expired, true);
});

test("a wrong code says so and how many tries are left; the 6th try ends the code", async () => {
  const { X, env, kv, sent, req } = rig();
  await X.alCode(req({ email: "a@b.co" }), env, "o");
  const right = codeOf(sent[0]), wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    const w = await X.alVerify(req({ email: "a@b.co", code: wrong }), env, "o");
    assert.equal(w.status, 400);
    assert.equal(w.body.left, 4 - i);
  }
  const sixth = await X.alVerify(req({ email: "a@b.co", code: right }), env, "o");
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.expired, true);
  assert.equal(kv.m.has("code:a@b.co"), false);
});

test("an expired code, a malformed code, and the daily send limit per email", async () => {
  const { X, env, kv, sent, req } = rig({ counts: { "alcode:a@b.co": 2 } });
  await X.alCode(req({ email: "a@b.co" }), env, "o");
  const rec = JSON.parse(kv.m.get("code:a@b.co")); rec.at -= 11 * 60000; await kv.put("code:a@b.co", JSON.stringify(rec));
  assert.equal((await X.alVerify(req({ email: "a@b.co", code: codeOf(sent[0]) }), env, "o")).body.expired, true);
  assert.equal((await X.alVerify(req({ email: "a@b.co", code: "12ab" }), env, "o")).status, 400);
  await X.alCode(req({ email: "a@b.co" }), env, "o");
  const third = await X.alCode(req({ email: "a@b.co" }), env, "o");
  assert.equal(third.status, 429);
  assert.match(third.body.error, /already sent codes today/);
  assert.equal((await X.alCode(req({ email: "nope" }), env, "o")).status, 400);
});

test("codes are 6 digits and spread over the whole range", () => {
  const { X } = rig();
  const seen = new Set();
  for (let i = 0; i < 300; i++) { const c = X.alCodeMake(); assert.match(c, /^\d{6}$/); seen.add(c[0]); }
  assert.ok(seen.size >= 8, "leading digits vary");
});

test("the routes are wired behind the cross-origin POST guard", () => {
  const guard = INDEX.indexOf('if (request.method === "POST" && ALLOW_ORIGINS.indexOf(origin) === -1)');
  for (const r of ['"/alerts/code"', '"/alerts/verify"', '"/alerts/handoff"', '"/alerts/handoff/take"']) assert.ok(INDEX.indexOf(r) > guard, r);
});

test("wrong guesses are capped per address per day across its codes, and refused sends never use the site-wide cap", async () => {
  const { X, env, sent, counters, req } = rig({ counts: { "alcvf:a@b.co": 3 } });
  for (let k = 0; k < 2; k++) {
    await X.alCode(req({ email: "a@b.co" }), env, "o");
    const right = codeOf(sent[sent.length - 1]), wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 2 && k * 2 + i < 3; i++) assert.equal((await X.alVerify(req({ email: "a@b.co", code: wrong }), env, "o")).status, 400);
  }
  const right = codeOf(sent[sent.length - 1]), wrong = right === "000000" ? "111111" : "000000";
  const fourth = await X.alVerify(req({ email: "a@b.co", code: wrong }), env, "o");
  assert.equal(fourth.status, 429);
  assert.match(fourth.body.error, /Too many wrong codes today/);
  const r2 = rig({ counts: { "alcode:x@b.co": 1 } });
  await r2.X.alCode(r2.req({ email: "x@b.co" }), r2.env, "o");
  const refused = await r2.X.alCode(r2.req({ email: "x@b.co" }), r2.env, "o");
  assert.equal(refused.status, 429);
  assert.equal(r2.counters["alcode:all"], 1, "only the code actually sent counted site-wide");
});
