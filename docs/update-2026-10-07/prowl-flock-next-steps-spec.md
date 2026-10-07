# Flock next steps — build spec for Claude

Companion to the flock-tab spec. Same house rules apply (`prowl-design-rules.md`): one tap from intent, no machinery labels, everything feels effortless.

Live page v6.37. Cards are `.sgw-cell` (with `.fl-card` hook per the flock-tab spec), each carrying `data-u` (listing URL), `data-t` (title), `data-p` (price), `data-s` (source). Whole card is a listing link.

## A. Tap price → margin sheet

**What:** tapping a card's price opens a bottom sheet: list price, estimated fees, what you'd clear. One tap, math pre-computed, no inputs.

**Fee stack (verified 2026-10-06):** eBay final value ~13.6%, payment processing 2.7% + $0.25, Promoted Listings General 2% baseline. Label the sheet "Assuming you resell on eBay" — v1 uses the eBay stack for every source; per-marketplace fee tables are a later step, not this one.

**Sheet contents:**
- List price (from `data-p`), source (from `data-s`)
- Fee lines: final value fee, processing, promoted baseline — each one line, plain numbers
- **You'd clear: $X** — big, bottom of the sheet
- One action button: **"Watch for price drop"** → adds the item to the watchlist (see section C), button flips to "Watching ✓", sheet closes. This is where Watch lives — not another icon on the card.

**Mechanics:**
- The price sits inside the card's listing `<a>`. Give the price element `data-act="margin"`; a delegated click handler on `#otp-flockRow` intercepts it (`preventDefault` + `stopPropagation`) and opens the sheet instead of the listing. Same suppression pattern as the swipe-tap conflict in the flock-tab spec.
- Reuse the page's existing drawer/bottom-sheet pattern (like the Den drawer), not a new modal system.
- Close: tap outside, swipe down, or ✕. No confirmation.

## B. New since last visit

**What:** the feed remembers what you've seen. On open, unseen finds get a small "NEW" badge and a divider — "New since your last visit" — above the first unseen card.

**Mechanics:**
- `prowl.flockSeen`: array of seen card keys (`data-u`), capped at 1000, FIFO. Written when the feed closes (or on card snap — whichever is cheaper; close is fine).
- On render: any card whose key isn't in the set is new. Divider element before the first new card.
- The divider and NEW badges are **not** snap points (`scroll-snap-align` unset) — only cards and the end card snap.
- First-ever visit: everything is new, so skip the divider (no "new" when it's all new).

## C. Share button

**What:** one tap shares the find.

**Mechanics:**
- Share icon overlaid on the photo, bottom-right (star is top-right, ✕ top-left per the flock-tab spec — keep the corners consistent).
- `navigator.share({title: data-t, text: price + ' via Prowl', url: data-u})`. Fallback where Web Share is unavailable: copy `data-u` to clipboard + toast "Link copied."
- The icon is inside the card's `<a>` — same `preventDefault`/`stopPropagation` interception as the price tap.

## D. Watch for price drop (UI now, alerting later)

**What:** the "Watch for price drop" button in the margin sheet (section A) adds the item to `prowl.watchlist` in localStorage: `{u, t, p, s, watchedAt}`.

**Explicitly pending:** the actual price-drop *alert* needs the same two things as saved hunts that only Matthew can set up — a KV namespace on the `prowl` Worker and a Resend account. Until then, the watchlist is a local list a future Worker cron will poll. Do not fake alerts.

**Watchlist UI:** watched items appear in the Saved view of the flock tab under a "Watching" group header (below saved, above nothing). Unwatch from the margin sheet (button flips back).

## E. Star tap while logged out → login (the Gem pattern)

Gem puts its signup wall on the save button: tap save while logged out → email signup. /prowl does the same with its own login: **tapping the star while not logged in opens the Shopify customer-account login** (passwordless), not a local-only save. After login completes, the star tap is retried and the item saves. This is the "login gates saved hunts" rule from the login brief, applied at the exact tap where it matters — no separate login screen to go find.

## Deliberately parked

- **Barcode scan at estate sales** — separate spec, separate build. Not this one.
- Per-marketplace fee tables in the margin sheet — v1 is eBay-stack-only, labeled as such.

## Verify

- Tap price → sheet opens, listing does NOT open. Math matches the fee stack within a cent.
- "Watch for price drop" → button flips, item lands in `prowl.watchlist`, appears under Watching in Saved view.
- Close and reopen feed → previously seen cards have no badge; genuinely new finds get the divider + NEW badge.
- Share → system sheet on mobile; "Link copied" toast on desktop.
- `prowl.watchlist` survives reload. No alerts fire (backend pending) — and nothing claims they will.
- Reduced motion: sheet slides without animation; no other behavior change.
