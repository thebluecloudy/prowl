prowl.html is the Prowl page body. A push that changes it deploys it to Shopify (.github/workflows/deploy-page.yml).

## Affiliate tags

Outbound listing and search links go through `prowlAff()` in the first `<script>` of `prowl.html`: eBay gets its EPN tag (`prowlEpn`), and Etsy, Reverb, 1stDibs and Depop get their network's click URL from `window.PROWL_AFF`. Which programs are on, and their IDs, come from the admin area (below). The footer and Help disclosure list exactly the programs that are on.

### Affiliates in the admin area (worker v90 / page v6.60)

Every affiliate program is set up in the Prowl admin area, under **Affiliates**: its IDs (paste them, press **Save IDs**)
and its on/off switch (**Turn on** works only once the IDs are complete). Off means plain links and no disclosure
naming that site, on the Prowl page, in the alert emails and (for Depop) in the browser extension. Changes reach the
page and the extension within about 5 minutes. Nothing here needs a code change.

| Program | Network | IDs to paste | Where its links are tagged |
|---|---|---|---|
| eBay | eBay Partner Network | Campaign ID (10 digits) | page, alert emails, listing popup |
| Depop | Rakuten, merchant 53555 | Rakuten publisher ID | page, alert emails, extension |
| Etsy | Awin | Etsy advertiser ID (awinmid), your Awin publisher ID | page |
| Reverb | Awin | Reverb advertiser ID (awinmid), your Awin publisher ID | page |
| 1stDibs | Partnerize | camref | page |
| Amazon | Amazon Associates | Tracking ID (ends in -20) | page (Field Guide supplies) |

How it is safe: only the IDs are editable. The link templates stay in code (`AFF_PROGRAMS` and `DEPOP_AFF_T` in
`worker/index.js`, `PROWL_AFF` in `page/prowl.html`), and each ID must match its format when it is saved, when the
worker reads it, and again on the page, so a pasted value can only ever fill its own slot. KV keeps `aff:on` (the
switches) and `aff:ids` (the IDs); `GET /aff` answers both. IDs are public, since they are in every affiliate link.

**Turning Depop back on:** press **Turn on** next to Depop. Also put the Depop line back in
`docs/chrome-store-listing.md` (kept there in a comment) and in the Chrome Web Store listing.

**The extension** (1.6.3) follows the Depop switch but keeps its own copy of the Depop publisher ID, and has no Amazon
yet: Amazon in the extension waits until the Associates rules on browser extensions are checked.

**Adding a program:** one entry in `AFF_PROGRAMS` (its fields and formats) in `worker/index.js`, and in
`page/prowl.html` its `PROWL_AFF` template (with `{field}` slots and an `id`), its formats in `PROWL_AFF_FMT`, and a
key in `PROWL_AFF_ON`.
