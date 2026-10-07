# Prowl login — build brief for Claude

Goal: real login on `/pages/prowl` using Shopify customer accounts. No new auth
system, no passwords. Shopify handles identity; the Worker verifies it.

## How it works (the whole design in 5 lines)

1. Visitor taps "Log in" → Shopify's passwordless login → returns to `/pages/prowl`.
2. Page calls `https://www.owlandtwigvintage.com/apps/prowl/me` (an **app proxy**).
3. Shopify proxies that to the Worker **with a signed `logged_in_customer_id`**.
4. Worker verifies the signature, mints a short-lived session token, page uses it
   as a Bearer header on the existing Worker endpoints.
5. Pro status is checked server-side against the customer's real orders —
   this closes the line-item-property gifting hole.

## Matthew has to do 2 things (only he can)

1. **Shopify admin → Settings → Customer accounts → switch to the new
   customer accounts** (passwordless, email + code). This is also his customer
   acquisition: every login becomes a customer record with an email he can
   reach in Shopify Email.
2. **Create the custom app in the Dev Dashboard** (partners.shopify.com — NOT
   in the store admin; Shopify stopped allowing admin-created custom apps):
   - Create app → custom distribution → install on owlandtwigvintage-store.
   - API scopes: `read_customers`, `read_orders`.
   - App proxy: subpath `prowl`, proxy URL
     `https://prowl.thebluecloud.workers.dev/proxy`.
   - Copy the **Admin API access token** and the **app secret**. These go into
     the Worker as secrets (below). They never go in chat or in code.

## Claude: Worker changes (existing `prowl` worker)

Secrets (Matthew pastes on his machine, `wrangler secret put`):

- `SHOPIFY_ADMIN_TOKEN` — Admin API token from the custom app.
- `SHOPIFY_APP_SECRET` — app secret, for proxy signature verification.
- `PROWL_SESSION_SECRET` — any long random string you generate.

New route — the app proxy target, e.g. `POST /proxy/me`:

- Shopify appends `logged_in_customer_id`, `timestamp`, `signature`, etc. as
  query params. Verify: drop `signature`, sort remaining params by key,
  join as `key=value` concatenated (no separators), HMAC-SHA256 hex with
  `SHOPIFY_APP_SECRET`. Constant-time compare against `signature`.
  Reject (401) on mismatch or on `timestamp` older than 5 minutes.
- If `logged_in_customer_id` is absent → return `{loggedIn:false}`.
- If present → mint session token:
  `base64url(customerId + '.' + expiryEpoch + '.' + HMAC(sessionSecret, customerId + '.' + expiryEpoch))`,
  expiry = now + 30 days. Return `{loggedIn:true, customerId, token}`.
- CORS: same allowlist as the other routes
  (`https://www.owlandtwigvintage.com` + `https://owlandtwigvintage.com`).

Auth on existing endpoints (`/verdict`, `/research`, `/appraise`, `/alerts/*`):

- Accept `Authorization: Bearer <token>`. Verify structure, expiry, HMAC.
- Logged-in callers: identify by customer id. Keep the IP-based daily caps as
  the cost backstop (email-code accounts are cheap to mint, so per-account caps
  alone are gameable); optionally raise the per-visitor AI cap for logged-in
  users once abuse patterns are known.
- `/alerts/status`: when a Bearer token is present, resolve Pro from the
  verified customer id (below), not from the emailed token alone.

Pro check (replaces the line-item-property email match):

- `GET https://owlandtwigvintage-store.myshopify.com/admin/api/2026-01/customers/{id}/orders.json?status=any&limit=20`
  with `X-Shopify-Access-Token: SHOPIFY_ADMIN_TOKEN`.
- Pro = any order with `financial_status == "paid"` containing
  `variant_id == 67633421025534`.
- Cache the result in KV for 6 hours (the page already expects a 6h cache;
  `fresh=1` bypasses it after checkout).
- **Known limitation for v1:** a cancelled subscription keeps its original
  paid order, so this checks purchase, not live subscription status. If that
  matters later, the upgrade path is the `subscriptionContracts` query, which
  needs the protected `read_own_subscription_contracts` scope (requires
  Shopify approval) — do NOT chase that for v1.

Requires the KV namespace bound to the worker (same one already on Matthew's
list for saved hunts).

## Claude: page changes (`/prowl`)

- On load, `fetch('/apps/prowl/me')`. If `{loggedIn:false}`, show "Log in"
  button → `/customer_authentication/login?return_to=/pages/prowl`.
  (Note: `return_to` with new customer accounts is flaky per community
  reports — if Shopify drops the user on the account page instead, they can
  still navigate back to /prowl and the on-load check picks up the session.
  Do not build a custom login form; use Shopify's.)
- Store the session token in `localStorage` (`prowl.session` — keep it out of
  the backup/export like `prowl.owner`). Send as
  `Authorization: Bearer …` alongside the existing `X-Prowl-Owner` header.
- Login gates: **Pro, Prowl Alerts management, saved hunts** (cross-device once
  hunts move server-side). **Do NOT gate the free AI price checks** — login
  stays optional there so the top-of-funnel funnel keeps working with zero
  friction. IP caps remain the cost defense for anonymous use.
- Logged-in header state: show "Hi, {first name}" + Log out (link to
  `/account/logout`? for new accounts the logout URL is via
  `/customer_authentication/logout` — verify against the theme's account link).
- The "I already upgraded" recheck button now calls `alerts/status?fresh=1`
  with the Bearer token; no email needed.

## What this fixes from the redteam

- Pro gifting via forged line-item properties: dead — Pro resolves from the
  verified customer id's real orders.
- Owner-code sharing: keep `?owner=` for Matthew's own device, but logged-in
  identity is now the real per-user mechanism.

## Out of scope for v1

- Migrating anonymous localStorage hunts/Den to the account (do after saved
  hunts exist server-side).
- Social logins (Shop / Google / Apple via Shopify handle this themselves in
  the new accounts flow — nothing to build).
