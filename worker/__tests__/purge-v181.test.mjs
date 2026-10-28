/* v182: the review fixes: a member back at an earlier address keeps their trip id; a Delete by a newcomer at an address
   someone moved away from leaves that member's trips and photos (tidkept:, hpkept:).
   v181 (the security and trust plan, 2026-10-28): a Delete takes the member's trips (tripsForget) and every earlier
   address's saved finds, acct: and tripinv:; an email change carries the saved finds and keeps an email-only member's
   trip id. The functions are taken from index.js with fakes for KV and R2.
   Run: node --test worker/__tests__/purge-v181.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../saved.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); if (o && o.expirationTtl) this.ttl.set(k, o.expirationTtl); else this.ttl.delete(k); }
  async delete(k) { this.m.delete(k); this.ttl.delete(k); }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
class FakeR2 {
  constructor() { this.m = new Map(); }
  async put(k, v) { this.m.set(k, v); }
  async get(k) { return this.m.get(k) || null; }
  async delete(k) { for (const x of [].concat(k)) this.m.delete(x); }
  async list({ prefix }) { return { objects: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; }
}
const kvGet = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const kvPut = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
const logs = [];
const names = ["sha16", "acctHash", "tripIdOk", "tripMemberIdFor", "tripIdOf", "alMerge", "tripGet", "tripPut", "tripPurge", "tripIndexAdd", "tripsForget",
  "savedIndex", "savedPurge", "savedHpPurge", "pushHash", "pushId", "pushList", "pushPurge", "pushMove", "alEmail", "alSame", "alMask", "alPurge", "alMoveConfirm"];
const deps = {
  kvGet, kvPut, photoKey: S.photoKey, AL_LETTER_TTL: 21 * 86400, TRIPINV_TTL: 30 * 86400,
  console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")) },
  alReady: () => true, alPage: (title) => ({ page: title }), alGate: (title) => ({ gate: title }), alProSet: async () => {},
  alShell: () => "", alEsc: (x) => x, alSend: async () => ({ ok: true }), alFootText: () => "", PROWL_PAGE: "https://p",
  Response: { redirect: (u) => ({ redirect: u }) },
  alGateGo: async (env, base, sub) => ({ redirect: base + "#e=" + encodeURIComponent(sub.email) + "&k=TICKET&g=1" }),   /* v184: a ticket, not the token */
};
const W = new Function(...Object.keys(deps), names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...Object.values(deps));

const EMAIL = "jane@example.com", OLD = "jane.old@example.com", TOK = "T".repeat(24);
const trip = (id, org, members, extra = {}) => ({ id, org, members, day: "2026-10-30", closes: "2026-11-01T00:00:00.000Z", expires: "2026-11-15T00:00:00.000Z", stops: [], dest: { name: "Blenko" }, ...extra });
const find = (id, by) => ({ id, by, name: "Jane", at: "2026-10-30T12:00:00.000Z", item: "Blenko vase" });
function envOf() { return { PROWL_ALERTS: new FakeKV(), PROWL_FINDS: new FakeR2() }; }

test("tripsForget: a member leaves, an organizer hands the trip on, a last member's trip goes; their finds and photos go", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, r2 = env.PROWL_FINDS, me = "e" + await W.acctHash(EMAIL);
  kv.set("trip:taaaaaaaaa", trip("taaaaaaaaa", "1001", ["1001", me, "1002"]));   /* someone else's: they leave */
  kv.set("trip:tbbbbbbbbb", trip("tbbbbbbbbb", me, [me, "1002", "1003"]));   /* theirs, shared: handed to 1002 */
  kv.set("trip:tccccccccc", trip("tccccccccc", me, [me]));   /* theirs alone: it goes */
  kv.set("trips:" + me, ["taaaaaaaaa", "tbbbbbbbbb", "tccccccccc", "tmissing00"]);
  kv.set("trips:1002", ["taaaaaaaaa", "tbbbbbbbbb"]);
  kv.set("trips:all", [{ id: "taaaaaaaaa", expires: "x" }, { id: "tbbbbbbbbb", expires: "x" }, { id: "tccccccccc", expires: "x" }]);
  kv.set("tripfinds:taaaaaaaaa", [find("faaaaaaaaa", me), find("fbbbbbbbbb", "1001")]);
  kv.set("tripfinds:tbbbbbbbbb", [find("fccccccccc", "1002"), find("fddddddddd", me)]);
  kv.set("tripfinds:tccccccccc", [find("feeeeeeeee", me)]);
  for (const [t, f] of [["taaaaaaaaa", "faaaaaaaaa"], ["taaaaaaaaa", "fbbbbbbbbb"], ["tbbbbbbbbb", "fccccccccc"], ["tbbbbbbbbb", "fddddddddd"], ["tccccccccc", "feeeeeeeee"]]) r2.m.set("finds/" + t + "/" + f + ".jpg", 1);
  const purged = await W.tripsForget(env, [me]);
  assert.equal(purged, 1);
  const a = kv.json("trip:taaaaaaaaa"), b = kv.json("trip:tbbbbbbbbb");
  assert.deepEqual(a.members, ["1001", "1002"]); assert.equal(a.org, "1001");
  assert.deepEqual(b.members, ["1002", "1003"]); assert.equal(b.org, "1002", "the next member organizes it now");
  assert.equal(kv.json("trip:tccccccccc"), null, "nobody left: the trip goes");
  assert.equal(kv.json("tripfinds:tccccccccc"), null);
  assert.deepEqual(kv.json("trips:all").map((e) => e.id), ["taaaaaaaaa", "tbbbbbbbbb"]);
  assert.deepEqual(kv.json("tripfinds:taaaaaaaaa").map((f) => f.id), ["fbbbbbbbbb"], "other people's finds stay");
  assert.deepEqual(kv.json("tripfinds:tbbbbbbbbb").map((f) => f.id), ["fccccccccc"]);
  assert.deepEqual([...r2.m.keys()].sort(), ["finds/taaaaaaaaa/fbbbbbbbbb.jpg", "finds/tbbbbbbbbb/fccccccccc.jpg"], "only their photos go");
  assert.equal(kv.json("trips:" + me), null, "their trip list goes");
  assert.deepEqual(kv.json("trips:1002"), ["taaaaaaaaa", "tbbbbbbbbb"], "the others keep theirs");
  for (const [k, v] of kv.m) assert.ok(!k.includes(me) && !v.includes(me), "left behind: " + k);
});

test("tripsForget: two ids of one person (customer id and email hash) on one trip both go; an odd id is ignored", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, eh = "e" + await W.acctHash(EMAIL);
  kv.set("trip:taaaaaaaaa", trip("taaaaaaaaa", "1001", ["1001", eh, "1002"]));
  kv.set("trips:1001", ["taaaaaaaaa"]); kv.set("trips:" + eh, ["taaaaaaaaa"]);
  await W.tripsForget(env, ["1001", eh, "../x", ""]);
  assert.equal(kv.json("trip:taaaaaaaaa").org, "1002", "handed to someone else, not to their other id");
  assert.deepEqual(kv.json("trip:taaaaaaaaa").members, ["1002"]);
  assert.equal(kv.json("trips:1001"), null); assert.equal(kv.json("trips:" + eh), null);
});

function member(extra = {}) { return { email: EMAIL, tok: TOK, hunts: [], pro: true, prev: [OLD], ...extra }; }
async function seedPurge(env, sub) {
  const kv = env.PROWL_ALERTS, r2 = env.PROWL_FINDS;
  const ehNow = "e" + await W.acctHash(EMAIL), ehOld = "e" + await W.acctHash(OLD), id = await W.tripMemberIdFor(sub, EMAIL);
  kv.set("sub:" + EMAIL, sub);
  kv.set("acct:" + await W.acctHash(EMAIL), { cid: id });
  kv.set("acct:" + await W.acctHash(OLD), { cid: ehOld });
  kv.set("tripinv:" + await W.acctHash(EMAIL), { ids: ["tzzzzzzzzz"] });
  kv.set("tripinv:" + await W.acctHash(OLD), { ids: ["tzzzzzzzzz"] });
  kv.set("tripoffer:" + id, { ids: ["tzzzzzzzzz"], done: [] }); kv.set("tripoffer:" + ehOld, { ids: ["tzzzzzzzzz"], done: [] });   /* v183: offers */
  kv.set("tripoffer:n" + await W.acctHash(OLD), { ids: ["tzzzzzzzzz"], done: [] });
  kv.set("tripoffer:1002", { ids: ["tzzzzzzzzz"], done: [] });
  kv.set("acct:" + await W.acctHash("hark@example.com"), { cid: "1002" });
  /* saved finds left at an earlier address before v181, with a photo; and the current list with a photo kept under it */
  const hOld = await W.sha16(OLD), hNow = await W.sha16(EMAIL), u = "https://www.ebay.com/itm/1", ku = await W.sha16(u);
  kv.set("saved:" + OLD, { saved: [{ url: u, title: "Vase", at: 1, ph: 1 }], gone: [] });
  kv.set("saved:" + EMAIL, { saved: [{ url: u, title: "Vase", at: 1, ph: 1, hp: hOld }, { url: u + "2", title: "Bowl", at: 1, ph: 1 }], gone: [] });
  kv.set("saved:all", [OLD, EMAIL, "hark@example.com"]);
  r2.m.set("saved/" + hOld + "/" + ku + ".jpg", 1); r2.m.set("saved/" + hNow + "/" + await W.sha16(u + "2") + ".jpg", 1);
  r2.m.set("saved/" + await W.sha16("hark@example.com") + "/x.jpg", 1);
  /* a trip they organized with a friend, one they joined, and one from their old address's id */
  kv.set("trip:taaaaaaaaa", trip("taaaaaaaaa", id, [id, "1002"]));
  kv.set("trip:tbbbbbbbbb", trip("tbbbbbbbbb", "1002", ["1002", id]));
  kv.set("trip:tccccccccc", trip("tccccccccc", ehOld, [ehOld]));
  kv.set("trips:" + id, ["taaaaaaaaa", "tbbbbbbbbb"]); kv.set("trips:" + ehOld, ["tccccccccc"]); kv.set("trips:1002", ["taaaaaaaaa", "tbbbbbbbbb"]);
  kv.set("trips:all", [{ id: "taaaaaaaaa", expires: "x" }, { id: "tbbbbbbbbb", expires: "x" }, { id: "tccccccccc", expires: "x" }]);
  kv.set("tripfinds:tbbbbbbbbb", [find("faaaaaaaaa", id), find("fbbbbbbbbb", "1002")]);
  r2.m.set("finds/tbbbbbbbbb/faaaaaaaaa.jpg", 1); r2.m.set("finds/tbbbbbbbbb/fbbbbbbbbb.jpg", 1);
  return { id, ehNow, ehOld, hOld, hNow };
}
function noTrace(env, words) {
  for (const [k, v] of env.PROWL_ALERTS.m) for (const w of words) assert.ok(!k.includes(w) && !v.includes(w), "left behind: " + k + " = " + v.slice(0, 120));
  for (const k of env.PROWL_FINDS.m.keys()) for (const w of words) assert.ok(!k.includes(w), "photo left behind: " + k);
}

test("a Delete covers earlier addresses and the trips: no address, hash or trip id of theirs in any key or value", async () => {
  for (const sub of [member(), member({ cid: "7712345678901" }), member({ tid: "e" + "0a".repeat(8) })]) {
    const env = envOf(), kv = env.PROWL_ALERTS;
    const s = await seedPurge(env, sub);
    logs.length = 0;
    const gone = await W.alPurge(env, EMAIL, sub);
    noTrace(env, [EMAIL, OLD, s.id, s.ehNow, s.ehOld, s.hOld, s.hNow, await W.acctHash(EMAIL), await W.acctHash(OLD)]);
    assert.deepEqual(gone.slice(-4), ["acct:", "tripinv:", "trips:", "tripoffer:"], "new entries at the end");   /* v183: tripoffer: */
    assert.ok(kv.m.has("tripoffer:1002"), "someone else's offers stay");
    assert.ok(logs.every((l) => !l.includes(EMAIL) && !l.includes(OLD) && !l.includes(s.id)), "the log names keys only");
    const t = kv.json("trip:taaaaaaaaa");
    assert.equal(t.org, "1002"); assert.deepEqual(t.members, ["1002"]);
    assert.deepEqual(kv.json("trip:tbbbbbbbbb").members, ["1002"]);
    assert.deepEqual(kv.json("tripfinds:tbbbbbbbbb").map((f) => f.id), ["fbbbbbbbbb"]);
    assert.equal(kv.json("trip:tccccccccc"), null, "the old address's lone trip goes");
    assert.deepEqual(kv.json("trips:all").map((e) => e.id), ["taaaaaaaaa", "tbbbbbbbbb"], "trips:all keeps ids only");
    assert.deepEqual(kv.json("saved:all"), ["hark@example.com"]);
    assert.ok(kv.m.has("acct:" + await W.acctHash("hark@example.com")), "someone else's share link stays");
    assert.equal(env.PROWL_FINDS.m.size, 2, "someone else's saved photo and find photo stay");
  }
});

test("a Delete leaves an earlier address that someone else uses now alone", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, sub = member();
  await seedPurge(env, sub);
  kv.set("sub:" + OLD, { email: OLD, tok: "x", hunts: [] });
  await W.alPurge(env, EMAIL, sub);
  assert.ok(kv.m.has("saved:" + OLD), "their saved finds");
  assert.ok(kv.m.has("acct:" + await W.acctHash(OLD)) && kv.m.has("tripinv:" + await W.acctHash(OLD)), "their trip links");
  assert.ok(kv.m.has("trip:tccccccccc"), "their trip (the id of that address is theirs now)");
  assert.ok(kv.m.has("sub:" + OLD));
});

async function moveTo(env, sub, to) {
  const kv = env.PROWL_ALERTS;
  kv.set("mv:" + to, { code: "c1", from: sub.email }); kv.set("mvf:" + sub.email, { to });
  return W.alMoveConfirm({ method: "POST" }, env, new URL("https://w/alerts/move-confirm?e=" + encodeURIComponent(to) + "&c=c1"));
}

test("an email change carries the saved finds (photos stay, hp), keeps an email-only member's trip id, moves acct: and tripinv:", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, NEW = "jane.new@example.com";
  const sub = { email: EMAIL, tok: TOK, hunts: [], pro: true };
  kv.set("sub:" + EMAIL, sub);
  const hFrom = await W.sha16(EMAIL), u = "https://www.ebay.com/itm/1", id = "e" + await W.acctHash(EMAIL);
  kv.set("saved:" + EMAIL, { saved: [{ url: u, title: "Vase", at: 1, ph: 1 }, { url: u + "2", title: "Bowl", at: 2, ph: 0 }], gone: [{ u: u + "3", at: 3 }] });
  kv.set("saved:all", [EMAIL]);
  kv.set("lt:" + EMAIL, { html: "letter" }); kv.set("in:" + EMAIL, { x: 1 }); kv.set("last:" + EMAIL, { day: "d" });
  kv.set("acct:" + await W.acctHash(EMAIL), { cid: id });
  kv.set("tripinv:" + await W.acctHash(EMAIL), { ids: ["tqqqqqqqqq"] });
  kv.set("trip:taaaaaaaaa", trip("taaaaaaaaa", id, [id])); kv.set("trips:" + id, ["taaaaaaaaa"]);
  const r = await moveTo(env, sub, NEW);
  assert.ok(r.redirect, "moved");
  const moved = kv.json("sub:" + NEW);
  assert.equal(moved.tid, id, "the trip id of the old address is kept");
  assert.equal(await W.tripMemberIdFor(moved, NEW), id);
  assert.deepEqual(kv.json("trips:" + id), ["taaaaaaaaa"], "so their trips are still theirs");
  assert.ok(kv.m.has("tidkept:" + id));
  const sv = kv.json("saved:" + NEW);
  assert.equal(sv.saved[0].hp, hFrom, "the photo stays under the old address's hash");
  assert.equal(sv.saved[1].hp, undefined, "no photo, no hp");
  assert.deepEqual(sv.gone, [{ u: u + "3", at: 3 }]);
  assert.deepEqual(kv.json("saved:all"), [NEW]);
  for (const p of ["saved:", "lt:", "in:", "last:", "sub:"]) assert.equal(kv.m.has(p + EMAIL), false, p);
  assert.equal(kv.ttl.get("lt:" + NEW), 21 * 86400, "the letter keeps its 21 days");
  assert.deepEqual(kv.json("acct:" + await W.acctHash(NEW)), { cid: id });
  assert.equal(kv.m.has("acct:" + await W.acctHash(EMAIL)), false);
  assert.deepEqual(kv.json("tripinv:" + await W.acctHash(NEW)), { ids: ["tqqqqqqqqq"] });
  assert.equal(kv.ttl.get("tripinv:" + await W.acctHash(NEW)), 30 * 86400);
  assert.equal(kv.m.has("tripinv:" + await W.acctHash(EMAIL)), false);
  /* a second change keeps the same tid and the photo's hash; then a Delete takes everything */
  const r2 = await moveTo(env, moved, "jane.third@example.com");
  assert.ok(r2.redirect);
  const third = kv.json("sub:jane.third@example.com");
  assert.equal(third.tid, id); assert.equal(kv.json("saved:jane.third@example.com").saved[0].hp, hFrom);
  env.PROWL_FINDS.m.set("saved/" + hFrom + "/" + await W.sha16(u) + ".jpg", 1);
  await W.alPurge(env, "jane.third@example.com", third);
  noTrace(env, [EMAIL, NEW, "jane.third@example.com", id, hFrom]);
  assert.equal(kv.m.has("trip:taaaaaaaaa"), false);
});

test("a member with a customer id keeps it across a change; no tid is needed", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, NEW = "jane.new@example.com";
  const sub = { email: EMAIL, tok: TOK, hunts: [], cid: "7712345678901" };
  kv.set("sub:" + EMAIL, sub); kv.set("acct:" + await W.acctHash(EMAIL), { cid: "7712345678901" });
  await moveTo(env, sub, NEW);
  const moved = kv.json("sub:" + NEW);
  assert.equal(moved.tid, undefined);
  assert.equal(await W.tripMemberIdFor(moved, NEW), "7712345678901");
  assert.deepEqual(kv.json("acct:" + await W.acctHash(NEW)), { cid: "7712345678901" });
  assert.equal(kv.m.has("acct:" + await W.acctHash(EMAIL)), false);
  assert.equal([...kv.m.keys()].some((k) => k.startsWith("tidkept:")), false);
});

test("a newcomer at an address someone moved away from gets a trip id of their own", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, NEW = "jane.new@example.com", id = "e" + await W.acctHash(EMAIL);
  const sub = { email: EMAIL, tok: TOK, hunts: [] };
  kv.set("sub:" + EMAIL, sub); kv.set("trips:" + id, ["taaaaaaaaa"]);
  await moveTo(env, sub, NEW);
  const newcomer = { email: EMAIL, tok: "N".repeat(24), hunts: [] };
  kv.set("sub:" + EMAIL, newcomer);
  const theirs = await W.tripIdOf(env, newcomer, EMAIL);
  assert.match(theirs, /^e[0-9a-f]{16}$/); assert.notEqual(theirs, id);
  assert.equal(kv.json("sub:" + EMAIL).tid, theirs, "kept, so it stays the same");
  assert.equal(await W.tripIdOf(env, kv.json("sub:" + EMAIL), EMAIL), theirs);
  assert.equal(await W.tripIdOf(env, kv.json("sub:" + NEW), NEW), id, "the member who moved keeps theirs");
  /* with no move behind an address, the id is the address's hash, as before */
  assert.equal(await W.tripIdOf(env, { email: "hark@example.com", tok: "h", hunts: [] }, "hark@example.com"), "e" + await W.acctHash("hark@example.com"));
});

test("saved.js keeps hp only from the stored copy, and savedHp finds it", async () => {
  const hp = "ab".repeat(8), u = "https://www.ebay.com/itm/1";
  const m = S.savedMerge({ saved: [{ url: u, title: "Vase", at: 1, ph: 1, hp }] }, { saved: [{ url: u, title: "Vase", at: 1, hp: "cd".repeat(8) }, { url: u + "2", title: "Bowl", at: 2, ph: 1, hp: "cd".repeat(8) }] }, 10);
  assert.equal(m.saved.find((f) => f.url === u).hp, hp);
  assert.equal(m.saved.find((f) => f.url === u + "2").hp, undefined, "a device cannot point a photo elsewhere");
  assert.equal(S.savedHp({ saved: [{ url: u, hp }] }, u, "h"), hp);
  assert.equal(S.savedHp({ saved: [{ url: u, hp: "../x" }] }, u, "h"), "h");
  assert.equal(S.savedHp(null, u, "h"), "h");
});

test("wired: the photo URL, the sync's and the sweep's deletes use hp; the move lists keep their tails; v181", () => {
  assert.match(indexFn("alSaved"), /savedPhotoUrl\(env, f\.hp \|\| h, /);
  assert.match(indexFn("alSaved"), /photoKey\(savedHp\(had, u, h\), /);
  assert.match(indexFn("savedSweep"), /photoKey\(savedHp\(had, u, h\), /);
  assert.match(indexFn("alPurge"), /await tripsForget\(env, tids\);/);
  assert.match(indexFn("tripWho"), /await tripIdOf\(env, sub, email\)/);
  assert.ok(Number(/const WORKER_VERSION = "v(\d+)";/.exec(INDEX)[1]) >= 182);   /* v183: or later */
});

/* v182: the review of part 5 */
const X = "x@example.com", XF = "x.new@example.com", XG = "x.third@example.com";
async function seedX(env) {
  const kv = env.PROWL_ALERTS, r2 = env.PROWL_FINDS, id = "e" + await W.acctHash(X), u = "https://www.ebay.com/itm/9";
  const sub = { email: X, tok: TOK, hunts: [] };
  kv.set("sub:" + X, sub);
  kv.set("trip:taaaaaaaaa", trip("taaaaaaaaa", id, [id, "1002"])); kv.set("trips:" + id, ["taaaaaaaaa"]); kv.set("trips:1002", ["taaaaaaaaa"]);
  kv.set("trips:all", [{ id: "taaaaaaaaa", expires: "x" }]);
  kv.set("tripfinds:taaaaaaaaa", [find("faaaaaaaaa", id)]); r2.m.set("finds/taaaaaaaaa/faaaaaaaaa.jpg", 1);
  kv.set("saved:" + X, { saved: [{ url: u, title: "Vase", at: 1, ph: 1 }], gone: [] }); kv.set("saved:all", [X]);
  const photo = "saved/" + await W.sha16(X) + "/" + await W.sha16(u) + ".jpg";
  r2.m.set(photo, 1);
  return { sub, id, u, photo };
}

test("v182: a Delete by a newcomer at an address someone moved away from leaves that member's trips and photos", async () => {
  for (const viaPrev of [false, true]) {
    const env = envOf(), kv = env.PROWL_ALERTS, r2 = env.PROWL_FINDS, s = await seedX(env);
    await moveTo(env, s.sub, XF);
    assert.equal(kv.json("hpkept:" + await W.sha16(X)).n, 1);
    /* Y joins at X's old address, gets a trip id of their own, saves a find with a photo there */
    let y = { email: X, tok: "Y".repeat(24), hunts: [] };
    kv.set("sub:" + X, y);
    const yid = await W.tripIdOf(env, y, X); y = kv.json("sub:" + X);
    kv.set("trip:tyyyyyyyyy", trip("tyyyyyyyyy", yid, [yid])); kv.set("trips:" + yid, ["tyyyyyyyyy"]);
    const yu = "https://www.ebay.com/itm/10", yphoto = "saved/" + await W.sha16(X) + "/" + await W.sha16(yu) + ".jpg";
    kv.set("saved:" + X, { saved: [{ url: yu, title: "Bowl", at: 1, ph: 1 }], gone: [] }); r2.m.set(yphoto, 1);
    if (viaPrev) { await moveTo(env, y, "y.new@example.com"); y = kv.json("sub:y.new@example.com"); assert.equal(y.tid, yid, "Y takes their own id, not X's"); }
    await W.alPurge(env, y.email, y);
    assert.ok(kv.m.has("trip:taaaaaaaaa"), "X's trip stays");
    assert.deepEqual(kv.json("trip:taaaaaaaaa").members, [s.id, "1002"]);
    assert.deepEqual(kv.json("trips:" + s.id), ["taaaaaaaaa"]);
    assert.ok(r2.m.has("finds/taaaaaaaaa/faaaaaaaaa.jpg"));
    assert.ok(kv.m.has("tidkept:" + s.id), "X's mark stays");
    assert.ok(r2.m.has(s.photo), "X's saved photo stays");
    assert.equal(kv.json("saved:" + XF).saved[0].hp, await W.sha16(X));
    assert.equal(r2.m.has(yphoto), false, "Y's own photo goes");
    assert.equal(kv.m.has("trip:tyyyyyyyyy"), false, "Y's trip goes");
    /* then X deletes: everything of X's goes, the marks too */
    await W.alPurge(env, XF, kv.json("sub:" + XF));
    noTrace(env, [s.id, await W.sha16(X), XF]);
    assert.equal(kv.m.has("trip:taaaaaaaaa"), true, "handed to 1002");
    assert.deepEqual(kv.json("trip:taaaaaaaaa").members, ["1002"]);
  }
});

test("v182: a member who moves away and back keeps their trip id and their trips", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, s = await seedX(env);
  await moveTo(env, s.sub, XF);
  await moveTo(env, kv.json("sub:" + XF), X);
  const back = kv.json("sub:" + X);
  assert.equal(back.tid, s.id);
  assert.equal(await W.tripIdOf(env, back, X), s.id, "not a newcomer");
  assert.equal(kv.json("sub:" + X).tid, s.id, "the tid is not replaced");
  assert.deepEqual(kv.json("trips:" + s.id), ["taaaaaaaaa"]);
  assert.deepEqual(kv.json("acct:" + await W.acctHash(X)), { cid: s.id });
  /* away again: the same id; the photo counts once; a Delete clears every mark */
  await moveTo(env, kv.json("sub:" + X), XG);
  assert.equal(kv.json("sub:" + XG).tid, s.id);
  assert.equal(kv.json("hpkept:" + await W.sha16(X)).n, 1);
  await W.alPurge(env, XG, kv.json("sub:" + XG));
  noTrace(env, [s.id, await W.sha16(X), X, XF, XG]);
  assert.equal([...kv.m.keys()].some((k) => k.startsWith("tidkept:") || k.startsWith("hpkept:")), false);
});

test("v182: two members left photos under one address; one Delete keeps the other's", async () => {
  const env = envOf(), kv = env.PROWL_ALERTS, r2 = env.PROWL_FINDS, s = await seedX(env), h = await W.sha16(X);
  await moveTo(env, s.sub, XF);
  const z = { email: X, tok: "Z".repeat(24), hunts: [] }, zu = "https://www.ebay.com/itm/11", zphoto = "saved/" + h + "/" + await W.sha16(zu) + ".jpg";
  kv.set("sub:" + X, z); kv.set("saved:" + X, { saved: [{ url: zu, title: "Jug", at: 1, ph: 1 }], gone: [] }); r2.m.set(zphoto, 1);
  await moveTo(env, z, "z.new@example.com");
  assert.equal(kv.json("hpkept:" + h).n, 2);
  assert.notEqual(kv.json("sub:z.new@example.com").tid, s.id, "Z's own trip id");
  await W.alPurge(env, XF, kv.json("sub:" + XF));
  assert.equal(r2.m.has(s.photo), false, "X's photo goes");
  assert.ok(r2.m.has(zphoto), "Z's stays");
  assert.equal(kv.json("hpkept:" + h).n, 1);
  await W.alPurge(env, "z.new@example.com", kv.json("sub:z.new@example.com"));
  assert.equal(r2.m.has(zphoto), false);
  assert.equal(kv.m.has("hpkept:" + h), false);
});
