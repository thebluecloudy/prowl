# Prowl status

Update this file in every PR (see `CLAUDE.md`). Last updated 2026-10-11 (v6.85).

## Live

| | Version | Page room left |
|---|---|---|
| Page | **v6.85** | 2813 bytes under Shopify's 512 KB (slimmed) |
| Worker | **v107** | |

Recently shipped, newest first:

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

Next free numbers: **page v6.86, worker v108**. Claim one here when you start.

## Waiting on Matt

- **URGENT: Shopify rejects the worker's order token ("shopify 401", Re-check Pro, 2026-10-11).** No member can be
  confirmed Pro until SHOPIFY_ORDERS_TOKEN is replaced: Shopify admin > Settings > Apps > Develop apps > the Prowl app >
  API credentials (scope read_orders), copy the Admin API access token, then Cloudflare > Workers > prowl > Settings >
  Variables and secrets > SHOPIFY_ORDERS_TOKEN > Edit. Then Re-check Pro in admin > Members.
- **In Shopify:** set the PROWLMONTH discount to one use per customer (the code is visible in the page source).
- **Known gap:** if adding Pro to the cart fails, the page falls back to `/products/prowl-pro` without the code.
- **Next:** check Den > Settings shows the free month and that the welcome email came.
- **Facebook alerts cost test** (Apify, 5 real hunts in Detroit/Novi). Needs a go-ahead and the Apify token.
- **Estate sales check:** admin > Diagnose > "Check garage-sale sites", then Den > Local with "Novi, MI".

## Done

- **Free-month checkout test passed** (2026-10-11): "Start my free month" opened checkout with PROWLMONTH
  applied, $0.00 today, $7.00 a month after, card saved; Shopify's subscription page offers Pause, Skip and Cancel.
  Cancel tested too: the store got "canceled a subscription contract". The $0 order stays paid, so Pro runs to the
  end of the free month (Nov 11) and then stops, as no $7 order comes. Known gap: Prowl doesn't see the cancel, so
  Den still says "then $7.00 a month" until then.

## Known issues

- The Flock bar test (`__tests__/page/flock-bar.test.mjs`) fails now and then on main; not caused by recent PRs.
