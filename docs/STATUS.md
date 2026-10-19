# Prowl status

Update this file in every PR (see `CLAUDE.md`). Last updated 2026-10-19 (v7.28 / v127).

## Live

| | Version | Page room left |
|---|---|---|
| Page | **v7.28** | 402,942 bytes under Shopify's 512 KB (slimmed; the main stylesheet and the main script are sent as links to the worker). The page-css test keeps at least 100 KB |
| Worker | **v127** | |

Recently shipped, newest first:

- **v7.28: Found on the Prowl shows only vintage** (the owner: it "is showing new parts it should only show the vintage
  stuff"). `isVintageProduct` was a block list (studio types and tags), so Printify's Scented Soy Candle and Skull Castle
  Woven Blanket (type Home Decor) showed in the Den › About strip. Now a product must be tagged **Vintage** or **Estate**
  (every real find is) and not come from vendor **Printify**; the old block lists still apply. Page only. Test:
  `__tests__/page/found-strip-vintage-v728.test.mjs` (fails on v7.27).

- **v7.27 + worker v127: Prowl usage moves to the admin** (the owner, on Den › Stats' "Prowl usage": "shouldn't this be on
  admin only?"). The admin's Searches tab has a new **Visitors** card: people searching and searches per UTC day for 14
  days and where the page's visitors came from for 7 days (`GET /admin/api/usage`, admin sign-in; read when the tab opens,
  at most every 5 minutes, not on the overview's refresh). `GET /owner-stats` is gone; the Den shows owner-key devices only
  a link to `/admin#searches`. Where visitors came from needs the worker secrets **CF_API_TOKEN** (Account Analytics: Read),
  **CF_ACCOUNT_ID** and **CF_SITE_TAG**; the owner added them on 2026-10-19. Tests: `worker/__tests__/admin.test.mjs`
  (usage), `worker/__tests__/referrers.test.mjs` (was owner-stats), `__tests__/page/den-stats-v722.test.mjs`.
- **v7.26 + worker v126: from Jellycat's shop** (the owner sent us.jellycat.com product screenshots "for inspiration" and
  picked four ideas). Checked in Chromium at 390 px, Light and Blue hour, with stubbed results (beside main's).
  - **Calm result cards:** a result card's title is in normal case and centred, at most 2 lines (was UPPERCASE, 3
    lines), with the price under it in ink (was the accent colour). The border is a thin line, with no offset shadow
    in the New look. Only the results grids change: Flock and the Likes grid keep their own cards, and the "new" glow stays.
  - **Outlined tags:** New, Possible reproduction and "% off" are outlined boxes now, like Jellycat's "Best Seller",
    and Got away is outlined too. **Best pick:** a result that is one of its hunt's Best picks gets an outlined
    "Best pick" tag on the photo (`.is-pick`, `pickMark`, on the same MutationObserver as Got away; only for this
    visit). It stays off Flock and Likes cards.
  - **Seller stars** under the price, on cards and in the popup (`slrHtml`). eBay shows one star and the seller's
    positive feedback, "★ 99.8% (12k)" (`seller { pct, n }` from eBay's feedbackPercentage and feedbackScore, in search
    results and `/item`). Etsy's `/item` shows five stars filled to the shop's review average, with the review count
    (`seller { stars, n }`). Numbers only: the worker never sends the seller's name. `cleanItems` keeps them through
    `slrClean`.
  - **Popup sections:** under + / − headings like Jellycat's PRODUCT DETAILS. **Item details** (specifics and
    description) starts open. **Price check** (Fair price? and What it sold for on eBay) starts closed unless a verdict
    is already in hand. The title, price, stars and Search this on Prowl are centred, and View on eBay stays pinned at the foot. A repaint
    (the details arriving) keeps the sections as the visitor left them.
  - No new localStorage keys. No change to page room (CSS and JS are on the worker).
  - Tests: `__tests__/page/jellycat-v726.test.mjs`, `worker/__tests__/seller-stars.test.mjs`, plus an Etsy case in
    `item-etsy.test.mjs`. `popup-v699` and `flock-bar` were updated for the new markup.
  - Seen in passing: `cleanItems` also drops the worker's `was`/`off`/`listed`/`relisted`. So the sale tag and the
    listing age only show in the popup (from `/item`), never on a results card.
  - Prowl points (a rewards idea from Jellycat Purrks) was planned, then **cancelled by the owner on 2026-10-19**.
    Don't build it unless the owner asks again.
- **v7.25: Blue hour in the Classic look** (the owner: "The blue hour is missing now. Only three themes. But there are
  4 modes. I'm in classic mode"). Classic's dark (labelled Blue hour) and Midnight were the same near-black `#070706`
  since v6.37; only the New look had Blue hour's navy. Classic Blue hour now has the same navy palette (selector
  `[data-theme=dark]:not([data-dark=midnight]) .scout-app-wrapper:not(.k2)`) with Classic's amber accents. Settings and
  How Prowl works now name all four modes (they said "all three"). Checked in Chromium, both looks, all four modes.
  Test: `__tests__/page/blue-hour-classic-v725.test.mjs`.
- **v7.24: a firefly field in the dark themes** (the owner, on GhostNode's starfield: "it has a glow to it and it moves
  with the cursor, I wanted this with fireflies instead"). In Dark, Midnight and Uranium, 12 to 36 fireflies (by screen
  size) drift over the page, each blinking on its own beat; nearer ones are bigger and move more with the mouse, a soft
  glow follows it, and fireflies near it drift in and brighten. Lights on body (`.pm-fly`, like the hunt swarm), z-index
  1 so under the bar, dock and drawers, pointer-events none, `mix-blend-mode:screen`. Transform and opacity only, paused
  while the tab is hidden; never in Light or under reduced motion. New key `prowl.fireflies` = `'0'` turns it off (no
  switch in Settings yet). Touch does not move it. Our own code, not GhostNode's. Checked in Chromium (Uranium 1280 px,
  Dark 390 px). It lives in the page's second script (not served by the worker), about 3.5 KB of the page body.
  Test: `__tests__/page/fireflies-field-v724.test.mjs`.
- **v7.23: from the eBay teardown, in the panther's words** (Matt, 2026-10-18: "keep the panther related terms",
  "keep Den", "keep locked on", "keep it crash free").
  - **On the lookout:** Hunt with an empty box no longer silently re-runs the ticked hunts. It opens "What are we
    hunting?" (`#otp-bolo`): your hunts, locked-on first, then **On the lookout**, BOLO's old auto-filled starter
    terms (`OLD_DEF`) less the ones already yours, 8 each. A chip runs that one hunt (`boloRun`); typing puts them
    away. The hunt sparkle only plays when there is a term. The BOLO marketplace tab is unchanged.
  - **Related hunts on an empty search:** under "Email me when it shows up", "Or try": the hunt with a word fewer,
    then your hunts and On the lookout terms that share a word (`relTerms`, at most 5). Any `[data-bolo]` chip in the
    app runs its hunt.
  - **Got away:** when a popup finds a listing ended, its URL goes in `prowl.gotAway` (new key, newest 300) and every
    card of it, anywhere, gets a "Got away" tag and a grey photo (`.is-gone`, a MutationObserver on the app). It still
    opens, to Watch for the next one. Not `goneGet`: that name was already the un-liked list (v6.48).
  - **Locked on / Hiding:** the Den's lock reads "Locked on" or "Hiding" (aria-pressed), with a 🔔 instead of ◉ when
    the member's alerts watch that hunt (signed in, emails on, within the plan's count: `denBell`). Toasts: "Locked on
    X." / "X is hiding in your Den."
  - **Prowl's words:** a glossary at the end of How Prowl works (Prowl, Hunt, Den, Locked on, Hiding, Daily, Flock,
    On the lookout, Best picks, Pounce, Quarry, Got away, Paw prints).
  - Checked in Chromium at 390 px. Already there, so not rebuilt: Keep in the results header, How Prowl works on a
    first visit, the Daily header, "N new" on Den hunts. "Prowling" stays (Matt: panther words).
  - **Deploy fix (same version):** the first deploy sent v7.23 but failed its md5 check, because Shopify saves a
    `<dd>` that follows `</dt>` on its own line. The glossary is now written that way, and a test fails if body
    markup has `</dt><dd>` again. Markup built inside the scripts is not affected.
  Test: `__tests__/page/lookout-v723.test.mjs`; `motion.test.mjs` (a hunt needs a term to sparkle).
- **v7.22 + worker v125: Den › STATS holds every analytic and graph** (Matt: "I'd like this and any other analytics and
  graphs in the menu area", and "can it show me how someone came to the site?"). New tab between ABOUT and SETTINGS:
  "Your hunting" (this device: searches per day for 14 days from `prowl.runs`, finds saved per week for 8 weeks from
  `prowl.finds`), then Your marketplaces (moved out of Settings). With the owner key (`prowl.owner`) it also shows
  "Prowl usage" from the new `GET /owner-stats` (owner only, 403 otherwise): people searching per day (new stat kind
  `u`, ticked once per search on `/ebay`, distinct daily-salted IP hashes, so it starts at 0 on v125), searches, the
  week's top terms, and **where visitors came from** (Cloudflare Web Analytics referrers via the GraphQL Analytics API,
  `cfReferrers`). Referrers need three worker secrets: **CF_API_TOKEN** (Account Analytics: Read), **CF_ACCOUNT_ID**,
  **CF_SITE_TAG**; without them the panel says "Not connected yet". No new localStorage keys. Tests:
  `__tests__/page/den-stats-v722.test.mjs`, `worker/__tests__/owner-stats.test.mjs`.

- **v7.21 + worker v124: the page's main script is served by the worker** (Matt: "why is there a limit??"). The
  Shopify page body went from 100,030 bytes under the 512 KB cap to 408,229, the way v6.92 moved the stylesheet. The
  repo page keeps the script inline in `<script id="prowl-js">`; **after any change to it run
  `node scripts/build-page-css.mjs`** (it now writes `worker/page-js.js` too, and a test fails until you do; after
  merging main, rebuild). The deploy sends `<script src="…/js/prowl.<hash>.js">` in its place (blocking, so it runs
  where it did) and waits for the worker to serve that hash. If it does not load, the page asks once more, then shows
  "Prowl could not load. Tap to try again". **If the worker is down, Prowl does not run** (before, it ran without live
  results); the browser keeps the script a year. Checked in Chromium: runs, a missed first load retries and runs, a down
  worker shows the note over the styled page. See `page/README.md`, Main script on the worker. Tests:
  `__tests__/page/page-js.test.mjs`; `page-css.test.mjs` and `slim.test.mjs` updated.
- **v7.20 + worker v123: eBay listing age, and phone alerts that say why they failed** (Matt, 2026-10-18).
  - **Listing age** ("is there a way to show ebay aging? how many times it has been listed"): eBay search results and
    `/item` carry `listed` (eBay's itemOriginDate, the first listing, else itemCreationDate) and `relisted` (the
    creation date when it is a day or more later); `ebayAge`, future dates ignored. The popup's detail line reads
    "Listed 12 days ago", or "Listed Mar 2 (7 months ago), relisted Oct 8" (`popAge`, calendar days, UTC). Search
    items keep them in `SVI` (ls/rl) for a popup whose `/item` lacks them. **eBay gives no relist count.**
  - **Phone alerts** (Matt: "Prowl could not reach this phone", it used to work): Send test now goes the way Alert
    this phone does (re-registers this phone, then the worker tests it), so a lost or renewed address is mended.
    `/push/subscribe` and `/push/test` answer `codes` (the push service's status per phone that did not take it); a
    refused key (401/403) or expired address (404/410) gets one fresh subscription; a failure says why (`wpWhy`).
    Not found from here: why it stopped. Phones are stored under a key made with MEMBER_ID_SALT, else ADMIN_KEY, so
    **changing ADMIN_KEY without MEMBER_ID_SALT set disconnects every phone** (re-registering mends it).
  - Pounce's intro says what a quarry is ("the piece you stalk, the way a panther stalks its prey").
  - **Room: 100,030 bytes, 30 over the 100 KB guard** (`page-css.test.mjs`). The next page change must trim first.
  Tests: `__tests__/page/ebay-age-v720.test.mjs`, `__tests__/page/push-button.test.mjs`, `worker/__tests__/ebay-age.test.mjs`,
  `worker/__tests__/push.test.mjs`.
- **v7.19 + worker v122: Pounce with no form, a price range, and two ideas from the UX spec** (Matt, 2026-10-18).
  - **One-tap Pounce** (Matt: "why do I need to fill out the form for Pounce, why can't it just find the items?"):
    each hunt in Den › Settings › Pounce has **🐾 Pounce** (and Describe it). One tap saves a quarry with no
    description, `any: 1`; the worker judges new listings as "any genuine example of what the hunt names" (not a
    thing that only shares a word, a reproduction or a mixed lot). The row reads "Any Padilla it finds"; Edit narrows
    it. The description is optional now (the "Describe the piece in a few words first" check is gone); an empty one
    saves as any. Stop stalking still removes it.
  - **Price range on a quarry** (Matt: "if we are doing max min inches we should have max price/min price too"): Min
    price $ / Max price $ (`lo`, `hi`, whole dollars, 0 = any). The worker's free pre-filter drops a listing whose
    shown price is outside it ("under $40" / "over $300"); a listing with no price goes to the judge.
  - **An ended listing offers to watch for the next one** (the spec's "it just slipped away"): the popup's grey "This
    listing ended." is now "This one got away. Prowl can watch for the next one." with **Watch for the next one**,
    which makes the cleaned title (`popTerm`, as Search this on Prowl) a favorite hunt through `sgwAdd` (a full Den
    says so). On an ended listing View on <site> is no longer pinned. Max price "10% above" from the spec is left out.
  - **A Pounce note opens the find** (the spec's "Alert Match" screen): `?pounce=<url>` still opens Den › Settings at
    the match, and now opens that find's listing popup over it with "🐾 Pounce match for <hunt>", Pounce's reason and
    Not it (`pncPop`, `pncPopNot`). &fp=1 runs Fair price in the popup.
  Tests: `__tests__/page/pounce-popup-v719.test.mjs`, `worker/__tests__/pounce.test.mjs` (any + price range).
  No localStorage keys changed. Free is still 1 quarry, Pro 5.
- **v7.18: a Best picks card opens the listing popup** (Matt: "fix the best picks popup it should have same
  behaviour"; built as v7.17, renumbered when v7.17 merged first). `.pk-card` now carries data-u/t/p/s, and the result-card tap handler opens it with `popOpen` like any
  other card: photos, Fair price?, What it sold for, Share, View on. Picks the popup cannot show (Craigslist,
  Poshmark…) still open in their own tab. Test: `__tests__/page/picks-popup-v718.test.mjs`.
- **v7.17: Undo on a favorite hunt chip's ×** (Matt, 2026-10-17, the gap left after v7.12 made that × a 44 px tap;
  built as v7.13, renumbered when v7.13 to v7.16 merged first). All three things the × does now say so and offer
  Undo for 5 seconds (`CHIP_UNDO`, `chipUndo`, `#otp-unchip`): a locked Den hunt goes back to the Den ("moved back to
  your Den", Undo locks it again if the Den still has it in the same place); the first-visit sample chips are cleared
  ("Sample hunts cleared", Undo brings them back, still not saved); a favorite of your own is removed ("removed from
  your favorites", Undo puts it back in its place in `owlTwigSgwTerms`). Test: `__tests__/page/chip-undo-v717.test.mjs`.
  No localStorage keys changed.
- **v7.16: the launch film, redrawn as the real app** (Matt, 2026-10-17/18: "use my panther", then "my app doesn't
  look like that"). The help's film card (`#otp-film`) plays the new cut: Matt's own panther artwork
  (`video/launch-film/assets/art/prowl-panther.webp`) and an app window drawn from the real page (dotted cream, brown
  outlines, Find the prey, the orange Hunt button, result cards, the dock, the listing popup with the real repair and
  damage flag). The panther glides as a ceramic figurine instead of walking (Matt: "the panther walking looks
  weird"). Only the card's `data-src` changed, to the original upload in Shopify Files
  (`cdn.shopify.com/videos/c/o/v/767c569b...mp4`, Video `46547817005310`, uploaded through the Admin API). Matt takes
  the older uploads down (including Video `46547634979070`, the walking cut). The film says "28 marketplaces" and the page counts 29; Matt: "doesn't matter", leave both.

- **v7.15 + worker v121: share a photo into Prowl on Android** (Matt, 2026-10-17: "Android same way" as the Chrome
  extension's image menu). The installed app shows up in Android's share sheet for images; the photo opens straight
  in Photo check. How: the theme asset `prowl-manifest.json` has a `share_target` (POST multipart, field `photo`, action
  `/pages/prowl-app?share-target=1`); the app page registers `/apps/prowl/sw.js` with scope `/pages/prowl-app` (the
  worker now sends `Service-Worker-Allowed: /pages/prowl-app`; skipped on iPhone, which has no web share target);
  `worker/sw.js` answers only that POST, keeps the photo in Cache Storage (`prowl-share`) and redirects to `?shared=1`,
  where the page runs it through `window.prowlPhotoFile`. The photo never leaves the phone until Photo check sends it
  as before. The app must have been opened once after this update before it can receive a share; Android adds Prowl
  to the share sheet after it refreshes the installed app's manifest (can take up to a day, or reinstall).
  Tests: `__tests__/page/share-photo-v715.test.mjs`, `worker/__tests__/share-target.test.mjs`.

- **v7.14: the launch film in How Prowl works** (Matt, 2026-10-17: "add the horizontal video here, we need a help
  section"). The 20-second film (`video/launch-film/`, HyperFrames) sits at the top of How Prowl works as a play card
  (`#otp-film`; the vertical 1080x1920 cut is generated into `video/launch-film-vertical/`); nothing loads until it is tapped, then a `<video>` plays it from Shopify's CDN (Content › Files) and it
  pauses when the help closes. The film's address is the card's `data-src`; to swap the film, upload the new MP4 to
  Shopify Files and change that one URL. Note the film says "28 marketplaces"; the page counts 29.
  Test: `__tests__/page/help-film-v714.test.mjs`.
- **v7.13: the dock's numbers sit beside the icons** (Matt: the Flock count "is blocking the cool bird icon"). The
  badge (`.db .bd`, Flock and Daily) moved from 50% + 6px, on the icon, to 50% + 14px and 6px from the top, past
  the 22px icon's edge. Checked in Chromium at 412 px and 1280 px, Uranium. Test: `__tests__/page/dock-badge-v713.test.mjs`.
- **v7.12: three fixes from the UI/UX brief check** (Matt, 2026-10-17, items 1 to 3 of the audit).
  - **View on <site> stays on screen** in the listing popup: it sits in `.pp-dock`, sticky at the foot of the
    sheet's scrolling body, so it shows over the photos and details and settles above Share and Close at the end.
    Checked in Chromium at 390 px and 1280 px.
  - **Undo** on "Hunt removed." (Den) and "Removed from saved finds." (any star), 5 seconds. The hunt goes back in
    its place with its tick and lock (`HUNT_UNDO`, `unmap`); a hunt typed in again meanwhile is not doubled. The
    find goes back in its place with its first saved time (`FIND_UNDO`). One toast listener (`#otp-unhunt`,
    `#otp-unfind`); Flock's discard Undo is unchanged.
  - **44 px tap areas** for the favorite hunt chip's ×, the Likes chips' ×, a result card's star, heart and Fair
    price, Flock's Feed/Saved switch and the toast's Undo: an invisible `::after` 44 px across, so nothing looks
    different. The chip's × reaches a few pixels into the chip's own label.
  Test: `__tests__/page/undo-tap-v712.test.mjs`. No localStorage keys changed.
- **v7.11: How Prowl works starts at step 1** (Matt, 2026-10-17: a new visitor's help jumped to step 6). `openM`
  focused Got it, which sits under step 6, so the browser scrolled the help to its end. Now it focuses with
  `preventScroll` and sets the dialog's `scrollTop` to 0 (older Safari ignores `preventScroll`). Test:
  `__tests__/page/help-top-v711.test.mjs` (fails on v7.10).
- **Worker v120: Prowl admin as a phone app** (Matt, 2026-10-17). `/admin` now installs to the home screen: new
  `worker/admin-app.js` serves `/admin/app.webmanifest` (standalone, opens on `#members`), owl icons (180/192/512,
  512 maskable) and `/admin/sw.js` (pass-through, offline note only, caches nothing). Both admin pages link them; CSP
  adds `manifest-src` / `worker-src 'self'`. Install: Android Chrome menu > Install app; iPhone Safari Share > Add to
  Home Screen. Sign-in is still the 12-hour ADMIN_KEY session. Test `worker/__tests__/admin-app.test.mjs`.
- **v7.10: Back keeps your place** (Matt, 2026-10-17: in Daily, a card's popup closed with Android's Back and the
  screen jumped to the top, while its X left it where it was). Back steps onto the history entry Prowl pushed when the
  first layer opened (v6.55), and the browser restored the scroll it had saved with that entry: the top of Daily.
  While Prowl's own entries are in use `history.scrollRestoration` is `manual`; once every layer is closed it is
  `auto` again (`ovScroll`). Reproduced in Chromium on v7.09 (2246 px → 0) and fixed (stays at 2246). Test:
  `__tests__/page/back-button.test.mjs`.
  Also: **a shared find links to Prowl** (Matt: "we say found with prowl but no link"). The sign-off reads "Found with
  Prowl, a vintage search tool from Owl & Twig Vintage: owlandtwigvintage.com/prowl" (`SHARE_HOME`). That address is a
  **Shopify URL redirect Matt adds** (Online Store › Navigation › URL redirects: `/prowl` → `/pages/prowl`); it must
  exist before this merges. Not bit.ly: a shortener reads as spam, and its free plan allows a few links a month.
  Also: **Get the app comes first in How Prowl works** (Matt: "When people first come to it I want them to get to the
  app version but they don't see it until the end"). How Prowl works opens by itself on a first visit; it now starts
  with the Get the Prowl app card (`.otp-getapp[data-mode=help]`: Get the app and Open it now, or Install on the app
  page; hidden in the installed app), and its old step 5 is gone (six steps now). The home page's own app card is often
  hidden for new visitors, since one promo shows at a time and they get the alerts one. A tap on the card closes the
  help. The help's Near me and Daily lines now say what v7.09 made them do. Test: `__tests__/page/help-app-v710.test.mjs`.
  Also, **worker v119 + the listing popup** (Matt, on an Etsy astronaut figurine at 20% off that showed full price and
  said "One arm has a repair."):
  - **Sales:** eBay's `marketingPrice` rides along as `was`/`off` on search results and `/item` (`ebaySale`; not for
    auctions, only when the old price is higher). The popup and result cards show "$358.40 ~~$448.00~~ 20% off";
    Pounce keeps it with a match ("on sale, was $X" on the Den card and in the phone note). **Etsy sales cannot be
    seen:** Etsy's Open API gives the list price only, so an Etsy listing on sale still shows its full price.
  - **Repair and damage flags:** a sentence in the title, condition or description that mentions a repair
    (repaired, restored, glued, touch-up, repainted) or damage (chip, crack, hairline, crazing, broken, missing, as is)
    shows above the fold as "⚠ Mentions a repair" with the seller's words (`popFlags`); a sentence with no/not/without
    ("No chips, cracks or repairs") is not a flag. Fair price is told the flag and the sale first (its details are cut
    at 600 characters).
  - **What it sold for on eBay ↗** in the popup: eBay's sold listings for the cleaned title, in a new tab (`popSold`).
  - The star reads its card if Prowl's 400-listing memory (`SVI`) has dropped the listing, and says so when a save
    cannot be made, instead of doing nothing. Matt's "In flock the star doesn't work" was **not reproduced** (it saved
    in jsdom and in Chromium with a real tap); this only closes a silent failure.
  Tests: `__tests__/page/popup-flags-v710.test.mjs`, `worker/__tests__/ebay-sale.test.mjs`.
- **v7.09: Daily announces itself (Matt, 2026-10-17: "it reads as I tapped DAILY and nothing changed").** Daily is
  its own screen now: the date, **Your daily prowl**, "N hunts · X new since yesterday" and the hunt names; then
  **What's new** at the top, grouped per hunt (up to 6 cards each); then the email card and one block per hunt with
  its live listings ("3 new · 24 live now"). **Live only:** no marketplace rows and no Open all in Daily (Matt: "no one
  should open 500 tabs"); Run the full hunt still opens one hunt's whole screen. New key `prowl.dailySeen`
  (`{d, cur, cs, pd, prev, ps}`): what Daily saw each day as short hashes of the listing links (at most 200 a hunt)
  plus which marketplaces answered; on a new day the last day's list is what Daily compares with, and a marketplace
  that did not answer that day is not counted as new. The first Daily on a device says it starts keeping track.
  The label says "since yesterday", or since the weekday or date of the last Daily. Test:
  `__tests__/page/daily-screen-v709.test.mjs`.
  Also: **LOCAL and Near me open the Maps links** (Matt: "local is not opening local areas, should be opening the
  google links"). Both always open Den › Local at Stores near you (Google Maps, or Apple Maps if picked), with or
  without a hunt typed; they no longer run Facebook, Craigslist, OfferUp, EstateSales and CTBids, which stay on every
  search's rows. Tests: `__tests__/page/near-me.test.mjs`, `__tests__/page/vinted-invite.test.mjs`.
  Also: **the shop's menu no longer draws over Flock** (Matt's screenshot, on a computer: "Shop · Help and info · The
  drop list" over the cards). Two causes. v7.04 gave `main#otp-main` a `view-transition-name` all the time, which makes
  main its own layer, so Flock (fixed inside main, z-index 39) fell under Prowl's top bar and the store header; it is
  now named only while the morph runs (`html.otp-vt`). And the store theme pins its header above any z-index Flock
  has, so Flock now starts under whatever is pinned at the top of the screen that is not Flock (`flClear`, by what is
  drawn there, not the theme's class names; checked again after the morph and on resize). Tried in Chromium against a
  mock sticky header. Test: `__tests__/page/flock-store-header-v709.test.mjs`.
  Also: **new listings are featured on the home page, and glow** (Matt: "it says 1 new, but it isn't obvious", then
  "make them glow"). **New since your last look** (`#otp-homeNew`) sits at the top of the home panel with the listings
  behind the other hunts' "N new" badges: up to 3 a hunt and 8 in all, each tagged New and "for <hunt>", and a button per
  hunt that opens it. They are not marked seen there; opening the hunt does that, as before. Inside a hunt, listings new
  since the last look come first in each marketplace (`frontNew`). Those cards and the strip's glow: a steady ring and a
  breathing light inside the edge (opacity only; steady under reduced motion). The strip shows once the other hunts'
  listings are in hand (Flock or Daily fetch them), as the badges always did. Test: `__tests__/page/home-new-v709.test.mjs`.
  Also: CI's time limit is 10 minutes (was 5): the suite takes about 4.5 and runs were being cancelled mid-test.
- **v7.08 + worker v118: Keep it simple, and shelf scan (Matt picked PIE items 18 and 20, 2026-10-16).**
  - **Keep it simple / Show everything** (Den › Settings, new key `prowl.detail`, `all` = everything). Simple is the
    default: in a search the long marketplace list, the Open all bar, the pop-up warnings and the sign-in note fold
    behind "Show all N marketplaces" (`#otp-dtMore`, adds `.dt-open` to that run); the cross-post line hides.
    Best picks and live finds stay. Wrapper class `dt-simple`.
  - **Shelf scan:** the photo screen has One piece / A whole shelf. Shelf sends `/appraise` mode `shelf`; worker
    v118 asks for at most 3 pieces worth a closer look (`shelfPrompt`), each with where it sits, a fair range and a
    pay-up-to price (`shelfParse`), or "Nothing stands out". Each card has Search this on Prowl. Uses one photo check.
    Not tried against the real model yet.
  Tests: `__tests__/page/detail-shelf-v708.test.mjs`, `worker/__tests__/shelf.test.mjs`.
- **v7.07:** Best picks also show for the hunt picked in Your favorite hunts (Matt: they only came with the search
  box). `huntBox(t)` at the top of `sgwBody`; `huntPaint` fills every `.pk[data-t]` box for that term.
- **v7.06 + worker v117: Best picks, "hunt like Hark" (Hark's spec and code, Matt 2026-10-16).** One call,
  `GET /hunt?q=` (optional `&cl=` Craigslist city, letters only, default detroit), checks every `LIVE_CALLS`
  marketplace plus Craigslist in parallel and answers `{term, ms, median, picks, rows, dupes}`. The matching lives in
  `worker/hunt.js` (pure, tested): every query word or a synonym must be in the title (pottery/porcelain count as
  ceramic, plurals fold), noise phrases per word (Pink Panther, Marvel, Cartier…), cross-posts = 80% same title words
  on two sites with prices within 6% (the dearer one gets `dupeOf`), picks = top 3 by below-median price, quiet live
  auction, lot/pair, photo. Every site keeps a row with a note; Facebook and eBay Sold are listed as login-only.
  A site that is cooling down (or Vinted out of turn) reports a row instead of being fetched. Cached 15 min
  (PCACHE), 150 uncached hunts a visitor a day (`hu:`). Craigslist's static list is untested from a Worker address:
  its row shows what it answered. Page: a Best picks strip at the top of a single search (`#otp-hpicks`; the id
  `otp-picks` was already the shop strip), paw prints while it waits, eBay links tagged `prowl-picks`, chips per
  site; a failed hunt leaves the box empty and the regular results stand. Not yet: Pro alerts from `/hunt`, more
  sources (LiveAuctioneers, Ruby Lane, Mercari US), "close matches" when the gate keeps nothing.
  Tests: `worker/__tests__/hunt.test.mjs`, `__tests__/page/hunt-picks-v706.test.mjs`.
- **v7.05: bigger type and four quick wins from the Flippr teardown (Matt, 2026-10-16).** Ranked with a PIE matrix
  (`claude/prowl-direction-and-roadmap-2026-10-16.md` in the project).
  - **Type floor:** every font size in the main stylesheet moved up one step: under 12px → 12.5, 12–12.5 → 13,
    13–13.5 → 14, 14–14.5 → 15, 15–15.5 → 16 (306 rules). Nothing below 12.5px is left. Text size Standard/Large/
    Extra large and `prowl.textSize` are unchanged. The Den tabs got 4px gaps and no letter-spacing so SETTINGS fits.
  - **Paw prints** (`.paws`, three 🐾 fading in turn) while a live source is loading ("Looking on eBay…") and while
    a photo is being checked. Reduced motion: they stay still.
  - **Photo tips** on the Photo check screen: One piece · Good light · Show the mark (`.apr-tips`). Each `<li>` sits on its
    own line: Shopify rewrites inline list items that way, and the first deploy's md5 check failed on it.
  - **Empty Den:** "No hunts saved yet" with two examples and an "Add my first hunt" button that puts the cursor in
    the Add box (`.den-empty`, `#otp-denStart`).
  - "Free checks left today" already existed (`#otp-aprLeft`), so it was not rebuilt.
  Test: `__tests__/page/type-quickwins-v705.test.mjs`. No localStorage keys, IDs or marketplace changes.
- **v7.04: the dock buttons morph the page (Matt, 2026-10-15).** Pressing Prowl, the one-site button, Local, Flock
  or Daily fades the old main area up and the new one in (160 ms out, 240 ms in). Browsers with View Transitions use
  `document.startViewTransition` with only `main#otp-main` named (`prowl-main`); the root crossfade is switched off
  while `html.otp-vt` is set, so the Shopify header, footer and the dock itself stay still. Other browsers get the
  same fade-in as a class (`otp-in`). Den keeps its drawer slide, Daily with no hunts only toasts, reduced motion
  gets no animation. Test: `__tests__/page/dock-morph.test.mjs`.
- **v7.03: less to read, fewer buttons (Matt picked ideas 1 to 7, 2026-10-14).** Phone home page 690 → 575 words and
  58 → 46 controls (3 screens → 2); Den About 966 → 86 words; Den Settings 548 → 335.
  1. One search button: Hunt. Search All is hidden (kept, other code clicks it); Near me is a small chip.
  2/3. One promo on the home page (`promoPick`, wrapper class `pm-alerts|pm-app|pm-guide`): Alerts for someone not
     signed up (no alert token or store session), the app on a phone browser when its box would show, else the Field
     Guide. Someone with saved guides (`prowl.guides`) always keeps the guide box. The feedback line moved to Den › About.
  4. Header: account + a ☰ menu holding App, Text size, Theme and How Prowl works (same ids and handlers).
  5. "Tap × to move a hunt back to your Den" and the hunt panel's second Aa are gone; the link reads "All your hunts →".
  6. Facebook/Instagram buttons fold into "Facebook and Instagram ›"; the link-only sites in the empty card fold into
     "More places to look ›".
  7. Den › About opens with two lines, the feedback note, the Vault strip, share and byline; the long SEO section is
     still on the page inside a closed "How it works, and how collectors use it". Den › Settings keeps alerts,
     appearance, style and text size up top; marketplaces, AI helpers, one-site, stats, backup, import, clear and
     About sit under "More settings".
  Not a bug after all: "Pro: 25 hunts" is right for alerts (worker `AL_MAX_HUNTS` 25); 100 is the Den cap.
  Test: `__tests__/page/declutter-v703.test.mjs`.
- **v7.02:** tapping a hunt chip in Your favorite hunts scrolls down to that hunt's finds when they sit below the fold
  (Matt, 2026-10-14: on a phone they were under the long chip list). `sgwToBody` runs only on a chip tap, only when
  the finds start below 45% of the screen; on a wide screen they sit beside the chips and nothing moves. Test:
  `__tests__/page/hunt-scroll.test.mjs`.
- **v7.01:** the orange "N new" badge on a favorite hunt chip no longer squashes into "1 / ne / w" beside a long hunt name
  (Matt's screenshot, 2026-10-14): `.sgw-new` is `flex:none; white-space:nowrap`, so the name wraps and the badge
  stays on one line. Test: `__tests__/page/new-badge.test.mjs`.
- **v7.00: Back on Android (Matt, 2026-10-14).** Back closed the installed app when he expected Prowl's home screen.
  Search results now count as a layer: Back clears them and scrolls to the top (`ovAny`/`ovCloseTop` include
  `st.run`; `rRes` resyncs the guard). In the installed app only (`ovApp`: /pages/prowl-app, standalone, fullscreen or
  minimal-ui), Back on the home screen shows "Press Back again to close Prowl." The extra history entry is added on a
  tap (Chrome skips entries pushed without one) and not again for 2.5 s after the toast, so a second Back closes the
  app as Android expects. A browser tab is left alone. A "stay or close" dialog is not possible: pages cannot hold Back
  with a prompt. Test: `__tests__/page/back-root.test.mjs`.
- **v6.99: the listing popup (Matt, 2026-10-13).**
  - **Large text could trap you in the popup.** Large and Extra large zoom the whole app (1.12 / 1.25), and the popup
    is 94vh tall, so zoomed it was taller than the phone and its top bar with the X sat above the screen; only the
    phone's Back button got out. `textSizeApply` now sets `--tz` on the wrapper and the popup, the other sheets, the
    `.md` modals and the photo strip divide their vh heights by it (`dvh` where the browser has it). There is also a
    **Close** button at the bottom of the popup. In large text, or under 420px, the item details stack (label over
    value) instead of squeezing the values into a thin column.
  - **Search this on Prowl:** a pill under the price. It closes the popup, puts a cleaned title in the search box and
    runs the search (`popTerm`: the maker from the item details first, then the title without sales words like rare,
    vintage, MCM or label, sizes, years, quotes or emoji, at most 7 words). A toast says what it searched.
  - **Double-tap the photo to like** (`popLike`): adds the like Flock learns from, with a heart over the photo. It never
    un-likes; the heart button still does that.
  - Seller text escaped twice ("it&#39;s") is decoded once, as text, in the title, details and description
    (`popUnEnt`), and a description that only repeats the title is left out.
  Test: `__tests__/page/popup-v699.test.mjs`. Also: the worker tests for `/item` and Salvation Army load v116's
  Pacific-time helpers (`PT_FMT`, `ptOff`, `sgwMs`) and its `item2` cache key; they had failed since v116.
- **v116:** ShopGoodwill end times are Pacific wall time with no zone; the worker read them as UTC, so live auctions
  showed about 7 hours short or "This listing ended" (Matt bid on one that was still live). `sgwMs` reads them as
  America/Los_Angeles; `itemSgw` trusts ShopGoodwill's own expired flag; item cache key `item2`.
- **v6.98 / v115:** Prowl's notifications reached Matt's Android phone, but Chrome's on-device filter hid the first
  test behind "Possible spam". The notes now say who they are from and why, with no emoji: the test is "Prowl by Owl &
  Twig Vintage / Phone alerts are on. When Pounce spots the piece you described, Prowl shows it here with the photo."
  and a match is "Prowl found a likely (possible) match for <hunt>". The page no longer promises a test the worker
  could not deliver, and tells a member to tap Show notification if Chrome marks it as possible spam.
  Also: **Share sends the find's photo.** Flock's Share and a new **Share this find** button in the listing popup (so
  hunt results, Likes and any card that opens it) send the photo with the title, price and link (`shareFind`). The text reads like a person passing on a find, so
  someone who has never heard of Prowl does not take it for spam or AI: "Found this on eBay: <title> · <price>", the
  marketplace link, then one plain line, "Found with Prowl, a vintage search tool from Owl & Twig Vintage". The
  worker hands the photo over (`GET /img?u=`, Prowl's pages only, images only, 4 MB, 200 a day per visitor, nothing
  kept); a phone that cannot share files, or no photo in time, sends the link alone as before. Tests:
  `__tests__/page/flock-share.test.mjs`, `worker/__tests__/img-share.test.mjs`.
- **v6.97 / v114: Prowl's own notifications (Web Push), and ntfy is gone.** A Pounce match arrives as a notification
  from Prowl itself (Matt, 2026-10-13). Den > Settings > Pounce has **Alert this phone**: it registers Prowl's service
  worker (`worker/sw.js`, served at the shop's `/apps/prowl/sw.js` through the existing app proxy), asks for permission
  on that tap only, subscribes and tells the worker, which sends a test. The worker keeps up to 5 phones per member
  (`push:<salted hash>`, `pushep:` to swap a renewed subscription) and sends with `worker/push.js` (VAPID ES256 + RFC
  8291 aes128gcm, Web Crypto, no dependencies; it posts only to the browsers' own push services). A match that cannot
  go as a notification rides in the next digest (phone-only members: held and tried again); Android shows Check price
  and Not it (a signed 14-day token per match, never the member's sign-in). iPhone: only from the Home Screen app
  (iOS 16.4+), no buttons. **ntfy is removed** (nobody had signed up): its buttons, `/alerts/push` and
  `/alerts/quarry-no` are gone; an old `sub.push` topic is ignored. Tests: `worker/__tests__/push.test.mjs` (RFC 8291
  Appendix A byte for byte), `__tests__/page/push-button.test.mjs`, `worker/__tests__/pounce.test.mjs`.
- **v6.96:** Pounce's phone line names the member's ntfy channel with a Copy button and links to the ntfy app itself
  (`ntfy://ntfy.sh/<channel>`, the app's subscribe link) as well as ntfy's web page. "Open in ntfy" went to the web
  page, so the app never learned the channel (Matt, 2026-10-13: an empty Subscribed topics list).
  Also: switching a live site (ShopGoodwill, eBay, Chairish, Etsy, Poshmark, Vinted, Grailed, Salvation Army) off or
  on in the marketplace list now changes the search on screen too (`liveScope`); turning Chairish back on took a
  reload. Tests: `__tests__/page/live-scope.test.mjs`.
- **v6.95 / v113: Pounce saves for members signed in through the store.** Status, prefs and likes take a store session
  (v82) in place of the email token; Pounce took only the token, so Matt saw the Pounce box but every Save quarry was
  refused ("Sign in to Prowl Alerts first."). The worker's `pounceMember` now takes either, for save, phone alerts and
  the owner test, and the page sends the session with them. The refusal also showed below every hunt, off the screen,
  so the box just stayed open: a Pounce message now shows right under the hunt it is about, "Saving…" shows at once,
  and an answer that is not JSON still says what came back.
- **v6.95:** in Uranium, the band at the top of the Den, the listing popup and the other pop-up screens is a deep
  green gradient (#1e7f24 to #0c330e, from Matt's shades of #3cff49) instead of the bright #39ff14, with a pale title
  (#ebffec), and the popup's View on <site> button matches it (pale label, bright #3cff49 edge). The screens under it stay black, and the home page's section bands keep the bright green. Other themes are
  unchanged. Test: `__tests__/page/uranium-popups.test.mjs`.
- **v6.94:** a tap on a liked ShopGoodwill, eBay, Etsy or Salvation Army find in Den > Likes opens its listing popup
  again. The popup and the Den are both drawers at the same level and the Den comes later in the page, so the popup
  opened behind it and the tap seemed to do nothing (Matt's Haeger pumpkin). The popup now sits above every drawer, and
  closing it keeps the scrim when the Den is still open. Finds from other sites link straight out, as before. Test:
  `__tests__/page/likes-popup.test.mjs`.
- **v6.93 / v112: Pounce** (Hark's branch, brought up to date by Claude). A quarry is one of a member's alert hunts
  plus their own words for the exact piece (skip words, a size range, a reference photo). On the alert clock, a free
  pre-filter drops obvious misses and Muse judges the rest with the photo (yes / maybe / no and a reason). A match taps
  the member's phone through ntfy (Open it, Check price, Not it), or rides at the top of the next digest when there is
  no phone, and shows in Den > Settings > Pounce. Free: 1 quarry and 10 judgements a day; Pro: 5 and 40; the site
  stops at 2,000 a day. Fixed from the review of Hark's 1beb038:
  - editing one quarry re-judges that quarry only (pj: entries are per quarry), not every quarry;
  - a phone-only check (emails off or paused) marks nothing seen, so the digest still has every listing when emails
    come back, and keeps its own list of hunts searched today;
  - listings Pounce did not reach in a run wait in pq: for the day, so the hunt is not searched again every 5 minutes;
    the digest waits up to two hours past the member's hour for those matches;
  - a Muse outage (network, timeout, 429, 5xx, a refused key) marks nothing, stops judging for 10 minutes (pjdown) and
    keeps the listings waiting; only an unreadable listing gets the one-retry-then-let-go rule;
  - a phone-only member's tap that does not go through waits in pp: and is sent on a later run, for up to 3 days;
  - the test that cleared pj: by hand now goes through the real forget.
  The panther no longer pounces and walks when a match arrives: Prowl magic already moves it (Matt). Page test:
  `__tests__/page/pounce.test.mjs`; worker: `worker/__tests__/pounce.test.mjs`.
- **v6.92 / v111:** the page's main stylesheet (141 KB) is served by the worker, so the page body Shopify holds went
  from 886 bytes to 144 KB under the limit. The repo page keeps it inline in `<style id="prowl-css">`, so editing and
  tests are unchanged; the deploy swaps that block for a `<link>` to `/css/prowl.<hash>.css` plus a few lines of
  script (re-adds the link if a sanitizer drops it, retries once if the worker fails). After changing the page's CSS,
  run `node scripts/build-page-css.mjs` (a test fails until you do). The page deploy waits, up to 10 minutes, for the
  worker to serve the new stylesheet before sending. See `page/README.md`, Main stylesheet on the worker.
- **v6.91:** Matt's Vinted invite: one line under a run's first Vinted row ("New to Vinted? Join with Matt's invite:
  you each get $20 when you list 3 items, then $30 each at your first sale. Terms apply."). A referral, not an
  affiliate; the `VINV` constant holds the link and `''` hides it. Matt to confirm Vinted's terms allow it on a public
  page.
- **v6.90:** Near me takes Facebook USA's spot under the search box (Hunt · Search All · Near me). It does what the
  dock's LOCAL does: with a hunt, Facebook (your city), Craigslist, OfferUp, EstateSales.net and CTBids; with none,
  Den > Local. Facebook USA is still on the results ("Facebook Marketplace · search X in N cities") and in the
  Goodwill panel. The dead `.b.fb` styles went with it (+356 bytes of room).
- **v6.89:** in Uranium, starting a hunt sends a swarm of 22 fireflies across the screen (on body, removed when
  done; a new hunt clears the last swarm). Nothing in other themes or under reduced motion.
- **v6.88:** the dock's ALL button is now LOCAL (map pin). With a hunt typed or selected it searches Facebook
  (your city), Craigslist, OfferUp, EstateSales.net and CTBids; with none it opens Den > Local. ALL used to scroll home
  and ask for a term. Search All stays under the search box. Tests that read the count from the dock read the hero.
  Taps answer (dock icons, rows and buttons press in), and a sweep line names each site as a hunt's rows rise, then
  says how many are ready (none under reduced motion). The Shopify search title and description now say 29
  marketplaces, not 28 (set in Shopify).
- **v6.87 / v110:** Etsy's affiliate row is Rakuten Advertising, not Awin (Etsy's US program answered Matt's application
  through Rakuten). Key `etsy_rak` (never `etsy`, which pages v6.60-v6.86 turn into an Awin link), fields Etsy's
  advertiser id (mid) and the Rakuten publisher id, both empty and off; page only, like Depop. The Prowl page's Shopify
  search title and description no longer frame it against Google (set in Shopify, not in the repo): "Prowl — Search 28
  Vintage Marketplaces at Once | Owl & Twig Vintage".
- **v109:** the worker gets its own Shopify order token from a Dev Dashboard app (client credentials; those tokens last
  about a day, which is why the pasted SHOPIFY_ORDERS_TOKEN went 401). Needs SHOPIFY_ORDERS_CLIENT_ID and
  SHOPIFY_ORDERS_CLIENT_SECRET in Cloudflare.
- **v6.86 / v108:** one sign-in, inside the app: tap the account chip, type your email, type the 6-digit code we email
  (POST /alerts/code, /alerts/verify; HMAC only, 10 minutes, 5 tries, same answer for any email). A new email becomes
  a member. Gone from view: the store "Log in" / "Sign in or sign up", the confirm-link and magic-link screens, and the
  Flock star's trip to the store login. Old confirm/sign-in links and the silent store sign-in still work. Upgrade asks
  for the sign-in first, then carries on to checkout. "Hi, name · Log out" moved to a slim line under the header (it
  overlapped the buttons on a computer), on phones too. Limits: 5 codes and 10 wrong guesses per address a day.
- **v6.85 / v107:** an account chip in the header on every screen (the installed app has no store header): the first
  letter of who is signed in, a green ring for Pro, a person when nobody is; it opens Den > Settings, whose Prowl
  Alerts box now shows the plan. A sign-in finished in a browser tab is picked up when the app comes back. Log out
  returns to the page it came from. The "Still looking for your order" card lets go after a day, names the email it
  looks under (with "Switch to it"), and asks the shop afresh 3 times a round, not 15. The worker keeps a "not Pro"
  answer 10 minutes (it was 6 hours) and names Shopify's own error in "pro check failing". On phones the ... home link
  makes way for the chip.
- **v6.84:** a first visit starts with 3 sample hunts (ceramic panther, Halloween decor, ceramic Christmas tree)
  instead of 12. The Den keeps 5 hunts of your own on Free, up to 100 with Prowl Pro (`HUNTS_FREE`/`HUNTS_PRO`). The
  sample hunts (old and new) don't count; nothing saved is ever removed, a full Den just takes no new hunt. Plan table, FAQ and
  billing terms say so. Searching itself has no limit.
- **v6.82:** the header fits on phones in the dark theme (its mushroom chip is hidden under 480px wide, and the bar
  tightens); Help no longer runs off the edge.
- **v6.81 / v106:** estate sales within 30 miles by default with each sale's distance, and "Show N farther"; the
  worker finds EstateSales.net's `filteredSales` list wherever it sits. (#116)
- **v6.80 / v105:** estate-sale links that 404'd now use the sale's own link; a ZIP saved as the Craigslist city
  searches 25 miles around it. (#114)
- **v6.80:** no panther walking across the screen when a hunt starts. The opening animation stays. (#115)
- **v6.79 / v104:** panther QR button, eBay fee fix, photo check on busy photos. (#112, #113)
- **v6.76 / v103:** Estate sales near you (EstateSales.net, with the site's permission), owner-only list and map in
  Den > Local. (#111)

## In flight

| Branch | Owner | What | State |
|---|---|---|---|
| `hark/copy-consistency` | Hark | Page copy matches the app (photo checks, alert cadence, no-account wording, FAQ count) | No PR yet, not reviewed. Will need a new page version. |
| `claude/nice-gates-pl5opz` | Claude | Print Finder moved to its own repo (thebluecloudy/printfinder) | No PR. |

Next free numbers: **page v7.29, worker v128**. Claim one here when you start.

## What's next

- **ShopGoodwill sniper: parked, waiting on ShopGoodwill's written consent.** Built and tested (worker part), not
  deployed. ShopGoodwill's Terms of Use (01/22/2025) forbid third-party apps that interact with the site "without our
  prior written consent" and "any ... script ... or other automated means", license the site for "private,
  non-commercial purposes" only, and say not to share passwords. The patch, the plan (owner-only test, then a Pro +
  Sniper tier) and a draft email asking ShopGoodwill are in `docs/sniper/README.md`. Do not ship it without that consent.

The ranked ideas and the order Matt chose are in `docs/priority-matrix.md`: Pounce, then the two-photo photo check
(the piece, then its mark or back), then community-lite.

## Waiting on Matt

- **Turn on Prowl's own notifications:** in Cloudflare > Workers > prowl > Settings > Variables and secrets, add
  `VAPID_PRIVATE_JWK` (type Secret) with the private key Claude gave in chat on 2026-10-13 (the public half is in
  `worker/wrangler.toml`). Until then the page offers no phone alerts (finds come by email). Then test: Android Chrome, Den > Settings > Pounce >
  Alert this phone (a test note arrives); iPhone: add Prowl to the Home Screen, open it from there, same button.
  **iPhone gate:** if the test never arrives on iPhone with the service worker at `/apps/prowl/`, tell Claude.

- **Try Pounce:** in Den > Settings > Pounce, set a quarry on one hunt and tap Alert this phone (once
  VAPID_PRIVATE_JWK is in, above). Matches also show in the same place. The Not it button on the phone needs
  MEMBER_ID_SALT or ADMIN_KEY (both are set if admin works).

- **URGENT: Pro checks fail until the order app's keys are in Cloudflare.** In the Shopify Dev Dashboard open the app
  that will read orders ("Prowl"), make sure its access scopes include read_orders (release a new version if you add
  it, and approve it in the store), copy its Client ID and Client secret, then in Cloudflare > Workers > prowl >
  Settings > Variables and secrets add SHOPIFY_ORDERS_CLIENT_ID and SHOPIFY_ORDERS_CLIENT_SECRET (type Secret) and
  Deploy. Then admin > Members > Re-check Pro.
- **In Shopify:** set the PROWLMONTH discount to one use per customer (the code is visible in the page source).
- **Known gap:** if adding Pro to the cart fails, the page falls back to `/products/prowl-pro` without the code.
- **Next:** check Den > Settings shows the free month and that the welcome email came.
- **Facebook alerts cost test** (Apify, 5 real hunts in Detroit/Novi). Needs a go-ahead and the Apify token.
- **Etsy affiliate (Rakuten):** declined 2026-10-11 ("temporarily", reapply after 15 days). Ask Etsy Affiliate US why;
  reapply with https://www.owlandtwigvintage.com/pages/prowl. Once approved, paste Etsy's advertiser id (mid) and the
  Rakuten publisher id in admin > Affiliates > Etsy, Save IDs, Turn on.
- **Estate sales check:** admin > Diagnose > "Check garage-sale sites", then Den > Local with "Novi, MI".

## Done

- **Free-month checkout test passed** (2026-10-11): "Start my free month" opened checkout with PROWLMONTH
  applied, $0.00 today, $7.00 a month after, card saved; Shopify's subscription page offers Pause, Skip and Cancel.
  Cancel tested too: the store got "canceled a subscription contract". The $0 order stays paid, so Pro runs to the
  end of the free month (Nov 11) and then stops, as no $7 order comes. Known gap: Prowl doesn't see the cancel, so
  Den still says "then $7.00 a month" until then.

## Known issues

- The Flock bar test (`__tests__/page/flock-bar.test.mjs`) fails now and then on main; not caused by recent PRs.
