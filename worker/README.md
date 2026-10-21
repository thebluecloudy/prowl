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
  (the public page keeps OWNER_KEY in the browser). The Start Prowl and stop links in Gift Pro
  emails are signed with a random key the worker makes once and keeps in KV (`giftkey:v1`);
  deleting that key retires every gift link already emailed.
- `GOOGLE_MAPS_KEY` (v132) is the Google Cloud API key behind NEAR ME: Around You and Road Trip (`/near`, `/trip`,
  `/pp`, and the live hours in `/trips/<id>`). Enable Places API (New), Routes API and Geocoding API on it, restrict
  it to those three, and set it with `wrangler secret put GOOGLE_MAPS_KEY` (or the dashboard). Without it those routes
  answer 503 "not set up" and the page keeps its plain Maps links. A Road Trip build is about 13 Text Search calls
  (one a 9-mile circle) plus a route and a reverse geocode, kept an hour per origin town, destination and day.
- `PRO_CIDS` (v132, plain-text variable) is the comp list for group trips: store customer ids, comma-separated, that
  count as Pro for building and sharing a trip and posting finds, the way the organizer arranges with the owner outside
  the app. A member's own paid Pro order (by customer id) or a linked Prowl Alerts member's Pro counts too. The page
  never decides Pro.
- Trip Finds photos live in the R2 bucket `prowl-finds` (binding `PROWL_FINDS`, see `wrangler.toml`): the owner creates
  it and uncomments the binding. Photos are served only through signed hour-long links to trip members and are deleted
  7 days after the trip closes.
- `FB_INGEST_KEY` (v94) lets Prowl-the-agent post the morning Facebook sweep to `POST /fb-ingest`: at least 24
  random characters, set with `wrangler secret put FB_INGEST_KEY`, given to the sweep and nowhere else (not the
  page, not OWNER_KEY). Without it the route answers 403 to everyone. The contract (one POST per locked hunt per
  morning, sent even when nothing is new; each adds its finds to the term's last 7 days; kept 8 days after the last
  POST, hidden on the page after 2) is in the comment above `handleFetch`. `FB_FINDS` in `wrangler.toml` says who can read the finds: "owner" (default), "public" or "off".
- Facebook watches (v157, `watch.js`) need nothing new: the KV namespace `PROWL_ALERTS`, `RESEND_API_KEY` and
  `PROWL_SESSION_SECRET` (it signs the emails' Hide and unsubscribe links; without it those links answer "not
  complete"). Members' own browsers do the Facebook checks through the extension and post to `/fb-ingest` with their
  Prowl sign-in; `FB_INGEST_KEY` is the sweep's alone. The routes and KV keys are in the comment above `watchReg`.

## Rolling back

Cloudflare dashboard, then Workers & Pages, then prowl, then Deployments: pick an
earlier version and choose Rollback. Or revert the commit here and push.

Last version deployed by hand from the dashboard before this was set up:
`dd206e9a-7701-42c8-9a4e-c84f3a56dac2` (2026-10-01 11:38 UTC).
