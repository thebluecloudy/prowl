# Prowl affiliate links — build spec for Claude

Goal: every outbound listing link earns commission where a program exists. Same one-place pattern as the existing `prowlEpn` hardening — all listing-link renderers route through a single router.

## What exists (verified 2026-10-06)

| Merchant | Program | Rate | Cookie | Network |
|---|---|---|---|---|
| eBay | EPN (already live) | varies | 24h | EPN |
| Etsy | yes | ~4% | 30d web / 7d app | Awin or Rakuten* |
| Reverb | yes | 5% of physical purchases, $5/new buyer or seller | 30d, last-touch | Awin |
| 1stDibs | yes | varies by partner | varies | Partnerize |
| Depop | yes (verified 2026-10-06: Gem's outbound links route through Rakuten LinkShare, merchant ID 53555) | check Rakuten directory | check Rakuten directory | Rakuten |
| | **Application status:** Matthew's Rakuten application was declined — likely the policy's "price comparison sites" clause. Exception requested via affiliate-marketing@depop.com (the policy's written-approval channel). Keep the placeholder until approved; Depop links pass through untagged meanwhile. | | | |
| | **Closed 2026-10-09:** Rakuten terminated the Owl & Twig publisher account. Do not build Depop affiliate links; worker v92, page v6.62 and extension 1.6.4 removed them (see `page/README.md`). | | | |

**eBay popup links:** when the eBay listing popup (see `prowl-ebay-popup-spec.md`) is live, its "View on eBay" button must use the `itemAffiliateWebUrl` returned by eBay's Browse API — eBay's docs require that exact URL for the sale to commission. `prowlAff` should prefer it over generic EPN tagging whenever it's present.

\*Etsy ran on Awin; one 2026 report says they migrated to Rakuten. Check which network hosts the program at signup time.

No public affiliate program (do not tag, links pass through unchanged): Mercari, Poshmark, Grailed, Whatnot, Vinted, Bonanza, eCrater, OfferUp, Facebook Marketplace, Craigslist, ShopGoodwill, EstateSales.net, HiBid, LiveAuctioneers, Heritage, Invaluable. Chairish: no verifiable public program found — leave untagged.

## 1. Router

New function `prowlAff(url)` next to `prowlEpn`:

```js
var AFF = {
  'ebay.com':     null,            // already handled by prowlEpn — call it first
  'etsy.com':     'YOUR_ETSY_TAG', // Awin/Rakuten click URL or tag param
  'reverb.com':   'YOUR_REVERB_TAG',
  '1stdibs.com':  'YOUR_1STDIBS_TAG',
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

Affiliate links need an FTC disclosure. Extend whatever EPN disclosure the page already shows (footer/about) to name the additional merchants, e.g.: "Prowl may earn a commission when you buy through links to eBay, Etsy, Reverb, or 1stDibs — at no extra cost to you."

## 3. Optional catch-all (only if Matthew wants it)

Skimlinks (or Sovrn Commerce) auto-converts outbound links into affiliate links for ~48k merchants and takes a revenue cut (~25%). It only monetizes merchants that *have* programs — it cannot create commission where none exists (see the no-program list above). Decision for Matthew; not required for the four programs above.

## Verify

- eBay link → unchanged EPN behavior (existing redteam hardening still holds: non-https → '#').
- Etsy/Reverb/1stDibs links → redirect through the correct network click URL with Matthew's real tag.
- Mercari/Poshmark/Grailed/etc. links → pass through untagged, working as before. (Depop: untagged until the exception is approved.)
- One tagged click per merchant → shows in the network dashboard (Awin/Rakuten/Partnerize) within 24h.
- Disclosure text visible on the page.

## Seamlessness (house rule)

- A tagged link behaves exactly like an untagged one: same new-tab behavior, no interstitial, no badges, no "affiliate link" markers anywhere in the UI.
- The only visible trace of the whole system is the footer disclosure — never inline, never a modal, never on first click.
- If a network redirect ever fails or hangs, fall back to the clean merchant URL. Never strand the user on a broken redirect.
- The user asked for hunts and finds; the monetization is plumbing, not product.
