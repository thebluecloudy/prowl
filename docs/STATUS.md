# Prowl status

Update this file in every PR (see `CLAUDE.md`). Last updated 2026-10-11 (v6.89).

## Live

| | Version | Page room left |
|---|---|---|
| Page | **v6.89** | 1100 bytes under Shopify's 512 KB (slimmed). Under 2 KB: trim before adding anything |
| Worker | **v110** | |

Recently shipped, newest first:

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
| `hark/pounce` | Hark | Pounce: "quarry" hunts, Muse photo judging, ntfy phone taps | Not ready. Re-review of 1beb038 found 6 must-fix issues (one quarry edit wipes every quarry's judgements, phone-only checks mark listings seen, unfinished hunts re-searched every 5 min, a Muse outage drops listings, phone-only pushes lost on failure, test hides the first). Its versions (page v6.77, worker v104/v105) are taken: renumber before merging. |
| `hark/copy-consistency` | Hark | Page copy matches the app (photo checks, alert cadence, no-account wording, FAQ count) | No PR yet, not reviewed. Will need a new page version. |
| `claude/nice-gates-pl5opz` | Claude | Print Finder moved to its own repo (thebluecloudy/printfinder) | No PR. |

Next free numbers: **page v6.91, worker v111** (v6.90 is claimed by `claude/trusting-lovelace-0d3cnd-near-me`: Near me replaces Facebook USA under the search box). Claim one here when you start.

## Waiting on Matt

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
