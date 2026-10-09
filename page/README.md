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
| Etsy | Awin | Etsy advertiser ID (awinmid), your Awin publisher ID | page |
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
  look or Classic), so it is the app's colour from its first frame: keep its `PAL` table in step with the palettes (the
  test reads them from the stylesheet). `?curtain=1` shows it on any page (to look at it),
  `?curtain=0` never. Its style and script sit right after the first script, so it covers the app before it paints, and
  it is on `body`, outside the text-size zoom. Timing constants are at the top of its script (`MIN_MS`, `MAX_MS`, ...).
- **Prowl magic** (Hark's idea): result cards rise in the first time each listing appears (a card redrawn mid-rise carries
  on); listings new since your last look at a hunt glow (`data-fresh`, from `seenFresh`, measured against what was seen
  when the visit started), and the first of them after you start or pick a hunt gets a unicorn; starting a hunt sparkles
  at the button and the panther pounces and walks across. The glow and the unicorn wait until they can be seen (not under
  the curtain, not on a hidden panel); a card drawn while the tab was hidden or under reduced motion does not rise later.
  Opacity and transform only, apart from the hunt-chip sheen (a moving background, once per hover); nothing under reduced
  motion, and nothing touches saved data, links or timing. The seen list (`seenMark`) now keeps every listing still on
  screen, so one that stays up never glows as new again. Tests: `__tests__/page/motion.test.mjs`.
