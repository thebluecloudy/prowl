# Salvation Army marketplace spec (marketplace #28)

## What it is
`shopthesalvationarmy.com` — the Salvation Army's online thrift/auction store. Auction model, like ShopGoodwill.

## Platform (verified 2026-10-07 via live inspection)
- **RainWorx / AuctionWorx Enterprise** (ASP.NET MVC). NOT Shopify — no Shopify markers.
- Evidence: Terms page states "Our store is hosted on RainWorx"; page source has `AWE_Bootstrap3.css`, `awe-rt-*` hooks, `rwx_SignalRDisabled` JS global; images on Azure Blob Storage.

## Search integration
- Search URL: `GET https://shopthesalvationarmy.com/Browse?FullTextQuery=<urlencoded-term>`
  (The form declares `/Search` but the effective navigation is `/Browse?FullTextQuery=`.)
- **Results are server-rendered HTML** — no JS API needed. At navigation time the DOM already contains every listing with title, link, current bid, bid count, and time remaining. Live bid updates happen later via SignalR; ignore that, parse the initial HTML.
- Parse each listing card: title, href `/Listing/Details/<id>/<slug>`, current bid price, bid count, time remaining, image URL.
- Listing detail pages: `/Listing/Details/<id>/<slug>`.

## Prowl treatment
- Auction model → same as ShopGoodwill: price pill shows **current bid**; flock cards get the auction pill (`2d 4h · 7 bids`) bottom-left.
- **No affiliate program exists** (verified: no mention anywhere on site; nonprofit). Links pass through clean and are never tagged. This is a coverage play, not revenue.
- Cache: short (15 min) — auctions move.
- Count goes 27 → 28 automatically (runtime-generated).

## Bot considerations
- Use a browser-like User-Agent on Worker fetches.
- If the Worker IP gets blocked (403s), report back — fallback is the same browser-digest route ShopGoodwill used before its API recovered. Do not silently drop the marketplace.

## Verify
- Search "panther" returns results with bids and time-left.
- Card links resolve to live listing pages.
- Flock auction cards show the bid pill; fixed-price "Buy Now!" items show clean price pills.
- Marketplace count reads 28.
