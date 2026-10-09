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
the extension.

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

