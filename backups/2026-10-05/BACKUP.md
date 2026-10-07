# Prowl backup, 5 October 2026

A snapshot of Prowl as it runs today, with what you need to put it back if something breaks.

| File | What it is | Version |
|---|---|---|
| `prowl-page-v6.37.html` | The whole Prowl page (HTML, CSS and JavaScript) that lives in Shopify | Page v6.37 |
| `prowl-worker-v78.js` | The Cloudflare Worker (`worker/index.js`) that fetches live listings, runs Prowl Alerts, Pro, Field Guides and photo checks | Worker v78 |
| `prowl-worker-v78-admin.js`, `prowl-worker-v78-admin-page.js`, `prowl-worker-v78-metrics.js` | The admin area and its numbers (`worker/admin.js`, `worker/admin-page.js`, `worker/metrics.js`); the Worker imports them | Worker v78 |
| `wrangler.toml` | The Worker's settings: name, storage, schedule and plain (non-secret) variables | matches v78 |

Snapshot of `main` after page v6.37 and worker v78. Check a file is intact with `md5sum`:

- `prowl-page-v6.37.html`: `10b9a5876f45253a146c6586d7a0ada8`
- `prowl-worker-v78.js`: `5b7266dfdf0444aa0c1ff0f4177f1a78`
- `prowl-worker-v78-admin.js`: `bcb3265d093c941bdebf590be83ad818`
- `prowl-worker-v78-admin-page.js`: `2b1c550b124f9241ae273a193054960d`
- `prowl-worker-v78-metrics.js`: `260f474e1c1ddbaac487462dbb9b3bb2`

## What is in this version

- **Look:** "New" style (Look 2) is the default on the home page, the Den (all four tabs), the marketplace and photo drawers and Help: outlined cards, swung-vase orange bands, slab titles, pill tabs, short copy. **Classic** (the original look) is kept: Den > Settings > Style, or add `?look=1` to the address (`?look=2` goes back).
- **Colour modes:** Light (swung-vase bittersweet), Blue hour, Midnight (the original near-black dark, added in v6.37), Uranium (blacklight green). The theme button cycles through all four.
- **Live listings:** ShopGoodwill, eBay, Etsy, Chairish, Poshmark, Vinted and Grailed. 27 marketplaces in total, the rest as links (Depop became link-only in v6.35 / worker v76: its firewall blocks every Worker request; set `DEPOP_LIVE = true` in the worker to try again) (including Heritage Auctions). Facebook Marketplace city chips: New York, Los Angeles, San Francisco, Chicago, Detroit, Dallas, Houston, Phoenix, Miami, Atlanta, Seattle, plus My city and All USA.
- **Features:** hunts and the Den, Daily Prowl, Flock, Field Guide, photo check, Fair price, Prowl Alerts emails, Prowl Pro ($7/month), AI off switch for Pro, empty-search card, clear live-error messages, feedback link to the contact page.
- **Worker limits:** 2,500 fresh lookups per visitor address per day (cache hits are free). The site-wide free AI pools (Fair price, photo check, Research, Field Guide) are shared out hourly, at most a sixth of the day in any hour, and say "busy now" rather than "busy today". Pro members never count against those pools.
- **Security (worker v72 and later):** each signed store sign-in works once; scraped pages are capped at 3 MB before parsing.
- **New in page v6.34:** Photo check is a camera button inside the search bar (the "At a sale? Check a photo" card is gone; the camera hides when AI is off). On phones the Get the app card sits below your hunts.
- **New in worker v73:** Vinted cookies are reused for 10 minutes, so most Vinted searches are one fetch instead of two. The reproduction check, Fair price, Research and Field Guides now also catch confusable makers, e.g. Robinson-Ransbottom ("RRP Co. Roseville, Ohio") sold as Roseville Pottery.
- **New in worker v74:** daily emails no longer run late. The alert clock runs every 5 minutes (was 15) and checks the members whose email is due soonest first.
- **New in page v6.35 / worker v76:** Depop is a link-out, not a live source (its firewall refuses the Worker). Alerts skip it and the health check no longer checks it.
- **New in page v6.36 / worker v77:** Mercari Japan is a link-out marketplace (US buyers can buy direct through Mercari Global) and appears in the emails' "Also search" links. `/__mercarijptest` tests its search API for live results.
- **New in page v6.37:** Midnight colour mode; the New look is in the page markup so a refresh no longer flashes the Classic dark first.
- **New in worker v78: admin area** at `https://prowl.thebluecloud.workers.dev/admin`, signed in with the `ADMIN_KEY` secret. It shows health (uptime from hourly test searches, speed, errors, the alert-email clock, AI usage, top searches) and members by anonymous id only, never emails, tokens or ZIP codes. Find a member by typing their email (looked up, never stored). Support buttons: sign-in link, re-check Pro, re-check today, resend today's email, emails on/off, unpause, sign out all devices, clear "already sent" memory, delete. Diagnose runs a hunt live and shows what the AI and the member's own filters hide. **Gift Pro** gives free Pro by email (only a fingerprint of the address is stored) and can switch off anyone on the `PRO_EMAILS` list.
- **Health check:** the GitHub workflow **Scraper health** runs every day and fails (GitHub emails you) if a live marketplace returns nothing.
- **Accessibility (page v6.33 and later):** all text colours pass 4.5:1 in every theme; every button, link, tab and checkbox shows a focus ring when you use the keyboard; ticking a marketplace with the keyboard keeps focus; Uranium glows are softer.

## How to restore the page

1. Shopify admin > Online Store > Pages > **Prowl**. Switch the content editor to HTML view (the `<>` button).
2. Select everything, delete it, paste the whole of `prowl-page-v6.37.html`, and save.

Or let GitHub do it: copy the file over `page/prowl.html` in the repo and push to `main`. The **Deploy Prowl page to Shopify** workflow sends it and checks Shopify saved it.

Shopify rewrites some markup when it saves (lower-case `viewbox`, explicit closing tags, line breaks inside some boxes). The file is already written that way, so the deploy check passes.

## How to restore the Worker

1. Copy `prowl-worker-v78.js` over `worker/index.js`, and the three `prowl-worker-v78-*.js` files over `worker/admin.js`, `worker/admin-page.js` and `worker/metrics.js` (and `wrangler.toml` over `worker/wrangler.toml`), then push to `main`. Cloudflare Workers Builds deploys them together.
2. Since v78 the Worker is four files, so pasting into the Cloudflare dashboard's code editor no longer works on its own. Use the repo (step 1), or roll back a deploy in Cloudflare (Workers & Pages > **prowl** > Deployments).

The Worker keeps its secrets and storage across a code restore; nothing in these files deletes data.

### Secrets and settings the Worker needs (values are NOT in this backup)

Set in Cloudflare > Workers > prowl > Settings > Variables and Secrets. If you ever rebuild the Worker from scratch, these must be re-entered:

- **eBay:** `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EPN_CAMPAIGN_ID` (affiliate, in wrangler.toml)
- **Etsy:** `ETSY_API_KEY`, `ETSY_SHARED_SECRET`
- **Grailed:** `GRAILED_ALGOLIA_APP`, `GRAILED_ALGOLIA_KEY`, optional `GRAILED_ALGOLIA_INDEX`
- **AI:** `MUSE_API_KEY` (Meta Muse: Field Guides, photo checks, Fair price), `TYPESAFE_API_KEY` (Jev result sorting); switches `JEV_RESULTS`, `JEV_WHERE`, `JEV_LOOKS`, `JEV_PICKS`, `JEV_HUNTCHECK`, `ALERT_JEV`
- **Email (Prowl Alerts):** `RESEND_API_KEY`, `ALERT_FROM`, `ALERT_REPLY_TO`, `ALERT_ADDRESS`, `ALERT_HOUR`, `ALERT_BATCH`, `ALERTS`, `ALERT_ALLOW`, `ALERT_FREE_HUNTS`, `ALERT_FREE_HUNTS_NEW`
- **Shopify / Pro:** `SHOPIFY_SHOP`, `SHOPIFY_ORDERS_TOKEN`, `SHOPIFY_PROXY_SECRET`, `PRO_EMAILS` (complimentary Pro list)
- **Owner and debugging:** `OWNER_KEY`, `DEBUG_KEY`
- **Admin area (v78):** `ADMIN_KEY` (at least 20 characters, different from `OWNER_KEY`; without it /admin says it is not set up). Optional `MEMBER_ID_SALT` keeps member ids the same if you ever change `ADMIN_KEY`.

Storage bindings (in `wrangler.toml`): KV namespace `PROWL_ALERTS` (members, hunts, settings) and the `CAPS` Durable Object (counters, cache, search stats). Two crons: every 5 minutes for Alerts, and at 2 minutes past each hour for the admin's uptime test searches. The `CAPS` Durable Object also keeps the admin's traffic, error and activity records ("metrics"), pruned after 7–30 days.

## Other pieces that live elsewhere

- **GitHub repo** `thebluecloudy/prowl`: full history of every page and Worker version, the Chrome extension (`extension/`, v1.5.0), store listing text and the privacy policy section (`docs/`).
- **GitHub secrets:** `PROWL_DEBUG_KEY` (for the Worker probe), plus the Shopify token the page deploy uses.
- **Shopify:** the Prowl page, the Prowl Pro product and subscription, the privacy policy.
- **Chrome Web Store:** the extension listing (once approved).
