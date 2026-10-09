> **Repo note (2026-10-09), read first.** Three things changed after Matthew wrote this:
> - **Depop / Rakuten is closed.** Rakuten terminated the Owl & Twig publisher account on 2026-10-09. Worker v92, page
>   v6.62 and extension 1.6.4 removed the Rakuten link and ID, and `__tests__/page/no-rakuten.test.mjs` keeps them out.
>   Do not build the Depop deeplink below unless Rakuten reinstates the account and Depop approves in writing; ask first.
> - **Keep every affiliate slot (Matthew, 2026-10-09):** "I want affiliates, just keep them there as I apply for them."
>   So 1stDibs and Etsy stay in the router and the admin Affiliates tab, switched off with empty IDs, overriding the
>   "1stDibs out of the router" line below. Links stay plain and the disclosure leaves them out until he turns one on.
> - **Etsy's network:** the slot is built for Awin. If Matthew is approved on another network (Impact, Rakuten), change
>   Etsy's template and ID formats before he turns it on.

# Prowl affiliate links — build spec for Claude

Goal: every outbound listing link earns commission where a program exists. Same one-place pattern as the existing `prowlEpn` hardening — all listing-link renderers route through a single router.

## What exists (verified 2026-10-06)

| Merchant | Program | Rate | Cookie | Network |
|---|---|---|---|---|
| eBay | EPN (already live) | varies | 24h | EPN |
| Etsy | yes | ~3.2–4% | 30d | TBD at signup* |
| Reverb | yes | 5% of physical purchases, $5/new buyer or seller | 30d, last-touch | Awin |
| 1stDibs | UNVERIFIED — no affiliate program found (Oct 2026) | — | — | — |
| Depop | yes (verified 2026-10-06: Gem's outbound links route through Rakuten LinkShare, merchant ID 53555) | check Rakuten directory | check Rakuten directory | Rakuten |
| | **Application status:** Matthew's Rakuten application was declined — likely the policy's "price comparison sites" clause. Exception requested via affiliate-marketing@depop.com (the policy's written-approval channel). Keep the placeholder until approved; Depop links pass through untagged meanwhile. | | | |

**eBay popup links:** when the eBay listing popup (see `prowl-ebay-popup-spec.md`) is live, its "View on eBay" button must use the `itemAffiliateWebUrl` returned by eBay's Browse API — eBay's docs require that exact URL for the sale to commission. `prowlAff` should prefer it over generic EPN tagging whenever it's present.

\*Etsy network is unsettled as of Oct 2026 — Awin (historical), Rakuten (one 2026 migration report), Impact (freshest source). Do not hardcode a network anywhere; apply on whichever network lists Etsy at signup.

**1stDibs:** no verifiable affiliate program found on any network (Oct 2026). Out of the router and out of marketing copy until a real program page exists. Do not spend signup time on it.

No public affiliate program (do not tag, links pass through unchanged): Mercari, Poshmark, Grailed, Whatnot, Vinted, Bonanza, eCrater, OfferUp, Facebook Marketplace, Craigslist, ShopGoodwill, EstateSales.net, HiBid, LiveAuctioneers, Heritage, Invaluable. Chairish: no verifiable public program found — leave untagged.

## 1. Router

New function `prowlAff(url)` next to `prowlEpn`:

```js
var AFF = {
  'ebay.com':     null,            // already handled by prowlEpn — call it first
  'etsy.com':     'YOUR_ETSY_TAG', // network TBD at signup — click URL or tag param
  'reverb.com':   'YOUR_REVERB_TAG',
  'depop.com':    'YOUR_DEPOP_TAG'  // Rakuten LinkShare deeplink
};
function prowlAff(url){
  url = prowlEpn(url);                       // eBay stays as-is
  try{
    var h = new URL(url).hostname.replace(/^www\./,'');
    for(var d in AFF){
      if(AFF[d] && (h===d || h.endsWith('.'+d))){
        return tagAff(url, d, AFF[d]);       // per-network link builder
      }
    }
  }catch(e){}
  return url;
}
```

- `tagAff` builds the network click URL per merchant (each network has its own format — Awin, Rakuten, Partnerize all use redirect-style click URLs, not query params; store the full click-URL template per merchant).
- Route every listing-link renderer through `prowlAff`: SGW cards, appraiser links, eBay comp links, flock cards, saved list, guide "Hunt it" links — everywhere `prowlEpn` is called today.
- (Closed 2026-10-09, do not implement.) Depop links: build the Rakuten LinkShare deeplink the way Gem does — `https://click.linksynergy.com/deeplink?id=<YOUR_RAN_ID>&mid=53555&murl=<encoded-depop-url>`. Depop's Rakuten merchant ID is 53555 (verified from Gem's live redirect chain, 2026-10-06).
- Matthew fills in the real tags/IDs — placeholders only, never invent them.

## 2. Disclosure

Affiliate links need an FTC disclosure. Extend whatever EPN disclosure the page already shows (footer/about) to name the additional merchants, e.g.: "Prowl may earn a commission when you buy through links to eBay, Etsy, or Reverb — at no extra cost to you."

## 3. Optional catch-all (only if Matthew wants it)

Skimlinks (or Sovrn Commerce) auto-converts outbound links into affiliate links for ~48k merchants and takes a revenue cut (~25%). It only monetizes merchants that *have* programs — it cannot create commission where none exists (see the no-program list above). Decision for Matthew; not required for the four programs above.

## Verify

- eBay link → unchanged EPN behavior (existing redteam hardening still holds: non-https → '#').
- Etsy/Reverb links → redirect through the correct network click URL with Matthew's real tag.
- Mercari/Poshmark/Grailed/1stDibs/etc. links → pass through untagged, working as before. (Depop: untagged until the exception is approved.)
- One tagged click per merchant → shows in the network dashboard (Awin/Rakuten) within 24h.
- Disclosure text visible on the page.

## Seamlessness (house rule)

- A tagged link behaves exactly like an untagged one: same new-tab behavior, no interstitial, no badges, no "affiliate link" markers anywhere in the UI.
- The only visible trace of the whole system is the footer disclosure — never inline, never a modal, never on first click.
- If a network redirect ever fails or hangs, fall back to the clean merchant URL. Never strand the user on a broken redirect.
- The user asked for hunts and finds; the monetization is plumbing, not product.
