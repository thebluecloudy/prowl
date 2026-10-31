/* ---------- v208: feedback from members, and the "What's new" update email ----------
   Matt, 2026-10-31: "i would like to see it in the admin" (feedback) and "send them an update to show them all of the
   new features" (the update email).

   Feedback: POST /feedback { rating 0-5, like, miss, reply, v } from the page's Send feedback sheet, signed in or not.
   Each entry is kept in KV as fbk:<13-digit reverse time>-<6 random> for 180 days (so a KV list reads newest first):
   the day and time, the rating, the two texts (control characters stripped, 1000 characters each), the page version,
   the plan (pro / free / signed-out) and, only when the member ticked "OK to email me back", their email address.
   No IP address and no address without that tick. A copy goes to the owner's inbox through Resend (reply-to the member
   only when they asked). 5 a day per IP key and 5 a day per member (the counters are the usual daily vCount ones).

   The update email: one campaign at a time in KV (news:cur): id, subject, the optional personal note, the edition,
   status (draft, sending, stopped, done), counts. The content is the template below (newsBuild); the admin previews it,
   sends a test to the owner, then sends it to every member with emails on (paused members too; emails off or "Stop
   product updates" no). The alert clock sends at most NEWS_PER_RUN a run within its outside-call budget; each member
   gets sub.news = <campaign id> before their email goes, so nobody gets it twice and a stopped or crashed run picks up
   where it left off. A failed send is counted and not retried.

   Everything here takes D, the helpers index.js hands in (newsDeps there), so the module never imports index.js and
   the tests can run it with fakes. */

export const FBK_PREFIX = "fbk:", FBK_TTL = 180 * 86400, FBK_TEXT_MAX = 1000, FBK_PER_IP = 5, FBK_PER_MEMBER = 5, FBK_LIST_MAX = 300, FBK_BODY_MAX = 16384;
export const NEWS_KEY = "news:cur", NEWS_PER_RUN = 10, NEWS_NOTE_MAX = 600, NEWS_TESTS_PER_DAY = 10;
export const NEWS_SUBJECT = "What’s new in Prowl", NEWS_EDITION = "2026-11";
const FBK_ID_RE = /^\d{13}-[0-9a-z]{6}$/;

/* ---------- feedback ---------- */
/* one text box: strip control and direction characters (keep line breaks), at most two blank lines in a row, trimmed, capped */
export function fbkText(v, n) {
  return String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/\t/g, " ")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/[  ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, n || FBK_TEXT_MAX).trim();
}
export function fbkClean(b) {
  b = b && typeof b === "object" ? b : {};
  const r = Math.round(Number(b.rating));
  const out = { rating: r >= 1 && r <= 5 ? r : 0, like: fbkText(b.like), miss: fbkText(b.miss), reply: b.reply === true || b.reply === 1 || b.reply === "1",
    v: /^v\d{1,2}\.\d{2}[a-z]?$/.test(String(b.v || "")) ? String(b.v) : "" };
  if (!out.rating && !out.like && !out.miss) return { error: "Pick a rating or write a line first." };
  return out;
}
export function fbkKey(nowMs, rand) {
  const t = String(9999999999999 - Math.floor(nowMs)).padStart(13, "0");
  return FBK_PREFIX + t + "-" + String(rand || "").toLowerCase().replace(/[^0-9a-z]/g, "").padEnd(6, "0").slice(0, 6);
}
function fbkRand() { const a = crypto.getRandomValues(new Uint8Array(6)); return Array.from(a, x => "0123456789abcdefghijklmnopqrstuvwxyz"[x % 36]).join(""); }
export function fbkStars(n) { n = Number(n) || 0; return n ? "★".repeat(n) + "☆".repeat(5 - n) : "no rating"; }
export function fbkPlan(sub) { return !sub ? "signed-out" : sub.pro ? "pro" : "free"; }
const PLAN_NAME = { pro: "Pro", free: "Free", "signed-out": "Signed out" };
function nl2br(D, s) { return D.alEsc(s).replace(/\n/g, "<br>"); }

/* the owner's copy: plain, with the texts escaped; reply-to the member only when they asked for a reply */
export function fbkMail(D, env, e) {
  const p = (label, body) => '<tr><td style="padding:6px 22px;font:15px/1.6 Arial,sans-serif;color:#2b2118"><b>' + label + '</b><br>' + body + '</td></tr>';
  const inner = '<tr><td style="padding:18px 22px 6px;font:bold 22px/1.3 Georgia,serif;color:#2b2118">New Prowl feedback</td></tr>' +
    p("Rating", D.alEsc(fbkStars(e.rating))) + p("What they like", e.like ? nl2br(D, e.like) : "<i>(blank)</i>") +
    p("What’s missing or broken", e.miss ? nl2br(D, e.miss) : "<i>(blank)</i>") +
    p("Plan and page", D.alEsc((PLAN_NAME[e.plan] || e.plan) + (e.v ? " · page " + e.v : ""))) +
    p("Reply", e.reply ? "They asked for a reply: press Reply to write back." : "No reply wanted (no address was kept).");
  const html = D.alShell(env, inner, "Sent from Send feedback in Prowl. Every note is in the admin, Feedback tab, for 180 days.", "");
  const text = ["New Prowl feedback", "", "Rating: " + fbkStars(e.rating), "", "What they like:", e.like || "(blank)", "", "What's missing or broken:", e.miss || "(blank)", "",
    "Plan: " + (PLAN_NAME[e.plan] || e.plan) + (e.v ? " · page " + e.v : ""), e.reply ? "They asked for a reply: press Reply to write back." : "No reply wanted (no address was kept)."].join("\n");
  const subject = "Prowl feedback · " + (e.rating ? fbkStars(e.rating) : "no rating") + " · " + (PLAN_NAME[e.plan] || e.plan);
  return { subject: subject, html: html, text: text };
}
export function fbkTo(env, D) { return String((env && env.FEEDBACK_TO) || D.AL_UNSUB_MAIL); }

/* POST /feedback */
export async function fbkPost(request, env, origin, D) {
  if (!env || !env.PROWL_ALERTS) return D.json({ error: "Feedback is not on yet." }, 503, origin);
  if (D.ALLOW_ORIGINS.indexOf(origin) === -1) return D.json({ error: "forbidden" }, 403, origin);
  const b = await D.readJson(request, FBK_BODY_MAX);
  if (b.big) return D.json({ error: "That is too long to send. Shorten it a little." }, 413, origin);
  const c = fbkClean(b);
  if (c.error) return D.json({ error: c.error }, 400, origin);
  const owner = D.isOwner(request, env);
  let sub = null;
  try { sub = await D.memberOf(request, env); } catch (e) { sub = null; }
  if (!owner) {
    if (!(await D.vCount("fbk:" + D.ipKey(request.headers.get("CF-Connecting-IP")), FBK_PER_IP))) return D.json({ error: "That is a lot of feedback for one day. Thank you! Try again tomorrow, or email " + D.AL_UNSUB_MAIL + "." }, 429, origin);
    if (sub && !(await D.vCount("fbkm:" + sub.email, FBK_PER_MEMBER))) return D.json({ error: "That is a lot of feedback for one day. Thank you! Try again tomorrow, or email " + D.AL_UNSUB_MAIL + "." }, 429, origin);
  }
  const now = Date.now();
  const e = { at: new Date(now).toISOString(), rating: c.rating, like: c.like, miss: c.miss, v: c.v, plan: fbkPlan(sub) };
  const reply = c.reply && sub && sub.email ? String(sub.email) : "";
  if (reply) e.reply = reply;
  const key = fbkKey(now, fbkRand());
  try { await env.PROWL_ALERTS.put(key, JSON.stringify(e), { expirationTtl: FBK_TTL }); }
  catch (err) { return D.json({ error: "Prowl could not save that just now. Try again in a minute." }, 503, origin); }
  let mailed = false;
  try {
    const m = fbkMail(D, env, Object.assign({}, e, { reply: !!reply }));
    const r = await D.alSend(env, fbkTo(env, D), m.subject, m.html, m.text, "", null, reply || "");
    mailed = !!(r && r.ok);
    if (!mailed) console.error("feedback mail", D.scrubPII(String(r && r.error || "")).slice(0, 160));
  } catch (err) { console.error("feedback mail", D.scrubPII(String(err && err.message || err)).slice(0, 160)); }
  return D.json({ ok: true, reply: !!reply, mailed: mailed }, 200, origin);
}

/* the entries for the admin, newest first (the key order); the address never leaves here, only that one is there */
export async function fbkList(env, max) {
  const kv = env.PROWL_ALERTS, keys = [];
  let cursor;
  do {
    const l = await kv.list({ prefix: FBK_PREFIX, cursor: cursor, limit: 1000 });
    for (const k of (l && l.keys) || []) keys.push(k.name);
    cursor = l && !l.list_complete ? l.cursor : undefined;
  } while (cursor && keys.length < (max || FBK_LIST_MAX));
  keys.sort();
  const take = keys.slice(0, max || FBK_LIST_MAX), out = [];
  for (let i = 0; i < take.length; i += 50) {
    const part = take.slice(i, i + 50), got = await Promise.all(part.map(k => kv.get(k, "json").catch(() => null)));
    part.forEach((k, j) => { const g = got[j]; if (g && typeof g === "object") out.push(fbkView(k, g)); });
  }
  return { entries: out, total: keys.length, more: keys.length > take.length };
}
export function fbkView(key, g) {
  const r = Math.round(Number(g.rating));
  return { id: String(key).slice(FBK_PREFIX.length), at: String(g.at || "").slice(0, 25), rating: r >= 1 && r <= 5 ? r : 0,
    like: fbkText(g.like), miss: fbkText(g.miss), v: /^v\d{1,2}\.\d{2}[a-z]?$/.test(String(g.v || "")) ? String(g.v) : "",
    plan: PLAN_NAME[g.plan] ? String(g.plan) : "signed-out", reply: typeof g.reply === "string" && g.reply.indexOf("@") > 0 };
}
export function fbkIdOk(id) { return FBK_ID_RE.test(String(id || "")); }
export async function fbkDelete(env, id) {
  if (!fbkIdOk(id)) return false;
  const k = FBK_PREFIX + id;
  if ((await env.PROWL_ALERTS.get(k)) == null) return false;
  await env.PROWL_ALERTS.delete(k);
  return true;
}
/* the address of one entry that asked for a reply, for the admin's Reply by email button (asked for one at a time) */
export async function fbkReplyTo(env, id) {
  if (!fbkIdOk(id)) return "";
  const g = await env.PROWL_ALERTS.get(FBK_PREFIX + id, "json").catch(() => null);
  return g && typeof g.reply === "string" && g.reply.indexOf("@") > 0 ? g.reply : "";
}
/* Delete my Prowl Alerts account: the address comes out of any feedback that kept it (the note stays, anonymous) */
export async function fbkForget(env, email) {
  email = String(email || "").toLowerCase();
  if (!email) return 0;
  const kv = env.PROWL_ALERTS;
  let cursor, n = 0;
  do {
    const l = await kv.list({ prefix: FBK_PREFIX, cursor: cursor, limit: 1000 });
    for (const k of (l && l.keys) || []) {
      const g = await kv.get(k.name, "json").catch(() => null);
      if (g && typeof g.reply === "string" && g.reply.toLowerCase() === email) {
        delete g.reply;
        const left = Math.max(60, Math.floor(((Date.parse(g.at) || Date.now()) + FBK_TTL * 1000 - Date.now()) / 1000));
        await kv.put(k.name, JSON.stringify(g), { expirationTtl: left });
        n++;
      }
    }
    cursor = l && !l.list_complete ? l.cursor : undefined;
  } while (cursor);
  return n;
}

/* ---------- the update email ---------- */
export function newsEligible(sub) {
  return !!sub && typeof sub === "object" && typeof sub.email === "string" && sub.email.indexOf("@") > 0 && sub.mail !== "off" && !sub.newsOff;
}
export function newsDue(sub, cur) { return !!cur && newsEligible(sub) && String(sub.news || "") !== String(cur.id); }
export function newsId(nowMs) { return "n" + new Date(nowMs).toISOString().replace(/[^0-9]/g, "").slice(0, 14) + fbkRand().slice(0, 3); }
export function newsNote(v) { return fbkText(v, NEWS_NOTE_MAX); }
export function newsFresh(nowMs, note) {
  return { id: newsId(nowMs), subject: NEWS_SUBJECT, edition: NEWS_EDITION, note: newsNote(note), status: "draft", created: new Date(nowMs).toISOString(),
    total: 0, sent: 0, failed: 0, tests: 0, startedAt: "", stoppedAt: "", doneAt: "", lastRun: "" };
}
/* what the admin is shown: no member data in a campaign, only counts */
export function newsView(cur) {
  if (!cur || typeof cur !== "object") return null;
  const pick = ["id", "subject", "edition", "note", "status", "created", "total", "sent", "failed", "tests", "startedAt", "stoppedAt", "doneAt", "lastRun"], o = {};
  pick.forEach(k => { o[k] = cur[k] == null ? "" : cur[k]; });
  return o;
}

/* The sections, one line each, Pro marked. q: the app link's query (a deep link where Prowl has one). */
export const NEWS_ITEMS = [
  { h: "Facebook Marketplace finds", pro: true, q: "daily=1", go: "See today’s finds",
    t: "Your hunts are searched on Facebook Marketplace every day, near you or across the USA, and when a hunt finds nothing Prowl says why. Facebook is in the Store tab too, with its own search box." },
  { h: "Estate sales this week", pro: true, q: "wk=1", go: "Open Estate sales",
    t: "NEAR ME › Estate sales lists the next 7 days of sales near you, with photos and Top picks that match your hunts. Plan my week lays out the days, and your daily email gets an “Estate sales near you” section." },
  { h: "Estate sales in Road trip", pro: true, q: "wk=1", go: "Plan my week",
    t: "Open a planned day as a Road trip on the map, see the estate sales on the way, and add them as stops." },
  { h: "Photo Check, rebuilt", pro: false, q: "photo=1", go: "Check a photo",
    t: "Faster to snap, a clear fair price with how sure Prowl is, and Hunt this on Prowl to keep looking for it." },
  { h: "The Store tab", pro: false, q: "store=1", go: "Open the Store tab",
    t: "Every hunt on one marketplace in one tap: pick a store, the LIVE ones show their listings right there." },
  { h: "The theme switch, always on the top bar", pro: false, q: "", go: "Open Prowl",
    t: "Light, Blue hour, Midnight, Uranium or Cockpit (now with a blood moon), one tap from any screen." }
];
export const NEWS_INTRO = "Hello from Owl & Twig. We’ve spent the fall building the things you asked for, so here is what’s new in Prowl, one line each.";
export const NEWS_PRO_LINE = "Some of these are part of Prowl Pro: Facebook finds, estate sales, up to 100 hunts and more. The first month is free, then $7 a month, and you can cancel any time.";
export const NEWS_SIGN = "Happy hunting,\nOwl & Twig Vintage";

/* the app links: a member's email signs in as every Prowl email does (a ticket in the hash); a preview or test has none */
function newsUrl(D, ms, q) {
  if (ms.preview) return D.PROWL_APP + (q ? "?" + q : "");
  return D.PROWL_APP + "?alerts=in" + (q ? "&" + q : "") + D.alLinkHash(ms);
}
export function newsUnsubUrl(D, ms) { return D.alUnsubUrl(ms) + "&w=news"; }
/* ms: the member as alMailSub gives it (or a preview stand-in); cur: the campaign */
export function newsBuild(D, env, ms, cur) {
  const E = D.alEsc, pro = !!ms.pro, note = newsNote(cur && cur.note);
  const p = (inner, pad) => '<tr><td style="padding:' + (pad || "6px 22px") + ';font:16px/1.6 Georgia,serif;color:#2b2118">' + inner + "</td></tr>";
  const btn = (href, label, dark) => '<a href="' + E(href) + '" style="display:inline-block;padding:12px 20px;border-radius:99px;background:' + (dark ? "#2b2118" : "#8a4b1f") + ';color:#fff;font:bold 15px Arial,sans-serif;text-decoration:none">' + E(label) + "</a>";
  const chip = '<span style="display:inline-block;margin-left:6px;padding:1px 8px;border-radius:99px;background:#f1e3cf;color:#8a4b1f;font:bold 11px Arial,sans-serif;letter-spacing:.06em;vertical-align:2px">PRO</span>';
  let h = '<tr><td style="padding:18px 22px 4px;font:bold 12px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#9a8b7a">Prowl news · ' + E(newsMonth(cur)) + "</td></tr>" +
    '<tr><td style="padding:0 22px 8px;font:bold 26px/1.25 Georgia,serif;color:#2b2118">' + E(NEWS_SUBJECT) + "</td></tr>";
  if (note) h += p('<i>' + E(note).replace(/\n/g, "<br>") + "</i>", "4px 22px 10px");
  h += p(E(NEWS_INTRO));
  NEWS_ITEMS.forEach(it => {
    h += '<tr><td style="padding:14px 22px 2px;border-top:1px solid #efe8dc"><div style="font:bold 17px/1.35 Georgia,serif;color:#2b2118">' + E(it.h) + (it.pro ? chip : "") + "</div>" +
      '<div style="padding-top:4px;font:15px/1.6 Arial,sans-serif;color:#4a423b">' + E(it.t) + "</div>" +
      '<div style="padding:6px 0 4px;font:bold 15px Arial,sans-serif"><a href="' + E(newsUrl(D, ms, it.q)) + '" style="color:#8a4b1f">' + E(it.go) + " →</a></div></td></tr>";
  });
  if (!pro) h += p('<span style="font:15px/1.6 Arial,sans-serif;color:#4a423b">' + E(NEWS_PRO_LINE) + ' <a href="' + E(ms.preview ? D.PROWL_APP + "?upgrade=1" : D.alUpgradeUrl(ms)) + '" style="color:#8a4b1f;font-weight:bold">Try Prowl Pro</a></span>', "14px 22px 6px");
  h += '<tr><td style="padding:18px 22px 6px;border-top:1px solid #efe8dc;font:bold 18px/1.35 Georgia,serif;color:#2b2118">Tell us what you think</td></tr>' +
    p('<span style="font:15px/1.6 Arial,sans-serif;color:#4a423b">What do you like, and what’s missing or broken? Two boxes, a minute at most, and a person reads every note.</span>', "0 22px 8px") +
    '<tr><td style="padding:4px 22px 6px">' + btn(newsUrl(D, ms, "feedback=1"), "Tell us what you think") + "</td></tr>" +
    p("<i>" + E(NEWS_SIGN).replace(/\n/g, "<br>") + "</i>", "14px 22px 4px") +
    '<tr><td style="padding:10px 22px 4px">' + btn(newsUrl(D, ms, ""), "Open Prowl", true) + "</td></tr>";
  const links = '<a href="' + E(newsUnsubUrl(D, ms)) + '" style="color:#9a8b7a">Stop product updates</a> · <a href="' + E(D.alUnsubUrl(ms)) + '" style="color:#9a8b7a">Unsubscribe from all Prowl emails</a>';
  const html = D.alShell(env, h, "You are getting this because you have Prowl Alerts on. We send news about Prowl a few times a year at most; your alert emails are separate.", links);
  const text = [NEWS_SUBJECT, ""].concat(note ? [note, ""] : [], [NEWS_INTRO, ""],
    ...NEWS_ITEMS.map(it => [it.h + (it.pro ? " (Pro)" : ""), it.t, it.go + ": " + newsUrl(D, ms, it.q), ""]),
    pro ? [] : [NEWS_PRO_LINE, "Try Prowl Pro: " + (ms.preview ? D.PROWL_APP + "?upgrade=1" : D.alUpgradeUrl(ms)), ""],
    ["Tell us what you think: " + newsUrl(D, ms, "feedback=1"), "", NEWS_SIGN, "", "--",
      "You are getting this because you have Prowl Alerts on. We send news about Prowl a few times a year at most.",
      "Stop product updates: " + newsUnsubUrl(D, ms), "Unsubscribe from all Prowl emails: " + D.alUnsubUrl(ms), 'Or just reply "unsubscribe" to this email.',
      "Copyright © " + new Date().getUTCFullYear() + " Owl & Twig Vintage. All rights reserved.", D.alAddr(env) + " · owlandtwigvintage.com"]).join("\n");
  return { subject: NEWS_SUBJECT, html: html, text: text, unsub: newsUnsubUrl(D, ms) };
}
function newsMonth(cur) {
  const m = /^(\d{4})-(\d{2})$/.exec(String((cur && cur.edition) || NEWS_EDITION));
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return m ? names[Number(m[2]) - 1] + " " + m[1] : "";
}
/* a stand-in member for the admin's preview and test (no address of anyone, no ticket) */
export function newsSample(email, pro) { return { email: String(email || "member@example.com"), utok: "preview", pro: !!pro, preview: true }; }

/* one member: the marker first (a crash after it can never send twice), then the email */
export async function newsSendOne(D, env, sub, cur) {
  sub.news = cur.id;
  if (!(await D.alMerge(env, sub, ["news"]))) return "gone";
  const ms = await D.alMailSub(env, sub);
  const m = newsBuild(D, env, ms, cur);
  const r = await D.alSend(env, sub.email, m.subject, m.html, m.text, m.unsub);
  return r && r.ok ? "sent" : "failed";
}
/* the alert clock's share: subs = every member record this run read; room = outside calls the run can still spend */
export async function newsTick(D, env, subs, room, nowMs) {
  const res = { sent: 0, failed: 0, done: false };
  let cur = await D.kvGet(env, NEWS_KEY, null);
  if (!cur || cur.status !== "sending") return res;
  const due = (subs || []).filter(s => newsDue(s, cur));
  const n = Math.max(0, Math.min(NEWS_PER_RUN, Math.floor(Number(room) || 0), due.length));
  for (let i = 0; i < n; i++) {
    if (i) { const c = await D.kvGet(env, NEWS_KEY, null); if (!c || c.id !== cur.id || c.status !== "sending") break; }   /* Stop takes effect between emails */
    let r = "failed";
    try { r = await newsSendOne(D, env, due[i], cur); } catch (e) { r = "failed"; }
    if (r === "sent") res.sent++; else if (r === "failed") res.failed++;
  }
  const fresh = await D.kvGet(env, NEWS_KEY, null);
  if (!fresh || fresh.id !== cur.id) return res;
  fresh.sent = (Number(fresh.sent) || 0) + res.sent;
  fresh.failed = (Number(fresh.failed) || 0) + res.failed;
  fresh.lastRun = new Date(nowMs || Date.now()).toISOString();
  if (fresh.status === "sending" && due.length <= n) { fresh.status = "done"; fresh.doneAt = fresh.lastRun; res.done = true; }
  await D.kvPut(env, NEWS_KEY, fresh);
  return res;
}
