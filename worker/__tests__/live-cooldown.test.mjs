/* v91: a marketplace that says "slow down" cools down (shared through Caps); meanwhile a search gets the last good
   answer as a spare, or a 429 "busy", never a 502; Vinted searches wait their turn; its cookies are shared.
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
const lineOf = (re) => { const m = re.exec(INDEX); assert.ok(m, String(re)); return m[0]; };

/* a clock the lifted code reads through Date.now() and new Date() */
function clockAt(t) {
  const clock = { t };
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock.t])); } static now() { return clock.t; } }
  return { clock, FakeDate };
}
/* PCACHE as Caps keeps it: a value lives for its max-age */
function fakeCache(clock) {
  const m = new Map(), puts = [];
  return {
    m, puts,
    async match(req) {
      const k = typeof req === "string" ? req : req.url, e = m.get(k);
      if (!e || e.until <= clock.t) return undefined;
      return new Response(e.b, { status: e.s, headers: e.h });
    },
    async put(req, res) {
      const k = typeof req === "string" ? req : req.url, mm = /max-age=(\d+)/.exec(res.headers.get("Cache-Control") || "");
      const h = {}; res.headers.forEach((v, n) => { h[n] = v; });
      const e = { b: await res.text(), s: res.status, h, until: clock.t + (mm ? Number(mm[1]) : 3600) * 1000 };
      m.set(k, e); puts.push([k, e]);
    }
  };
}
function fakeCaps() {
  const n = new Map(), calls = [];
  return {
    n, calls,
    async capsCall(name, op, body) {
      calls.push([name, op, body]);
      if (op !== "take") return null;
      const k = name + "|" + body.k, c = n.get(k) || 0;
      if (c >= body.lim) return { left: -1, n: c };
      n.set(k, c + 1);
      return { left: body.lim - c - 1, n: c + 1 };
    }
  };
}
const quiet = { log() {}, error() {} };

function lift({ t = Date.parse("2026-10-09T19:30:10Z"), caps = fakeCaps(), extra = [], deps = {}, onWait = null } = {}) {
  const { clock, FakeDate } = clockAt(t), cache = fakeCache(clock), waits = [];
  const fakeTimeout = (fn, ms) => { waits.push(ms); clock.t += ms; if (onWait) onWait(); fn(); return 0; };
  const src = [
    lineOf(/^const ALLOW_ORIGINS = \[[\s\S]*?\];/m),
    lineOf(/^const VINTED_JAR_MS = [^\n]*;/m), lineOf(/^let vintedJar = [^\n]*;/m), lineOf(/^const VINTED_JAR_KEY = [^\n]*;/m),
    lineOf(/^const LIVE_COOL = [^\n]*;/m), lineOf(/^const LIVE_COOL_URL = [^\n]*;/m), lineOf(/^const LIVE_COOL_SEEN_MS = [^\n]*;/m),
    lineOf(/^const VINTED_GAP_MS = [^\n]*;/m), lineOf(/^let vintedNext = [^\n]*;/m),
    ...["cors", "json", "capsDay", "vintedJarLoad", "vintedJarSave", "coolCode", "coolUntil", "coolStart", "vintedTurn",
      "liveFresh", "liveServe", "liveKeep", "liveSpare", ...extra].map(indexFn)
  ].join("\n");
  const names = ["coolCode", "coolUntil", "coolStart", "vintedTurn", "vintedJarLoad", "vintedJarSave", "liveFresh", "liveServe", "liveKeep", "liveSpare", ...extra];
  const X = new Function("PCACHE", "capsCall", "Date", "setTimeout", "console", "DEPS",
    "const { liveSources, liveFetch, PROBE_TERMS, vintedCall, vintedNormalize, AL_PER_SITE } = DEPS || {};\n" + src +
    "\nreturn { " + names.join(", ") + ", LIVE_COOL, LIVE_COOL_MAX, LIVE_STALE_SECONDS, VINTED_PER_MIN, VINTED_GAP_MS, VINTED_WAIT_MAX, jar: () => vintedJar, setJar: (j) => { vintedJar = j; }, cool: (s, t) => { liveCooling[s] = t; } };");
  const api = X(cache, caps.capsCall, FakeDate, fakeTimeout, quiet, deps);
  return Object.assign(api, { clock, cache, caps, waits });
}
const ORIGIN = "https://www.owlandtwigvintage.com";

test("only a 429, or Vinted's 403, starts a cool-down", () => {
  const X = lift();
  assert.equal(X.coolCode("vinted", 429), 429);
  assert.equal(X.coolCode("ebay", 429), 429);
  assert.equal(X.coolCode("vinted", 403), 403);
  assert.equal(X.coolCode("etsy", 403), 0, "another marketplace's 403 is a broken key, not a slow-down");
  for (const s of [200, 401, 404, 500, 502, 0]) assert.equal(X.coolCode("vinted", s), 0, String(s));
});

test("a cool-down lasts 90s after a 429 and 10 minutes after Vinted's 403, is shared through Caps, and then ends", async () => {
  const X = lift(), t0 = X.clock.t;
  assert.equal(await X.coolUntil("vinted"), 0);
  assert.equal(await X.coolStart("vinted", 200, ""), 0);
  assert.equal(await X.coolStart("vinted", 500, ""), 0);
  assert.equal(X.cache.puts.length, 0, "nothing stored for an answer that is not a slow-down");

  assert.equal(await X.coolStart("vinted", 429, ""), t0 + 90 * 1000);
  assert.equal(await X.coolUntil("vinted"), t0 + 90 * 1000);
  assert.equal(await X.coolUntil("ebay"), 0, "one marketplace at a time");

  /* another isolate (no memory of it) reads it from Caps */
  const Y = lift({ t: t0 + 1000 });
  for (const [k, e] of X.cache.m) Y.cache.m.set(k, e);
  assert.equal(await Y.coolUntil("vinted"), t0 + 90 * 1000);

  X.clock.t = t0 + 90 * 1000 + 1;
  assert.equal(await X.coolUntil("vinted"), 0, "over when the time is up");

  assert.equal(await X.coolStart("vinted", 403, ""), X.clock.t + 10 * 60 * 1000);
});

test("Retry-After stretches a cool-down, never past the cap; a short or odd one keeps the 90s", async () => {
  const at = (ra) => { const X = lift(); return X.coolStart("ebay", 429, ra).then(u => u - X.clock.t); };
  assert.equal(await at("300"), 300 * 1000);
  assert.equal(await at("99999"), 15 * 60 * 1000);
  assert.equal(await at("5"), 90 * 1000);
  assert.equal(await at("Wed, 21 Oct 2026 07:28:00 GMT"), 90 * 1000, "a date is ignored");
  const X = lift(), t0 = X.clock.t;
  await X.coolStart("ebay", 429, "");
  assert.equal(X.cache.m.get("https://prowl-internal.invalid/cool/ebay").until, t0 + 90 * 1000, "Caps keeps it only as long as it lasts");
});

test("a later 429 never shortens the longer cool-down a block started, in this isolate or another", async () => {
  const X = lift(), t0 = X.clock.t;
  assert.equal(await X.coolStart("vinted", 403, ""), t0 + 10 * 60 * 1000);
  X.clock.t = t0 + 2000;
  assert.equal(await X.coolStart("vinted", 429, ""), t0 + 10 * 60 * 1000, "still the block's 10 minutes");
  const Y = lift({ t: t0 + 3000 });
  for (const [k, e] of X.cache.m) Y.cache.m.set(k, e);
  assert.equal(await Y.coolStart("vinted", 429, ""), t0 + 10 * 60 * 1000);
  const Z = lift({ t: t0 + 100 * 1000 });
  for (const [k, e] of Y.cache.m) Z.cache.m.set(k, e);
  assert.equal(await Z.coolUntil("vinted"), t0 + 10 * 60 * 1000, "Caps still holds the block");
});

test("a 'not cooling' answer is trusted for a few seconds, so most searches skip the Caps lookup", async () => {
  const X = lift();
  assert.equal(await X.coolUntil("etsy"), 0);
  const n = X.cache.m.size;
  /* another isolate starts a cool-down: seen here within LIVE_COOL_SEEN_MS */
  X.cache.m.set("https://prowl-internal.invalid/cool/etsy", { b: String(X.clock.t + 90000), s: 200, h: {}, until: X.clock.t + 90000 });
  assert.equal(await X.coolUntil("etsy"), 0, "remembered as not cooling");
  X.clock.t += 5001;
  assert.ok(await X.coolUntil("etsy"), "then asked again");
  assert.equal(n, 0);
});

test("Vinted searches wait their turn: 1s apart in an isolate, give up past 6s, at most VINTED_PER_MIN a minute in all", async () => {
  const X = lift();
  assert.equal(await X.vintedTurn(), true);
  assert.deepEqual(X.waits, [], "the first goes now");
  /* a burst: each later one waits for the one before */
  const burst = [];
  const t0 = X.clock.t;
  for (let i = 0; i < 3; i++) { X.clock.t = t0; burst.push(await X.vintedTurn()); }
  assert.deepEqual(burst, [true, true, true]);
  assert.deepEqual(X.waits, [1000, 2000, 3000]);
  /* 6s of queue already: the next is turned away rather than waiting longer */
  X.waits.length = 0;
  X.clock.t = t0;
  for (let i = 0; i < 3; i++) { X.clock.t = t0; await X.vintedTurn(); }
  X.clock.t = t0;
  assert.equal(await X.vintedTurn(), false);
  assert.deepEqual(X.waits.slice(0, 3), [4000, 5000, 6000]);
  const minuteKey = X.caps.calls.filter(c => c[1] === "take").map(c => c[2].k)[0];
  assert.match(minuteKey, /^vinted:2026-10-09T19:3\d$/, "counted per minute");

  /* across isolates: the Caps count for the minute */
  const caps = fakeCaps(), at = Date.parse("2026-10-09T20:00:05Z");
  const results = [];
  for (let i = 0; i < 12; i++) { const Z = lift({ t: at + i, caps }); results.push(await Z.vintedTurn()); }
  assert.equal(results.filter(Boolean).length, X.VINTED_PER_MIN);
  assert.deepEqual(results.slice(X.VINTED_PER_MIN), [false, false]);
  /* a new minute, a new count */
  const W = lift({ t: at + 60 * 1000, caps });
  assert.equal(await W.vintedTurn(), true);
});

test("a Vinted search that waited its turn does not go out if Vinted said slow down meanwhile", async () => {
  let X = null;
  X = lift({ onWait: () => X.cool("vinted", X.clock.t + 90000) });
  assert.equal(await X.vintedTurn(), true);
  assert.equal(await X.vintedTurn(), false, "the one queued behind it stops");
});

test("a Caps hiccup does not stop Vinted searches", async () => {
  const X = lift({ caps: { calls: [], async capsCall() { throw new Error("caps 500"); } } });
  assert.equal(await X.vintedTurn(), true);
});

test("Vinted's cookies are shared through Caps for VINTED_JAR_MS, and dropped there too", async () => {
  const X = lift(), t0 = X.clock.t;
  const s = { jar: ["access_token_web=abc", "_vinted_fr_session=x"], origin: "https://www.vinted.com", homeStatus: 200, at: t0 };
  await X.vintedJarSave(s);
  assert.deepEqual(X.jar(), s);

  const Y = lift({ t: t0 + 60 * 1000 });
  for (const [k, e] of X.cache.m) Y.cache.m.set(k, e);
  assert.deepEqual(await Y.vintedJarLoad(), s, "a new isolate picks them up");

  const Z = lift({ t: t0 + 11 * 60 * 1000 });
  for (const [k, e] of X.cache.m) Z.cache.m.set(k, { ...e, until: Infinity });
  assert.equal(await Z.vintedJarLoad(), null, "too old to use, even if Caps still had them");

  await X.vintedJarSave(null);
  assert.equal(X.jar(), null);
  const V = lift({ t: t0 + 1000 });
  for (const [k, e] of X.cache.m) V.cache.m.set(k, e);
  assert.equal(await V.vintedJarLoad(), null, "a refused jar is dropped for everyone");

  /* junk in Caps is ignored */
  const J = lift({ t: t0 });
  J.cache.m.set("https://prowl-internal.invalid/vinted-jar", { b: '{"jar":"nope","origin":1,"at":0}', s: 200, h: {}, until: Infinity });
  assert.equal(await J.vintedJarLoad(), null);
});

test("a cached answer is fresh for the marketplace's own time and kept a day as a spare", async () => {
  const X = lift(), now = X.clock.t;
  const res = new Response(JSON.stringify({ term: "lucite", source: "vinted", items: [{ url: "https://www.vinted.com/items/1", title: "Lucite box" }] }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800", "X-Prowl-Cache": "miss" } });
  const kept = X.liveKeep(res, 1800, now);
  assert.equal(kept.headers.get("Cache-Control"), "public, max-age=" + X.LIVE_STALE_SECONDS);
  assert.equal(kept.headers.get("X-Prowl-Fresh-Until"), String(now + 1800 * 1000));
  assert.equal(X.liveFresh(kept, now + 1799 * 1000), true);
  assert.equal(X.liveFresh(kept, now + 1800 * 1000), false);
  assert.equal(X.liveFresh(new Response("{}", { headers: { "Cache-Control": "public, max-age=1800" } }), now), true, "an entry from before v91 is fresh while it lasts");

  /* served fresh: the visitor's CORS, the browser told only the time left, no internal mark */
  const served = X.liveServe(kept, ORIGIN, now + 600 * 1000);
  assert.equal(served.headers.get("Cache-Control"), "public, max-age=1200");
  assert.equal(served.headers.get("X-Prowl-Fresh-Until"), null);
  assert.equal(served.headers.get("X-Prowl-Cache"), "hit");
  assert.equal(served.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal((await served.json()).items.length, 1);

  const old = X.liveServe(new Response("{}", { headers: { "Cache-Control": "public, max-age=1800" } }), ORIGIN, now);
  assert.equal(old.headers.get("Cache-Control"), "public, max-age=1800", "an old entry keeps its own");
});

test("the spare: the last good answer marked stale (200), or with none a 429 busy with Retry-After, never a 502", async () => {
  const X = lift();
  const stale = new Response(JSON.stringify({ term: "madball", source: "vinted", items: [{ url: "https://www.vinted.com/items/2", title: "Madball" }] }));
  const r = await X.liveSpare(stale, "vinted", "cooling down", 45000, ORIGIN);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Prowl-Cache"), "stale");
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  const j = await r.json();
  assert.equal(j.stale, true);
  assert.equal(j.staleWhy, "cooling down");
  assert.equal(j.items.length, 1);

  const b = await X.liveSpare(null, "vinted", "cooling down", 45000, ORIGIN);
  assert.equal(b.status, 429);
  assert.equal(b.headers.get("Retry-After"), "45");
  assert.deepEqual(await b.json(), { error: "busy", source: "vinted", why: "cooling down", retryIn: 45 });

  const d = await X.liveSpare(null, "shopgoodwill", "unreachable", 0, ORIGIN);
  assert.equal(d.status, 429);
  assert.equal(d.headers.get("Retry-After"), "60", "no hint: a minute");

  const junk = await X.liveSpare(new Response("not json"), "vinted", "answered 500", 0, ORIGIN);
  assert.equal(junk.status, 429, "a spare that cannot be read is no spare");
  const noItems = await X.liveSpare(new Response('{"error":"x"}'), "vinted", "answered 500", 0, ORIGIN);
  assert.equal(noItems.status, 429);
});

test("the hourly test searches skip a marketplace cooling down and start one on a 429", async () => {
  const asked = [];
  const X = lift({ extra: ["runProbes"], deps: {
    liveSources: () => ["shopgoodwill", "vinted", "grailed"], PROBE_TERMS: {},
    liveFetch: async (env, src) => { asked.push(src); return src === "grailed" ? { status: 429, items: null, ms: 5, err: "answered 429" } : { status: 200, items: [{}], ms: 5 }; }
  } });
  await X.coolStart("vinted", 403, "");
  const out = await X.runProbes({});
  assert.deepEqual(asked.sort(), ["grailed", "shopgoodwill"]);
  const resting = out.find(p => p.source === "vinted");
  assert.ok(resting, "the resting one still gets a record, so a long block shows in the admin area");
  assert.equal(resting.ok, false);
  assert.match(resting.err, /^resting: it asked Prowl to slow down \(until \d\d:\d\d UTC\)$/);
  assert.ok(await X.coolUntil("grailed"), "the probe's 429 starts a cool-down");
  assert.equal(await X.coolUntil("shopgoodwill"), 0);
});

test("alert searches skip a marketplace cooling down, pace Vinted, and start a cool-down on its 429", async () => {
  let calls = 0, answer = { status: 200, text: "page" };
  const X = lift({ extra: ["alSearch"], deps: {
    vintedCall: async () => { calls++; return answer; },
    vintedNormalize: () => [{ url: "https://www.vinted.com/items/3", title: "Viking glass", price: "$20" }], AL_PER_SITE: 5
  } });
  assert.equal((await X.alSearch({}, "vinted", "viking glass", "")).length, 1);
  assert.equal(calls, 1);
  assert.ok(X.caps.calls.some(c => c[1] === "take" && /^vinted:/.test(c[2].k)), "Vinted's turn was taken");

  answer = { status: 429, text: "", retryAfter: "120" };
  assert.deepEqual(await X.alSearch({}, "vinted", "viking glass", ""), []);
  assert.equal(await X.coolUntil("vinted"), X.clock.t + 120 * 1000);
  answer = { status: 200, text: "page" };
  assert.deepEqual(await X.alSearch({}, "vinted", "viking glass", ""), [], "cooling: not asked");
  assert.equal(calls, 2);
});

test("the live route checks the cool-down before it counts the visitor or calls out, and answers failures with the spare", () => {
  const start = INDEX.indexOf("const spare = (why, retryMs) => liveSpare(");
  assert.ok(start > 0, "the live route uses liveSpare");
  const body = INDEX.slice(start, INDEX.indexOf("\n    return res;\n", start));
  const at = (s) => { const i = body.indexOf(s); assert.ok(i > -1, s); return i; };
  assert.ok(at("await coolUntil(source)") < at("vCount(\"sr:\" + sip"), "cooling answers do not use up the visitor's searches");
  assert.ok(at("vCount(\"sr:\" + sip") < at("isVinted && !(await vintedTurn())"));
  assert.ok(at("isVinted && !(await vintedTurn())") < at("up = isEbay ?"));
  assert.match(body, /catch \(e\) \{[\s\S]*?if \(stale\) return spare\("unreachable"\);[\s\S]*?502/, "unreachable: the spare first");
  assert.match(body, /const until = await coolStart\(source, up\.status, up\.retryAfter\);[^\n]*\n\s*if \(until \|\| stale\) return spare\(/);
  assert.match(body, /if \(items === null\) \{\s*\n\s*if \(stale\) return spare\(/);
  assert.match(body, /cache\.put\(key, liveKeep\(res\.clone\(\), fresh, Date\.now\(\)\)\)/);
  assert.match(body, /if \(isVinted && !\(await vintedTurn\(\)\)\) \{[\s\S]{0,80}await coolUntil\(source\)/, "a turn refused for a cool-down says so");
  const hitAt = INDEX.lastIndexOf("const hit = await cache.match(key);", start);
  assert.match(INDEX.slice(hitAt - 400, hitAt), /\+ "&keep=1"/, "kept-a-day entries have their own key, so a rollback never serves them as fresh");
  assert.match(INDEX.slice(hitAt, start), /if \(liveFresh\(hit, Date\.now\(\)\)\) return liveServe\(hit, origin, Date\.now\(\)\);\s*\n\s*stale = hit;/);
});
