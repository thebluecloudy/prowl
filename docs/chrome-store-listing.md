# Prowl extension: Chrome Web Store listing (v1.7.0)

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

Facebook watches (with a Prowl account):
- Turn on a watch for a saved hunt in Prowl, and this extension runs your saved Facebook Marketplace searches in your browser and sends matching listings to your Prowl account. Prowl then tells you only about listings that are new since the watch started, by email and in the app.
- Watches check while your browser is open: weekly, daily, or every 30 minutes for a Hot watch. They use your own Facebook login in this browser. The extension never reads, stores or sends your Facebook password, cookies or account details.

To use the Pro features, sign in once on the Prowl page (Den, Settings, Prowl Alerts). The extension unlocks by itself. The free features need no account.

Prowl is an independent tool. It is not affiliated with, endorsed by, or sponsored by the marketplaces it searches. All trademarks belong to their owners.

<!-- No affiliate links in the extension since 1.6.4 (the Rakuten link for Depop is removed), so the listing makes no
affiliate claim. -->

## Category
Shopping

## Single purpose
Search vintage marketplaces for the text the user types or selects, show live listings for it, and keep checking the user's saved searches for new listings (Facebook watches).

## Permission justifications
- contextMenus: adds the right-click "Prowl" search for selected text and the image-identify item.
- tabGroups: groups the marketplace tabs opened by "every marketplace" into one named, collapsible group.
- storage: keeps the last search for the browser session, the member sign-in used to unlock Pro, and the Prowl sign-in that Facebook watches report with.
- alarms (1.7.0): wakes the extension when a Facebook watch is due (weekly, daily, or every 30 minutes for a Hot watch), and once an hour to pick up watches set on another device.
- Host permission https://www.facebook.com/* (1.7.0): opens the user's own saved Facebook Marketplace searches for their watches, in their browser and with their own Facebook login, and reads the listings on those search pages. It does not use the cookies permission and never reads, stores or sends Facebook cookies, passwords or account details; the only thing it reports about Facebook is whether the user was logged in when a check came due.
- Host permission https://prowl.thebluecloud.workers.dev/*: Prowl's own search server, which returns live listings and confirms Prowl Pro membership.
- Content script on owlandtwigvintage.com/pages/prowl*: reads the Prowl sign-in that the Prowl page already holds (the Prowl Alerts email and token, and the store sign-in key), so a member does not sign in twice and watches stop when they sign out there, and marks the page so Prowl knows the extension is installed. It reads nothing else.
- omnibox keyword "prowl": address-bar search.

## Data use (privacy practices tab)
- Collected: search words the user types or selects and chooses to search; the Prowl Alerts email and token, stored locally to confirm Prowl Pro; for Facebook watches, the Prowl sign-in (stored locally) and the Marketplace listings the user's own saved searches return (listing id, title, price, photo link, city), sent to the user's Prowl account. No Facebook credentials, cookies or account details.
- Sent only to Prowl's server (prowl.thebluecloud.workers.dev), hosted by Cloudflare. Search words get live listings. The email and token confirm membership. A watch's new listings are stored against the user's Prowl account until the watch is deleted.
- Not sold. Not used for advertising or unrelated purposes. No AI service is used (the extension asks the server to skip AI sorting).
- No remote code. No analytics or trackers in the extension.

## Privacy policy URL
Use your Shopify privacy policy, which now has the section "Prowl, Prowl Alerts and Field Guides":
https://owlandtwigvintage.com/policies/privacy-policy

## Test instructions (Privacy practices tab)
Facebook watches need a Prowl account signed in on the Prowl page (owlandtwigvintage.com/pages/prowl, Den, Hunts, "Watch on Facebook") and a Facebook login in the same browser.
No account is needed for the free features. Click the toolbar icon, type "ceramic panther" and press Search. The buttons below open the search on every marketplace in tabs, eBay sold prices and Google Images. Highlight text on any page and right-click to see the Prowl menu. The Pro features (live listings, Field Guide, Daily, photo check) need a Prowl Pro account; the toolbar shows how to sign in. Without one they are hidden and the popup explains Prowl Pro.

## Assets you need to provide
- Screenshots, 1280x800 or 640x400, 1 to 5. Take them with real listings: toolbar popup after a search, the locked Pro screen, the right-click menu.
- Small promo tile 440x280 (required), marquee 1400x560 (optional).
- Icon 128x128 is already in the package.

## Rules to keep it accepted (Chrome "spam and placement in the store")
- Do not list marketplace or brand names in the name, summary, description or tags. A string of site names reads as keyword stuffing, even when it is accurate.
- Do not repeat a word or phrase over and over, and keep the description to plain sentences.
- Do not claim endorsement by any marketplace.
