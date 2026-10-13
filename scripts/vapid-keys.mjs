// Makes the VAPID key pair for Web Push (worker v114). Run once: `node scripts/vapid-keys.mjs`.
// In Cloudflare > Workers > prowl > Settings > Variables and secrets add:
//   VAPID_PRIVATE_JWK  (type Secret): the first line printed
//   VAPID_PUBLIC       (type Text):   the second line printed
//   VAPID_SUBJECT      (type Text):   mailto: the shop's own address (no member's address)
// Keep the private key secret and never change the pair once members have turned alerts on: every phone's
// subscription is tied to the public key, and a new pair means each phone turns alerts on again.
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
console.log(JSON.stringify({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }));
console.log(b64u(raw));
