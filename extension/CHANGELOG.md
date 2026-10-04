# Prowl extension changelog

Versions follow `extension/manifest.json`. Bump `version` there in the same change as any edit under `extension/`; the workflow builds the zip and publishes a GitHub release named `ext-vX.Y.Z` when it lands on main.

## 1.4.0
- Field Guide: right-click text, or the popup's Field Guide button, opens Prowl's Field Guide with the subject filled in (needs Prowl page v6.23).
- Popup shortcuts to My Daily Prowl and Check a photo on the Prowl page.
- "Sold prices" is now labelled "eBay sold prices", because it opens eBay's sold listings.

## 1.3.0
- Prowl Pro bonus: toolbar, right-click and address-bar search unlock for Pro members. A content script on the Prowl page hands the Prowl Alerts sign-in to the extension; the worker's `/alerts/status` confirms Pro.
- Added Heritage Auctions and Invaluable (26 marketplaces).
- Live listings now include Chairish, Poshmark, Depop, Vinted and Grailed beside ShopGoodwill, eBay and Etsy.
- Fixed the HiBid search link.
- Live requests send `ai=0` so no AI sorting is used.

## 1.2.0
- Toolbar popup with live ShopGoodwill, eBay and Etsy listings, right-click search, address-bar "prowl" keyword and Lens identify.
