# Listing popup — build spec for Claude

Goal: tap any card → popup showing all the listing's photos, the description, and the outbound link. This is the Gem pattern Matthew pointed at: photos hotlinked from the source's own CDN — no scraping workarounds, no photo hosting.

**v1 sources: eBay, ShopGoodwill, Salvation Army.** Same popup UI for all three; only the data source differs. Depop stays experimental v2 (see below).

## How it works (the mechanism)

1. Parse the eBay legacy item ID out of the card's listing URL (`ebay.com/itm/<id>`).
2. Worker calls eBay's Browse API `getItemByLegacyId` (accepts legacy IDs directly — no ID translation needed).
3. Page renders the returned photos (hotlinked `ebayimg.com` URLs), description, and link.

## Matthew's prerequisite (his click — the outstanding one)

The Worker needs his **eBay developer app key** (client ID + secret) for the client-credentials token flow (`https://api.ebay.com/oauth/api_scope`). **Sold-API access is NOT required** — the Browse API (`getItemByLegacyId`) is standard access and covers everything in this spec. The sold-data restriction only affects sold-comps features, not this popup.

## 1. Worker: item-detail endpoint

New `GET /item?source=<ebay|sgw|salvation>&id=<id>` (or `?url=<listingUrl>`, Worker parses source + ID):

### eBay
- Calls `GET https://api.ebay.com/buy/browse/v1/item/getItemByLegacyId?legacy_item_id=<id>` with the app token. Pass the EPN affiliate header so the response includes `itemAffiliateWebUrl`.
- Returns: `{ title, price, images[], description, condition, aspects[], itemWebUrl, itemAffiliateWebUrl }`.
- **Photos:** use the Browse API item schema's image fields. If the Browse response carries only the primary image, fall back to the Trading API `GetItem` (`PictureDetails.PictureURL[]`) for the full set — verify against the real response, don't guess.
- **EPN commission:** eBay's own docs say commissioned sales must use the `itemAffiliateWebUrl` from the response. Return it and use it for the popup's eBay button (this supersedes generic EPN tagging for popup links — update `prowlAff` to prefer it when present).

### ShopGoodwill
- No detail API with photos (the search API returns one `imageURL`). Fetch the listing page HTML instead: `https://shopgoodwill.com/item/<id>` — the gallery is in the page markup.
- Extract **all** gallery image URLs (inspect the real markup; `og:image` gives one, the gallery thumbs give the full set — hotlink them, no proxying).
- Returns: `{ title, currentBid, bids, timeLeft, images[], description, itemWebUrl }`. Links go out clean (no affiliate program).

### Salvation Army
- Same pattern: fetch `https://shopthesalvationarmy.com/Listing/Details/<id>/<slug>` HTML, extract the gallery (images live on Azure Blob Storage — hotlink them).
- Returns: `{ title, currentBid, bids, timeLeft, images[], description, itemWebUrl }`. Links go out clean.

### Shared
- **Cache:** 24h per item (same cache discipline as `/verdict`). Never fetch the same item twice in a day.
- **Errors:** sold/ended/unavailable item → return a clean `gone: true`; the popup shows "This listing ended" with the cached photos if we have them.
- **Bot protection:** use a browser-like UA on page fetches. If SGW/Salvation Army 403 the Worker, report back — don't silently degrade to direct links.

## 2. Page: the popup

**Trigger:** tap on a card's body opens the popup instead of navigating straight out. (Behavior change, requested.) The card's existing controls keep their actions: star, ✕, share, price-tap all intercept as today — only the body tap opens the popup.

**Layout** (follow `prowl-design-rules.md`):
- Mobile: bottom sheet. Desktop: centered modal. Reuse the page's existing drawer/sheet pattern.
- **Photo gallery:** large main photo, swipeable left/right, thumbnail strip below. Photos are hotlinked from the source CDN (`ebayimg.com`, SGW's image host, Azure Blob) — no proxying.
- **Title, price, condition + key aspects** (size, maker, etc.) in one compact block. For auctions: current bid + bids + time-left line.
- **Description:** collapsed to ~4 lines with "Read more". Descriptions are raw seller HTML — **sanitize before injecting**: strip `<script>`, `<iframe>`, `<form>`, event handlers; allowlist basic formatting. Never `innerHTML` the raw description.
- **Fair price? button** — keep it in the popup (it exists on cards today).
- **Outbound button** — big, bottom: "View on eBay ↗" (uses `itemAffiliateWebUrl`), "View on ShopGoodwill ↗", "View on Salvation Army ↗". This is the only way out to the source from the popup.
- `role="dialog"`, Esc closes, returns focus to the card. Follows the reduced-motion rules.

**Depop (experimental v2, not v1):** no public API (no key to get), but its listing pages are server-rendered Next.js — title, description, and photo URLs (hotlinkable `media-photos.depop.com`) all arrive in the initial HTML, which is how Gem shows Depop photos on-site. Catch: Depop 403s datacenter IPs intermittently (bot protection), so Worker fetching would be flaky. Parse `og:image`/`og:description` from the HTML with graceful fallback to direct link. Don't generalize yet.

## 3. Cost control

- Popup fetches hit the Worker cache first; a fresh source call only happens on cache miss.
- Preload on card visibility is banned for v1 — fetch on tap only. (The feed's `flockWarm` already spends budget; don't add speculative item-detail calls.)

## Verify

- Tap eBay card → popup opens with all photos swipeable (count matches the eBay listing), description readable, "View on eBay" goes through the affiliate URL.
- Tap ShopGoodwill card → popup opens with all gallery photos, current bid + time-left shown, "View on ShopGoodwill" is a clean link.
- Tap Salvation Army card → same, "View on Salvation Army" clean.
- Ended listing → clean "listing ended" state, no broken popup.
- Description with malicious HTML (test with a script tag) → sanitized, nothing executes.
- Star/✕/share/price-tap on the card still do their own thing; only body tap opens the popup.
- Etsy/Poshmark/other cards → unchanged direct-link behavior.
- Same item tapped twice → second open is instant (cache), no second source call.
- Reduced motion: gallery swipe still works, no animation flourishes.
