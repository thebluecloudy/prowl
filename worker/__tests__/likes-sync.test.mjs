/* v85 likes sync: POST /alerts/likes merges this device's likes into likes:<email>, newest of liked or unliked wins.
   Run: node --test worker/__tests__/likes-sync.test.mjs */
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
const CONSTS = /^const LIKES_MAX = .*$/m.exec(INDEX)[0];
function fromIndex(names, deps = {}) {
  const keys = Object.keys(deps);
  return new Function(...keys, CONSTS + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
}
class FakeKV {
  constructor() { this.m = new Map(); this.puts = 0; }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v) { this.puts++; this.m.set(k, String(v)); }
  async delete(k) { this.m.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
const json = (body, status) => ({ status: status || 200, body });
const alSame = (a, b) => typeof a === "string" && typeof b === "string" && a.length > 0 && a === b;
const alEmail = (e) => (typeof e === "string" && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e.trim()) ? e.trim().toLowerCase() : "");

function setup({ session = null, left = true } = {}) {
  const kv = new FakeKV(), counted = [];
  kv.set("sub:" + EMAIL, { email: EMAIL, tok: TOK, hunts: ["Pyrex"] });
  const L = fromIndex(["likeItem", "likeAt", "likesMerge", "alLikes"], {
    kvGet, kvPut, json, alSame, alEmail,
    alReady: (env) => !!env.PROWL_ALERTS,
    readJson: async (r) => (r.big ? { big: true } : r.body || {}),
    sessMember: async () => session,
    vCount: async (k) => { counted.push(k); return left; },
  });
  return { L, kv, env: { PROWL_ALERTS: kv }, counted };
}
const EMAIL = "jane@example.com", TOK = "T".repeat(24);
const NOW = Date.now();
const like = (n, at, extra = {}) => ({ u: "https://www.ebay.com/itm/" + n, t: "Haeger panther " + n, p: "$40", s: "ebay", i: "https://i.ebayimg.com/" + n + ".jpg", h: "ceramic panther", at, ...extra });
const post = (body) => ({ method: "POST", body });

test("two devices: likes from both are kept, newest first", () => {
  const { L } = setup();
  const m = L.likesMerge({ likes: [like(1, 100), like(2, 300)] }, { likes: [like(3, 200), like(1, 50)] }, NOW);
  assert.deepEqual(m.likes.map((l) => l.u.slice(-1)), ["2", "3", "1"]);
  assert.equal(m.likes[2].at, 100, "the newer copy of the same link wins");
  assert.deepEqual(m.gone, []);
});

test("an unlike beats an older like, a newer like beats an older unlike, a tie is unliked", () => {
  const { L } = setup();
  const phone = { likes: [like(2, 500)], gone: [{ u: like(1).u, at: 400 }, { u: like(3).u, at: 300 }] };
  const desk = { likes: [like(1, 200), like(3, 300), like(4, 100)], gone: [{ u: like(2).u, at: 450 }] };
  const m = L.likesMerge(desk, phone, NOW);
  assert.deepEqual(m.likes.map((l) => l.u.slice(-1)), ["2", "4"]);
  assert.deepEqual(m.gone, [{ u: like(1).u, at: 400 }, { u: like(3).u, at: 300 }], "the unlike that lost to a newer like goes");
  assert.deepEqual(L.likesMerge(phone, desk, NOW), m, "the order of the two lists does not matter");
});

test("entries are cleaned, times clamp to now, caps hold", () => {
  const { L } = setup();
  const junk = [null, "x", { u: "http://insecure.example/1", t: "a" }, { u: "https://x.example/2" }, { u: "https://x.example/3", t: "   " },
    like(5, NOW + 9e9, { t: "  Haeger   panther \n big ", p: 12, s: 7, i: "javascript:alert(1)", extra: "no" })];
  const m = L.likesMerge(null, { likes: junk }, NOW);
  assert.equal(m.likes.length, 1);
  assert.deepEqual(m.likes[0], { u: like(5).u, t: "Haeger panther big", p: "12", s: "", i: "", h: "ceramic panther", at: NOW });
  const many = Array.from({ length: 450 }, (_, i) => like(i, 1000 + i));
  const gone = Array.from({ length: 450 }, (_, i) => ({ u: "https://g.example/" + i, at: 1000 + i }));
  const big = L.likesMerge({}, { likes: many, gone, mute: Array.from({ length: 150 }, (_, i) => "w" + i).concat(["BAD!", "w1"]), muteAt: 5 }, NOW);
  assert.equal(big.likes.length, 300); assert.equal(big.likes[0].at, 1449, "the newest are kept");
  assert.equal(big.gone.length, 300);
  assert.equal(big.mute.length, 100); assert.ok(big.mute.every((w) => /^[a-z0-9]{2,30}$/.test(w)));
});

test("ignored words: the newer list wins, the stored one keeps a tie", () => {
  const { L } = setup();
  assert.deepEqual(L.likesMerge({ mute: ["pyrex"], muteAt: 10 }, { mute: ["haeger"], muteAt: 20 }, NOW).mute, ["haeger"]);
  assert.deepEqual(L.likesMerge({ mute: ["pyrex"], muteAt: 30 }, { mute: [], muteAt: 20 }, NOW).mute, ["pyrex"]);
  assert.deepEqual(L.likesMerge({ mute: ["pyrex"], muteAt: 20 }, { mute: [], muteAt: 20 }, NOW).mute, ["pyrex"]);
  const cleared = L.likesMerge({ mute: ["pyrex"], muteAt: 20 }, { mute: [], muteAt: 21 }, NOW);
  assert.deepEqual(cleared.mute, []); assert.equal(cleared.muteAt, 21);
});

test("POST /alerts/likes with the token merges, stores and answers the merged lists", async () => {
  const { L, kv, env, counted } = setup();
  kv.set("likes:" + EMAIL, { likes: [like(1, 100)], gone: [], mute: [], muteAt: 0 });
  const r = await L.alLikes(post({ email: EMAIL, tok: TOK, likes: [like(2, 200)], gone: [], mute: ["pyrex"], muteAt: 50 }), env, "");
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.likes.map((l) => l.u.slice(-1)), ["2", "1"]);
  assert.deepEqual(r.body.mute, ["pyrex"]);
  assert.deepEqual(kv.json("likes:" + EMAIL).likes.map((l) => l.u.slice(-1)), ["2", "1"]);
  assert.deepEqual(counted, ["lksync:" + EMAIL]);
  const puts = kv.puts;
  await L.alLikes(post({ email: EMAIL, tok: TOK, likes: [like(1, 100)] }), env, "");
  assert.equal(kv.puts, puts, "nothing new, nothing written");
});

test("a store session stands in for the token, only for its own member", async () => {
  let { L, kv, env } = setup({ session: { email: EMAIL, tok: TOK } });
  let r = await L.alLikes(post({ email: EMAIL, likes: [like(1, 100)] }), env, "");
  assert.equal(r.status, 200); assert.equal(kv.json("likes:" + EMAIL).likes.length, 1);
  r = await L.alLikes(post({ likes: [like(2, 100)] }), env, "");
  assert.equal(r.status, 200, "no email: the session's member"); assert.equal(kv.json("likes:" + EMAIL).likes.length, 2);
  r = await L.alLikes(post({ email: "other@example.com", likes: [like(3, 100)] }), env, "");
  assert.equal(r.status, 404); assert.equal(kv.m.has("likes:other@example.com"), false);
});

test("sign-in required; too big and too many are refused; nothing is written", async () => {
  const { L, kv, env } = setup();
  let r = await L.alLikes(post({ email: EMAIL, tok: "nope", likes: [like(1, 1)] }), env, "");
  assert.equal(r.status, 404);
  r = await L.alLikes(post({ likes: [like(1, 1)] }), env, "");
  assert.equal(r.status, 404);
  r = await L.alLikes({ big: true }, env, "");
  assert.equal(r.status, 413);
  const lim = setup({ left: false });
  r = await lim.L.alLikes(post({ email: EMAIL, tok: TOK, likes: [like(1, 1)] }), lim.env, "");
  assert.equal(r.status, 429);
  assert.equal(kv.m.has("likes:" + EMAIL), false); assert.equal(lim.kv.m.has("likes:" + EMAIL), false);
  r = await L.alLikes(post({ email: EMAIL, tok: TOK }), {}, "");
  assert.equal(r.status, 503);
});

test("wired in: route, metrics name, purge and email move carry likes:", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/alerts\/likes" && request\.method === "POST"\) return alLikes\(request, env, origin\);/);
  const list = (re) => { const m = re.exec(INDEX); assert.ok(m, String(re)); return JSON.parse(m[1]); };
  assert.ok(list(/async function alPurge[\s\S]*?for \(const p of (\[[^\]]*\])\) \{ await kv\.delete/).includes("likes:"), "Delete purges likes");
  assert.match(INDEX, /for \(const k of \["pend:", "seen:", "likes:"\]\) \{ const v = await kvGet\(env, k \+ from, null\)/, "a change of email copies likes");
  assert.ok(list(/for \(const k of (\[[^\]]*\])\) await env\.PROWL_ALERTS\.delete\(k \+ from\);/).includes("likes:"), "and removes them from the old address");
  const v = /const WORKER_VERSION = "v(\d+)[a-z]?";/.exec(INDEX);
  assert.ok(v && Number(v[1]) >= 85, "v85 or later");
});
