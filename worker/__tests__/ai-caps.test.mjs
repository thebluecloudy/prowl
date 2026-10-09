/* v93: the AI limits, run with the real counters. Every other test stubs vTake/vCount/poolOk, and the Oct 2 burst hole
   came from counters that did nothing in production while mocked tests passed, so here the real ipKey, ipNet, vTake,
   vCount, poolOk, giveBack and verdict / research run against the real Caps Durable Object code over an in-memory
   store, with a fixed clock. What one address, one IPv6 /64, one /24 and a crowd across many networks can spend.
   Run: node --test worker/__tests__/ai-caps.test.mjs */
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
const consts = INDEX.match(/^const (VERDICT|RESEARCH)_[A-Z_]+ = .*$/gm).join("\n");

/* the real Caps class, with an in-memory storage; one object per name, as Cloudflare gives one per idFromName */
const capsSrc = (() => { const m = /^export class Caps \{/m.exec(INDEX); return INDEX.slice(m.index + "export ".length, INDEX.indexOf("\n}\n", m.index) + 2); })();
const Caps = new Function("metricsOp", "metricsPrune", capsSrc + "\nreturn Caps;")(() => ({}), () => {});
function capsWorld() {
  const objs = new Map();
  const storage = () => { const m = new Map(); let alarm = null; return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k), getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }, list: async () => new Map(m) }; };
  const world = { broken: false, calls: [] };
  world.capsCall = async (name, op, body) => {
    world.calls.push(op);
    if (world.broken) throw new Error("caps down");
    let o = objs.get(name);
    if (!o) objs.set(name, (o = new Caps({ storage: storage() })));
    const r = await o.op(op, body);
    return JSON.parse(await r.text());
  };
  return world;
}

/* a clock the test moves */
function clock(iso) {
  let now = Date.parse(iso);
  class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return now; } }
  return { Date: FixedDate, advance: (ms) => { now += ms; } };
}

function load({ answer = "ITEM: Black panther TV lamp, 1955\nVERDICT: FAIR\nFAIR PRICE: $40-60\nWHY: Sold at $45 and $55.", pro = null } = {}) {
  const world = capsWorld(), time = clock("2026-10-09T15:10:00Z"), paid = [];
  const deps = {
    ALLOW_ORIGINS: ["https://www.owlandtwigvintage.com"], G_ENV: null, console: { error() {}, log() {} },
    json: (body, status, origin, extra) => ({ status: status || 200, body, extra }),
    readJson: async (r) => r.body,
    PCACHE: { match: async () => null, put: async () => {} },
    caches: { default: { match: async () => null, put: async () => {} } },
    proMember: async () => pro,
    museAsk: async () => { paid.push("verdict"); return { status: 200, content: answer }; },
    fetch: async () => { paid.push("research"); return { ok: false, status: 500 }; },
    AbortController, setTimeout, clearTimeout,
    capsCall: (...a) => world.capsCall(...a),
    Date: time.Date,
    Request: class { constructor(u) { this.url = u; } },
    Response: class { constructor(b) { this.b = b; } async text() { return this.b; } },
    MUSE_RESPONSES_URL: "https://ai.invalid", MUSE_MODEL: "m", PCACHE_TTL: 1,
  };
  const keys = Object.keys(deps);
  const names = ["ip6Parts", "ipKey", "ipNet", "isOwner", "capsDay", "vTake", "vCount", "poolOk", "busyNow", "giveBack",
    "vClean", "scrubListingText", "sha16", "noCents", "soldCited", "verdictAuction", "verdict", "research"];
  const f = new Function(...keys, consts + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, world, time, paid };
}
const ORIGIN = "https://www.owlandtwigvintage.com";
let n = 0;
const fp = (ip) => ({ body: { title: "Black panther TV lamp " + (++n), price: "$" + (20 + n) + ".00", url: "https://shopgoodwill.com/item/" + n, details: "", comps: [] },
  headers: { get: (h) => (h === "CF-Connecting-IP" ? ip : null) } });
const rs = (ip) => ({ body: { item: "Black panther TV lamp " + (++n) }, headers: { get: (h) => (h === "CF-Connecting-IP" ? ip : null) } });
const ENV = { MUSE_API_KEY: "k" };

test("one address: one free Fair price a day, then 429 free limit; one paid call", async () => {
  const L = load();
  const out = [];
  for (let i = 0; i < 25; i++) out.push(await L.verdict(fp("203.0.113.9"), ENV, ORIGIN));
  assert.equal(out[0].status, 200);
  assert.equal(out[0].body.left, 0);
  for (const r of out.slice(1)) { assert.equal(r.status, 429); assert.equal(r.body.error, "free limit"); }
  assert.equal(L.paid.length, 1);
});

test("an IPv6 host changing address inside its /64 is still one visitor", async () => {
  const L = load();
  const out = [];
  for (let i = 1; i <= 10; i++) out.push(await L.verdict(fp("2001:db8:1:2::" + i.toString(16)), ENV, ORIGIN));
  assert.equal(out.filter((r) => r.status === 200).length, 1);
  assert.equal(L.paid.length, 1);
});

test("one /24: 20 free checks a day across all its addresses", async () => {
  const L = load();
  const out = [];
  for (let i = 1; i <= 30; i++) out.push(await L.verdict(fp("198.51.100." + i), ENV, ORIGIN));
  assert.equal(out.filter((r) => r.status === 200).length, 20);
  assert.ok(out.slice(20).every((r) => r.status === 429 && r.body.error === "free limit"));
});

test("a crowd across many networks: one hour's share (a sixth of 400), then busy now with Retry-After", async () => {
  const L = load();
  const out = [];
  for (let i = 0; i < 90; i++) out.push(await L.verdict(fp("10." + i + ".7.1"), ENV, ORIGIN));
  const ok = out.filter((r) => r.status === 200).length;
  assert.equal(ok, 67, "Math.ceil(400 / 6)");
  const busy = out.slice(67);
  assert.ok(busy.every((r) => r.status === 429 && r.body.error === "busy now"));
  assert.ok(Number(busy[0].extra["Retry-After"]) >= 60);
  assert.equal(L.paid.length, 67);
});

test("v93: a visitor turned away with busy now keeps their free check for later in the day", async () => {
  const L = load();
  for (let i = 0; i < 67; i++) assert.equal((await L.verdict(fp("10." + i + ".8.1"), ENV, ORIGIN)).status, 200);
  const late = "192.0.2.77";
  const r1 = await L.verdict(fp(late), ENV, ORIGIN);
  assert.equal(r1.body.error, "busy now");
  L.time.advance(60 * 60000);   /* the next hour */
  const r2 = await L.verdict(fp(late), ENV, ORIGIN);
  assert.equal(r2.status, 200, "the check was given back, not spent on 'busy now'");
  assert.ok(L.world.calls.includes("give"));
  assert.equal((await L.verdict(fp(late), ENV, ORIGIN)).body.error, "free limit", "and it is still one a day");
});

test("v93: a full network gives the address's count back", async () => {
  const L = load();
  for (let i = 1; i <= 20; i++) await L.verdict(fp("198.51.100." + i), ENV, ORIGIN);
  const r = await L.verdict(fp("198.51.100.200"), ENV, ORIGIN);
  assert.equal(r.body.error, "free limit");
  /* the address's own check is still there (a phone leaving the shared wifi can use it): the counter is back at 0 */
  const t = await L.world.capsCall(L.capsDay(), "take", { k: "fp:198.51.100.200", lim: 1 });
  assert.equal(t.left, 0);
});

test("a failed AI answer is not given back (it could be made to fail on purpose and retried for free)", async () => {
  const L = load({ answer: "I will not answer in that format." });
  const a = await L.verdict(fp("203.0.113.50"), ENV, ORIGIN);
  assert.equal(a.status, 502);
  const b = await L.verdict(fp("203.0.113.50"), ENV, ORIGIN);
  assert.equal(b.status, 429, "the free check was spent");
  assert.equal(b.body.error, "free limit");
});

test("counters that cannot be reached mean no, never free", async () => {
  const L = load();
  L.world.broken = true;
  const r = await L.verdict(fp("203.0.113.60"), ENV, ORIGIN);
  assert.equal(r.status, 429);
  assert.equal(L.paid.length, 0);
});

test("Pro members have their own ceiling and skip the free pool", async () => {
  const L = load({ pro: "member@example.com" });
  const out = [];
  for (let i = 0; i < 5; i++) out.push(await L.verdict(fp("203.0.113.70"), ENV, ORIGIN));
  assert.ok(out.every((r) => r.status === 200));
});

test("v93: research has a per-network cap (15 a day) as well as 5 per address", async () => {
  const L = load();
  const out = [];
  for (let i = 1; i <= 20; i++) out.push(await L.research(rs("198.51.100." + i), ENV, ORIGIN));
  /* past the gate the stubbed AI fails (502); a refusal at the gate is 429 */
  assert.equal(out.filter((r) => r.status === 502).length, 15);
  assert.ok(out.slice(15).every((r) => r.status === 429 && r.body.error === "daily limit"));
  const one = load(), seq = [];
  for (let i = 0; i < 8; i++) seq.push(await one.research(rs("203.0.113.80"), ENV, ORIGIN));
  assert.equal(seq.filter((r) => r.status === 502).length, 5, "5 per address");
});
