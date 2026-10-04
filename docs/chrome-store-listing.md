# Prowl extension: Chrome Web Store listing (v1.4.0)

Source is in `extension/`. Build the upload with: `cd extension && zip -r ../prowl-extension-X.Y.Z.zip . -x '.*'`

## Name
Prowl by Owl & Twig: Vintage Search

## Summary (132 characters max)
A Prowl Pro bonus: search vintage marketplaces from one place, with live listings, Field Guides and your Daily Prowl.

## Description
Prowl helps vintage collectors and resellers search for the same piece in many places at once. It is built by Owl & Twig Vintage, a family vintage shop in Michigan. This extension is a bonus for Prowl Pro members.

What it does:
- Type what you are hunting in the toolbar and see live listings from several marketplaces side by side.
- Right-click any text on a page to search it, open it on all the marketplaces in one tab group, check sold prices, or get a Field Guide.
- Open your Daily Prowl and Prowl's photo check from the toolbar.
- Type "prowl" and a space in the address bar to search from there.

How to unlock it: Prowl Pro is $7 a month, first month free. Sign in once on the Prowl page (Den, Settings, Prowl Alerts) and the extension unlocks by itself. Without Prowl Pro it sends you to the free Prowl page.

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

## Assets you need to provide
- Screenshots, 1280x800 or 640x400, 1 to 5. Take them with real listings: toolbar popup after a search, the locked Pro screen, the right-click menu.
- Small promo tile 440x280 (required), marquee 1400x560 (optional).
- Icon 128x128 is already in the package.

## Rules to keep it accepted (Chrome "spam and placement in the store")
- Do not list marketplace or brand names in the name, summary, description or tags. A string of site names reads as keyword stuffing, even when it is accurate.
- Do not repeat a word or phrase over and over, and keep the description to plain sentences.
- Do not claim endorsement by any marketplace.
