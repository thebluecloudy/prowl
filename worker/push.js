/* v114: Web Push from Prowl itself, so a Pounce match arrives as a notification from Prowl, with no ntfy app.
   No dependencies: Web Crypto does all of it.
   - VAPID (RFC 8292): an ES256 JWT for the push service, aud = the endpoint's origin, exp = now + 12 hours, sent as
     "Authorization: vapid t=<jwt>, k=<public key>". The keys come from scripts/vapid-keys.mjs: VAPID_PRIVATE_JWK
     (a secret, the private key as JWK) and VAPID_PUBLIC (a var, the raw public key, base64url).
   - The body is encrypted for the browser (RFC 8291, aes128gcm): ECDH P-256 with a one-time key, HKDF from the
     subscription's auth secret, AES-128-GCM, in one record.
   - Only the browsers' own push services are ever posted to (PUSH_HOSTS): a subscription is data from a browser, and
     the worker must not be made to POST to any other address. */

export const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com)\//i;
export const PUSH_TTL = 86400;
const enc = new TextEncoder();

export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function cat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

/* a subscription as the browser gives it (PushSubscription.toJSON()), checked; null when it is not one */
export function pushSubClean(s) {
  if (!s || typeof s !== "object") return null;
  const endpoint = String(s.endpoint || ""), k = s.keys || {};
  if (endpoint.length > 800 || !PUSH_HOSTS.test(endpoint)) return null;
  let p256dh, auth;
  try { p256dh = unb64u(k.p256dh); auth = unb64u(k.auth); } catch (e) { return null; }
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: endpoint, p256dh: b64u(p256dh), auth: b64u(auth) };
}

/* RFC 8291: the encrypted body for one subscription. asKeys and salt are for the RFC's test vector only. */
export async function pushEncrypt(payload, p256dhB64, authB64, asKeys, salt) {
  const uaPublic = unb64u(p256dhB64), authSecret = unb64u(authB64);
  const as = asKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  /* IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0 || ua_public || as_public, 32) */
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, cat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(s, ikm);
  const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const plain = cat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2]));   /* the last (only) record */
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const rs = 4096, head = new Uint8Array(21);
  head.set(s, 0); head[16] = (rs >>> 24) & 255; head[17] = (rs >>> 16) & 255; head[18] = (rs >>> 8) & 255; head[19] = rs & 255; head[20] = asPublic.length;
  return cat(head, asPublic, ct);
}

/* RFC 8292: the VAPID JWT for one push service */
export async function vapidJwt(privateJwk, aud, sub, now) {
  const jwk = typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk;
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const t = Math.floor((now || Date.now()) / 1000);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: aud, exp: t + 12 * 3600, sub: sub })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body)));   /* raw r||s, as JWS wants */
  return head + "." + body + "." + b64u(sig);
}

export function pushReady(env) { return !!(env && env.VAPID_PRIVATE_JWK && env.VAPID_PUBLIC && env.VAPID_SUBJECT); }

/* Send one payload (an object, kept under 3 KB) to one stored subscription. Returns
   { ok } on 201/202, { gone } on 404/410 (delete it), { retry } on 429/5xx or a network error, { bad } otherwise. */
export async function pushSend(env, s, payload, fetchFn) {
  if (!pushReady(env) || !s || !PUSH_HOSTS.test(String(s.endpoint || ""))) return { bad: true, status: 0 };
  const body = await pushEncrypt(JSON.stringify(payload), s.p256dh, s.auth);
  const aud = new URL(s.endpoint).origin;
  const jwt = await vapidJwt(env.VAPID_PRIVATE_JWK, aud, String(env.VAPID_SUBJECT));
  let r;
  try {
    r = await (fetchFn || fetch)(s.endpoint, {
      method: "POST",
      headers: { "Authorization": "vapid t=" + jwt + ", k=" + env.VAPID_PUBLIC, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": String(PUSH_TTL), "Urgency": "high" },
      body: body
    });
  } catch (e) { return { retry: true, status: 0 }; }
  const st = r.status;
  if (st === 201 || st === 202 || st === 200) return { ok: true, status: st };
  if (st === 404 || st === 410) return { gone: true, status: st };
  if (st === 429 || st >= 500) return { retry: true, status: st };
  return { bad: true, status: st };
}
