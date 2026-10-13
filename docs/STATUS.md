# Prowl status

Update this file in every PR (see `CLAUDE.md`). Last updated 2026-10-13 (v6.98 / v115).

## Live

| | Version | Page room left |
|---|---|---|
| Page | **v6.98** | 132,590 bytes under Shopify's 512 KB (slimmed, main stylesheet sent as a link). Under 2 KB: trim before adding anything |
| Worker | **v115** | |

Recently shipped, newest first:

- **v6.98 / v115:** Prowl's notifications reached Matt's Android phone, but Chrome's on-device filter hid the first
  test behind "Possible spam". The notes now say who they are from and why, with no emoji: the test is "Prowl by Owl &
  Twig Vintage / Phone alerts are on. When Pounce spots the piece you described, Prowl shows it here with the photo."
  and a match is "Prowl found a likely (possible) match for <hunt>". The page no longer promises a test the worker
  could not deliver, and tells a member to tap Show notification if Chrome marks it as possible spam.
  Also: **Share sends the find's photo.** Flock's Share and a new **Share this find** button in the listing popup (so
  hunt results, Likes and any card that opens it) send the photo with the title, price and link (`shareFind`). The
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

Next free numbers: **page v6.99, worker v116**. Claim one here when you start.

## What's next

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
