# Prowl extension: Chrome Web Store listing (v1.5.0)

Source is in `extension/`. Build the upload with: `cd extension && zip -r ../prowl-extension-X.Y.Z.zip . -x '.*'`

## Name
Prowl by Owl & Twig: Vintage Search

## Summary (132 characters max)
Search vintage marketplaces from your toolbar, right-click menu or address bar. Prowl Pro adds live listings and Field Guides.

## Description
Prowl helps vintage collectors and resellers search for the same piece in many places at once. It is built by Owl & Twig Vintage, a family vintage shop in Michigan.

Free for everyone:
- Type what you are hunting in the toolbar and open it on all the marketplaces in one tab group.
- Right-click any text on a page to search it, open it everywhere, or check sold prices.
- Right-click a photo to identify it with Google Lens.
- Type "prowl" and a space in the address bar to search from there.

With Prowl Pro ($7 a month, first month free):
- Live listings from several marketplaces side by side in the toolbar.
- Field Guides: a researched collector's guide to a maker, line or kind of object.
- Your Daily Prowl and Prowl's photo check, one click away.

To use the Pro features, sign in once on the Prowl page (Den, Settings, Prowl Alerts). The extension unlocks by itself. The free features need no account.

Prowl is an independent tool. It is not affiliated with, endorsed by, or sponsored by the marketplaces it searches. All trademarks belong to their owners.

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

## Test instructions (Privacy practices tab)
No account is needed for the free features. Click the toolbar icon, type "ceramic panther" and press Search. The buttons below open the search on every marketplace in tabs, eBay sold prices and Google Images. Highlight text on any page and right-click to see the Prowl menu. The Pro features (live listings, Field Guide, Daily, photo check) need a Prowl Pro account; the toolbar shows how to sign in. Without one they are hidden and the popup explains Prowl Pro.

## Assets you need to provide
- Screenshots, 1280x800 or 640x400, 1 to 5. Take them with real listings: toolbar popup after a search, the locked Pro screen, the right-click menu.
- Small promo tile 440x280 (required), marquee 1400x560 (optional).
- Icon 128x128 is already in the package.

## Rules to keep it accepted (Chrome "spam and placement in the store")
- Do not list marketplace or brand names in the name, summary, description or tags. A string of site names reads as keyword stuffing, even when it is accurate.
- Do not repeat a word or phrase over and over, and keep the description to plain sentences.
- Do not claim endorsement by any marketplace.
