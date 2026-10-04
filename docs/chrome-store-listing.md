# Prowl extension: Chrome Web Store listing (v1.3.0)

Source is in `extension/`. Build the upload with: `cd extension && zip -r ../prowl-extension-1.3.0.zip . -x '.*'`

## Name
Prowl by Owl & Twig: Vintage Search

## Summary (132 characters max)
A Prowl Pro bonus: search 26 vintage marketplaces at once, with live listings in your toolbar and a right-click search.

## Description
Prowl is the search tool for vintage collectors and resellers, built by Owl & Twig Vintage, a family vintage shop in Michigan. This extension brings it into your browser. It is a bonus for Prowl Pro members.

- Toolbar: type a piece once and see live listings from ShopGoodwill, eBay, Etsy, Chairish, Poshmark, Depop, Vinted and Grailed.
- Right-click any text on any page to hunt it: live listings, the Prowl page, every marketplace opened in one tab group, or eBay sold prices.
- Right-click a photo to identify it with Google Lens.
- Address bar: type "prowl", press space, then what you are hunting.
- Opens searches on 26 marketplaces, including Facebook Marketplace, Whatnot, ShopGoodwill, Heritage Auctions, LiveAuctioneers and Invaluable.

Prowl Pro is $7 a month, first month free. Sign in once on owlandtwigvintage.com/pages/prowl (Den, Settings, Prowl Alerts) and the extension unlocks by itself. Without Prowl Pro the extension sends you to the free Prowl page.

Prowl is an independent tool and is not affiliated with, endorsed by, or sponsored by any marketplace it searches.

## Category
Shopping

## Single purpose
Search vintage marketplaces for the text the user types or selects, and show live listings for it.

## Permission justifications
- contextMenus: adds the right-click "Prowl" search for selected text and the image-identify item.
- tabGroups: groups the marketplace tabs opened by "every marketplace" into one named, collapsible group.
- storage: keeps the last search for the browser session and the member sign-in used to unlock Pro.
- Host permission https://prowl.thebluecloud.workers.dev/*: Prowl's own search server, which returns live listings and confirms Prowl Pro membership.
- Content script on owlandtwigvintage.com/pages/prowl*: reads the Prowl Alerts sign-in (email and token) that the Prowl page already holds, so a Pro member does not sign in twice. It reads nothing else.
- omnibox keyword "prowl": address-bar search.

## Data use (privacy practices tab)
- Collected: search words the user types or selects and chooses to search; the Prowl Alerts email and token, stored locally to confirm Prowl Pro.
- Sent only to Prowl's server (prowl.thebluecloud.workers.dev), hosted by Cloudflare. Search words get live listings. The email and token confirm membership.
- Not sold. Not used for advertising or unrelated purposes. No AI service is used (the extension asks the server to skip AI sorting).
- No remote code. No analytics or trackers in the extension.

## Privacy policy URL
Use your Shopify privacy policy, which now has the section "Prowl, Prowl Alerts and Field Guides":
https://owlandtwigvintage.com/policies/privacy-policy

## Assets you need to provide
- Screenshots, 1280x800 or 640x400, 1 to 5. Take them with real listings: toolbar popup after a search, the locked Pro screen, the right-click menu.
- Small promo tile 440x280 (required), marquee 1400x560 (optional).
- Icon 128x128 is already in the package.
