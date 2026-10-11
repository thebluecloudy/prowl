# Prowl status

Update this file in every PR (see `CLAUDE.md`). Last updated 2026-10-11.

## Live

| | Version | Page room left |
|---|---|---|
| Page | **v6.81** | 6,243 bytes under Shopify's 512 KB (slimmed) |
| Worker | **v106** | |

Recently shipped, newest first:

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

Next free numbers: **page v6.82, worker v107**. Claim one here when you start.

## Waiting on Matt

- **Free-month checkout test.** Tap "Start my free month" with a fresh email: checkout should show $0 (code
  PROWLMONTH, applied by the link `/checkout?discount=PROWLMONTH`) and save the card; Den > Settings should then
  show "Free until <date>, then $7.00 a month". Never tested yet.
- **In Shopify:** set the PROWLMONTH discount to one use per customer (the code is visible in the page source).
- **Known gap:** if adding Pro to the cart fails, the page falls back to `/products/prowl-pro` without the code.
- **Facebook alerts cost test** (Apify, 5 real hunts in Detroit/Novi). Needs a go-ahead and the Apify token.
- **Estate sales check:** admin > Diagnose > "Check garage-sale sites", then Den > Local with "Novi, MI".

## Known issues

- The Flock bar test (`__tests__/page/flock-bar.test.mjs`) fails now and then on main; not caused by recent PRs.
