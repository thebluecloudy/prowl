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
  constructor() { this.m = new Map(); this.ttl = new Map(); this.reads = []; }
  async get(k, type) {
    const o = type && typeof type === "object" ? type : { type };
    this.reads.push({ k, cacheTtl: o.cacheTtl });
    if (!this.m.has(k)) return null; const v = this.m.get(k); return o.type === "json" ? JSON.parse(v) : v;
  }
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
    ipKey: (ip) => "ip-" + ip, ipNet: (k) => "net-" + String(k).split(".").slice(0, 3).join("."), sleep: async (ms) => { D.naps.push(ms); }, naps: [],
    vCount: async (name, lim) => { const n = (counts.get(name) || 0) + 1; counts.set(name, n); return n <= lim; },
    isOwner: (req) => req.headers.get("X-Prowl-Owner") === "OWNER",
    memberOf: async (req, env) => { const e = req.headers.get("X-Prowl-Email"), t = req.headers.get("X-Prowl-Tok"); const s = e ? await env.PROWL_ALERTS.get("sub:" + e, "json") : null; return s && s.tok === t ? s : null; },
    alSend: async (env, to, subject, html, text, unsub, att, replyTo) => { if (D.failNext) { D.failNext--; return { ok: false, error: D.failWith || "resend 500" }; } sent.push({ to, subject, html, text, unsub, replyTo }); return { ok: true }; },
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
  const env = envWith(MEMBER), D = deps(), H = { "X-Prowl-Email": MEMBER.email, "X-Prowl-Tok": MEMBER.tok };
  await N.fbkPost(req({ like: "x", reply: true }, H), env, ORIGIN, D);
  const k = fbkKeys(env)[0];
  assert.equal(env.PROWL_ALERTS.json(k).reply, "jane@example.com");
  assert.equal(await N.fbkForget(env, "Jane@Example.com"), 1);
  const g = env.PROWL_ALERTS.json(k);
  assert.equal(g.reply, undefined); assert.equal(g.like, "x");
  assert.ok(env.PROWL_ALERTS.ttl.get(k) > 179 * 86400, "keeps its 180 days");
  assert.equal(env.PROWL_ALERTS.m.has("fbkr:jane@example.com"), false, "its list goes too");
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
  const cur = CUR({ id: "n1" }), H = { hunts: ["pyrex"] };
  assert.ok(N.newsDue({ ...H, email: "a@x.co", mail: "on" }, cur));
  assert.ok(N.newsDue({ ...H, email: "a@x.co", prefs: { pause: "2099-01-01" } }, cur), "paused members get it");
  assert.ok(!N.newsDue({ ...H, email: "a@x.co", mail: "off" }, cur));
  assert.ok(!N.newsDue({ ...H, email: "a@x.co", newsOff: "2026-11-01" }, cur));
  assert.ok(!N.newsDue({ ...H, email: "a@x.co", news: "n1" }, cur));
  assert.ok(N.newsDue({ ...H, email: "a@x.co", news: "n0" }, cur), "an older campaign's marker does not count");
  assert.ok(!N.newsDue({ ...H, email: "nope" }, cur));
});
function crowd(n) { const subs = []; for (let i = 0; i < n; i++) subs.push({ email: "m" + i + "@example.com", tok: "t", utok: "u" + i, mail: "on", pro: i % 2 === 0, hunts: ["pyrex"] }); return subs; }
const cntOf = (env, id) => env.PROWL_ALERTS.json(N.NEWS_CNT + id) || {};
test("newsTick: nothing unless sending; at most NEWS_PER_RUN a run and within the room; marker first; done when all have it", async () => {
  const subs = crowd(23).concat([{ email: "off@example.com", mail: "off", hunts: ["x"] }, { email: "stop@example.com", newsOff: "x", hunts: ["x"] }]);
  const env = envWith(...subs), D = deps();
  assert.deepEqual(await N.newsTick(D, env, subs, 50), { sent: 0, failed: 0, retry: 0, done: false }, "no campaign");
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
  const cur = (await N.newsLoad(env)).state;
  assert.equal(cur.status, "done"); assert.equal(cur.sent, 23); assert.ok(cur.doneAt);
  assert.equal(env.PROWL_ALERTS.json(N.NEWS_KEY).status, "sending", "the clock never writes news:cur");
  const to = D.sent.map(m => m.to);
  assert.equal(new Set(to).size, 23, "everyone once");
  assert.ok(!to.includes("off@example.com") && !to.includes("stop@example.com"), "emails off and updates stopped are left out");
  assert.equal((await N.newsTick(D, env, await read(), 50)).sent, 0, "done sends nothing more");
});
test("newsTick: Stop between emails, Resume picks up where it left off; a refused send is counted once; a crash after the marker never sends twice", async () => {
  const subs = crowd(6), env = envWith(...subs), D = deps();
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "n2", status: "sending", total: 6 }));
  const read = async () => Promise.all(subs.map(s => D.kvGet(env, "sub:" + s.email, null)));
  /* stop after the 2nd email: the admin's Stop key appears while the run is going */
  const send0 = D.alSend; let k = 0;
  D.alSend = async (...a) => { const r = await send0(...a); if (++k === 2) await env.PROWL_ALERTS.put(N.NEWS_STOP + "n2", JSON.stringify({ at: "x" })); return r; };
  let r = await N.newsTick(D, env, await read(), 50);
  assert.equal(r.sent, 2); let st = (await N.newsLoad(env)).state;
  assert.equal(st.status, "stopped"); assert.equal(st.sent, 2, "counts kept with the stop");
  assert.equal((await N.newsTick(D, env, await read(), 50)).sent, 0, "stopped sends nothing");
  D.alSend = send0; await env.PROWL_ALERTS.delete(N.NEWS_STOP + "n2");
  D.failNext = 1; D.failWith = "resend 422 invalid to";
  r = await N.newsTick(D, env, await read(), 50);
  assert.equal(r.sent, 3); assert.equal(r.failed, 1); assert.equal(r.done, true);
  st = (await N.newsLoad(env)).state;
  assert.equal(st.sent, 5); assert.equal(st.failed, 1); assert.equal(st.status, "done");
  assert.equal(new Set(D.sent.map(m => m.to)).size, D.sent.length, "nobody twice");
  for (const s of await read()) assert.equal(s.news, "n2", "every member marked, the refused one too (not retried)");
  /* a crash between the marker and the email: the member is marked, so the next run skips them */
  const env2 = envWith(...crowd(2)), D2 = deps({ alMailSub: async () => { throw new Error("crash"); } });
  await D2.kvPut(env2, N.NEWS_KEY, CUR({ id: "n3", status: "sending" }));
  await N.newsTick(D2, env2, await Promise.all(crowd(2).map(s => D2.kvGet(env2, "sub:" + s.email, null))), 1);
  assert.equal((await D2.kvGet(env2, "sub:m0@example.com", null)).news, "n3");
  assert.equal(D2.sent.length, 0);
});
test("wired in: the clock sends within its budget, unsub ?w=news, the admin routes", () => {
  assert.match(INDEX, /wkRun\.calls \+ newsRun\.sent \+ newsRun\.failed \+ newsRun\.retry \+ fbRun\.used;/, "its sends count in runUsed");
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
    newsView: idx.newsView, newsNote: idx.newsNote, newsEligible: idx.newsEligible, newsLoad: idx.newsLoad, newsMerge: idx.newsMerge, NEWS_KEY: idx.NEWS_KEY, NEWS_STOP: idx.NEWS_STOP, NEWS_KEEP: idx.NEWS_KEEP, NEWS_PER_RUN: idx.NEWS_PER_RUN, NEWS_TESTS_PER_DAY: idx.NEWS_TESTS_PER_DAY,
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

/* ---------- v208 review fixes ---------- */
test("review 1: /feedback caps a network (ipNet) and the whole site a day; past the mail budget a note is kept without a copy", async () => {
  const env = envWith(), D = deps();
  for (let i = 0; i < N.FBK_PER_NET; i++) assert.equal((await N.fbkPost(req({ like: "n" + i }, { "CF-Connecting-IP": "5.6.7." + i }), env, ORIGIN, D)).status, 200, "one a host, " + i);
  const net = await N.fbkPost(req({ like: "one more" }, { "CF-Connecting-IP": "5.6.7.200" }), env, ORIGIN, D);
  assert.equal(net.status, 429, "a fresh IP in the same network is refused");
  assert.ok(D.counts.has("fbkn:net-ip-5.6.7"), "counted by ipNet(ipKey)");
  assert.equal(fbkKeys(env).length, N.FBK_PER_NET, "nothing stored past it");
  /* the site-wide cap: every post counts, whoever sends it */
  const D2 = deps(), env2 = envWith();
  D2.counts.set("fbk:all", N.FBK_PER_DAY);
  const all = await N.fbkPost(req({ like: "late" }, { "CF-Connecting-IP": "9.8.7.6" }), env2, ORIGIN, D2);
  assert.equal(all.status, 429); assert.match(all.body.error, /busy today/);
  assert.equal(fbkKeys(env2).length, 0);
  /* the mail budget: kept, not emailed */
  const D3 = deps(), env3 = envWith();
  D3.counts.set("fbkmail:day", N.FBK_MAIL_PER_DAY);
  const held = await N.fbkPost(req({ like: "kept" }, { "CF-Connecting-IP": "4.4.4.4" }), env3, ORIGIN, D3);
  assert.equal(held.status, 200); assert.equal(held.body.mailed, false);
  assert.equal(fbkKeys(env3).length, 1, "the note is kept"); assert.equal(D3.sent.length, 0, "no copy");
  assert.ok(N.FBK_MAIL_PER_DAY < N.FBK_PER_DAY);
});
test("review 2: addresses and phone numbers typed into the boxes are masked before they are kept, emailed or shown", async () => {
  assert.equal(N.fbkScrub("email me at jane.doe@gmail.com or 248-555-0134"), "email me at [email] or [number]");
  assert.equal(N.fbkScrub("(248) 555 0134, Pyrex 1950-1960, lot 4521, item 123456"), "([number], Pyrex 1950-1960, lot 4521, item 123456", "years and short numbers stay");
  const env = envWith(), D = deps();
  await N.fbkPost(req({ like: "love it, write jane.doe@gmail.com", miss: "call 248.555.0134 please" }), env, ORIGIN, D);
  const e = env.PROWL_ALERTS.json(fbkKeys(env)[0]);
  assert.equal(e.like, "love it, write [email]"); assert.equal(e.miss, "call [number] please");
  assert.ok(!/jane\.doe|555/.test(D.sent[0].html + D.sent[0].text), "not in the owner's copy");
  /* an entry kept before the mask (or written some other way) is masked in the admin view too */
  const aenv = adminEnv(), { H } = await adminH();
  aenv.PROWL_ALERTS.set(N.fbkKey(Date.now(), "eeeeee"), { at: new Date().toISOString(), rating: 3, like: "me: bob@example.org", miss: "248 555 0134", plan: "free" });
  const t = await (await admin(aenv, H, "GET", "/admin/api/feedback")).text();
  assert.ok(!t.includes("bob@example.org") && !t.includes("555"), t);
});
const stale = (kv, keys) => {   /* a location whose cache still holds the given keys as they were */
  const snap = new Map(keys.map(k => [k, kv.m.has(k) ? kv.m.get(k) : null]));
  return new Proxy(kv, { get(t, p) {
    if (p === "get") return async (k, o) => { if (snap.has(k)) { const v = snap.get(k); if (v == null) return null; return (o && (o.type || o)) === "json" ? JSON.parse(v) : v; } return t.get(k, o); };
    const v = t[p]; return typeof v === "function" ? v.bind(t) : v;
  } });
};
test("review 4: a Stop or a New update pressed during a run is never undone by the clock (it never writes news:cur; Stop is its own key, read fresh)", async () => {
  const subs = crowd(12), env = envWith(...subs), D = deps();
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "s1", status: "sending", total: 12 }));
  const clockEnv = { PROWL_ALERTS: stale(env.PROWL_ALERTS, [N.NEWS_KEY]) };   /* the clock's news:cur read stays "sending" */
  let k = 0; const send0 = D.alSend;
  D.alSend = async (...a) => { const r = await send0(...a); if (++k === 3) {   /* the owner presses Stop (another location) */
    const c = env.PROWL_ALERTS.json(N.NEWS_KEY); c.status = "stopped"; c.stoppedAt = "now"; env.PROWL_ALERTS.set(N.NEWS_KEY, c);
    await env.PROWL_ALERTS.put(N.NEWS_STOP + "s1", JSON.stringify({ at: "now" })); } return r; };
  const r = await N.newsTick(D, clockEnv, subs, 50);
  assert.equal(r.sent, 3, "the Stop key ends the run at the next email");
  assert.equal(env.PROWL_ALERTS.json(N.NEWS_KEY).status, "stopped", "news:cur is as the owner left it");
  assert.equal((await N.newsTick(D, clockEnv, subs, 50)).sent, 0, "later runs send nothing");
  assert.ok(env.PROWL_ALERTS.reads.filter(x => x.k === N.NEWS_STOP + "s1").every(x => x.cacheTtl === N.KV_FRESH_TTL), "the Stop key is read with the shortest cache");
  assert.equal(N.KV_FRESH_TTL, 30, "Cloudflare's minimum cacheTtl");
  /* New update during a run: the new draft stays */
  const env2 = envWith(...crowd(4)), D2 = deps();
  await D2.kvPut(env2, N.NEWS_KEY, CUR({ id: "s2", status: "sending" }));
  const clock2 = { PROWL_ALERTS: stale(env2.PROWL_ALERTS, [N.NEWS_KEY]) };
  D2.alSend = async () => { env2.PROWL_ALERTS.set(N.NEWS_KEY, CUR({ id: "s3", status: "draft" })); await env2.PROWL_ALERTS.put(N.NEWS_STOP + "s2", "{}"); return { ok: true }; };
  await N.newsTick(D2, clock2, crowd(4), 50);
  assert.equal(env2.PROWL_ALERTS.json(N.NEWS_KEY).id, "s3", "the old campaign is not written back over the new draft");
});
test("review 9: the admin's Stop and Resume never roll the clock's counts back", async () => {
  const subs = crowd(5), env = adminEnv(subs), { H, D } = await adminH();
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "c1", status: "sending", total: 5 }));
  const adminKV = env.PROWL_ALERTS, before = stale(adminKV, [N.NEWS_KEY]);   /* the admin read news:cur before the run */
  await N.newsTick(D, env, subs, 3);
  assert.equal(cntOf(env, "c1").sent, 3);
  const aenv = Object.assign({}, env, { PROWL_ALERTS: before });
  const j = await (await admin(aenv, H, "POST", "/admin/api/news/stop", {})).json();
  assert.equal(j.campaign.status, "stopped"); assert.equal(j.campaign.sent, 3); assert.match(j.message, /^Stopped\. 3 sent/);
  await admin(aenv, H, "POST", "/admin/api/news/resume", {});
  await admin(aenv, H, "POST", "/admin/api/news/draft", { note: "x" });
  assert.equal(cntOf(env, "c1").sent, 3, "the counts are the clock's alone");
  const v = await (await admin(env, H, "GET", "/admin/api/news")).json();
  assert.equal(v.campaign.sent, 3); assert.equal(v.campaign.status, "sending");
  assert.equal(env.PROWL_ALERTS.json(N.NEWS_KEY).sent, undefined, "news:cur carries no counts");
});
test("review 5: sends are paced; a busy Resend (429, 5xx, a timeout) puts the member back for a later run, NEWS_TRIES in all, counted once", async () => {
  const subs = crowd(4), env = envWith(...subs), D = deps();
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "p1", status: "sending", total: 4 }));
  const read = async () => Promise.all(subs.map(s => D.kvGet(env, "sub:" + s.email, null)));
  await N.newsTick(D, env, await read(), 2);
  assert.deepEqual(D.naps, [N.NEWS_GAP_MS], "a pause between two emails");
  assert.ok(N.NEWS_GAP_MS >= 500, "Resend takes 2 a second");
  D.failNext = 1; D.failWith = "resend 429 rate_limit_exceeded";
  let r = await N.newsTick(D, env, await read(), 50);
  assert.deepEqual([r.sent, r.failed, r.retry, r.done], [0, 0, 1, false], "busy: no more this run, not done");
  const m2 = env.PROWL_ALERTS.json("sub:m2@example.com");
  assert.notEqual(m2.news, "p1", "the marker is taken back"); assert.deepEqual(m2.newsTry, { id: "p1", n: 1 });
  r = await N.newsTick(D, env, await read(), 50);
  assert.deepEqual([r.sent, r.failed, r.done], [2, 0, true], "the next run reaches them");
  assert.equal(cntOf(env, "p1").failed, 0);
  for (const e of ["The operation was aborted", "resend 503 down", "resend 500 x"]) assert.equal(N.newsRetryable({ ok: false, error: e }), true, e);
  for (const e of ["resend 422 invalid", "resend 403 domain"]) assert.equal(N.newsRetryable({ ok: false, error: e }), false, e);
  /* always busy: NEWS_TRIES tries, then counted as failed once and left */
  const env2 = envWith(...crowd(1)), D2 = deps({ alSend: async () => ({ ok: false, error: "resend 500 x" }) });
  await D2.kvPut(env2, N.NEWS_KEY, CUR({ id: "p2", status: "sending", total: 1 }));
  const one = async () => [await D2.kvGet(env2, "sub:m0@example.com", null)];
  const got = [];
  for (let i = 0; i < N.NEWS_TRIES + 2; i++) got.push(await N.newsTick(D2, env2, await one(), 50));
  assert.deepEqual(got.map(x => x.retry + "/" + x.failed), ["1/0", "1/0", "0/1", "0/0", "0/0"]);
  assert.equal(cntOf(env2, "p2").failed, 1); assert.equal(env2.PROWL_ALERTS.json("sub:m0@example.com").news, "p2");
});
test("review 6: members with no saved hunt get no update, and the admin's count leaves them out too", async () => {
  const cur = CUR({ id: "h1" });
  assert.equal(N.newsDue({ email: "gift@example.com", mail: "on", hunts: [] }, cur), false, "a gift recipient who never saved a hunt");
  assert.equal(N.newsDue({ email: "road@example.com", mail: "on" }, cur), false, "signed in for Road trip only");
  assert.equal(N.newsDue({ email: "a@example.com", mail: "on", hunts: ["pyrex"] }, cur), true);
  const env = adminEnv([{ email: "gift@example.com", mail: "on", hunts: [] }].concat(crowd(2))), { H } = await adminH();
  const j = await (await admin(env, H, "GET", "/admin/api/news")).json();
  assert.equal(j.counts.eligible, 2); assert.equal(j.counts.members, 3);
});
test("review 8 and 12: an unsubscribe made during the run holds: the record is read again just before the email", async () => {
  const subs = crowd(3), env = envWith(...subs), D = deps();
  await D.kvPut(env, N.NEWS_KEY, CUR({ id: "u1", status: "sending", total: 3 }));
  const held = subs.map(s => ({ ...s }));   /* what the run read at its start */
  const m0 = env.PROWL_ALERTS.json("sub:m0@example.com"); m0.newsOff = "2026-11-01"; env.PROWL_ALERTS.set("sub:m0@example.com", m0);
  const m1 = env.PROWL_ALERTS.json("sub:m1@example.com"); m1.mail = "off"; env.PROWL_ALERTS.set("sub:m1@example.com", m1);
  const r = await N.newsTick(D, env, held, 50);
  assert.deepEqual(D.sent.map(x => x.to), ["m2@example.com"]);
  assert.equal(r.sent, 1); assert.equal(r.failed, 0);
  assert.equal(env.PROWL_ALERTS.json("sub:m0@example.com").news, undefined, "no marker for them either");
  assert.ok(env.PROWL_ALERTS.reads.some(x => x.k === "sub:m0@example.com" && x.cacheTtl === N.KV_FRESH_TTL), "read with the shortest cache");
  /* a record that turns off between the fresh read and the marker (alMerge's copy) is not sent either */
  const env2 = envWith(...crowd(1)), D2 = deps();
  await D2.kvPut(env2, N.NEWS_KEY, CUR({ id: "u2", status: "sending" }));
  const merge0 = D2.alMerge;
  D2.alMerge = async (e, sub, f) => { const c = e.PROWL_ALERTS.json("sub:" + sub.email); c.newsOff = "now"; e.PROWL_ALERTS.set("sub:" + sub.email, c); return merge0(e, sub, f); };
  assert.equal(await N.newsSendOne(D2, env2, crowd(1)[0], CUR({ id: "u2" })), "skipped");
  assert.equal(D2.sent.length, 0);
});
test("review 11: Delete my account reads only the member's own notes (fbkr: list), however many notes there are; the list stays small", async () => {
  const env = envWith(MEMBER), D = deps(), H = { "X-Prowl-Email": MEMBER.email, "X-Prowl-Tok": MEMBER.tok, "X-Prowl-Owner": "OWNER" };
  for (let i = 0; i < 1500; i++) env.PROWL_ALERTS.set(N.fbkKey(Date.now() - i * 1000, "z" + i), { at: new Date().toISOString(), rating: 1, like: "", miss: "x", plan: "free" });
  for (let i = 0; i < N.FBK_REPLY_MAX + 5; i++) assert.equal((await N.fbkPost(req({ like: "r" + i, reply: true }, H), env, ORIGIN, D)).status, 200);
  const list = env.PROWL_ALERTS.json("fbkr:jane@example.com");
  assert.equal(list.length, N.FBK_REPLY_MAX, "at most FBK_REPLY_MAX listed");
  const withReply = () => fbkKeys(env).filter(k => env.PROWL_ALERTS.json(k).reply);
  assert.equal(withReply().length, N.FBK_REPLY_MAX, "an older note past the list has its address taken out at once");
  env.PROWL_ALERTS.reads.length = 0;
  assert.equal(await N.fbkForget(env, ["jane@example.com"]), N.FBK_REPLY_MAX);
  assert.ok(env.PROWL_ALERTS.reads.length <= N.FBK_REPLY_MAX + 1, "reads: " + env.PROWL_ALERTS.reads.length);
  assert.equal(withReply().length, 0);
});
test("review 13: the admin's count is the true total (or N+ past the counting cap), not the first list page", async () => {
  const env = envWith();
  for (let i = 0; i < 2500; i++) env.PROWL_ALERTS.set(N.fbkKey(Date.now() - i * 1000, "y" + i), { at: new Date().toISOString(), rating: 4, like: "ok", miss: "", plan: "free" });
  const r = await N.fbkList(env);
  assert.equal(r.entries.length, N.FBK_LIST_MAX); assert.equal(r.total, 2500); assert.equal(r.more, true); assert.equal(r.totalMore, false);
  const small = await N.fbkList(env, 300);
  assert.equal(small.total, 2500);
  const P = await import("../admin-page.js"), js = P.adminPage("n0nce", "v208");
  assert.match(js, /num\(j\.total\) \+ \(j\.totalMore \? "\+" : ""\)/, "N+ when the count stopped short");
});

/* review 14: the unsubscribe route, alPurge and the clock's news step, run (not only read) */
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
function fromIndex(names, dep = {}, pre = "") {
  const keys = Object.keys(dep);
  return new Function(...keys, pre + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => dep[k]));
}
const kvG = async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; };
const kvP = async (e, k, v) => e.PROWL_ALERTS.put(k, JSON.stringify(v));
const PX = fromIndex(["pushHash", "pushId", "pushList", "pushPurge", "savedIndex", "savedPurge", "savedHpPurge", "sha16", "acctHash", "tripIdOk", "tripGet", "tripPut", "tripPurge", "tripsForget",
  "alPurge", "alMerge", "alEmail", "alSame", "vClean", "alParams", "alUnsub"], {
  kvGet: kvG, kvPut: kvP, console: { log() {}, error() {} }, json: (body, status) => ({ status: status || 200, body }), ALLOW_ORIGINS: [ORIGIN], photoKey: (h, k) => "saved/" + h + "/" + k + ".jpg",
  alReady: (env) => !!env.PROWL_ALERTS, readJson: async (r) => r.body || {},
  alPage: (title, msg, status) => ({ page: title, msg, status: status || 200 }), alGate: (title) => ({ gate: title }), fbkForget: N.fbkForget,
});
const UNSUB = "https://prowl.example/alerts/unsub";
const unsubUrl = (t, w) => { const u = new URL(UNSUB); u.searchParams.set("e", MEMBER.email); u.searchParams.set("t", t); if (w) u.searchParams.set("w", w); return u; };
const oneClick = { method: "POST", body: "List-Unsubscribe=One-Click", headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/x-www-form-urlencoded" : null) } };
test("review 14: /alerts/unsub?w=news: a GET only asks; the one-click POST stops product updates alone; an old token gets 400", async () => {
  const env = envWith(MEMBER);
  const g = await PX.alUnsub({ method: "GET", headers: { get: () => null } }, env, unsubUrl(MEMBER.utok, "news"), "");
  assert.equal(g.gate, "Stop Prowl product updates?");
  assert.equal(env.PROWL_ALERTS.json("sub:" + MEMBER.email).newsOff, undefined, "a GET changes nothing");
  const bad = await PX.alUnsub(oneClick, env, unsubUrl("an-old-token", "news"), "");
  assert.equal(bad.status, 400); assert.equal(env.PROWL_ALERTS.json("sub:" + MEMBER.email).newsOff, undefined);
  const ok = await PX.alUnsub(oneClick, env, unsubUrl(MEMBER.utok, "news"), "");
  assert.equal(ok.page, "Product updates are off"); assert.equal(ok.status, 200);
  const sub = env.PROWL_ALERTS.json("sub:" + MEMBER.email);
  assert.ok(sub.newsOff); assert.equal(sub.mail, "on", "the alert emails stay on"); assert.deepEqual(sub.hunts, MEMBER.hunts);
  assert.equal(N.newsEligible(sub), false);
});
test("review 10 and 14: Delete my account after an address change takes the old reply address out of feedback too", async () => {
  const env = envWith(MEMBER), D = deps(), H = { "X-Prowl-Email": MEMBER.email, "X-Prowl-Tok": MEMBER.tok };
  await N.fbkPost(req({ like: "as a", reply: true }, H), env, ORIGIN, D);
  /* the member moves jane@ -> jane.new@ (alMoveConfirm: the record under the new address, prev holds the old one) */
  const moved = { ...MEMBER, email: "jane.new@example.com", prev: [MEMBER.email] };
  await env.PROWL_ALERTS.delete("sub:" + MEMBER.email); env.PROWL_ALERTS.set("sub:" + moved.email, moved);
  await N.fbkPost(req({ like: "as b", reply: true }, { "X-Prowl-Email": moved.email, "X-Prowl-Tok": MEMBER.tok, "CF-Connecting-IP": "2.2.2.2" }), env, ORIGIN, D);
  /* someone else's note that kept their own address stays */
  env.PROWL_ALERTS.set(N.fbkKey(Date.now(), "other1"), { at: new Date().toISOString(), rating: 2, like: "o", miss: "", plan: "free", reply: "other@example.com" });
  await env.PROWL_ALERTS.put("fbkr:other@example.com", JSON.stringify([N.fbkKey(Date.now(), "other1").slice(4)]));
  const gone = await PX.alPurge(env, moved.email, moved);
  assert.ok(gone.includes("fbk:"));
  for (const [k, v] of env.PROWL_ALERTS.m) if (k.startsWith("fbk")) assert.ok(!/jane/.test(k + v), "left behind: " + k + " = " + v);
  assert.equal(fbkKeys(env).length, 3, "the notes stay");
  assert.ok([...env.PROWL_ALERTS.m.values()].some(v => v.includes("other@example.com")), "another member's address is theirs");
});
test("review 7 and 14: the alert clock runs the update email last, after the estate prep and the Facebook sweep, with only what they left", async () => {
  const kv = new FakeKV(), order = [], seen = {};
  const members = crowd(3).map(m => ({ ...m, proDay: "2026-11-01", prefs: {} }));
  members.forEach((m) => kv.set("sub:" + m.email, m));
  kv.set(N.NEWS_KEY, CUR({ id: "t1", status: "sending", total: 3 }));
  const NOW = { day: "2026-11-01", hour: 11 }, D = deps();
  const dep = {
    alReady: () => true, alNow: () => NOW, POUNCE_PER_RUN: 30, PJ_RUN: null,
    kvGet: kvG, alBatch: () => 2, AL_PRO_REFRESH_PER_RUN: 8, AL_LETTERS_PER_RUN: 4, AL_CALLS_PER_HUNT: 9, FB_RUN_CALLS: 50,
    alUrgency: () => 0, memberId: async (s, e) => "M-" + e.length, scrubPII: (x) => x, alTrialPlan: () => null, alTrialNotes: async () => "",
    alLocal: () => ({ day: NOW.day, hour: 7, wday: 0 }), alPaused: () => false, pounceHasPhone: () => false, pounceQuarries: () => ({}),
    alProSet: async () => false, alToken: () => "utok", alMerge: D.alMerge,
    alLetterDue: () => false, alLetterSend: async () => "", pounceRetry: async () => {}, pounceCarry: async () => 0,
    alPrefs: (sub) => ({ tz: "", zip: "", estate: "", ...(sub.prefs || {}) }),
    alCheck: async () => 0, alSlotHour: () => 23, alActive: (e, sub) => sub.hunts, alSendDay: () => true, alDigest: async () => ({ sent: false, reason: "nothing new" }),
    alEstateReady: async () => false, alEstatePrep: async () => "ready",
    fbSweep: async (e, subs, left) => { order.push("fb"); seen.fb = left; return { calls: 3, swept: 3, errors: [], used: 44 }; },
    newsTick: async (...a) => { order.push("news"); seen.news = a[3]; return N.newsTick(...a); }, newsDeps: () => D, NEWS_PER_RUN: N.NEWS_PER_RUN,
    rosterCounts: () => null, ADMIN_H: 0, console: { log() {}, error() {} }, Date: { now: () => 0 },
  };
  const estatePrepAt = INDEX.indexOf("try { await estatePrep(); }"), sweepAt = INDEX.indexOf("await fbSweep(env, subs.map"), newsAt = INDEX.indexOf("await newsTick(newsDeps()");
  assert.ok(estatePrepAt > 0 && estatePrepAt < sweepAt && sweepAt < newsAt, "estate prep, then Facebook, then the news");
  const consts = /^const AL_ESTATE_CALLS = .*$/m.exec(INDEX)[0] + "\n" + /^const AL_ESTATE_KEEP = .*$/m.exec(INDEX)[0];
  const src = ["alTick", "alEstateDue", "alEstateOn", "alEstateTried"].map(indexFn).join("\n");
  const keys = Object.keys(dep).filter((k) => k !== "PJ_RUN");
  const run = new Function(...keys, "let PJ_RUN = null;\n" + consts + "\n" + src + "\nreturn { alTick };")(...keys.map((k) => dep[k]));
  const out = await run.alTick({ PROWL_ALERTS: kv });
  assert.deepEqual(order, ["fb", "news"]);
  assert.equal(seen.news, 50 - 44, "the news gets only what the sweep left");
  assert.equal(D.sent.length, 3, "and it did send: " + JSON.stringify(out.errors));
  assert.ok(out.log.some(l => /^news: 3 sent, 0 failed, done$/.test(l)), out.log.join(" | "));
});
