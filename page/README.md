prowl.html is the Prowl page body. A push that changes it deploys it to Shopify (.github/workflows/deploy-page.yml).

## Affiliate tags

Outbound listing and search links go through `prowlAff()` in the first `<script>` of `prowl.html`. eBay keeps its EPN tag. The other programs live in `window.PROWL_AFF`, one click-URL template per merchant with `{url}` where the listing URL goes:

| Merchant | Network | Fill in |
|---|---|---|
| Etsy | Awin (or Rakuten, check at signup) | `YOUR_ETSY_MID`, `YOUR_AWIN_ID` |
| Reverb | Awin | `YOUR_REVERB_MID`, `YOUR_AWIN_ID` |
| 1stDibs | Partnerize | `YOUR_1STDIBS_CAMREF` |
| Depop | Rakuten (merchant 53555) | Publisher id `jh1j/r7*wkQ` in all three places (`PROWL_AFF` here, `DEPOP_AFF` in `worker/index.js`, `AFF.depop` in `extension/sites.js`). **Off since 2026-10-08** (Rakuten declined): see the switches below. |

A template that still contains `YOUR_` is off, and that merchant's links go out clean. The footer and Help disclosure list exactly the merchants that are on.

### Affiliate switches (admin area, worker v89 / page v6.59 / extension 1.6.3)

eBay and Depop each have an on/off switch in the Prowl admin area, under **Affiliates**. Off means plain links and no
disclosure naming that site, on the Prowl page, in the browser extension and in the alert emails. The worker keeps the
choice in KV `aff:on`, the defaults are `AFF_PROGRAMS` in `worker/index.js` (eBay on, Depop off), and `GET /aff`
tells the page and the extension (they pick a change up within about 5 minutes).

**Turning Depop back on:** open the admin area, Affiliates, and press **Turn on** next to Depop. Nothing else is
needed for the page, the extension or the emails. Also put the Depop line back in `docs/chrome-store-listing.md`
(it is kept there in a comment) and in the Chrome Web Store listing.

**Adding a program to the switches:** add it to `AFF_PROGRAMS` in `worker/index.js`, to `PROWL_AFF_ON` (and an `id`
on its `PROWL_AFF` entry) in `page/prowl.html`, and to `AFF.on` in `extension/sites.js`, then gate its links on it.
