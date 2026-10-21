/* v157: Facebook watches, the routes in index.js: GET|POST /watches (store session), POST /fb-ingest with a session
   (one check cycle from the extension), the email's one-tap Hide and the watch-email unsubscribe. The real functions
   are lifted out of index.js and run against a fake KV, a fake session and a fake Resend.
   Run: node --test worker/__tests__/fb-watch-routes.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../watch.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const consts = INDEX.match(/^const WATCH_[A-Z_]+ = .*$/gm).join("\n");

class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); this.puts = 0; }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); this.ttl.set(k, o && o.expirationTtl); this.puts++; }
  async delete(k) { this.m.delete(k); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const CID = "7012345678901";
function load({ pro = false, member = true, full = false, claims = null } = {}) {
  const mails = [], counts = [];
  const deps = {
    json: (body, status, origin, extra) => ({ status: status || 200, body, extra: extra || {}, origin }),
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    kvPut: async (e, k, v) => { await e.PROWL_ALERTS.put(k, JSON.stringify(v)); },
    vCount: async (name) => { counts.push(name); return !full; },
    sessVerify: async (req) => { const m = /^Bearer (\d+)$/.exec(req.headers.get("Authorization") || ""); return m ? m[1] : null; },
    sessMember: async (req) => (member && /^Bearer /.test(req.headers.get("Authorization") || "") ? { email: "hunter@example.com", cid: CID } : null),
    sessKey: (env) => String(env.PROWL_SESSION_SECRET || ""),
    capsCall: async (name, op, body) => { if (!claims) return null; const k = name + "|" + body.k; const n = claims.get(k) || 0; if (n >= body.lim) return { left: -1 }; claims.set(k, n + 1); return { left: 0 }; },
    tripPro: async (env, req, who) => { assert.ok(who && who.id, "Pro is asked for an account"); return pro; },
    alSend: async (env, to, subject, html, text, unsub) => { mails.push({ to, subject, html, text, unsub }); return { ok: true }; },
    alShell: (env, inner, why, links) => "<shell>" + inner + "<why>" + why + "</why><links>" + links + "</links></shell>",
    alAddr: () => "Owl & Twig Vintage · Novi, Michigan",
    alBadLink: (msg) => ({ status: 400, page: msg }),
    alGate: (title, msg, button) => ({ status: 200, gate: title, button }),
    alPage: (title, msg) => ({ status: 200, page: title, msg }),
    PROWL_APP: "https://www.owlandtwigvintage.com/pages/prowl-app", PROWL_PAGE: "https://www.owlandtwigvintage.com/pages/prowl", WORKER_BASE: "https://prowl.thebluecloud.workers.dev",
    ...W,
  };
  const keys = Object.keys(deps);
  const names = ["readJson", "alSame", "pxHmac", "alEsc", "alEmail", "sha16", "acctHash", "tripIdOk", "tripMemberIdFor", "watchWho", "watchSub", "watchReg", "watchRegPut", "watchHid", "watchHideSet", "watchPro", "watchSig", "watchUnsubUrl", "watchFbUrl", "watchView",
    "watchClaim", "watchAnswer", "watchesGet", "watchesPost", "watchIngestRoute", "watchShell", "watchMail", "watchHideLink", "watchUnsub", "watchPurge"];
  const f = new Function(...keys, consts + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, mails, counts };
}
const ENV = () => ({ PROWL_ALERTS: new FakeKV(), PROWL_SESSION_SECRET: "s".repeat(40) });
function req(method, body, { auth = "Bearer " + CID, headers = {} } = {}) {
  const text = body == null ? "" : JSON.stringify(body);
  const h = { "content-length": String(text.length), "content-type": "application/json", ...(auth ? { authorization: auth } : {}), ...headers };
  return { method, text: async () => text, headers: { get: (n) => (h[n.toLowerCase()] == null ? null : h[n.toLowerCase()]) } };
}
const U = (p) => new URL("https://prowl.thebluecloud.workers.dev" + p);
const ORIGIN = "https://www.owlandtwigvintage.com";
const IT = (id, extra = {}) => ({ id: String(id), title: "Ceramic black panther " + id, price: "$150", image: "https://scontent.xx.fbcdn.net/v/" + id + ".jpg", location: "Novi, MI", ...extra });
async function make(L, env, body) { return L.watchesPost(req("POST", body), env, U("/watches"), ORIGIN); }
async function cycle(L, env, results) { return L.watchIngestRoute(req("POST", { results }), env); }

test("watches need a store session; the answer never carries the email address", async () => {
  const L = load(), env = ENV();
  assert.equal((await L.watchesGet(req("GET", null, { auth: "" }), env, U("/watches"), ORIGIN)).status, 401);
  assert.equal((await L.watchesPost(req("POST", { term: "x" }, { auth: "" }), env, U("/watches"), ORIGIN)).status, 401);
  assert.equal((await L.watchIngestRoute(req("POST", { results: [] }, { auth: "" }), env)).status, 401);
  const r = await L.watchesGet(req("GET"), env, U("/watches"), ORIGIN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { plan: W.watchPlan(false), mail: true, email: true, watches: [], hidden: [] });
  assert.equal(r.extra["Cache-Control"], "private, no-store");
  assert.doesNotMatch(JSON.stringify(r.body), /hunter@example\.com/);
});

test("a member who signed in with the emailed code (no store account) uses watches by their Prowl token", async () => {
  const L = load({ pro: true, member: false }), env = ENV();
  env.PROWL_ALERTS.m.set("sub:code@example.com", JSON.stringify({ email: "code@example.com", tok: "tok-0123456789abcdef", hunts: [] }));
  const as = (method, body, tok = "tok-0123456789abcdef") => req(method, body, { auth: "", headers: { "x-prowl-email": "Code@Example.com", "x-prowl-tok": tok } });
  assert.equal((await L.watchesGet(as("GET", null, "wrong"), env, U("/watches"), ORIGIN)).status, 401);
  const r = await L.watchesPost(as("POST", { term: "owl", tier: "hot" }), env, U("/watches"), ORIGIN);
  assert.equal(r.status, 200);
  const keys = [...env.PROWL_ALERTS.m.keys()].filter((k) => k.startsWith("watch:"));
  assert.equal(keys.length, 1); assert.match(keys[0], /^watch:e[0-9a-f]{16}$/, "keyed by the address's id, never the address");
  const w = r.body.watches[0];
  const puts = env.PROWL_ALERTS.puts;
  await L.watchIngestRoute(as("POST", { results: [{ watch: w.id, gen: w.gen, status: "ok", items: [] }] }), env);
  assert.equal(env.PROWL_ALERTS.puts - puts, 2, "a quiet first look: the seen state and the registry, nothing else");
  await L.watchIngestRoute(as("POST", { results: [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(9100001)] }] }), env);
  assert.equal(L.mails.length, 1); assert.equal(L.mails[0].to, "code@example.com");
  assert.match(L.mails[0].html, /watch-hide\?c=e[0-9a-f]{16}&amp;i=9100001/);
  const id = keys[0].slice(6), sig = await L.watchSig(env, "hide", id, "9100001");
  const h = await L.watchHideLink(req("POST", null, { auth: "" }), env, U("/watch-hide?c=" + id + "&i=9100001&s=" + sig));
  assert.match(await h.text(), /won\u2019t come back/);
});

test("create, change and turn off; the plan decides what is allowed", async () => {
  const L = load(), env = ENV();
  let r = await make(L, env, { goal: "find me a ceramic panther under $200", tier: "weekly" });
  assert.equal(r.status, 200);
  const w = r.body.watches[0];
  assert.equal(w.term, "ceramic panther"); assert.equal(w.ceiling, 200); assert.deepEqual(w.metros, ["local"]); assert.equal(w.activeAt, "");
  assert.equal(r.body.watch, w.id);
  r = await make(L, env, { id: w.id, tier: "daily" });
  assert.equal(r.status, 403); assert.match(r.body.error, /Daily watches come with Prowl Pro/);
  r = await make(L, env, { term: "owl", tier: "weekly" });
  assert.equal(r.status, 403, "free holds one");
  const P = load({ pro: true });
  r = await make(P, env, { id: w.id, tier: "hot", skip: "repro" });
  assert.equal(r.body.watches[0].tier, "hot"); assert.equal(r.body.watches[0].gen, 2, "new skip-words, a new baseline");
  env.PROWL_ALERTS.m.set("fbseen:" + CID + ":" + w.id, "{}"); env.PROWL_ALERTS.m.set("fbfinds:" + CID + ":" + w.id, "{}");
  r = await make(P, env, { id: w.id, tier: "off" });
  assert.deepEqual(r.body.watches, []);
  assert.equal(env.PROWL_ALERTS.m.has("fbseen:" + CID + ":" + w.id), false, "its seen state goes with it");
  assert.equal(env.PROWL_ALERTS.m.has("fbfinds:" + CID + ":" + w.id), false);
});

test("a check cycle: the baseline alerts nothing, then a new listing alerts once with its read, and the rest is counted", async () => {
  const claims = new Map(), L = load({ pro: true, claims }), env = ENV();
  const w = (await make(L, env, { term: "ceramic panther", tier: "daily", ceiling: 300, skip: "repro", metros: ["detroit", "local"] })).body.watches[0];
  let r = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(1000001), IT(1000002)], comps: [150, 150] }]);
  assert.deepEqual(r.body.results, [{ watch: w.id, baseline: true, fresh: 2, finds: 0, filtered: 0 }]);
  assert.equal(L.mails.length, 0, "zero alerts for listings that already existed");
  let reg = env.PROWL_ALERTS.json("watch:" + CID).watches[0];
  assert.ok(reg.activeAt && reg.checkedAt, "active and checked");
  assert.equal(env.PROWL_ALERTS.ttl.get("fbseen:" + CID + ":" + w.id), 60 * 86400);
  const comps = [100, 110, 120, 130, 140, 150, 60];
  r = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(1000003, { price: "$60" }), IT(1000004, { price: "$900" }), IT(1000005, { title: "Panther repro" })], comps }]);
  assert.deepEqual(r.body.results, [{ watch: w.id, baseline: false, fresh: 3, finds: 1, filtered: 2 }]);
  assert.equal(L.mails.length, 1, "one digest for the cycle");
  const m = L.mails[0];
  assert.equal(m.to, "hunter@example.com");
  assert.equal(m.subject, "New on Facebook: Ceramic black panther 1000003 · $60");
  assert.match(m.html, /Fair price\? Looks like a deal/); assert.match(m.html, /below the usual asking price/);
  assert.match(m.html, /https:\/\/www\.facebook\.com\/marketplace\/item\/1000003\//);
  assert.match(m.html, /watch-hide\?c=7012345678901&amp;i=1000003&amp;s=[0-9a-f]{32}/);
  assert.match(m.unsub, /\/watch-unsub\?c=7012345678901&s=[0-9a-f]{32}$/);
  assert.match(m.text, /Stop watch emails: /);
  reg = env.PROWL_ALERTS.json("watch:" + CID).watches[0];
  assert.equal(reg.filtered, 2); assert.equal(reg.found, 1);
  assert.deepEqual(env.PROWL_ALERTS.json("fbfinds:" + CID + ":" + w.id).items.map((x) => x.id), ["1000003"]);
  const page = await L.watchesGet(req("GET"), env, U("/watches?finds=1&seen=1"), ORIGIN);
  assert.deepEqual(page.body.finds[w.id].map((x) => x.id), ["1000003"]);
  assert.deepEqual(page.body.watches[0].seen.split(",").sort(), ["1000001", "1000002", "1000003", "1000004", "1000005"]);
  /* the same listing from a second browser, and a retry: no second alert */
  r = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(1000003, { price: "$60" })], comps }]);
  assert.equal(r.body.results[0].finds, 0); assert.equal(L.mails.length, 1);
});

test("two browsers reporting one listing at the same moment: the claim lets one alert through", async () => {
  const claims = new Map(), L = load({ pro: true, claims }), env = ENV();
  const w = (await make(L, env, { term: "owl", tier: "hot" })).body.watches[0];
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [], comps: [] }]);
  const seenBefore = env.PROWL_ALERTS.m.get("fbseen:" + CID + ":" + w.id);
  const a = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(2000001)], comps: [] }]);
  env.PROWL_ALERTS.m.set("fbseen:" + CID + ":" + w.id, seenBefore);   /* the second browser read KV before the first one's write landed */
  const b = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(2000001)], comps: [] }]);
  assert.equal(a.body.results[0].finds + b.body.results[0].finds, 1);
  assert.equal(L.mails.length, 1, "Hot: one email for the listing, once");
});

test("Hot: one email per new listing; Daily and Weekly share one digest a cycle", async () => {
  const L = load({ pro: true }), env = ENV();
  const hot = (await make(L, env, { term: "owl", tier: "hot" })).body.watches[0];
  const day = (await make(L, env, { term: "panther", tier: "daily" })).body.watches.find((x) => x.term === "panther");
  const wk = (await make(L, env, { term: "fox", tier: "weekly" })).body.watches.find((x) => x.term === "fox");
  await cycle(L, env, [hot, day, wk].map((w) => ({ watch: w.id, gen: w.gen, status: "ok", items: [], comps: [] })));
  await cycle(L, env, [
    { watch: hot.id, gen: hot.gen, status: "ok", items: [IT(3000001), IT(3000002)], comps: [] },
    { watch: day.id, gen: day.gen, status: "ok", items: [IT(3000003)], comps: [] },
    { watch: wk.id, gen: wk.gen, status: "ok", items: [IT(3000004), IT(3000005)], comps: [] },
  ]);
  assert.equal(L.mails.length, 3);
  assert.match(L.mails[0].subject, /^New on Facebook: Ceramic black panther 3000001/);
  assert.match(L.mails[1].subject, /^New on Facebook: Ceramic black panther 3000002/);
  assert.equal(L.mails[2].subject, "3 new on Facebook for 2 watches");
});

test("not logged in to Facebook: only that is recorded, the check does not count, and two in a row show", async () => {
  const L = load(), env = ENV();
  const w = (await make(L, env, { term: "owl" })).body.watches[0];
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "nologin", items: [IT(4000001)] }]);
  let r = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "nologin" }]);
  assert.deepEqual(r.body.results, [{ watch: w.id, skips: 2 }]);
  const reg = env.PROWL_ALERTS.json("watch:" + CID).watches[0];
  assert.equal(reg.skips, 2); assert.equal(reg.checkedAt, ""); assert.equal(env.PROWL_ALERTS.m.has("fbseen:" + CID + ":" + w.id), false, "nothing it carried was used");
  r = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [], comps: [] }]);
  assert.equal(env.PROWL_ALERTS.json("watch:" + CID).watches[0].skips, 0);
});

test("a cycle for old filters, an unknown watch or a paused one changes nothing", async () => {
  const L = load({ pro: true }), env = ENV();
  const w = (await make(L, env, { term: "owl", tier: "daily" })).body.watches[0];
  await make(L, env, { id: w.id, ceiling: 50 });
  let r = await cycle(L, env, [{ watch: w.id, gen: 1, status: "ok", items: [IT(5000001)] }, { watch: "wnope0000", status: "ok", items: [] }]);
  assert.deepEqual(r.body.results, [{ watch: w.id, stale: true }, { watch: "wnope0000", gone: true }]);
  assert.equal(env.PROWL_ALERTS.m.has("fbseen:" + CID + ":" + w.id), false);
  const F = load({ pro: false });
  await make(L, env, { term: "fox", tier: "daily" });
  const list = (await F.watchesGet(req("GET"), env, U("/watches"), ORIGIN)).body.watches;
  assert.deepEqual(list.map((x) => [x.term, x.runs, x.paused]), [["owl", "weekly", false], ["fox", "weekly", true]], "Pro ended: the oldest keeps running weekly");
  r = await cycle(F, env, [{ watch: list[1].id, gen: list[1].gen, status: "ok", items: [] }]);
  assert.deepEqual(r.body.results, [{ watch: list[1].id, gone: true }]);
});

test("ingest guards: size, shape, rate", async () => {
  const L = load(), env = ENV();
  assert.equal((await L.watchIngestRoute(req("POST", { nope: 1 }), env)).status, 400);
  const big = req("POST", { results: [] }, { headers: { "content-length": String(300000) } });
  assert.equal((await L.watchIngestRoute(big, env)).status, 413);
  assert.equal((await load({ full: true }).watchIngestRoute(req("POST", { results: [] }), env)).status, 429);
  assert.ok(L.counts.every((c) => c === "fbw:" + CID));
});

test("hidden listings: hidden from the page or an email never alert or show again, and the page gets them back to discard", async () => {
  const L = load({ pro: true }), env = ENV();
  const w = (await make(L, env, { term: "owl", tier: "daily" })).body.watches[0];
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [], comps: [] }]);
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(6000001), IT(6000002)], comps: [] }]);
  let r = await L.watchesPost(req("POST", { id: "6000001" }), env, U("/watches/hide"), ORIGIN);
  assert.deepEqual(r.body, { ok: true, hidden: 1 });
  r = await L.watchesGet(req("GET"), env, U("/watches?finds=1"), ORIGIN);
  assert.deepEqual(r.body.finds[w.id].map((x) => x.id), ["6000002"]);
  assert.deepEqual(r.body.hidden, ["https://www.facebook.com/marketplace/item/6000001/"]);
  /* the email link: GET only shows a page that posts itself; the POST hides; Undo brings it back */
  const sig = await L.watchSig(env, "hide", CID, "6000002");
  const link = U("/watch-hide?c=" + CID + "&i=6000002&s=" + sig);
  r = await L.watchHideLink(req("GET", null, { auth: "" }), env, link);
  assert.equal(r.status, 200); assert.match(await r.text(), /document\.getElementById\("f"\)\.submit\(\)/);
  assert.deepEqual(env.PROWL_ALERTS.json("fbhide:" + CID).ids, ["6000001"], "a scanner fetching the link hides nothing");
  r = await L.watchHideLink(req("POST", null, { auth: "" }), env, link);
  assert.match(await r.text(), /won’t come back/);
  assert.deepEqual(env.PROWL_ALERTS.json("fbhide:" + CID).ids, ["6000001", "6000002"]);
  await L.watchHideLink(req("POST", null, { auth: "" }), env, U("/watch-hide?c=" + CID + "&i=6000002&s=" + sig + "&undo=1"));
  assert.deepEqual(env.PROWL_ALERTS.json("fbhide:" + CID).ids, ["6000001"]);
  r = await L.watchHideLink(req("POST", null, { auth: "" }), env, U("/watch-hide?c=" + CID + "&i=6000002&s=" + "0".repeat(32)));
  assert.equal(r.status, 400, "a forged link does nothing");
  r = await L.watchHideLink(req("POST", null, { auth: "" }), env, U("/watch-hide?c=" + CID + "&i=6000003&s=" + sig));
  assert.equal(r.status, 400, "a signature is for one listing");
  /* a hidden listing that turns up new (say, relisted) is only marked seen */
  await L.watchesPost(req("POST", { id: "6000009" }), env, U("/watches/hide"), ORIGIN);
  const c = await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(6000009)], comps: [] }]);
  assert.equal(c.body.results[0].finds, 0);
});

test("watch emails: off from the email (one-click or the button), off and on from the page; no member address, no email", async () => {
  const L = load({ pro: true }), env = ENV();
  const w = (await make(L, env, { term: "owl", tier: "hot" })).body.watches[0];
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [] }]);
  const sig = await L.watchSig(env, "unsub", CID, "all");
  let r = await L.watchUnsub(req("GET", null, { auth: "" }), env, U("/watch-unsub?c=" + CID + "&s=" + sig));
  assert.equal(r.gate, "Stop watch emails?");
  assert.equal(env.PROWL_ALERTS.json("watch:" + CID).mail, true);
  r = await L.watchUnsub(req("POST", null, { auth: "" }), env, U("/watch-unsub?c=" + CID + "&s=" + sig));
  assert.equal(r.page, "Watch emails are off");
  assert.equal(env.PROWL_ALERTS.json("watch:" + CID).mail, false);
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(7000001)] }]);
  assert.equal(L.mails.length, 0, "off means off");
  assert.deepEqual((await L.watchesGet(req("GET"), env, U("/watches?finds=1"), ORIGIN)).body.finds[w.id].map((x) => x.id), ["7000001"], "finds still land in Prowl");
  r = await make(L, env, { mail: true });
  assert.equal(r.body.mail, true);
  assert.equal((await L.watchUnsub(req("POST", null, { auth: "" }), env, U("/watch-unsub?c=" + CID + "&s=bad"))).status, 400);
  const N = load({ pro: true, member: false });
  await cycle(N, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(7000002)] }]);
  assert.equal(N.mails.length, 0, "no Prowl Alerts address linked: in Prowl only");
});

test("an edit made on the page during a check cycle is kept; the cycle's counters still land", async () => {
  const L = load({ pro: true }), env = ENV();
  const w = (await make(L, env, { term: "owl", tier: "daily" })).body.watches[0];
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [] }]);
  const kv = env.PROWL_ALERTS, get = kv.get.bind(kv);
  let edited = false;
  kv.get = async (k, t) => {   /* the page saves Hot right after the cycle has read the registry */
    const v = await get(k, t);
    if (k === "fbseen:" + CID + ":" + w.id && !edited) { edited = true; await make(L, env, { id: w.id, tier: "hot" }); }
    return v;
  };
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(9200001, { price: "$900" })] }]);
  kv.get = get;
  const reg = env.PROWL_ALERTS.json("watch:" + CID).watches[0];
  assert.equal(reg.tier, "hot", "the edit stays");
  assert.equal(reg.found, 1, "and the find is counted");
});

test("a member who turned off all Prowl emails gets no watch emails; the Den is told", async () => {
  const L = load({ pro: true, member: false }), env = ENV();
  env.PROWL_ALERTS.m.set("sub:off@example.com", JSON.stringify({ email: "off@example.com", tok: "tok-0123456789abcdef", hunts: [], mail: "off" }));
  const as = (method, body) => req(method, body, { auth: "", headers: { "x-prowl-email": "off@example.com", "x-prowl-tok": "tok-0123456789abcdef" } });
  const r = await L.watchesPost(as("POST", { term: "owl", tier: "daily" }), env, U("/watches"), ORIGIN);
  assert.equal(r.body.email, false);
  const w = r.body.watches[0];
  await L.watchIngestRoute(as("POST", { results: [{ watch: w.id, gen: w.gen, status: "ok", items: [] }] }), env);
  await L.watchIngestRoute(as("POST", { results: [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(9300001)] }] }), env);
  assert.equal(L.mails.length, 0);
});

test("purge: everything kept for the account's watches goes", async () => {
  const L = load({ pro: true }), env = ENV();
  const w = (await make(L, env, { term: "owl", tier: "hot" })).body.watches[0];
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(8000001)] }]);
  await cycle(L, env, [{ watch: w.id, gen: w.gen, status: "ok", items: [IT(8000002)] }]);
  await L.watchesPost(req("POST", { id: "8000002" }), env, U("/watches/hide"), ORIGIN);
  assert.ok(env.PROWL_ALERTS.m.size >= 4);
  await L.watchPurge(env, CID);
  assert.deepEqual([...env.PROWL_ALERTS.m.keys()], []);
});

test("index.js routes: the session ingest beside the sweep's key, email links before the Origin check, and the purge", () => {
  assert.match(INDEX, /\(request\.headers\.get\("Authorization"\) \|\| request\.headers\.get\("X-Prowl-Tok"\)\) && !request\.headers\.get\("X-Prowl-Ingest"\) \? watchIngestRoute\(request, env\) : fbIngest\(request, env\)/);
  const guard = INDEX.indexOf('if (request.method === "POST" && ALLOW_ORIGINS.indexOf(origin) === -1)');
  assert.ok(INDEX.indexOf('url.pathname === "/watch-hide"') < guard && INDEX.indexOf('url.pathname === "/watch-unsub"') < guard);
  assert.ok(INDEX.indexOf('return watchesPost(request, env, url, origin)') > guard, "the page's own posts keep the Origin check");
  assert.match(indexFn("alPurge"), /if \(cid\) await watchPurge\(env, cid\); await watchPurge\(env, "e" \+ await acctHash\(email\)\)/);
  assert.match(INDEX, /const WORKER_VERSION = "v157";/);
});
