/* v114: Prowl's own notifications (Web Push). worker/push.js is tested directly (RFC 8291's own test vector, a full
   decrypt, the VAPID JWT, the push services it will post to); the storage, the signed button token and the payload
   run on the real functions from index.js. Run: node --test worker/__tests__/push.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pushEncrypt, vapidJwt, pushSubClean, pushSend, b64u, unb64u, PUSH_HOSTS } from "../push.js";
import { SW_SRC } from "../sw-src.js";
import { swModule } from "../../scripts/build-sw.mjs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const SW = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
function fromIndex(names, deps) {
  const keys = Object.keys(deps);
  return new Function(...keys, names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(...keys.map((k) => deps[k]));
}
const enc = new TextEncoder();

/* RFC 8291, Appendix A */
const A = {
  plain: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
async function ecdhPair(pubB64, privB64) {
  const pub = unb64u(pubB64);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)), d: privB64 };
  return {
    privateKey: await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await crypto.subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
/* what a browser does with the body: the receiving side of RFC 8291 */
async function decrypt(body, uaPrivB64, uaPubB64, authB64) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const ua = await ecdhPair(uaPubB64, uaPrivB64), uaPublic = unb64u(uaPubB64);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const join = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
  const ikm = await hmac(await hmac(unb64u(authB64), ecdh), join(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, join(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, join(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
  assert.equal(plain[plain.length - 1], 2, "the last record's delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}

test("RFC 8291 Appendix A: the same keys and salt give the RFC's body, byte for byte", async () => {
  const out = await pushEncrypt(A.plain, A.uaPublic, A.auth, await ecdhPair(A.asPublic, A.asPrivate), unb64u(A.salt));
  assert.equal(b64u(out), A.body);
  assert.equal(await decrypt(out, A.uaPrivate, A.uaPublic, A.auth), A.plain);
});

test("a fresh key and salt each time, and the browser can read every one", async () => {
  const payload = JSON.stringify({ v: 1, title: "🐾 I think I spotted your quarry", body: "Royal Haeger panther\n$185 on eBay" });
  const a = await pushEncrypt(payload, A.uaPublic, A.auth), b = await pushEncrypt(payload, A.uaPublic, A.auth);
  assert.notEqual(b64u(a), b64u(b));
  assert.equal(await decrypt(a, A.uaPrivate, A.uaPublic, A.auth), payload);
  assert.equal(await decrypt(b, A.uaPrivate, A.uaPublic, A.auth), payload);
});

test("VAPID: an ES256 JWT for the push service's origin, 12 hours, that the public key verifies", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const now = Date.UTC(2026, 9, 13, 12);
  const t = await vapidJwt(JSON.stringify(jwk), "https://fcm.googleapis.com", "mailto:hello@owlandtwigvintage.com", now);
  const [h, c, sig] = t.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(h))), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(c))), { aud: "https://fcm.googleapis.com", exp: now / 1000 + 12 * 3600, sub: "mailto:hello@owlandtwigvintage.com" });
  assert.equal(unb64u(sig).length, 64, "raw r||s, not DER");
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, unb64u(sig), enc.encode(h + "." + c)));
});

test("only the browsers' own push services are ever posted to; a subscription is checked", () => {
  const keys = { p256dh: A.uaPublic, auth: A.auth };
  for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QAbc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"])
    assert.ok(pushSubClean({ endpoint: ok, keys }), ok);
  for (const bad of ["https://evil.example/push", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x", "https://prowl.thebluecloud.workers.dev/admin"])
    assert.equal(pushSubClean({ endpoint: bad, keys }), null, bad);
  assert.equal(pushSubClean({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: A.uaPublic, auth: "short" } }), null);
  assert.equal(pushSubClean({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: A.auth, auth: A.auth } }), null);
  assert.ok(PUSH_HOSTS.test("https://web.push.apple.com/x"));
});

test("sending: the headers a push service wants, and what each answer means", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const env = { VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey)), VAPID_PUBLIC: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))), VAPID_SUBJECT: "mailto:shop@example.com" };
  const s = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: A.uaPublic, auth: A.auth };
  let seen = null;
  const answer = (status) => async (u, o) => { seen = { u, o }; return { status }; };
  assert.deepEqual(await pushSend(env, s, { v: 1, title: "t" }, answer(201)), { ok: true, status: 201 });
  assert.equal(seen.u, s.endpoint);
  assert.match(seen.o.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(seen.o.headers["Content-Encoding"], "aes128gcm");
  assert.equal(seen.o.headers.TTL, "86400");
  assert.equal(seen.o.headers.Urgency, "high");
  assert.equal(await decrypt(seen.o.body, A.uaPrivate, A.uaPublic, A.auth), JSON.stringify({ v: 1, title: "t" }));
  assert.equal((await pushSend(env, s, {}, answer(410))).gone, true);
  assert.equal((await pushSend(env, s, {}, answer(404))).gone, true);
  assert.equal((await pushSend(env, s, {}, answer(429))).retry, true);
  assert.equal((await pushSend(env, s, {}, answer(503))).retry, true);
  assert.equal((await pushSend(env, s, {}, async () => { throw new Error("offline"); })).retry, true);
  assert.equal((await pushSend({}, s, {}, answer(201))).bad, true, "not set up: nothing is sent");
  assert.equal((await pushSend(env, Object.assign({}, s, { endpoint: "https://evil.example/x" }), {}, answer(201))).bad, true);
});

/* index.js: storage, the signed button token and the payload */
function kvFake() {
  const m = new Map();
  return { m, PROWL_ALERTS: { delete: async (k) => { m.delete(k); } }, get: async (e, k, d) => (m.has(k) ? JSON.parse(m.get(k)) : d), put: async (e, k, v) => { m.set(k, JSON.stringify(v)); } };
}
const vClean = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);

test("keeping phones: the same phone replaces itself, the newest five are kept", () => {
  const X = fromIndex(["pushAdd"], { PUSH_MAX: 5, vClean });
  let list = [];
  for (let i = 0; i < 7; i++) list = X.pushAdd(list, { endpoint: "https://fcm.googleapis.com/" + i, p256dh: "p", auth: "a" }, "Android", 1000 + i).list;
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((x) => x.endpoint.slice(-1)), ["2", "3", "4", "5", "6"]);
  const r = X.pushAdd(list, { endpoint: "https://fcm.googleapis.com/3", p256dh: "p2", auth: "a2" }, "Android", 2000);
  assert.equal(r.list.length, 5, "no duplicate");
  assert.equal(r.list[4].p256dh, "p2", "the renewed one, newest last");
  assert.deepEqual(r.dropped, []);
  const full = X.pushAdd(list, { endpoint: "https://fcm.googleapis.com/9", p256dh: "p", auth: "a" }, "x".repeat(80), 3000);
  assert.deepEqual(full.dropped.map((x) => x.endpoint.slice(-1)), ["2"], "the oldest goes, so its index can go too");
  assert.equal(full.list[4].label.length, 40);
});

test("a phone the push service says is gone (410) is dropped; a busy one (429) is kept for next time", async () => {
  const kv = kvFake();
  const sent = [];
  const X = fromIndex(["pushHash", "pushId", "pushList", "pushToMember"], {
    kvGet: kv.get, kvPut: kv.put,
    pushSend: async (env, s) => { sent.push(s.endpoint); return { "https://fcm.googleapis.com/gone": { gone: true, status: 410 }, "https://fcm.googleapis.com/busy": { retry: true, status: 429 }, "https://fcm.googleapis.com/ok": { ok: true, status: 201 } }[s.endpoint]; },
  });
  const env = { MEMBER_ID_SALT: "salt", PROWL_ALERTS: kv.PROWL_ALERTS };
  const pid = await X.pushId(env, "Matt@x.com");
  assert.equal(pid, await X.pushId(env, "matt@x.com"), "case does not matter");
  assert.doesNotMatch(pid, /matt|@/, "no address in the key");
  await kv.put(env, "push:" + pid, ["gone", "busy", "ok"].map((k) => ({ endpoint: "https://fcm.googleapis.com/" + k })));
  const out = await X.pushToMember(env, "matt@x.com", { v: 1 });
  assert.deepEqual(out, { ok: 1, retry: 1, gone: 1, n: 3, codes: [410, 429] }, "v123: the codes of the phones that did not take it");
  const left = JSON.parse(kv.m.get("push:" + pid));
  assert.deepEqual(left.map((x) => x.endpoint.slice(-4)), ["busy", "m/ok"]);
  assert.ok(left[1].lastOk, "the one that took it is marked");
});

test("a notification's buttons carry a signed token for that match, 14 days, never the member's sign-in", async () => {
  const X = fromIndex(["pushActKey", "pushActSign", "pushActToken", "pushActOpen", "pounceKey", "pounceSeal", "pounceOpen"], {
    PUSH_ACT_DAYS: 14, pushB64u: b64u, pushUnb64u: unb64u, alSame: (a, b) => a === b, alEmail: (e) => String(e || "").toLowerCase(), vClean,
  });
  const env = { MEMBER_ID_SALT: "salt" }, now = Date.UTC(2026, 9, 13);
  const t = await X.pushActToken(env, "matt@x.com", "royal haeger panther", "https://www.ebay.com/itm/1", now);
  assert.match(t, /^[\w-]+\.[\w-]{32}$/);
  assert.equal(t.indexOf("matt"), -1);
  assert.equal(Buffer.from(t.split(".")[0], "base64").toString().indexOf("matt"), -1, "the address is sealed inside");
  assert.deepEqual(await X.pushActOpen(env, t, now + 86400000), { email: "matt@x.com", hunt: "royal haeger panther", url: "https://www.ebay.com/itm/1" });
  assert.equal(await X.pushActOpen(env, t, now + 15 * 86400000), null, "expired after 14 days");
  assert.equal(await X.pushActOpen(env, t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"), now), null, "tampered");
  assert.equal(await X.pushActOpen({ MEMBER_ID_SALT: "other" }, t, now), null, "another key");
  assert.equal(await X.pushActToken({}, "matt@x.com", "h", "u", now), "", "no key set: no buttons");
});

test("a match's notification: no address or name, under 3 KB, one tag per quarry, opens the match in Prowl", async () => {
  let payload = null;
  const X = fromIndex(["pushHash", "pushMatch"], {
    AL_SRC_NAME: { ebay: "eBay" }, PROWL_APP: "https://www.owlandtwigvintage.com/pages/prowl-app",
    pushActToken: async () => "tok.sig", pushToMember: async (env, email, p) => { payload = p; return { ok: 1 }; },
  });
  const x = { title: "Royal Haeger panther 26 inch, flat tail", price: "$185", src: "ebay", url: "https://www.ebay.com/itm/1", image: "https://i.ebayimg.com/1.jpg", hunt: "Royal Haeger panther", pounce: { match: "yes", p: 0.9, reason: "Flat tail along the base." } };
  await X.pushMatch({}, { email: "matt.partsch@icloud.com", tok: "T".repeat(36), first: "Matt" }, x);
  const wire = JSON.stringify(payload);
  assert.equal(wire.indexOf("matt"), -1, "no address");
  assert.equal(wire.indexOf("Matt"), -1, "no name");
  assert.equal(wire.indexOf("T".repeat(36)), -1, "no token");
  assert.ok(Buffer.byteLength(wire) < 3072);
  assert.equal(payload.title, "Prowl found a likely match for Royal Haeger panther", "v115: who it is from and why, no emoji");
  assert.doesNotMatch(payload.title + payload.body, /\p{Extended_Pictographic}/u);
  assert.match(payload.body, /\$185 on eBay\nWhy: Flat tail along the base\./);
  assert.equal(payload.url, "https://www.owlandtwigvintage.com/pages/prowl-app?pounce=https%3A%2F%2Fwww.ebay.com%2Fitm%2F1");
  assert.equal(payload.img, x.image);
  const tag = payload.tag;
  await X.pushMatch({}, { email: "m@x.com" }, Object.assign({}, x, { hunt: "royal haeger panther", url: "https://www.ebay.com/itm/2" }));
  assert.equal(payload.tag, tag, "same quarry, same tag: the newer note replaces the older");
});

test("the service worker: served from the app proxy as JavaScript, filled in, kept in step", async () => {
  assert.equal(SW_SRC, SW, "worker/sw-src.js is out of date: run node scripts/build-sw.mjs");
  assert.equal(readFileSync(new URL("../sw-src.js", import.meta.url), "utf8"), swModule(SW));
  const X = fromIndex(["swResponse"], { SW_SRC, WORKER_BASE: "https://prowl.example", PROWL_APP: "https://shop.example/pages/prowl-app" });
  const r = X.swResponse({ VAPID_PUBLIC: "BKEY" }, "GET");
  assert.equal(r.headers.get("Content-Type"), "application/javascript; charset=utf-8");
  assert.equal(r.headers.get("Cache-Control"), "no-cache");
  const src = await r.text();
  assert.match(src, /var API = 'https:\/\/prowl\.example\/', APP = 'https:\/\/shop\.example\/pages\/prowl-app', KEY = 'BKEY';/);
  assert.equal(r.headers.get("Service-Worker-Allowed"), "/pages/prowl-app", "v121: the app page may register it");
  assert.equal((SW.match(/addEventListener\('fetch'/g) || []).length, 1, "v121: one fetch handler, for the share sheet only");
  assert.doesNotMatch(SW, /\b(let|const|class)\b|=>/, "ES5");
  for (const ev of ["push", "notificationclick", "pushsubscriptionchange"]) assert.match(SW, new RegExp("addEventListener\\('" + ev + "'"));
  assert.match(SW, /action: 'price', title: 'Check price'/);
  assert.match(SW, /action: 'notit', title: 'Not it'/);
});

test("v115: the test note says who it is from and what will come, with no emoji", () => {
  const m = /const PUSH_TEST = (\{[^\n]*\});/.exec(INDEX);
  assert.ok(m);
  const t = new Function("PROWL_APP", "return " + m[1])("https://shop.example/app");
  assert.equal(t.title, "Prowl by Owl & Twig Vintage");
  assert.match(t.body, /Pounce spots the piece you described/);
  assert.doesNotMatch(t.title + t.body, /\p{Extended_Pictographic}/u);
  assert.equal((INDEX.match(/pushToMember\(env, sub\.email, PUSH_TEST\)/g) || []).length, 2, "the subscribe test and Send test both use it");
});

test("wired in: the routes, status, delete and address change", () => {
  assert.ok(INDEX.indexOf('url.pathname === "/proxy/sw.js"') < INDEX.indexOf('return proxyHandle(request, env, url);'), "the service worker needs no Shopify signature");
  assert.match(INDEX, /url\.pathname\.startsWith\("\/push\/"\) && request\.method === "POST"\) return pushRoute/);
  assert.match(indexFn("alStatus"), /wpush: pushReady\(env\)/);
  assert.match(indexFn("alPurge"), /await pushPurge\(env, email\)/);
  assert.match(indexFn("alMoveConfirm"), /await pushMove\(env, from, to\)/);
  assert.match(indexFn("pushRoute"), /sub\.phone = "prowl"/, "subscribing makes Prowl's own alerts the default");
  assert.match(INDEX, /const WORKER_VERSION = "v(11[4-9]|1[2-9]\d|[2-9]\d\d)";/);
});
