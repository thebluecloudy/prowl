# Future work

Ideas that were planned but parked. Pick a version number when one is built: the worker and page move on in the meantime.

## Poshmark sold prices in the listing popup and Fair price

*Parked 2026-10-08. Matthew: not needed right now.*

**What exists today.** The worker's `GET /poshsold?q=` (v58) reads real Poshmark sales from Poshmark's own search page. It returns up to 6 sales with a sold date and caches them for 30 minutes. The page uses them in two places:
- **Photo check:** the result shows "Sold on Poshmark" (`poshGet`, `poshBox` in `page/prowl.html`).
- **Research:** if the AI finds no sales, its "Sold before" list falls back to these Poshmark sales.

**The idea.**
- **Listing popup** (eBay, ShopGoodwill, Salvation Army):
  - A "Sold on Poshmark" row under Fair price, showing up to 3 sales (photo, "$45 sold", date) plus "See all sold on Poshmark".
  - The row is hidden when nothing matches.
- **Fair price:**
  - The page sends those sales with the request.
  - The worker adds them to the prompt as real sales, separate from the asking prices of other live listings.
  - The note under the verdict says "Includes N recent Poshmark sales."

**How it would work.**
- **Query:** search Poshmark for the card's hunt term, not the long listing title. Cards need a `data-h` on every result cell. Flock cards already have one; set it in `sgwCard(it,hunt)` and drop Flock's own copy.
- **Relevance filter:** Poshmark search is loose ("panther" matches panther-print leggings). Keep a sale only when its title has every hunt word of 3+ letters, split the same way as `likeWords`.
- **Sharing the fetch:** the Photo-check code sits in its own script block. Expose `window.prowlPosh = poshGet` there, and keep its per-visit cache (`POSHC`).
- **Popup:**
  - `popPaint` redraws the sheet twice (from cache, then after `/item`), so the Poshmark row is added after each paint.
  - Before adding it, check the popup is still on the same listing.
- **Fair price:**
  - `fpAsk` waits at most about 4 seconds for the sales and never blocks on them.
  - The worker's `verdict()` cleans the `sold` entries (6 at most, money-shaped prices, dates as YYYY-MM-DD, titles through `scrubListingText`).
  - It puts them into the cache key's `sig` and bumps the cache prefix (`/v6/` to `/v7/`).
  - It returns `posh: n`.
- **Tests:**
  - Worker: the prompt block, cleaning, and that the cache key changes.
  - Page: the popup row, the filter, the row surviving the second paint, Fair price sending `sold`, and a slow `/poshsold` not holding Fair price up.

**Watch out for.** Poshmark mostly sells clothing and accessories, so vintage home pieces may often find nothing. The row then stays hidden, which is fine. eBay sold data is still unavailable: eBay denied Marketplace Insights on 2026-10-06.
