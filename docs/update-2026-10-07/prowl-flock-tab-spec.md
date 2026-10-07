# Flock tab + Instagram snap feed — build spec for Claude

Live page v6.37. All IDs/classes below verified in the live source on 2026-10-06.

## Goal

1. Flock gets its own dock tab, alongside PROWL / GOODWILL / ALL / PHOTO / DAILY / DEN.
2. The tab is a vertical full-screen feed: flick up and the feed **stops on each card**, one card per screen, Instagram Reels style. It must never fly past a card.

## 1. Dock button

The dock currently holds six buttons (PROWL, WHATNOT, ALL 27, PHOTO, DAILY, DEN) — no room for a seventh on mobile. **Remove the PHOTO dock button** and put FLOCK in its slot (4th position):

```html
<button class="db" data-m="flock" aria-label="Flock: a look across your hunts">
  <svg viewbox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <use href="#otp-swallow"/>
  </svg>
  <span>FLOCK</span>
</button>
```

Reuse the existing `#otp-swallow` symbol (already used in `.fl-birds`).

Nothing is lost: the camera button in the search box (`#otp-cam`) and the `?photo=1` deep link both still open the photo check via `openPhoto()`. Remove the `if(m==='photo'){openPhoto();return;}` branch from the dock click handler, but keep the `openPhoto()` function itself.

## 2. Mode wiring

- In the `#otp-dock` click handler, add alongside the other mode branches:
  `if(m==='flock'){openFlock();return;}`
- `openFlock()` sets `st.mode='flock'` so the existing `.db` `.on` toggle loop highlights the tab. Do **not** add flock to the den/photo skip list in that loop.
- Mirror the `openPhoto()` screen pattern: `openFlock()` shows the feed screen; tapping PROWL or any other dock mode closes it via `closeFlock()`.
- The old photo skip in the `.db` `.on` toggle loop (`m==='photo'`) can stay or go — harmless either way once the button is gone.

## 3. Move the section out of the home flow

- `#otp-flock` currently renders inline on the home screen between `#otp-res` and `#otp-guide`. Remove it from the home flow — it lives only in the FLOCK tab now.
- `openFlock()`: unhide the section, add class `as-feed` to it; add a `flock-mode` class on `.scout-app-wrapper` that hides the home content (`#otp-sf`, `#otp-sgw`, `#otp-picks`, `#otp-quick`, `#otp-res`, `#otp-guide`).
- `closeFlock()`: reverse both.
- Start loading on open: call `flockStart()` directly when the tab opens. Do not wait for the IntersectionObserver — the section is no longer in the home scroll flow. The `flockSync()` call in the home render path can be removed.
- Fewer than 2 hunts: render one full-screen empty card — "Add two hunts and the flock takes flight." plus a button back to PROWL. (Keeps the existing ≥2-hunts rule, presented nicely instead of a hidden section.)

## 4. Snap-feed CSS (the Instagram behavior)

```css
#otp-flock.as-feed{position:fixed;inset:0;z-index:60;background:var(--bg);
  display:flex;flex-direction:column;padding:0}
#otp-flock.as-feed .flock-head{position:sticky;top:0;z-index:2;background:var(--bg)}
#otp-flock.as-feed #otp-flockRow{flex:1;overflow-y:auto;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;scroll-snap-type:y mandatory;scrollbar-width:none}
#otp-flock.as-feed #otp-flockRow::-webkit-scrollbar{display:none}
#otp-flock.as-feed .sgw-grid{display:block;padding:0}
#otp-flock.as-feed .fl-card{scroll-snap-align:start;scroll-snap-stop:always;
  min-height:100%;max-width:520px;margin:0 auto}
```

- `scroll-snap-stop: always` is the hard requirement — it forces the feed to stop at **every** card even on a hard flick. That is the "push up and it won't fly by" behavior.
- Each card is one viewport tall (`min-height:100%` of the row container). **First, give the cards a hook:** in `flockCardHtml`, add the class — `h.replace('class="sgw-cell"', 'class="sgw-cell fl-card"')` — one line, everything else untouched. (Cards are `.sgw-cell` today; there is no `.fl-card` class.)
- Card layout (Gem-clean): the photo fills the card; a **price pill floats top-right** (like Gem's `$26.94` badge) and is the price-tap target; one-line title below; a tiny `for ‹term›` hunt tag. That's the whole card face — no bids/time-left line, no source line. Corners: ✕ top-left (discard), price pill top-right, star + share bottom-right.
- **Auction exception (ShopGoodwill, eBay auction):** the price pill shows the current bid, and a second small pill sits bottom-left of the photo: `2d 4h · 7 bids`. Time-left and bid count are decision info for auctions, not clutter — they stay on the face. Fixed-price cards stay Gem-clean. All detail lives one tap away: card body → listing popup (all photos, description, aspects, Fair price?), price pill → margin sheet. Restyle the existing `sgwCard` output with feed overrides — do not rewrite `flockCardHtml` beyond the class hook (it already appends the `.fl-for` line; the feed CSS shrinks it to the tiny tag).
- Keep `.flock-head` (Flock title + `#otp-flockShuf` Shuffle) sticky at the top of the feed. Shuffle re-renders and scrolls the row back to top.
- **Desktop (≥1024px):** the feed becomes a square grid filling the viewport — 4 columns, square photo tiles with the same overlays (price pill top-right, auction pill bottom-left where applicable), one-line title + tiny `for ‹term›` below each tile. No snap scrolling on desktop; normal page scroll. Star/✕/share appear on tile hover, always visible on touch.
- **Themes:** the feed follows the site theme via the existing page tokens (`var(--bg)` etc.). Dark mode: page bg near-black `#16120f`, card text cream, `for ‹term›` muted tan, segmented control bg `#2a221c` with the active pill cream/black. Photo pills (price, auction) and the ✕/star/share circles stay white-on-dark in both themes — they sit on photos, not chrome.
- The fixed layer must sit below the app header and above `#otp-dock` — use the same offsets and z-index approach as the photo screen (`openPhoto()`).
- Extend the existing `prefers-reduced-motion` block for the Shuffle scroll-to-top.

## 5. End of feed

After the last card, render one end card: "That's the flock." plus a Shuffle button ("Fresh look"). No infinite loop.

## 5b. Don't yank the scroll

`flockRender()` replaces `#otp-flockRow`'s `innerHTML` — in feed mode that resets the user's scroll to the top every time `flockWarm()` fetches more. In feed mode, capture `row.scrollTop` before the render and restore it after (best-effort; snap will re-seat on the nearest card). Shuffle is the only action that should reset to top.

## 6. Keep unchanged

- Shuffle behavior exactly as-is (reshuffles `FLOCK.order`, re-renders, `flockWarm()` fetches).
- The "for ‹term›" line on every card.
- The Fair price? button stays out of flock cards (unchanged from current `flockCardHtml`).

## Feel (house rule)

- Everything in this tab should feel effortless: no spinners where content can stream in, no confirmations where undo exists, no labels explaining the machinery.
- Discard is the whole ceremony: card flies off, next card arrives, one quiet toast with Undo.
- Empty states sound like a person, not a system ("Nothing saved yet. Tap the star…" — never "0 items in collection").

## 7. Saved (the star)

- The per-card star already exists, but saved items are buried at the bottom of the Den. Move them into the FLOCK tab.
- In `.flock-head`, next to Shuffle, add a segmented toggle: **Feed | Saved**.
- Saved view: the same snap-feed card layout, showing starred items newest-first. Unstarring a card removes it from the view immediately.
- Saved empty state: full-screen card — "Nothing saved yet. Tap the star on any find to keep it here."
- Count badge: show the saved count on the FLOCK dock button — same `<em class="bd">` badge pattern the DAILY tab uses (`<em class="bd" id="otp-flbd" hidden></em>` inside the button), updated in the same counts pass.
- Remove the old saved list at the bottom of the Den so there is one saved list, not two.

## 8. Swipe right to discard

- In the feed, swiping a card right discards it: the card follows the finger, then flies off and the next card snaps up. The item is never shown again.
- Gesture handling: cards get `touch-action: pan-y` so horizontal swipes are intercepted by JS while vertical scrolling stays native. Track pointer events on the card; past ~35% of card width (or a fast flick) commits the discard, otherwise the card springs back.
- "Never see again" is persistent: keep a `prowl.discarded` array in localStorage of item keys, capped at 500 with oldest dropped first. **Key = the card's existing `data-u` attribute** (the listing URL — already on every `.sgw-cell`). `flockCards()`/`flockPool()` skip discarded keys on every render — today, tomorrow, after Shuffle. (ShopGoodwill relists get new URLs and may resurface; acceptable.)
- Undo: `toast()` takes HTML, so `toast('Discarded. <button type="button" id="otp-undis" class="gh">Undo</button>', 5000)` plus a delegated click handler that removes the key and re-renders. Mis-swipes happen.
- **Swipe-then-tap conflict:** the whole card is a listing link. After any swipe that moved >10px, suppress the synthetic click (capture-phase click handler on the row, `preventDefault` + `stopPropagation` when the flag is set), or a discard swipe will open the listing.
- Desktop / discoverability: a small ✕ button on each card (top-left, mirroring the star top-right) triggers the same discard path — swipe doesn't exist with a mouse.
- If a discarded item was starred, unstar it too.
- Scope: the discard list filters the flock feed and Saved. On-demand home search results are unaffected (active hunting is a different context).
- `prefers-reduced-motion`: skip the follow-finger and fly-off animations; remove the card and show the Undo toast.

## Optional (only if cheap)

- `?flock=1` deep link, mirroring `?photo=1`.

## Verify

- FLOCK tab with 0–1 hunts → friendly empty card, no console errors.
- Hard flick up through 5+ cards → stops on every single card, never skips one.
- Shuffle → new order, scroll resets to top.
- PROWL tab → home exactly as before; flock section no longer inline on home.
- Saved toggle → starred items newest-first, same snap behavior; unstarring removes immediately; badge count on the FLOCK tab matches.
- Swipe right (or ✕) → card flies off, never shown again (persistent discard list, 500 cap, keyed on the card's `data-u`); Undo toast 5s; hard flick up still stops on every remaining card.
- Background re-render (new flock data arriving) must not yank the scroll back to top — only Shuffle resets to top.
- Desktop narrow and wide, plus `prefers-reduced-motion` on.
- iPhone Safari: verify `scroll-snap-stop: always` is honored — fast flicks must still stop on every card. (Snap itself works everywhere; the always-stop is the part to confirm.)
- Keyboard: arrow/PageUp/PageDown move between cards; cards reachable by Tab.
- Screen reader: `role="feed"` on `#otp-flockRow`, each card `role="article"` with an accessible name from the title.
