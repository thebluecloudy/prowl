# /prowl briefing — Wednesday 2026-10-07

For Claude. Read top to bottom, build in order. Detailed specs are separate files — this is the map.

## 0. Read first: design rules

Matthew's standing rules, outrank any spec when they conflict:

- **Seamless.** It should feel like they don't even know what's happening, while providing all this value. The machinery is never the product.
- **One tap from intent.** No "pushing buttons then pushing more buttons to go."
- No spinners where content can stream in. No confirmations where undo exists.
- Empty states sound like a person ("Nothing saved yet. Tap the star…"), never a system.
- No badges, labels, or markers explaining the machinery.
- **Money is plumbing, not product.** Affiliate links behave exactly like normal links. The only visible trace is the footer disclosure — never inline, never a modal, never on first click. If a redirect/tag fails, fall back to the clean URL.
- Free stays a real funnel: login gates Pro, alerts, and saved hunts only. Free AI price checks stay login-optional.
- Marketing: pitch what Prowl does for you, never what competitors can't do. Video = text on screen over the real page, no AI voice.

(Full one-pager: `prowl-design-rules.md`.)

## Build order

### 1. Flock tab — `prowl-flock-tab-spec.md`
The big one. No external dependencies — start here.
- New FLOCK dock button in the **4th slot, replacing PHOTO**. (The search-box camera and `?photo=1` still open photo check — nothing is lost.)
- The tab is a full-screen vertical feed: `scroll-snap-type: y mandatory` + **`scroll-snap-stop: always`** so a hard flick still stops on every card.
- **Gem-clean cards:** full-bleed photo, floating price pill top-right, one-line title, tiny `for ‹term›` tag. No bids/time-left/source on the face — detail lives one tap away (card → popup, price pill → margin sheet).
- **Feed | Saved toggle** in the sticky header next to Shuffle. Saved shows starred items newest-first with a count badge on the tab. Remove the old saved list from the bottom of the Den.
- **Swipe right to discard:** card follows the finger, flies off, key (`data-u`) goes into `prowl.discarded` (500 cap) and is filtered from all future renders. 5-second Undo toast. ✕ button top-left as the desktop equivalent. Unstars too.
- Critical implementation notes are in the spec: the `.fl-card` class hook, click-suppression after swipe, scroll preservation on background re-render, `touch-action: pan-y`.
- Fewer than 2 hunts → full-screen empty card, not a hidden section.

### 2. Flock next steps — `prowl-flock-next-steps-spec.md`
Build after the flock tab exists.
- **Tap price pill → margin sheet:** list price, fee lines from the verified eBay stack (FVF ~13.6%, processing 2.7% + $0.25, promoted 2% baseline), big "You'd clear: $X". Labeled "assuming you resell on eBay".
- **Watch for price drop** lives inside the margin sheet. UI now (local `prowl.watchlist`, shown under Watching in Saved view) — the actual alert backend waits on Matthew's KV + Resend setup. Do not fake alerts.
- **New since last visit:** divider + NEW badges via `prowl.flockSeen` (1000-key FIFO). Not snap points.
- **Share button** bottom-right of the photo: Web Share API, clipboard + toast fallback.
- **Star while logged out → Shopify passwordless login**, then the save retries. (The Gem pattern, minus the email wall.)

### 3. Listing popup — `prowl-ebay-popup-spec.md`
**eBay is BLOCKED on Matthew's app key** (he has it — get it from him, never in chat). SGW and Salvation Army need no key and can build now.
- Tap card body → bottom-sheet popup: swipeable photo gallery (hotlinked source CDNs), sanitized description with Read more, Fair price? button, big outbound button.
- eBay: Worker `/item` uses Browse API `getItemByLegacyId` (standard access — sold-API denial irrelevant). SGW/Salvation Army: Worker parses the server-rendered listing page HTML for the gallery.
- 24h item cache, fetch on tap only. Etsy/Poshmark/etc. keep direct links for v1.

### 4. Affiliate links — `prowl-affiliate-links-spec.md`
Can be built with placeholders; Matthew supplies the real tags.
- New `prowlAff(url)` router beside `prowlEpn`: eBay stays as-is; **Etsy** (~4%), **Reverb** (5% + $5/new buyer), **1stDibs** (Partnerize), **Depop** (Rakuten deeplink, mid=53555) get tagged; everything else passes through.
- **Depop: Matthew's application was declined** (price-comparison clause); exception email sent to affiliate-marketing@depop.com. Keep the placeholder until approved.
- Popup eBay links must use `itemAffiliateWebUrl` (eBay requires it for commission).
- FTC disclosure: extend the footer text to name the merchants.

### 5. Amazon — `prowl-amazon-affiliate-spec.md`
Lowest priority. **Kill-switched OFF until Matthew says traffic is there** (Amazon drops affiliates under 3 sales/180 days).
- Extension right-click "Search Amazon" menu item + Field Guide supply/book links only. NOT Amazon as a marketplace.
- Ships with placeholder tag + `AMAZON_ON=false`. No Amazon URLs go out anywhere until flipped.

### 6. Salvation Army (marketplace #28) — `prowl-salvation-army-spec.md`
Small, no dependencies — can slot in anywhere.
- Auction site on RainWorx/AuctionWorx (ASP.NET, not Shopify). Search: `/Browse?FullTextQuery=<term>`, server-rendered HTML, parse listing cards directly.
- Auction treatment like ShopGoodwill (bid pill on flock cards). **No affiliate program — links stay clean.** Count goes 27 → 28.

## Matthew's tasks (yours to ask him for — don't work around them)

1. **eBay app key** → unblocks item 3. He has it; take it on his machine, never in chat.
2. **Awin signup** → Reverb program (and Etsy, if it's still on Awin).
3. **Rakuten** → account created; Depop application declined, exception email sent — waiting. Etsy may also be on Rakuten now.
4. **Partnerize** → 1stDibs program.
5. **Cloudflare KV namespace + Resend account** → unblocks saved-hunts alerts and watch-for-price-drop alerts (pre-existing).
6. **Amazon Associates** → later, when traffic exists. Not tomorrow.

## Later roadmap (from Matthew's roadmap doc)

Organized by readiness. Anything marked ⚠️ needs his call before building.

**Fits the plan — queue next:**
- **Target price alerts** ("alert me below $X") — natural extension of the watchlist in item 2. Same backend gate (KV + Resend).
- **Extension promo banner** on the web app, desktop viewports only (`min-width: 768px`).
- **Deep linking:** extension item click → `?open_card=<data-u>` opens the web app snapped to that card's popup/sheet. Same pattern as the existing `?photo=1`.

**Needs backend first (KV + Shopify login):**
- **Web push notifications** — the doc's architecture is right (VAPID + service worker + Worker-stored subscriptions). iOS only works from a home-screen install, so the "Add to Home Screen" prompt comes before the permission prompt. Phase order stands: Resend email first, push second.
- **Extension↔web app state sync** — the content-script localStorage bridge is a hack; the real fix is the watchlist/saved data moving to KV behind his Shopify login (already the plan). Skip phase 1, build phase 2.

**⚠️ Tension with the design rules — his call:**
- **"Unicorn"/"Steal" badge** (glowing border, fire icon for below-comp deals) — loud labels cut against "no badges explaining the machinery" and "seamless." A quieter version (e.g. the price pill tinted, no icon) could keep the value without the noise.
- **"SOLD — Missed It" ghosts** (leave sold items visible 24h to create FOMO) — engineered anxiety. His rules say pitch what it does *for* you.
- **Loss-framed margins** ("$X sitting on the table") — same category. The margin sheet already shows "You'd clear: $X"; the reframe is a marketing decision, not a build decision.

**Blocked or risky — don't build as written:**
- **Velocity indicators** ("4 competing watchers" scraped from eBay) — eBay doesn't expose this via API; scraping it is ToS-risky and flaky. Park until a legitimate source exists.
- **Comp engine sold averages** — eBay denied the sold API (established 2026-10-06). The honest sold-data paths remain eBay sold-search and Terapeak link-outs. Don't spec a sold comp engine on data we can't get.
- **AI auto-listing/cross-posting** — far-future, separate spec when he wants it.

## Global verify

- Every spec's own verify list, then: hard flick through the feed stops on every card; discard never resurfaces; popup shows all photos; tagged links behave exactly like untagged ones; nothing in the UI names the machinery.
- iPhone Safari: confirm `scroll-snap-stop: always` is honored.
- `prefers-reduced-motion` throughout.
