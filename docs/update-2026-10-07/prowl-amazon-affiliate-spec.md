# Amazon Associates — build spec for Claude

Status: spec-only, ready to build. **Do not wire the live tag until Matthew says traffic is there** — Amazon drops affiliates who don't make 3 qualifying sales within 180 days. Ship with the placeholder and the kill switch below.

## Terms (verified 2026-10-06)

- Commission 1–10% by category: most 1–4%, handmade 5%, books/kitchen 4.5%, luxury beauty 10%.
- 24-hour cookie, extends to 90 days if the buyer adds the item to cart.
- Pays on **whatever the buyer purchases** in the window, not just the linked product.
- $10 payout threshold (direct deposit). Must make 3 qualifying sales in 180 days to stay active.

## Matthew's setup (his clicks, ~15 min)

1. Sign up at affiliate-program.amazon.com, create a tracking ID.
2. Hand Claude the tracking ID — it goes in as `AMAZON_TAG`, placeholder until then.
3. FTC disclosure: Amazon requires the standard affiliate disclosure wherever links appear (extension listing description + /prowl footer — extend the existing disclosure text).

## 1. Chrome extension — context menu item

The extension already has a right-click menu ("search it, open it on all the marketplaces in one tab group, check sold prices, get a Field Guide" per the store listing).

- Add: **"Search Amazon"** → opens `https://www.amazon.com/s?k={encodedSelection}&tag={AMAZON_TAG}` in a new tab.
- Store the tag in one config constant (e.g. `AFF.amz`), defaulting to the placeholder.
- Kill switch: `AFF.amzEnabled` (default `false`). When false, the menu item is hidden entirely — no untagged Amazon links go out, and there's nothing half-built for reviewers to trip on. Matthew flips it when the tag is live.

## 2. /prowl page — Field Guide supply/book links

Guides already render via `gdRender` with a "Hunt it" related-search row. Add a page-side helper next to `prowlAff`:

```js
var AMAZON_TAG = 'YOUR_AMAZON_TAG';   // placeholder until Matthew supplies it
var AMAZON_ON = false;                // Matthew flips this when traffic is ready
function amzSearch(keywords){
  if(!AMAZON_ON || !AMAZON_TAG || AMAZON_TAG.indexOf('YOUR_') === 0) return null;
  return 'https://www.amazon.com/s?k=' + encodeURIComponent(keywords) + '&tag=' + AMAZON_TAG;
}
```

- Use only where a guide genuinely recommends a **supply or reference book** (cleaning supplies, display stands, price guides — books pay 4.5%). Never on vintage pieces themselves; Amazon is new goods.
- Render as a normal link with the existing affiliate disclosure covering it. If `amzSearch` returns null, render no link — no untagged Amazon URLs.

## 3. Disclosure

Extend the page footer disclosure to include Amazon ("…and Amazon"), and add one line to the Chrome Web Store listing description when the tag goes live. Amazon's Operating Agreement requires the disclosure to state plainly that links earn commission.

## Deliberately out of scope

- Amazon as a searched marketplace on /prowl — new goods, weak fit for vintage price research. Not this spec.
- Tagging Amazon links anywhere else (extension toolbar search, omnibox) — menu + guides only, until data says otherwise.

## Seamlessness (house rule)

- A tagged link behaves exactly like an untagged one: same new-tab behavior, no interstitial, no badges, no "affiliate link" markers anywhere in the UI.
- The only visible trace of the whole system is the footer disclosure — never inline, never a modal, never on first click.
- If a network redirect ever fails or hangs, fall back to the clean merchant URL. Never strand the user on a broken redirect.
- The user asked for hunts and finds; the monetization is plumbing, not product.

## Verify

- `AMAZON_ON=false` → no Amazon menu item in the extension, no Amazon links in guides, zero Amazon URLs in page source.
- Flip the switch with a real tag → right-click "Search Amazon" opens a tagged search; one guide supply link renders tagged.
- One tagged click → shows in the Associates dashboard (up to 24h delay).
- Disclosure text present on page and store listing.
