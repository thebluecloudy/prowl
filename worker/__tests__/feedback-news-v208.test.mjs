/* v208 (Matt, 2026-10-31): POST /feedback and the admin's Feedback tab; the "What's new" update email (news.js), its
   admin card and the alert clock's batched send.
   Run: node --test worker/__tests__/feedback-news-v208.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as N from "../news.js";
import { adminFetch, signSession } from "../admin.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
const ORIGIN = "https://www.owlandtwigvintage.com";

class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); if (o && o.expirationTtl) this.ttl.set(k, o.expirationTtl); }
  async delete(k) { this.m.delete(k); this.ttl.delete(k); }
  async list({ prefix, cursor, limit }) {
    const all = [...this.m.keys()].filter(k => k.startsWith(prefix || "")).sort(), from = Number(cursor || 0), n = limit || 1000;
    const keys = all.slice(from, from + n).map(name => ({ name }));
    return { keys, list_complete: from + n >= all.length, cursor: String(from + n) };
  }
  set(k, v) { this.m.set(k, JSON.stringify(v)); }
  json(k) { return this.m.has(k) ? JSON.parse(this.m.get(k)) : null; }
}
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);

function deps(over) {
  const sent = [], counts = new Map();
  const D = {
    sent, counts,
    json: (body, status) => ({ status: status || 200, body }),
    readJson: async (r) => (r._big ? { big: true } : r.body || {}),
    kvGet: async (env, k, d) => { const v = await env.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    kvPut: async (env, k, v) => env.PROWL_ALERTS.put(k, JSON.stringify(v)),
    ipKey: (ip) => "ip-" + ip,
    vCount: async (name, lim) => { const n = (counts.get(name) || 0) + 1; counts.set(name, n); return n <= lim; },
    isOwner: (req) => req.headers.get("X-Prowl-Owner") === "OWNER",
    memberOf: async (req, env) => { const e = req.headers.get("X-Prowl-Email"), t = req.headers.get("X-Prowl-Tok"); const s = e ? await env.PROWL_ALERTS.get("sub:" + e, "json") : null; return s && s.tok === t ? s : null; },
    alSend: async (env, to, subject, html, text, unsub, att, replyTo) => { if (D.failNext) { D.failNext--; return { ok: false, error: "resend 500" }; } sent.push({ to, subject, html, text, unsub, replyTo }); return { ok: true }; },
    alEsc: esc,
    alShell: (env, inner, why, links) => "<html><body><table>" + inner + "<tr><td>" + why + "<br>" + (links ? links + '<br>Or just reply &quot;unsubscribe&quot; to this email.<br>' : "") + "Copyright © Owl &amp; Twig Vintage<br>Owl &amp; Twig Vintage · Novi, Michigan</td></tr></table></body></html>",
    alAddr: () => "Owl & Twig Vintage · Novi, Michigan",
    alMerge: async (env, sub, fields) => { const cur = await env.PROWL_ALERTS.get("sub:" + sub.email, "json"); if (!cur) return null; fields.forEach(f => { cur[f] = sub[f]; }); await env.PROWL_ALERTS.put("sub:" + sub.email, JSON.stringify(cur)); Object.assign(sub, cur); return cur; },
    alMailSub: async (env, sub) => Object.assign({}, sub, { k: "TICKET" }),
    alLinkHash: (sub) => "#e=" + encodeURIComponent(sub.email) + (sub.k ? "&k=" + sub.k : ""),
    alUnsubUrl: (sub) => "https://w.example/alerts/unsub?e=" + encodeURIComponent(sub.email) + "&t=" + (sub.utok || ""),
    alUpgradeUrl: (sub) => "https://shop.example/pages/prowl-app?alerts=in&upgrade=1#e=" + encodeURIComponent(sub.email),
    scrubPII: (s) => String(s).replace(/\S+@\S+/g, "[email]"),
    ALLOW_ORIGINS: [ORIGIN], PROWL_APP: "https://shop.example/pages/prowl-app", AL_UNSUB_MAIL: "hello@owlandtwigvintage.com",
  };
  return Object.assign(D, over || {});
}
const hdrs = (o) => ({ get: (h) => (o || {})[h] ?? null });
const req = (body, h) => ({ body, headers: hdrs(Object.assign({ "CF-Connecting-IP": "1.2.3.4" }, h || {})) });
const MEMBER = { email: "jane@example.com", tok: "T".repeat(36), utok: "U".repeat(36), hunts: ["pyrex"], pro: true, mail: "on" };
function envWith(...subs) { const kv = new FakeKV(); subs.forEach(s => kv.set("sub:" + s.email, s)); return { PROWL_ALERTS: kv }; }
const fbkKeys = (env) => [...env.PROWL_ALERTS.m.keys()].filter(k => k.startsWith("fbk:"));

/* ---------- POST /feedback ---------- */
test("fbkText strips control and direction characters, keeps line breaks, caps at 1000", () => {
  assert.equal(N.fbkText("  hi\u0000 there‮\r\n\r\n\r\n\r\nnext\t line ​ "), "hi there\n\nnext  line");
  assert.equal(N.fbkText("x".repeat(1500)).length, 1000);
  assert.equal(N.fbkText(null), "");
  assert.equal(N.fbkText({ toString: () => "<b>" }), "<b>", "kept as text; the admin and the email escape it");
});
test("fbkClean: rating 1-5 or none, booleans for reply, a page version only when it looks like one, and something to send", () => {
  assert.deepEqual(N.fbkClean({ rating: 4.4, like: " a ", miss: "", reply: true, v: "v8.35" }), { rating: 4, like: "a", miss: "", reply: true, v: "v8.35" });
  assert.equal(N.fbkClean({ rating: 9, like: "a" }).rating, 0);
  assert.equal(N.fbkClean({ rating: -1, like: "a" }).rating, 0);
  assert.equal(N.fbkClean({ like: "a", reply: "yes" }).reply, false);
  assert.equal(N.fbkClean({ like: "a", v: "<script>" }).v, "");
  assert.ok(N.fbkClean({}).error);
  assert.ok(N.fbkClean({ like: "   \u0001 " }).error, "blank after cleaning");
  assert.ok(!N.fbkClean({ rating: 2 }).error, "a rating alone is fine");
});
test("POST /feedback, signed out: stored 180 days with no address and no IP, emailed to the shop with the shop as reply-to", async () => {
  const env = envWith(), D = deps();
  const r = await N.fbkPost(req({ rating: 5, like: "The <Store> tab", miss: "Dark\nmode", reply: true, v: "v8.35" }), env, ORIGIN, D);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.reply, false, "no reply without a sign-in");
  const ks = fbkKeys(env); assert.equal(ks.length, 1);
  assert.match(ks[0], /^fbk:\d{13}-[0-9a-z]{6}$/);
  assert.equal(env.PROWL_ALERTS.ttl.get(ks[0]), 180 * 86400);
  const e = env.PROWL_ALERTS.json(ks[0]);
  assert.deepEqual(Object.keys(e).sort(), ["at", "like", "miss", "plan", "rating", "v"]);
  assert.equal(e.plan, "signed-out"); assert.equal(e.like, "The <Store> tab");
  assert.ok(!JSON.stringify(e).includes("1.2.3.4"), "no IP");
  assert.equal(D.sent.length, 1);
  assert.equal(D.sent[0].to, "hello@owlandtwigvintage.com");
  assert.equal(D.sent[0].replyTo, "", "the default reply-to (the shop) stays");
  assert.match(D.sent[0].html, /The &lt;Store&gt; tab/, "escaped in the email");
  assert.match(D.sent[0].html, /Dark<br>mode/);
  assert.match(D.sent[0].subject, /^Prowl feedback · ★★★★★ · Signed out$/);
});
test("POST /feedback, a member: plan from the record, the address only when they ticked OK to email me back", async () => {
  const env = envWith(MEMBER), D = deps(), H = { "X-Prowl-Email": MEMBER.email, "X-Prowl-Tok": MEMBER.tok };
  await N.fbkPost(req({ miss: "Maps", reply: false }, H), env, ORIGIN, D);
  let e = env.PROWL_ALERTS.json(fbkKeys(env)[0]);
  assert.equal(e.plan, "pro"); assert.equal(e.reply, undefined);
  assert.ok(!JSON.stringify(e).includes("jane@"), "no address without the tick");
  assert.ok(!D.sent[0].html.includes("jane@") && !D.sent[0].text.includes("jane@"));
  assert.equal(D.sent[0].replyTo, "");
  const r = await N.fbkPost(req({ like: "Lots", reply: true }, H), env, ORIGIN, D);
  assert.equal(r.body.reply, true);
  const withReply = fbkKeys(env).map(k => env.PROWL_ALERTS.json(k)).find(x => x.like === "Lots");
  assert.equal(withReply.reply, "jane@example.com");
  assert.equal(D.sent[1].replyTo, "jane@example.com", "reply-to the member only when they asked");
  const wrongTok = await N.fbkPost(req({ like: "x", reply: true }, { "X-Prowl-Email": MEMBER.email, "X-Prowl-Tok": "nope" }), env, ORIGIN, D);
  assert.equal(wrongTok.body.reply, false, "a wrong token is signed out: no address");
});
test("POST /feedback: refused cross-site, too large, empty; 5 a day per IP and per member; the owner is not counted; a failed copy still saves", async () => {
  const env = envWith(MEMBER), D = deps();
  assert.equal((await N.fbkPost(req({ like: "a" }), env, "https://evil.example", D)).status, 403);
  assert.equal((await N.fbkPost(Object.assign(req({}), { _big: true }), env, ORIGIN, D)).status, 413);
  assert.equal((await N.fbkPost(req({ like: " " }), env, ORIGIN, D)).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await N.fbkPost(req({ like: "n" + i }), env, ORIGIN, D)).status, 200);
  const sixth = await N.fbkPost(req({ like: "six" }), env, ORIGIN, D);
  assert.equal(sixth.status, 429); assert.match(sixth.body.error, /hello@owlandtwigvintage\.com/);
  const H = { "X-Prowl-Email": MEMBER.email, "X-Prowl-Tok": MEMBER.tok };
  for (let i = 0; i < 5; i++) assert.equal((await N.fbkPost(req({ like: "m" + i }, Object.assign({ "CF-Connecting-IP": "9.9.9." + i }, H)), env, ORIGIN, D)).status, 200);
  assert.equal((await N.fbkPost(req({ like: "m6" }, Object.assign({ "CF-Connecting-IP": "8.8.8.8" }, H)), env, ORIGIN, D)).status, 429, "per member across IPs");
  assert.ok([...D.counts.keys()].some(k => k === "fbkm:jane@example.com"), "member counter (index.js's vCount hashes an address in a counter name)");
  assert.equal((await N.fbkPost(req({ like: "owner" }, { "X-Prowl-Owner": "OWNER" }), env, ORIGIN, D)).status, 200, "owner not limited");
  D.failNext = 1;
  const before = fbkKeys(env).length, r = await N.fbkPost(req({ like: "mail down" }, { "CF-Connecting-IP": "7.7.7.7" }), env, ORIGIN, D);
  assert.equal(r.status, 200); assert.equal(r.body.mailed, false); assert.equal(fbkKeys(env).length, before + 1);
});
test("fbkKey sorts newest first; fbkList reads newest first and never returns an address", async () => {
  assert.ok(N.fbkKey(2000, "a") < N.fbkKey(1000, "a"));
  const env = envWith();
  env.PROWL_ALERTS.set(N.fbkKey(Date.parse("2026-10-01"), "aaaaaa"), { at: "2026-10-01T10:00:00.000Z", rating: 2, like: "", miss: "old", plan: "free", v: "v8.30" });
  env.PROWL_ALERTS.set(N.fbkKey(Date.parse("2026-10-30"), "bbbbbb"), { at: "2026-10-30T10:00:00.000Z", rating: 5, like: "new", miss: "", plan: "pro", reply: "jane@example.com", v: "v8.35" });
  const r = await N.fbkList(env);
  assert.deepEqual(r.entries.map(e => e.miss || e.like), ["new", "old"]);
  assert.equal(r.entries[0].reply, true); assert.equal(r.entries[1].reply, false);
  assert.ok(!JSON.stringify(r).includes("jane@"), "the list has no address");
  assert.equal(await N.fbkReplyTo(env, r.entries[0].id), "jane@example.com");
  assert.equal(await N.fbkReplyTo(env, r.entries[1].id), "");
  assert.equal(await N.fbkReplyTo(env, "../sub:jane"), "");
  assert.equal(await N.fbkDelete(env, "sub:jane@example.com"), false, "only feedback ids");
  assert.equal(await N.fbkDelete(env, r.entries[1].id), true);
  assert.equal((await N.fbkList(env)).entries.length, 1);
});
test("Delete my account takes the address out of feedback and keeps the note", async () => {
  const env = envWith(), k = N.fbkKey(Date.now(), "cccccc");
  env.PROWL_ALERTS.set(k, { at: new Date().toISOString(), rating: 3, like: "x", miss: "", plan: "pro", reply: "Jane@Example.com" });
  assert.equal(await N.fbkForget(env, "jane@example.com"), 1);
  const g = env.PROWL_ALERTS.json(k);
  assert.equal(g.reply, undefined); assert.equal(g.like, "x");
  assert.ok(env.PROWL_ALERTS.ttl.get(k) > 179 * 86400, "keeps its 180 days");
  assert.match(INDEX, /try \{ if \(await fbkForget\(env, email\)\) gone\.push\("fbk:"\); \} catch \(e\) \{\}/, "alPurge calls it");
});
test("wired in: the route, alSend's reply-to and the version", () => {
  assert.match(INDEX, /if \(url\.pathname === "\/feedback" && request\.method === "POST"\) return fbkPost\(request, env, origin, newsDeps\(\)\);/);
  assert.match(INDEX, /body\.reply_to = replyTo \|\| env\.ALERT_REPLY_TO \|\| AL_UNSUB_MAIL;/);
  assert.match(INDEX, /const WORKER_VERSION = "v208";/);
});

/* ---------- the update email ---------- */
const CUR = (o) => Object.assign(N.newsFresh(Date.parse("2026-11-01T12:00:00Z"), ""), o || {});
test("newsBuild: subject, every section with its link into the app, Pro marked, escaping, no tracking, footer and unsubscribe", () => {
  const D = deps(), ms = Object.assign({}, MEMBER, { k: "TICKET", pro: false });
  const m = N.newsBuild(D, {}, ms, CUR({ note: "Hi <all> & thanks\nMatt" }));
  assert.equal(m.subject, "What’s new in Prowl");
  for (const it of N.NEWS_ITEMS) assert.ok(m.html.includes(esc(it.h)), it.h);
  assert.equal((m.html.match(/>PRO</g) || []).length, N.NEWS_ITEMS.filter(i => i.pro).length, "a PRO chip on each Pro section");
  for (const q of ["daily=1", "wk=1", "photo=1", "store=1", "feedback=1"]) assert.ok(m.html.includes("?alerts=in&amp;" + q + "#e=jane%40example.com&amp;k=TICKET"), q);
  assert.match(m.html, /<i>Hi &lt;all&gt; &amp; thanks<br>Matt<\/i>/, "the note, escaped");
  assert.match(m.html, /Try Prowl Pro/); assert.match(m.html, /upgrade=1/);
  assert.match(m.html, /Tell us what you think/);
  assert.match(m.html, /Stop product updates/); assert.match(m.html, /Unsubscribe from all Prowl emails/);
  assert.match(m.html, /Or just reply &quot;unsubscribe&quot;/); assert.match(m.html, /Novi, Michigan/);
  assert.equal(m.unsub, "https://w.example/alerts/unsub?e=jane%40example.com&t=" + "U".repeat(36) + "&w=news");
  assert.doesNotMatch(m.html, /<img/i, "no tracking pixel, no images");
  assert.match(m.text, /Facebook Marketplace finds \(Pro\)/); assert.match(m.text, /Stop product updates: https/); assert.match(m.text, /Novi, Michigan/);
  const pro = N.newsBuild(D, {}, Object.assign({}, ms, { pro: true }), CUR());
  assert.doesNotMatch(pro.html, /Try Prowl Pro/, "Pro members do not get the Pro line");
  assert.doesNotMatch(pro.html, /<i><\/i>/, "no empty note");
  const pv = N.newsBuild(D, {}, N.newsSample("member@example.com", false), CUR());
  assert.doesNotMatch(pv.html, /alerts=in|TICKET/, "a preview carries no sign-in");
});
test("who gets it: emails on (paused too); emails off or product updates stopped do not; the marker makes it once", () => {
  const cur = CUR({ id: "n1" });
  assert.ok(N.newsDue({ email: "a@x.co", mail: "on" }, cur));
  assert.ok(N.newsDue({ email: "a@x.co", prefs: { pause: "2099-01-01" } }, cur), "paused members get it");
  assert.ok(!N.newsDue({ email: "a@x.co", mail: "off" }, cur));
  assert.ok(!N.newsDue({ email: "a@x.co", newsOff: "2026-11-01" }, cur));
  assert.ok(!N.newsDue({ email: "a@x.co", news: "n1" }, cur));
  assert.ok(N.newsDue({ email: "a@x.co", news: "n0" }, cur), "an older campaign's marker does not count");
  assert.ok(!N.newsDue({ email: "nope" }, cur));
});
function crowd(n) { const subs = []; for (let i = 0; i < n; i++) subs.push({ email: "m" + i + "@example.com", tok: "t", utok: "u" + i, mail: "on", pro: i % 2 === 0 }); return subs; }
test("newsTick: nothing unless sending; at most NEWS_PER_RUN a run and within the room; marker first; done when all have it", async () => {
  const subs = crowd(23).concat([{ email: "off@example.com", mail: "off" }, { email: "stop@example.com", newsOff: "x" }]);
  const env = envWith(...subs), D = deps();
  assert.deepEqual(await N.newsTick(D, env, subs, 50), { sent: 0, failed: 0, done: false }, "no campaign");
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "n1", status: "draft" }));
  assert.equal((await N.newsTick(D, env, subs, 50)).sent, 0, "a draft sends nothing");
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "n1", status: "sending", total: 23 }));
  const read = async () => Promise.all(subs.map(s => D.kvGet(env, "sub:" + s.email, null)));
  let r = await N.newsTick(D, env, await read(), 50);
  assert.equal(r.sent, N.NEWS_PER_RUN); assert.equal(D.sent.length, 10);
  assert.ok(D.sent.every(m => m.unsub.endsWith("&w=news")), "List-Unsubscribe is the news one");
  r = await N.newsTick(D, env, await read(), 3);
  assert.equal(r.sent, 3, "the room the run has left");
  r = await N.newsTick(D, env, await read(), 50);
  assert.equal(r.sent, 10); assert.equal(r.done, true);
  const cur = await D.kvGet(env, N.NEWS_KEY, null);
  assert.equal(cur.status, "done"); assert.equal(cur.sent, 23); assert.ok(cur.doneAt);
  const to = D.sent.map(m => m.to);
  assert.equal(new Set(to).size, 23, "everyone once");
  assert.ok(!to.includes("off@example.com") && !to.includes("stop@example.com"), "emails off and updates stopped are left out");
  assert.equal((await N.newsTick(D, env, await read(), 50)).sent, 0, "done sends nothing more");
});
test("newsTick: Stop between emails, Resume picks up where it left off; a failed send is counted and not retried; a crash after the marker never sends twice", async () => {
  const subs = crowd(6), env = envWith(...subs), D = deps();
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "n2", status: "sending", total: 6 }));
  const read = async () => Promise.all(subs.map(s => D.kvGet(env, "sub:" + s.email, null)));
  /* stop after the 2nd email: the admin flips the status while the run is going */
  const send0 = D.alSend; let k = 0;
  D.alSend = async (...a) => { const r = await send0(...a); if (++k === 2) { const c = await D.kvGet(env, N.NEWS_KEY, null); c.status = "stopped"; await D.kvPut(env, N.NEWS_KEY, c); } return r; };
  let r = await N.newsTick(D, env, await read(), 50);
  assert.equal(r.sent, 2); let cur = await D.kvGet(env, N.NEWS_KEY, null);
  assert.equal(cur.status, "stopped"); assert.equal(cur.sent, 2, "counts kept with the stop");
  assert.equal((await N.newsTick(D, env, await read(), 50)).sent, 0, "stopped sends nothing");
  D.alSend = send0; cur.status = "sending"; await D.kvPut(env, N.NEWS_KEY, cur);
  D.failNext = 1;
  r = await N.newsTick(D, env, await read(), 50);
  assert.equal(r.sent, 3); assert.equal(r.failed, 1); assert.equal(r.done, true);
  cur = await D.kvGet(env, N.NEWS_KEY, null);
  assert.equal(cur.sent, 5); assert.equal(cur.failed, 1); assert.equal(cur.status, "done");
  assert.equal(new Set(D.sent.map(m => m.to)).size, D.sent.length, "nobody twice");
  for (const s of await read()) assert.equal(s.news, "n2", "every member marked, the failed one too (not retried)");
  /* a crash between the marker and the email: the member is marked, so the next run skips them */
  const env2 = envWith(...crowd(2)), D2 = deps({ alMailSub: async () => { throw new Error("crash"); } });
  await D2.kvPut(env2, N.NEWS_KEY, CUR({ id: "n3", status: "sending" }));
  await N.newsTick(D2, env2, await Promise.all(crowd(2).map(s => D2.kvGet(env2, "sub:" + s.email, null))), 1);
  assert.equal((await D2.kvGet(env2, "sub:m0@example.com", null)).news, "n3");
  assert.equal(D2.sent.length, 0);
});
test("wired in: the clock sends within its budget, unsub ?w=news, the admin routes", () => {
  assert.match(INDEX, /newsTick\(newsDeps\(\), env, subs\.map\(x => x\.sub\), Math\.min\(NEWS_PER_RUN, FB_RUN_CALLS - runUsed\(\) - AL_ESTATE_MIN_CALLS\), Date\.now\(\)\)/);
  assert.match(INDEX, /wkRun\.calls \+ newsRun\.sent \+ newsRun\.failed;/, "its sends count in runUsed");
  assert.match(INDEX, /if \(p\.w === "news"\) \{/);
  assert.match(INDEX, /sub\.newsOff = new Date\(\)\.toISOString\(\);/);
  for (const r of ['feedback: apiFeedback', '"news/preview": apiNewsPreview', '"feedback/delete": apiFeedbackDelete', '"feedback/reply": apiFeedbackReply', '"news/test": apiNewsTest', '"news/send": apiNewsSend', '"news/stop": apiNewsStop', '"news/resume": apiNewsResume']) assert.ok(ADMIN.includes(r), r);
});

/* ---------- the admin routes, through adminFetch (owner session only) ---------- */
const KEY = "k".repeat(32);
async function admin(env, H, method, path, body, signed = true) {
  const cookie = signed ? "prowl_admin=" + await signSession(KEY, Date.now() + 3600000) : "";
  const h = { Cookie: cookie, "Sec-Fetch-Site": "same-origin", Origin: "https://prowl.example" };
  if (method === "POST") h["X-Prowl-Admin"] = "1";
  const request = new Request("https://prowl.example" + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  return adminFetch(request, env, { waitUntil() {} }, H);
}
function adminEnv(subs) { const env = envWith(...(subs || [])); env.ADMIN_KEY = KEY; env.MEMBER_ID_SALT = "salt"; return env; }
async function adminH() {
  const idx = await import("../news.js");
  const D = deps();
  return { D, H: { kvGet: D.kvGet, kvPut: D.kvPut, capsCall: async () => ({ left: 5 }), capsDay: () => "caps:x", vCount: async () => true, WORKER_VERSION: "v208",
    fbkList: idx.fbkList, fbkDelete: idx.fbkDelete, fbkReplyTo: idx.fbkReplyTo, newsBuild: idx.newsBuild, newsSample: idx.newsSample, newsFresh: idx.newsFresh,
    newsView: idx.newsView, newsNote: idx.newsNote, newsEligible: idx.newsEligible, NEWS_KEY: idx.NEWS_KEY, NEWS_PER_RUN: idx.NEWS_PER_RUN, NEWS_TESTS_PER_DAY: idx.NEWS_TESTS_PER_DAY,
    newsDeps: () => D, AL_UNSUB_MAIL: "hello@owlandtwigvintage.com" } };
}
test("admin Feedback: owner session only; the list has no address; Reply by email gives a mailto; Delete removes it", async () => {
  const env = adminEnv(), { H } = await adminH();
  env.PROWL_ALERTS.set(N.fbkKey(Date.now(), "dddddd"), { at: new Date().toISOString(), rating: 1, like: "", miss: "Broken <b>", plan: "free", reply: "jane@example.com", v: "v8.35" });
  assert.equal((await admin(env, H, "GET", "/admin/api/feedback", null, false)).status, 401, "signed out");
  const r = await admin(env, H, "GET", "/admin/api/feedback");
  assert.equal(r.status, 200);
  const t = await r.text(), j = JSON.parse(t);
  assert.ok(!t.includes("jane@"), "no address in the view");
  assert.equal(j.entries.length, 1); assert.equal(j.entries[0].reply, true); assert.equal(j.entries[0].miss, "Broken <b>");
  const id = j.entries[0].id;
  const rp = await (await admin(env, H, "POST", "/admin/api/feedback/reply", { id })).json();
  assert.equal(rp.mailto, "mailto:jane@example.com?subject=Your%20Prowl%20feedback");
  const noHdr = new Request("https://prowl.example/admin/api/feedback/delete", { method: "POST", headers: { Cookie: "prowl_admin=" + await signSession(KEY, Date.now() + 3600000), "Sec-Fetch-Site": "same-origin" }, body: JSON.stringify({ id }) });
  assert.equal((await adminFetch(noHdr, env, {}, H)).status, 403, "a POST needs the admin header");
  assert.equal((await admin(env, H, "POST", "/admin/api/feedback/delete", { id })).status, 200);
  assert.equal(fbkKeys(env).length, 0);
  assert.equal((await admin(env, H, "POST", "/admin/api/feedback/delete", { id })).status, 404);
});
test("admin Updates: preview as Free/Pro (its own CSP, framable by the admin only), note, test to the owner, send with a confirmed count, stop, resume, new", async () => {
  const subs = crowd(4).concat([{ email: "off@example.com", mail: "off" }]), env = adminEnv(subs), { H, D } = await adminH();
  assert.equal((await admin(env, H, "GET", "/admin/api/news", null, false)).status, 401);
  let j = await (await admin(env, H, "GET", "/admin/api/news")).json();
  assert.equal(j.campaign, null); assert.equal(j.counts.eligible, 4); assert.equal(j.counts.members, 5);
  let pv = await admin(env, H, "GET", "/admin/api/news/preview?as=free");
  assert.equal(pv.status, 200); assert.match(pv.headers.get("Content-Type"), /text\/html/);
  assert.equal(pv.headers.get("X-Frame-Options"), "SAMEORIGIN"); assert.match(pv.headers.get("Content-Security-Policy"), /frame-ancestors 'self'/);
  let html = await pv.text(); assert.match(html, /Try Prowl Pro/); assert.doesNotMatch(html, /m0@example\.com/, "a preview names no member");
  html = await (await admin(env, H, "GET", "/admin/api/news/preview?as=pro")).text(); assert.doesNotMatch(html, /Try Prowl Pro/);
  assert.equal((await admin(env, H, "POST", "/admin/api/news/draft", { note: "Thanks <3" })).status, 200);
  assert.match(await (await admin(env, H, "GET", "/admin/api/news/preview")).text(), /Thanks &lt;3/);
  const t = await (await admin(env, H, "POST", "/admin/api/news/test", { as: "pro" })).json();
  assert.equal(t.ok, true); assert.equal(D.sent.at(-1).to, "hello@owlandtwigvintage.com"); assert.match(D.sent.at(-1).subject, /^\[Test\] What/);
  assert.ok(D.sent.at(-1).unsub, "the test has the List-Unsubscribe link too");
  const bad = await admin(env, H, "POST", "/admin/api/news/send", { count: 99 });
  assert.equal(bad.status, 409); assert.equal((await bad.json()).count, 4, "the confirm step's count must match");
  j = await (await admin(env, H, "POST", "/admin/api/news/send", { count: 4 })).json();
  assert.equal(j.campaign.status, "sending"); assert.equal(j.campaign.total, 4); assert.equal(j.campaign.note, "Thanks <3");
  assert.equal((await admin(env, H, "POST", "/admin/api/news/send", { count: 4 })).status, 409, "only one at a time");
  assert.equal((await admin(env, H, "POST", "/admin/api/news/draft", { note: "x" })).status, 409, "the note is fixed once it goes");
  assert.equal((await admin(env, H, "POST", "/admin/api/news/new", {})).status, 409, "stop first");
  j = await (await admin(env, H, "POST", "/admin/api/news/stop", {})).json(); assert.equal(j.campaign.status, "stopped");
  j = await (await admin(env, H, "POST", "/admin/api/news/resume", {})).json(); assert.equal(j.campaign.status, "sending");
  const cur = await D.kvGet(env, N.NEWS_KEY, null); cur.status = "done"; await D.kvPut(env, N.NEWS_KEY, cur);
  assert.equal((await admin(env, H, "POST", "/admin/api/news/send", { count: 4 })).status, 409, "a sent update is not sent again");
  j = await (await admin(env, H, "POST", "/admin/api/news/new", {})).json();
  assert.equal(j.campaign.status, "draft"); assert.notEqual(j.campaign.id, cur.id);
  assert.ok(env.PROWL_ALERTS.json("news:prev"), "the old one is kept aside");
  const v = await (await admin(env, H, "GET", "/admin/api/news")).text();
  assert.ok(!/@example\.com/.test(v), "the Updates view carries no member address");
});
test("the admin page: Feedback and Updates tabs, texts through textContent only, the preview frame allowed by the CSP", async () => {
  const P = await import("../admin-page.js"), html = P.adminPage("n0nce", "v208");
  assert.match(html, /data-tab="feedback"/); assert.match(html, /data-tab="updates"/);
  assert.match(html, /data-ff="low"/); assert.match(html, /data-ff="reply"/);
  const js = html.split('<script nonce="n0nce">')[1];
  assert.doesNotMatch(js, /innerHTML/);
  assert.match(js, /sandbox: "allow-popups allow-popups-to-escape-sandbox"/);
  assert.match(ADMIN, /frame-src 'self'/);
});
