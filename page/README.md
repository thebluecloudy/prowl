prowl.html is the Prowl page body. A push that changes it deploys it to Shopify (.github/workflows/deploy-page.yml).

## Affiliate tags

Outbound listing and search links go through `prowlAff()` in the first `<script>` of `prowl.html`: eBay gets its EPN tag (`prowlEpn`), and Depop, Etsy, Reverb and 1stDibs get their network's click URL from `window.PROWL_AFF`. Which programs are on, and their IDs, come from the admin area (below). The footer and Help disclosure list exactly the programs that are on.

### Affiliates in the admin area (worker v90 / page v6.60)

Every affiliate program is set up in the Prowl admin area, under **Affiliates**: its IDs (paste them, press **Save IDs**)
and its on/off switch (**Turn on** works only once the IDs are complete). Off means plain links and no disclosure
naming that site, on the Prowl page and in the alert emails. Changes reach the page within about 5 minutes. Nothing
here needs a code change.

| Program | Network | IDs to paste | Where its links are tagged |
|---|---|---|---|
| eBay | eBay Partner Network | Campaign ID (10 digits) | page, alert emails, listing popup |
| Depop | Rakuten Advertising | Depop advertiser ID (filled in: 53555), your Rakuten publisher ID | page |
| Etsy | Rakuten Advertising | Etsy advertiser ID (mid), your Rakuten publisher ID (same as Depop's) | page |
| Reverb | Awin | Reverb advertiser ID (awinmid), your Awin publisher ID | page |
| 1stDibs | Partnerize | camref | page |
| Amazon | Amazon Associates | Tracking ID (ends in -20) | page (Field Guide supplies) |

Every slot stays while Matthew applies (2026-10-09): off with empty IDs means plain links, and nothing changes until he
turns one on. Etsy's slot is built for Awin; if his Etsy approval comes through another network (Impact, Rakuten),
change Etsy's template and ID formats first. Amazon also needs the Field Guide to return `supplies`, and its own
footer sentence, before it is turned on (see `docs/update-2026-10-08/STATUS.md`).

How it is safe: only the IDs are editable. The link templates stay in code (`AFF_PROGRAMS` in `worker/index.js`,
`PROWL_AFF` in `page/prowl.html`), and each ID must match its format when it is saved, when the
worker reads it, and again on the page, so a pasted value can only ever fill its own slot. KV keeps `aff:on` (the
switches) and `aff:ids` (the IDs); `GET /aff` answers both. IDs are public, since they are in every affiliate link.

**Vinted invite (page v6.91).** Not an affiliate program and not in the admin area: Matt's Vinted referral link
(both people get credit) is the `VINV` constant in `page/prowl.html`, shown once under a run's first Vinted row. Set it to
`''` to hide the line.

**Depop (worker v95, page v6.67).** Matthew was approved for Depop through Rakuten Advertising on 2026-10-09 (Depop's
Rakuten advertiser ID is 53555). Depop's slot is back in the Affiliates tab, off: paste the publisher ID from your own
Rakuten links (the `id=` in any Rakuten link you make), press **Save IDs**, then **Turn on**. Only the Prowl page tags
Depop links (`https://click.linksynergy.com/deeplink?id={ranid}&mid={mid}&murl=...`); the alert emails and the extension
keep plain Depop links, since Rakuten bars its links in email without its written permission. Rakuten closed the earlier
publisher account on 2026-10-09 (worker v92 / page v6.62 removed that link and its ID), so the old ID is never filled in
for you, and `__tests__/page/depop-rakuten.test.mjs` fails if it comes back, or if a Rakuten link reaches the worker or
the extension. The program's key is `depop_rak`, never `depop`: extension 1.6.3 and pages v6.59-v6.61 turn on their own
hardcoded link with the old ID whenever `/aff` answers `on.depop`, so the worker never does. The publisher ID is the 11
characters after `id=` in a Rakuten link (Links > Get Link), not the numeric Site ID, which the admin area refuses.

**Before any program goes on:** keep proof that the advertiser approved the partnership (a dated email or dashboard
screenshot). The alert emails and the extension each need the network's or advertiser's written permission first:
Rakuten, for one, bars its links in any email without it, and needs a browser extension approved before it carries
links.

**The extension** (1.6.4) tags nothing: every marketplace link is the site's own plain link, and it has no Amazon yet:
Amazon in the extension waits until the Associates rules on browser extensions are checked.

**Adding a program:** one entry in `AFF_PROGRAMS` (its fields and formats) in `worker/index.js`, and in
`page/prowl.html` its `PROWL_AFF` template (with `{field}` slots and an `id`), its formats in `PROWL_AFF_FMT`, and a
key in `PROWL_AFF_ON`.

## Facebook strip (page v6.65, worker v94)

Facebook Marketplace finds from Prowl-the-agent's morning sweep of the locked hunts show under the Goodwill block
(`fbBlock`, `fbFetch`; worker `GET /fb-finds`). The strip shows only on devices with the owner key (`?owner=`) unless
`PROWL_FB_PUBLIC` is true here and `FB_FINDS` is "public" in `worker/wrangler.toml`. Facebook is never a live source
(`LIVE_SRC`): the worker cannot search it. Links are plain listing links, rebuilt from the listing id. The worker keeps
each hunt's last 7 days; the page hides a sweep more than 2 days old, and keeps what it showed when a refresh fails.


## CTBids (page v6.68, worker v96)

CTBids (Caring Transitions' online estate sale auctions) is marketplace 29, in BOLO next to the other estate sales and
auctions, and in "Local & auctions" on the results screen. It is a link-out only: its search API answers 403 without a
signed-in session token. It has no `?q=` search; its results page is `https://ctbids.com/view-more-items/<words>`
(`ctbUrl`, the same in `worker/index.js` for the alert emails' "Also search" links). The app decodes that path with
`decodeURI`, so characters it leaves encoded (`/ ? # & + %` and the like) become spaces, and the four words that route
also uses for CTBids' own lists (`trending-now`, `ending-soon`, `featured`, `cool-and-unique`) get a trailing space so
they stay a search. A saved marketplace set from before v6.68 gains CTBids once (`h68`); unticking it afterwards sticks.
The worker's "where to look" list (`WHERE_MKTS`) has it too; cached answers (30 days) keep their old list. The Chrome
extension does not have it yet (it needs a store release).

## Motion (page v6.69)

- **The curtain** (Matthew's Curtain Intro): when the app opens (the installed app, or `/pages/prowl-app`), PROWL forms
  out of a blur in the middle, a hairline fills as the app gets ready, then six columns lift away to show it and the word
  flies up into the header's Prowl (`.brand-wm`). Once a launch (sessionStorage `prowl.curtain`); a tap or any key skips
  it (Space, Page Down and the arrows do not scroll the app beneath), and it keeps every tap until it is gone, so a second
  tap during the lift cannot press what is underneath; never under reduced motion; it always clears within 9 seconds.
  It brings its own colours, picked the way the app picks its theme (saved theme, else the device's dark or light; New
  look or Classic; with storage blocked, the device's dark or light and the New look, as the app does), so it is the
  app's colour from its first frame: keep its `PAL` table in step with the palettes (the test reads them from the
  stylesheet; Uranium's panels take the top of its page gradient). `?curtain=1` shows it on any page (to look at it),
  `?curtain=0` never. Its style and script sit right after the first script, so it covers the app before it paints, and
  it is on `body`, outside the text-size zoom. Timing constants are at the top of its script (`MIN_MS`, `MAX_MS`, ...).
- **Prowl magic** (Hark's idea): result cards rise in the first time each listing appears (a card redrawn mid-rise carries
  on); listings new since your last look at a hunt glow (`data-fresh`, from `seenFresh`, measured against what was seen
  when the visit started), and the first of them after you start or pick a hunt gets a unicorn; starting a hunt sparkles
  at the button and the panther pounces and walks across. The glow and the unicorn wait until they can be seen (not under
  the curtain, not on a hidden panel); a card drawn while the tab was hidden or under reduced motion does not rise later.
  Opacity and transform only, apart from the hunt-chip sheen (a moving background, once per hover); nothing under reduced
  motion, and nothing touches saved data, links or timing. The seen list (`seenMark`) now keeps every listing still on
  screen, and those of a marketplace that did not answer this time, so neither glows as new on a later look; it is written
  only when what it remembers changes. Tests: `__tests__/page/motion.test.mjs`.
- **Flock holds still while it loads** (v6.69): the feed scrolls smoothly (CSS `scroll-behavior`), and positions the page
  set itself followed that CSS, so every redraw as finds came in slid the feed from where the snap had put it back to
  your card. `flJump` sets them at once; your own moves (a swipe, Fly, the arrows, Back to top) stay smooth. Tests:
  `__tests__/page/flock-scroll.test.mjs`.

## Uranium hero (page v6.70, worker v97)

Uranium mode's hero is two of the owner's drawings. The mushroom-night mark (`page/art/prowl-mushroom-night.svg`) is in
the page as a data URI, 96px. The fireflies scene (`worker/art/prowl-hero-fireflies.svg`) is served by the worker
(`worker/art.js`, a year-long immutable cache), so its 23 KB cost the Shopify page (capped at 512 KB) nothing:
`/art/fireflies.svg` is the drawing exactly, animated, for screens with a mouse; `/art/fireflies-still.svg` is its first
frame (`stillSvg`), for phones (`hover:none`), where the animation kept a mid-range main thread a third to a half busy.
`heroScene` asks for it only once Uranium is on (`HERO_ART`, `HERO_V`). With motion allowed, a wide night box (5:2, the
scene's shape) holds the mark and the scene fades in over it, so nothing moves when it arrives; under reduced motion, the
mark alone (the lazy image is never fetched); if the scene cannot load, the mark stays. A new drawing: change the file in
`worker/art/`, re-embed it in `worker/art.js` and bump `HERO_V`.

## Panther QR (page v6.77)

Tap the panther at the top of the app (or the little QR square on its corner) to show someone Prowl: the bottom sheet
opens with the QR code, bigger than in the share strip, the name to say out loud ("Prowl by Owl & Twig"), the address,
and **Send the link** (the system share sheet, else the link is copied). The panther pounces first, except under reduced
motion. The code is copied from the share strip's `#otp-qrPanel .qr-box`, so there is one QR to keep right; the share
strip and its own QR button are unchanged. Once the panther has tucked away on scroll it is `visibility:hidden`, so its
button leaves the tab order. Tests: `__tests__/page/panther-qr.test.mjs`.

## What you'd clear: eBay fees corrected (page v6.78)

The price pill on a Flock card opens "What you'd clear" (`marginCalc`, `flMargin`). From v6.39 it took a separate
payment processing fee (2.7% + $0.25), which eBay has not charged since its managed payments: the final value fee
includes it, so every answer was about 3% low. It now takes eBay's per-order fee instead ($0.30 on orders of $10 or
less, $0.40 above), and the final value fee is 13.6% of the first $7,500 and 2.35% of the rest. Promoted listing stays
at 2%. Fees as checked 2026-10-10; they live in `FEES`. The sheet still takes the listing's own price as the sale
price. Tests: `__tests__/page/flock-next.test.mjs`.

## Local links that 404'd (page v6.80, worker v105)

- **Craigslist with a ZIP.** A ZIP saved as the city (Den › Local) made `www.craigslist.org/search/area/48377`, which
  Craigslist answers with a 404. A ZIP (or ZIP+4) now searches 25 miles around it on the default region's site
  (`annarbor.craigslist.org/search/gms?postal=48377&search_distance=25`), for garage sales, free stuff and keyword
  searches alike (`clZip`, `clAt`). City names and region codes make the same links as before.
- **Estate sales.** A sale whose block left out its city and ZIP showed as in the city searched for, and its link was
  built with an empty ZIP (`/MI/novi//5100273`, a 404). The worker now shows a sale in its own city only, and links it
  by its own link, or one built from a full state, city and ZIP, or else the city's page on EstateSales.net. Lists
  are kept under `es2:`, so the ones kept before the fix are not served.

## Estate sales within 30 miles (page v6.81, worker v106)

EstateSales.net's city page lists sales up to about 100 miles out (Okemos, Homer, Marlette, Mason for Novi). The list
in Den › Local now shows sales within 30 miles by default, each with its distance, and **Show N farther** shows the
rest; a sale with no distance stays in. A new search starts within 30 miles again.

The distances come from the app's list of sales (`filteredSales`). The owner's sales check (2026-10-11) showed that
list on the page, yet every sale the extractor gave back had no distance or map position, so worker v106 finds the
list by its name wherever it sits in a data block, as the check does. The check's extract now has `fromList`, the
number of sales that came from that list: it should equal `count`. Lists are kept under `es3:`.

## Main stylesheet on the worker (page v6.92, worker v111)

At v6.91 the page body sent to Shopify was 886 bytes under its 512 KB cap. The main stylesheet (about 141 KB, no logic)
now goes as a link to the worker, which leaves 144 KB of room. Nothing changes in how the page is written:

- The repo page keeps the CSS inline in `<style id="prowl-css">` (the one block with that id; the curtain's and the
  motion styles stay inline everywhere). Tests load the page with its CSS, as before.
- After changing that CSS, run `node scripts/build-page-css.mjs`. It writes `worker/page-css.js` (the CSS without
  comments and a 12-character hash of it). `__tests__/page/page-css.test.mjs` fails until the two match.
- The worker serves it at `/css/prowl.<hash>.css` (`cssResponse` in `worker/index.js`, answered before anything else,
  like `/art/`). Its own hash is cached for a year (`immutable`); any other hash gets the same CSS with `no-store`, so a
  page that is briefly ahead of or behind the worker is still styled but nothing wrong is cached. The `X-Prowl-Css`
  header names the hash it has.
- The deploy (`scripts/deploy-page.mjs` via `scripts/page-css.mjs`) strips comments as before, swaps the block for
  `<link rel="stylesheet" id="prowl-css" href="…/css/prowl.<hash>.css">` and a few lines of script, then waits (up to 10
  minutes) until the worker answers with that hash before sending the page. A merge that changes CSS deploys the worker
  (Workers Builds) and the page from the same push, so the page never links to a stylesheet the worker doesn't have.
- The script covers two rare cases: if the link is gone (a sanitizer took it out), it adds it to the head; if the
  stylesheet fails to load, it asks once more (`?r=1`).
- If the worker is down the page loads unstyled, where before it would have loaded styled but without live results.
- `node scripts/slim-page.mjs page/prowl.html` prints what is sent and the room left.

## Pounce (page v6.93, worker v112)

Hark's quarry hunt, brought onto main. In Den > Settings > Pounce, a member picks one of their alert hunts and
describes the exact piece in their own words (with optional skip words, a size range in inches and a reference
photo). The worker judges each new listing of that hunt against it on the alert clock (Muse, with the listing's photo)
and taps the member's phone through ntfy when one fits, with Open it, Check price and Not it; without phone alerts the
match rides at the top of the next digest. Matches also show here under "Spotted for you", with Fair price? and Not
it. The page only mirrors what the worker keeps (`sub.quarries`, `gm:`); its one key of its own is
`prowl.pounceSeen`, the newest match this device has shown a note for.

A new match shows a note and nothing else. Hark's branch also made the panther pounce and walk; that was dropped,
because Prowl magic already moves the panther (Matt, 2026-10-12). Opening `?pounce=<listing>` (the phone note) goes
straight to that match, and `&fp=1` runs Fair price? on it. Tests: `__tests__/page/pounce.test.mjs`.

## Prowl's own notifications (page v6.97, worker v114)

Pounce matches arrive as notifications from Prowl itself, so no ntfy app is needed. In Den > Settings > Pounce,
**Alert this phone**:

1. asks for notification permission, on that tap only (never on load);
2. registers Prowl's service worker at the shop's `/apps/prowl/sw.js`, scope `/apps/prowl/`. The Shopify app proxy that
   already carries the store sign-in forwards it to the worker's `/proxy/sw.js`, and the worker serves `worker/sw.js`
   with its address and public key filled in;
3. subscribes with the worker's public key (`wpush.key` in the alerts status) and POSTs the subscription to
   `/push/subscribe`, which keeps it and sends a test.

The states are: Alerts on this phone ✓ (Send test, Turn off); blocked in the browser settings; on iPhone in Safari, add
Prowl to the Home Screen first. When the browser has no push, or the worker has no keys yet, the old ntfy button is
shown, as before. The service worker has no fetch handler and caches nothing, so the page works exactly as it did.
`prowl.wpushOn` remembers that this device turned alerts on. After changing `worker/sw.js`, run
`node scripts/build-sw.mjs` (a test fails until you do).
