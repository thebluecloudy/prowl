# Prowl AI burst throttle — build brief for Claude

## The hole
The 400/day sitewide AI cap is burnable by a single IP. Re-redteam (Oct 2, live v5.97),
three rounds: 23 calls in ~44s, 20 unique calls in ~90s, 8 unique calls in ~57s — all
returned 200, zero 429s, no per-IP throttle, no rate-limit headers. One script burns the
whole daily budget in under a minute and real visitors get "Could not price this one
right now" for the rest of the day. This is the single still-open redteam finding.
Why now: the Oct 4 marketing push (NPR promo, walkthrough video, Pro-benefit video,
Facebook video) is built to grow traffic — exposure is going up while the hole is open.

## The fix — Cloudflare's native Rate Limiting binding (free, distributed, no KV needed)
Docs: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
Cost: free, included with Workers. Counting is per Cloudflare location and eventually
consistent — good enough for burst protection.

### 1. wrangler config (add to the config you actually deploy the `prowl` worker with)

```toml
[[ratelimits]]
name = "AI_BURST_LIMITER"
# integer unique to the Cloudflare account; 1001 is the docs example — pick any
# unused integer if 1001 is taken
namespace_id = "1001"
  [ratelimits.simple]
  limit = 10
  period = 60
```

### 2. Worker code — insert at the top of the fetch handler, BEFORE AI route dispatch

```js
// Burst throttle: one shared bucket per visitor IP across the three AI routes.
// 10 req / 60s is far above human use (one tap = one call; page caches answers 24h)
// and kills the observed attack shape (20+ calls in under 90s from one IP).
const AI_ROUTES = ["/verdict", "/research", "/appraise"]; // match the real route constants in this worker
const url = new URL(request.url);
if (request.method === "POST" && AI_ROUTES.includes(url.pathname)) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.AI_BURST_LIMITER.limit({ key: `ai-burst:${ip}` });
  if (!success) {
    return new Response(
      JSON.stringify({ error: "too many requests — slow down and try again in a minute" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          // Always send Retry-After: a bare 429 invites aggressive retry loops
          // that make the flood worse.
          "retry-after": "60",
          // + the same CORS headers this worker already attaches to its other
          // JSON responses (the ones the Oct 2 CORS checks passed with), so the
          // page's fetch error path keeps working.
        },
      }
    );
  }
}
```

Applies to everyone including the owner bypass — 10/min is plenty for demos.

### 3. Do NOT throttle
- `GET /?q=` Goodwill/live search, `/proxy` (Shopify login), `/alerts/*` — no AI cost there.
- The existing 20 checks/visitor/day cap and 24h answer cache stay as-is; this sits in front of them.

## Verify (cheap — does not burn budget)
1. Deploy, then fire ~12 rapid POSTs at `/verdict` with the SAME title+price payload.
   The 24h answer cache means repeat calls cost nothing: expect the first ~10 to return
   200 and the rest 429 with a `retry-after: 60` header.
2. Single taps on Fair price?, Field Guide (`/research`), and the appraiser still work.
3. Goodwill `?q=` search and the login proxy are unaffected (no 429s).
4. Confirm the 400/day sitewide cap and 20/day visitor cap still engage as before.

## What this does not do
- It does not stop a distributed attack (many IPs). That costs the attacker real
  resources; the observed threat was single-script bursts, which this kills.
- It does not replace the 400/day sitewide cap — that stays the cost backstop.
- Later upgrade path: nothing needed. If KV ever lands (saved hunts), no change required —
  the binding is independent of KV.
