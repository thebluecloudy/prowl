# Prowl worker

Cloudflare Worker behind Prowl (`prowl.thebluecloud.workers.dev`): eBay/Etsy/Muse
lookups, Jev, Prowl Alerts emails, Prowl Pro checks.

## How it deploys

Cloudflare Workers Builds watches this repo. Every push to `main` runs
`npx wrangler deploy` from this `worker/` folder and the new code goes live in
about a minute. No dashboard paste needed.

GitHub confirms it (v196). After each merge that touches `worker/`, `.github/workflows/verify-worker.yml` waits up to 8
minutes for the live `GET /version` (`{"worker":"vNNN"}`) to name the `WORKER_VERSION` in `index.js`. A red run
means Workers Builds did not deploy it: look in Cloudflare under Workers & Pages › prowl › Deployments. The workflow
can also be run by hand from the Actions tab.

- `index.js` is the worker (ES module, no dependencies). Since v78 it imports three sibling files, which
  wrangler bundles with it on deploy: `admin.js` (the /admin sign-in and API), `admin-page.js` (the admin
  page itself), `metrics.js` (speed, error and uptime records for the admin dashboard) and, since v193, `spend.js`
  (what the paid services cost, for the admin's Spending tab).
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
- `SERPAPI_KEY` (v173) is a SerpApi key (free plan, 250 searches a month): Photo check's Google Lens matches
  (`LENS_PER_DAY` a day). The photo waits in R2 under `finds/lens/` only while SerpApi fetches it. Without it Photo
  check works as before.
- `GOOGLE_VISION_KEY` (v171) is a Google Cloud API key restricted to Cloud Vision API: Photo check's Seen on the web
  (web detection on the first photo, `VISION_PER_DAY` a day). Without it Photo check works as before.
- `GOOGLE_MAPS_KEY` (v132) is the Google Cloud API key behind NEAR ME: Around You and Road Trip (`/near`, `/trip`,
  `/pp`, and the live hours in `/trips/<id>`). Enable Places API (New), Routes API and Geocoding API on it, restrict
  it to those three, and set it with `wrangler secret put GOOGLE_MAPS_KEY` (or the dashboard). Without it those routes
  answer 503 "not set up" and the page keeps its plain Maps links. A Road Trip build is about 13 Text Search calls
  (one a 9-mile circle) plus a route and a reverse geocode, kept an hour per origin town, destination and day.
  In a location (v157) uses the same key's Geocoding API for `/geo?q=` (a typed town, City, ST or ZIP, US only):
  one forward geocode per new text, kept 30 days, plus Craigslist's public area list (reference.craigslist.org/Areas,
  no key, kept 7 days) for the nearest Craigslist site. `/order` (v157, Optimize route) uses the public OSRM demo
  router (no key, fair use only) and falls back to a straight-line estimate. Nothing new to set up.
  Use my location (v159) adds `/geo?lat=..&lng=..`: one reverse geocode per ~1 km point (rounded to 2 decimals
  before it is sent or kept), kept 30 days, same daily cap as `/geo?q=`. Nothing new to set up.
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
- `SHOPIFY_CATALOG_CLIENT_ID` and `SHOPIFY_CATALOG_CLIENT_SECRET` (v210) switch on the live Shopify listings in hunts
  (`/shop-live`, `worker/shopcat.js`, Shopify's Global Catalog). Matt creates them in the **Shopify Dev Dashboard
  (dev.shopify.com) › Catalogs › create a Catalogs API key**; the key shows a Client ID and a Client secret. Set each
  with `wrangler secret put SHOPIFY_CATALOG_CLIENT_ID` and `wrangler secret put SHOPIFY_CATALOG_CLIENT_SECRET` (or the
  Cloudflare dashboard, as encrypted secrets). Never paste them into a chat, an issue, the repo or the page. Without
  both, `/shop-live` answers `{ off: true }` and the page shows no Shopify strip. The worker trades them for a token at
  `https://api.shopify.com/auth/access_token` (kept in memory under an hour) and serves Shopify its agent profile at
  `/ucp/profile.json`; the optional plain variable `SHOPIFY_CATALOG_PROFILE` points Shopify at another profile URL
  instead (for example Shopify's hosted example,
  `https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json`) if Shopify will not take
  ours. No published fee; Shopify's default limit is 5 requests a second. Results are never cached (Shopify's rule).
  v211: when `/shop-live` says `unavailable`, open the admin › Diagnose › **Shopify stores (Global Catalog)**: it shows
  Shopify's own error code and description for the last token exchange (the id and secret cut out), which auth method
  worked, the lengths of the two secrets and whether they look swapped or carry spaces, and runs one test search.

## What Prowl spends (admin Spending tab, v193)

`spend.js` counts every call to a paid service. `index.js` wraps the global `fetch` once, so the call sites stay plain
`fetch` and a new paid call is counted without anyone remembering to.

- **What is counted:**
  - Muse (`api.meta.ai`), with the input/output tokens and web searches its answer reports.
  - Jev (`api.typesafe.ai`), with TypeSafe's own token count, or about 4 characters a token of what was sent.
  - Google Places Text / Nearby Search, Place Details (hours, reviews), Place Photos, Autocomplete.
  - Google Geocoding, Routes and Cloud Vision.
  - SerpApi Lens.
- **What is not:** a Cloudflare cache hit, and a call that threw before any answer.
- **Where it is kept:** counts go to the `spend` Caps object as `w:<UTC day>|<service>` rows, kept 400 days.
  Caps' own alarm never clears `w:`.
- **Prices:** start from the list prices in `SPEND_SERVICES`. Each row cites its source and the date it was checked,
  and is empty where no per-unit price is published. The owner edits them in the admin, saved to KV `spend:cfg`
  together with the monthly bills (at most 12).
- **What the totals mean:** the tab shows Today, 7 days, This month and Last month per service. It is an estimate.
  The month columns take off Google's free monthly allowance per SKU (`free` in `SPEND_SERVICES`, from Matt's billing
  account price list); Today and 7 days are at the list price. The real figures are on each provider's billing page.
- **Adding a paid host:** add a service row in `spend.js` and teach `paidKey` its address.
  `worker/__tests__/spend.test.mjs` fails until both are done.

## Rolling back

Cloudflare dashboard, then Workers & Pages, then prowl, then Deployments: pick an
earlier version and choose Rollback. Or revert the commit here and push.

Last version deployed by hand from the dashboard before this was set up:
`dd206e9a-7701-42c8-9a4e-c84f3a56dac2` (2026-10-01 11:38 UTC).
