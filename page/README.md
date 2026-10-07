prowl.html is the Prowl page body. A push that changes it deploys it to Shopify (.github/workflows/deploy-page.yml).

## Affiliate tags

Outbound listing and search links go through `prowlAff()` in the first `<script>` of `prowl.html`. eBay keeps its EPN tag. The other programs live in `window.PROWL_AFF`, one click-URL template per merchant with `{url}` where the listing URL goes:

| Merchant | Network | Fill in |
|---|---|---|
| Etsy | Awin (or Rakuten, check at signup) | `YOUR_ETSY_MID`, `YOUR_AWIN_ID` |
| Reverb | Awin | `YOUR_REVERB_MID`, `YOUR_AWIN_ID` |
| 1stDibs | Partnerize | `YOUR_1STDIBS_CAMREF` |
| Depop | Rakuten (merchant 53555) | `YOUR_RAN_ID`, once Depop approves the exception |

A template that still contains `YOUR_` is off, and that merchant's links go out clean. The footer and Help disclosure list exactly the merchants that are on.
