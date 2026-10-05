# Prowl backup, 5 October 2026

A snapshot of Prowl as it runs today, with what you need to put it back if something breaks.

| File | What it is | Version |
|---|---|---|
| `prowl-page-v6.32.html` | The whole Prowl page (HTML, CSS and JavaScript) that lives in Shopify | Page v6.32 |
| `prowl-worker-v71.js` | The Cloudflare Worker that fetches live listings, runs Prowl Alerts, Pro, Field Guides and photo checks | Worker v71 |
| `wrangler.toml` | The Worker's settings: name, storage, schedule and plain (non-secret) variables | matches v71 |

Snapshot of `main` after page v6.32. Check a file is intact with `md5sum`:

- `prowl-page-v6.32.html`: `4a57cf016095cad9a81ffec447153d07`
- `prowl-worker-v71.js`: `6959e0d06697dbeb0160e08b2ee8f2ad`

## What is in this version

- **Look:** "New" style (Look 2) is the default on the home page, the Den (all four tabs), the marketplace and photo drawers and Help: outlined cards, swung-vase orange bands, slab titles, pill tabs, short copy. **Classic** (the original look) is kept: Den > Settings > Style, or add `?look=1` to the address (`?look=2` goes back).
- **Colour modes:** Light (swung-vase bittersweet), Dark (blue hour), Uranium (blacklight green).
- **Live listings:** ShopGoodwill, eBay, Etsy, Chairish, Poshmark, Depop, Vinted and Grailed. 26 marketplaces in total, the rest as links (including Heritage Auctions). Facebook Marketplace city chips: New York, Los Angeles, San Francisco, Chicago, Detroit, Dallas, Houston, Phoenix, Miami, Atlanta, Seattle, plus My city and All USA.
- **Features:** hunts and the Den, Daily Prowl, Flock, Field Guide, photo check, Fair price, Prowl Alerts emails, Prowl Pro ($7/month), AI off switch for Pro, empty-search card, clear live-error messages, feedback link to the contact page.
- **Worker limits:** 2,500 fresh lookups per visitor address per day (cache hits are free).

## How to restore the page

1. Shopify admin > Online Store > Pages > **Prowl**. Switch the content editor to HTML view (the `<>` button).
2. Select everything, delete it, paste the whole of `prowl-page-v6.32.html`, and save.

Or let GitHub do it: copy the file over `page/prowl.html` in the repo and push to `main`. The **Deploy Prowl page to Shopify** workflow sends it and checks Shopify saved it.

Shopify rewrites some markup when it saves (lower-case `viewbox`, explicit closing tags, line breaks inside some boxes). The file is already written that way, so the deploy check passes.

## How to restore the Worker

1. Copy `prowl-worker-v71.js` over `worker/index.js` (and `wrangler.toml` over `worker/wrangler.toml` if it changed), then push to `main`. Cloudflare Workers Builds deploys it.
2. Or in the Cloudflare dashboard: Workers & Pages > **prowl** > Edit code, paste the file, Deploy.

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

Storage bindings (in `wrangler.toml`): KV namespace `PROWL_ALERTS` (members, hunts, settings) and the `CAPS` Durable Object (counters, cache, search stats). A cron runs every 15 minutes to send Alerts.

## Other pieces that live elsewhere

- **GitHub repo** `thebluecloudy/prowl`: full history of every page and Worker version, the Chrome extension (`extension/`, v1.5.0), store listing text and the privacy policy section (`docs/`).
- **GitHub secrets:** `PROWL_DEBUG_KEY` (for the Worker probe), plus the Shopify token the page deploy uses.
- **Shopify:** the Prowl page, the Prowl Pro product and subscription, the privacy policy.
- **Chrome Web Store:** the extension listing (once approved).
