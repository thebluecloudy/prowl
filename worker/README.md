# Prowl worker

Cloudflare Worker behind Prowl (`prowl.thebluecloud.workers.dev`): eBay/Etsy/Muse
lookups, Jev, Prowl Alerts emails, Prowl Pro checks.

## How it deploys

Cloudflare Workers Builds watches this repo. Every push to `main` runs
`npx wrangler deploy` from this `worker/` folder and the new code goes live in
about a minute. No dashboard paste needed.

- `index.js` is the worker (ES module, no dependencies). Since v78 it imports three sibling files, which
  wrangler bundles with it on deploy: `admin.js` (the /admin sign-in and API), `admin-page.js` (the admin
  page itself) and `metrics.js` (speed, error and uptime records for the admin dashboard).
- `__tests__/` holds the unit tests: `node --test "worker/__tests__/*.test.mjs"` (Node 22, no packages).
- `wrangler.toml` holds the name, KV binding, crons (the 5-minute alert clock and the hourly uptime
  test searches) and compatibility date.
  `keep_vars = true` means the plain-text variables set in the dashboard survive a deploy.
- Secrets (Resend, eBay, Etsy, Shopify, Muse, TypeSafe, DEBUG_KEY, OWNER_KEY,
  PRO_EMAILS, ALERT_FROM, ALERT_REPLY_TO, ADMIN_KEY) live only in Cloudflare. Never commit them.
  ADMIN_KEY signs in to /admin: at least 20 characters and never the same as OWNER_KEY
  (the public page keeps OWNER_KEY in the browser).

## Rolling back

Cloudflare dashboard, then Workers & Pages, then prowl, then Deployments: pick an
earlier version and choose Rollback. Or revert the commit here and push.

Last version deployed by hand from the dashboard before this was set up:
`dd206e9a-7701-42c8-9a4e-c84f3a56dac2` (2026-10-01 11:38 UTC).
