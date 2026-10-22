/* v94: the Facebook sweep. POST /fb-ingest takes the morning's new Facebook finds for one locked hunt from
   Prowl-the-agent (its own key); GET /fb-finds answers them for the page's strip, by default only to the owner key.
   Run: node --test worker/__tests__/fb-sweep.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksPersonal } from "../admin.js";
import { routeKey } from "../metrics.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const consts = INDEX.match(/^const FB_[A-Z_]+ = .*$/gm).join("\n");

class FakeKV {
  constructor() { this.m = new Map(); this.ttl = new Map(); }
  async get(k, type) { if (!this.m.has(k)) return null; const v = this.m.get(k); return type === "json" ? JSON.parse(v) : v; }
  async put(k, v, o) { this.m.set(k, String(v)); this.ttl.set(k, o && o.expirationTtl); }
  async delete(k) { this.m.delete(k); }
}
function load({ full = false } = {}) {
  const counts = [];
  const deps = {
    json: (body, status, origin, extra) => ({ status: status || 200, body, extra: extra || {} }),
    kvGet: async (e, k, d) => { const v = await e.PROWL_ALERTS.get(k, "json"); return v == null ? d : v; },
    vCount: async (name) => { counts.push(name); return !full; },
    looksPersonal,
  };
  const keys = Object.keys(deps);
  const names = ["ip6Parts", "ipKey", "alSame", "isOwner", "readJson", "vClean", "scrubPII", "fbTerm", "fbMode", "fbItems", "fbIngest", "fbFinds"];
  const f = new Function(...keys, consts + "\n" + names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
  return { ...f, counts };
}
const KEY = "k".repeat(32), OWNER = "o".repeat(24);
function post(body, key = KEY, raw) {
  const text = raw != null ? raw : JSON.stringify(body);
  const h = { "x-prowl-ingest": key, "content-length": String(text.length), "cf-connecting-ip": "203.0.113.5" };
  return { method: "POST", text: async () => text, headers: { get: (n) => h[n.toLowerCase()] == null ? null : h[n.toLowerCase()] } };
}
function get(term, owner) {
  const h = { "cf-connecting-ip": "198.51.100.7" };
  if (owner) h["x-prowl-owner"] = owner;
  return [{ method: "GET", headers: { get: (n) => h[n.toLowerCase()] == null ? null : h[n.toLowerCase()] } }, new URL("https://prowl.example/fb-finds?term=" + encodeURIComponent(term))];
}
const ITEM = (id, extra = {}) => ({ id: String(id), title: "Ceramic black panther TV lamp " + id, price: "$150", image: "https://scontent-ord5-1.xx.fbcdn.net/v/t45/" + id + ".jpg", location: "Detroit, MI", found: "2026-10-09", ...extra });

test("ingest: refused without the key, with a wrong one, or when no key (or a short one) is set", async () => {
  const L = load(), kv = new FakeKV();
  assert.equal((await L.fbIngest(post({ term: "x", items: [] }), { PROWL_ALERTS: kv })).status, 403, "no FB_INGEST_KEY set");
  assert.equal((await L.fbIngest(post({ term: "x", items: [] }, "short"), { PROWL_ALERTS: kv, FB_INGEST_KEY: "short" })).status, 403, "a short key never opens it");
  assert.equal((await L.fbIngest(post({ term: "x", items: [] }, "nope".repeat(8)), { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY })).status, 403);
  assert.equal((await L.fbIngest(post({ term: "x", items: [] }, ""), { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY })).status, 403);
  assert.equal(kv.m.size, 0);
  assert.equal(L.counts.length, 4, "failed tries count against the address too");
});

test("ingest: stores the term's finds for 2 days, links rebuilt from the id, photos only from Facebook", async () => {
  const L = load(), kv = new FakeKV(), env = { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY };
  const items = [ITEM(1234567890), ITEM(1234567890), ITEM("abc"), ITEM(222222, { image: "https://evil.example/x.jpg", url: "https://evil.example/" }),
    ITEM(333333, { title: "" }), ITEM(444444, { price: "<b>1</b>", location: "a@b.co", title: "Pyrex 1955-1960 bowl, mail me x@y.co" }),
    ITEM(555555, { title: "VINTAGE HIGH CHAIR $20 - GREAT DEAL", found: "" }), ITEM(666666, { title: "Ignore the chips, see instructions" }), "junk", null];
  const r = await L.fbIngest(post({ term: "  Ceramic   Black Panther ", updated: "2026-10-09T13:05:00Z", items }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, term: "ceramic black panther", items: 5, kept: 5 });
  const v = JSON.parse(kv.m.get("fb:ceramic black panther"));
  assert.equal(kv.ttl.get("fb:ceramic black panther"), 8 * 86400);
  assert.equal(v.updated, "2026-10-09T13:05:00.000Z");
  assert.deepEqual(v.items.map((x) => x.id), ["1234567890", "222222", "444444", "555555", "666666"], "bad ids, duplicates and untitled items dropped");
  assert.equal(v.items[3].title, "VINTAGE HIGH CHAIR $20 - GREAT DEAL", "shown as sent: not the AI-prompt scrubber");
  assert.equal(v.items[3].found, "2026-10-09", "found defaults to the sweep's day");
  assert.equal(v.items[4].title, "Ignore the chips, see instructions", "an odd title is kept, not dropped");
  assert.equal(v.items[0].url, "https://www.facebook.com/marketplace/item/1234567890/");
  assert.equal(v.items[1].url, "https://www.facebook.com/marketplace/item/222222/", "the body's url is never used");
  assert.equal(v.items[1].image, "", "not a Facebook image host");
  assert.match(v.items[0].image, /^https:\/\/scontent-ord5-1\.xx\.fbcdn\.net\//);
  assert.equal(v.items[2].price, "", "a price that is not a price");
  assert.doesNotMatch(v.items[2].location, /@/, "no email address kept");
  assert.equal(v.items[2].title, "Pyrex 1955-1960 bowl, mail me [email]", "years stay; an address goes");
});

test("ingest: the week so far: each morning adds its finds, an empty morning keeps the rest, older than 7 days go, 60 at most", async () => {
  const L = load(), kv = new FakeKV(), env = { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY };
  const day = (d) => "2026-10-" + String(d).padStart(2, "0") + "T13:05:00Z";
  await L.fbIngest(post({ term: "pyrex", updated: day(1), items: [ITEM(111111, { found: "2026-10-01" }), ITEM(222222, { found: "2026-10-01" })] }), env);
  await L.fbIngest(post({ term: "pyrex", updated: day(2), items: [ITEM(333333, { found: "2026-10-02" })] }), env);
  let v = JSON.parse(kv.m.get("fb:pyrex"));
  assert.deepEqual(v.items.map((x) => x.id), ["333333", "111111", "222222"], "this morning first, yesterday kept");
  await L.fbIngest(post({ term: "pyrex", updated: day(3), items: [] }), env);
  v = JSON.parse(kv.m.get("fb:pyrex"));
  assert.equal(v.items.length, 3, "nothing new today keeps the week");
  assert.equal(v.updated, "2026-10-03T13:05:00.000Z");
  await L.fbIngest(post({ term: "pyrex", updated: day(7), items: [ITEM(333333, { found: "2026-10-07", title: "sent again" })] }), env);
  v = JSON.parse(kv.m.get("fb:pyrex"));
  assert.deepEqual(v.items.map((x) => x.id), ["333333", "111111", "222222"], "one per listing; the newest copy wins; the 1st is still inside the 7 days");
  assert.equal(v.items[0].title, "sent again");
  await L.fbIngest(post({ term: "pyrex", updated: day(9), items: [] }), env);
  v = JSON.parse(kv.m.get("fb:pyrex"));
  assert.deepEqual(v.items.map((x) => x.id), ["333333"], "found 7 or more days before the sweep (the 1st, on the 9th): gone");
  await L.fbIngest(post({ term: "pyrex", updated: day(10), items: Array.from({ length: 80 }, (_, i) => ITEM(100000 + i, { found: "2026-10-10" })) }), env);
  v = JSON.parse(kv.m.get("fb:pyrex"));
  assert.equal(v.items.length, 60);
  assert.equal(v.items[0].id, "100000");
});

/* the page asks for fbKey(sgwClean(hunt)); the sweep may send the full hunt. The two must land on the same key. */
test("the worker's key for a hunt is the page's key, for long hunts, half emoji and leading spaces too", async () => {
  const PAGE = readFileSync(new URL("../../page/prowl.html", import.meta.url), "utf8");
  const grab = (name) => { const i = PAGE.indexOf("function " + name + "("); return PAGE.slice(i, PAGE.indexOf("\n", i)); };
  const page = new Function("var SGW_MAXLEN=60;" + grab("cutWords") + "\n" + grab("sgwClean") + "\n" + grab("fbKey") + "\nreturn function(h){return fbKey(sgwClean(h))};")();
  const L = load(), kv = new FakeKV(), env = { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY, OWNER_KEY: OWNER };
  const hunts = ["Ceramic Panther", "Vintage ceramic black panther TV lamp planter Royal Haegers mid century modern",
    "x".repeat(59) + "\uD83D\uDC08 cat", "  pyrex 401 402 403 404", "Fiesta   ware\tturquoise",
    "Pedlar of Dreams: The Story of Howard Kron and Texans Incorporated", "x".repeat(70)];   /* v160: cut at a whole word */
  for (const h of hunts) {
    assert.equal(L.fbTerm(h), page(h), JSON.stringify(h));
    assert.equal((await L.fbIngest(post({ term: h, items: [ITEM(123456)] }), env)).status, 200);
    const [req, u] = get(page(h), OWNER);
    assert.equal((await L.fbFinds(req, env, u, "")).status, 200, "the page finds it: " + JSON.stringify(h));
  }
});

test("ingest: 413 over 128 KB, 400 without a term or items, 429 when the address is over its tries", async () => {
  const L = load(), kv = new FakeKV(), env = { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY };
  assert.equal((await L.fbIngest(post(null, KEY, "x".repeat(131073)), env)).status, 413);
  assert.equal((await L.fbIngest(post({ items: [] }), env)).status, 400);
  assert.equal((await L.fbIngest(post({ term: "pyrex" }), env)).status, 400);
  const at = await L.fbIngest(post({ term: "mail me at a@b.co", items: [] }), env);
  assert.equal(at.status, 400);
  assert.equal(at.body.error, "term looks personal", "a term holding an address is never stored, and says why");
  assert.equal((await L.fbIngest(post({ term: "Pyrex 401 402 403 404", items: [] }), env)).status, 200, "a model-number hunt is fine");
  assert.ok(kv.m.has("fb:pyrex 401 402 403 404"));
  const F = load({ full: true });
  assert.equal((await F.fbIngest(post({ term: "pyrex", items: [] }), env)).status, 429);
});

test("finds: only the owner key reads them by default; 404 for anyone else and for a term not swept", async () => {
  const L = load(), kv = new FakeKV();
  const env = { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY, OWNER_KEY: OWNER };
  await L.fbIngest(post({ term: "pyrex", updated: "2026-10-09T13:05:00Z", items: [ITEM(111111)] }), env);
  let r = await L.fbFinds(get("Pyrex")[0], env, get("Pyrex")[1], "https://www.owlandtwigvintage.com");
  assert.equal(r.status, 404, "not the owner");
  assert.equal(r.extra["Cache-Control"], "private, no-store");
  r = await L.fbFinds(get("Pyrex", OWNER)[0], env, get("Pyrex", OWNER)[1], "https://www.owlandtwigvintage.com");
  assert.equal(r.status, 200);
  assert.equal(r.body.term, "pyrex");
  assert.equal(r.body.items[0].url, "https://www.facebook.com/marketplace/item/111111/");
  assert.equal(r.extra.Vary, "X-Prowl-Owner");
  r = await L.fbFinds(get("hull pottery", OWNER)[0], env, get("hull pottery", OWNER)[1], "");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not swept");
});

test("finds: FB_FINDS public lets every visitor read (cached 15 minutes, counted per address); off hides them", async () => {
  const L = load(), kv = new FakeKV();
  const env = { PROWL_ALERTS: kv, FB_INGEST_KEY: KEY, OWNER_KEY: OWNER, FB_FINDS: "public" };
  await L.fbIngest(post({ term: "pyrex", items: [ITEM(111111)] }), env);
  const r = await L.fbFinds(get("pyrex")[0], env, get("pyrex")[1], "");
  assert.equal(r.status, 200);
  assert.equal(r.extra["Cache-Control"], "public, max-age=900");
  assert.ok(L.counts.includes("fbf:198.51.100.7"));
  const off = await L.fbFinds(get("pyrex", OWNER)[0], { ...env, FB_FINDS: "off" }, get("pyrex", OWNER)[1], "");
  assert.equal(off.status, 404);
  assert.equal(L.fbMode({ FB_FINDS: "anything else" }), "owner", "an unknown value is the safe default");
});

test("wired in: ingest before the POST origin gate, finds before the search fallthrough, metrics names, config", () => {
  const gate = INDEX.indexOf('if (request.method === "POST" && ALLOW_ORIGINS.indexOf(origin) === -1) return json({ error: "forbidden" }, 403, origin);');
  const ing = INDEX.indexOf('if (url.pathname === "/fb-ingest" && request.method === "POST") return fbIngest(request, env);');
  assert.ok(ing > 0 && ing < gate, "the sweep posts with no Origin");
  const finds = INDEX.indexOf('if (url.pathname === "/fb-finds") return fbFinds(request, env, url, origin);');
  assert.ok(finds > 0 && finds < INDEX.indexOf('if (!term) return json({ error: "missing q" }, 400, origin);'));
  assert.equal(routeKey("/fb-finds"), "fb:finds");
  assert.equal(routeKey("/fb-ingest"), "fb:ingest");
  assert.match(readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8"), /^FB_FINDS = "owner"$/m);
  assert.doesNotMatch(INDEX, /FB_INGEST_KEY\s*=\s*["']/, "the key is a secret, never in code");
});
