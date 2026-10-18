# ShopGoodwill sniper (parked)

Status, 2026-10-18: **built, not deployed. Do not ship it without ShopGoodwill's written consent.**

The owner asked for a sniper ("can we add a sniper to my prowl, and charge them more for it?") after looking at
GhostNode and ShopGoodwill Sniper. A member picks a ShopGoodwill auction and a max bid; a few seconds before the close
Prowl places that max as one bid from the member's own ShopGoodwill account. The owner chose:

- **Pricing:** a new tier, Pro + Sniper (a second Shopify subscription with its own SKU, e.g. `PROWL-SNIPER-MONTHLY`,
  about $14 a month; GhostNode charges $9.95 for sniping alone). Not built yet: the worker's `alPro` would learn the new
  SKU and set a `sniper` flag next to `pro`.
- **Sign-in:** keep only ShopGoodwill's session token, sealed. Never the password.
- **First step:** the owner key only, to prove on cheap lots that the bid goes through, before anyone pays.

## Why it is parked

ShopGoodwill's Terms of Use (https://shopgoodwill.com/about/terms-of-use, last updated 01/22/2025) say users will not:

> develop any third-party applications that interact with the Services without our prior written consent; use any
> robot, spider, crawler, scraper, script, browser extension, offline reader or other automated means or interface not
> authorized by us to access the Services, extract data, or otherwise interfere with or modify the rendering of Site
> pages or functionality

and they license the site "solely for your own private, non-commercial purposes", and tell users "that you not share
password with anyone else". A paid sniper that signs in with members' passwords breaks all three. The risk lands
first on members' ShopGoodwill accounts (suspension), then on Prowl (a blocked worker or a demand to stop).

The same "automated means ... extract data" line arguably covers Prowl's existing ShopGoodwill search through
`buyerapi.shopgoodwill.com`, live since long before this. The email below asks about both.

eBay is out regardless: its API lets only approved partners bid, and bidding with members' passwords would break
eBay's rules and put the eBay Partner Network links at risk. HiBid's firewall already blocks the worker.

## What is built (`sniper.patch`)

`git apply docs/sniper/sniper.patch` on top of page v7.24 / worker v125 adds:

- `worker/snipe.js`: `GET /snipe`, `POST /snipe/connect | disconnect | add | cancel`, owner key only (`isOwner`).
  Connect signs in to ShopGoodwill once (`SignIn/Login`, both fields AES-CBC encrypted with the key in ShopGoodwill's
  own page, the way its site does it) and keeps only the access token, sealed with AES-GCM (key from the secret
  `SNIPE_SEAL_KEY`, else `MEMBER_ID_SALT`, else `ADMIN_KEY`). The `Sniper` Durable Object (one per member, binding
  `SNIPER`, migration `v2`) wakes 2.5 s before the fire time, rechecks the lot (no bid once the price is past the max),
  waits to the second and calls `ItemBid/PlaceBid` with the max 6 s before the close. 90 s after the close it reads the
  final price: lost (went past the max) or ended (within the max: check ShopGoodwill). A 401 drops the dead token.
  At most 25 waiting; ShopGoodwill also limits accounts under 30 days old to 15 active auctions.
- `worker/__tests__/snipe.test.mjs`: 10 tests (sign-in format checked against Node's own AES, sealing, every add
  check, the bid's timing, headers and body, past-max, 401, refusals, after-close results).
- The page: a "🎯 Snipe it" box in a ShopGoodwill auction's popup (owner key only) and Den › Settings › Sniper
  (connect, disconnect, every snipe with ShopGoodwill's raw answer for the test runs).
- `worker/index.js`: the import, `export { Sniper }`, the `/snipe` route, `WORKER_VERSION` v126.

Not checked against the real ShopGoodwill: the sign-in and bid calls follow what ShopGoodwill's own site sends (as
open-source ShopGoodwill tools describe it); the session could not reach `buyerapi.shopgoodwill.com`. The first
owner test is what proves them.

## Before it ships

1. ShopGoodwill's written consent, covering a paid service and members' accounts.
2. Take fresh version numbers from `docs/STATUS.md` (the patch says worker v126; renumber if taken), merge main,
   `node scripts/build-page-css.mjs`.
3. Set the secret `SNIPE_SEAL_KEY` (32+ random characters) in Cloudflare.
4. Page tests for the popup box and the Den card (none yet).
5. Owner test on a few cheap lots; read "What ShopGoodwill answered" on each.
6. Then: the Pro + Sniper SKU in `alPro`, a member gate in `snipeWho`, a phone alert for each result (Web Push, as
   Pounce does), and members' snipes in the privacy purge list.

## Draft email to ShopGoodwill

> Subject: Permission for a bidding tool on ShopGoodwill
>
> Hello,
>
> I run Prowl (owlandtwigvintage.com/pages/prowl), a free search tool that helps vintage collectors find pieces across
> ShopGoodwill and other marketplaces. Many of our users buy on ShopGoodwill.
>
> Your Terms of Use ask for prior written consent before a third-party application interacts with the site, so I am
> writing before building anything further. We would like to offer our members a timed bid: a member sets a maximum,
> and Prowl places that single bid from the member's own ShopGoodwill account shortly before the auction ends. One
> bid per lot, no bid changes, and a member can only bid on their own account.
>
> 1. Would ShopGoodwill allow this, and on what terms (including as part of a paid membership)?
> 2. Is there an approved way to do it, such as a partner API or an authorization flow, so members never give us
>    their ShopGoodwill password?
> 3. Prowl also shows ShopGoodwill search results, linked back to your listings. Is that use acceptable to you, or is
>    there a feed you would prefer we use?
>
> Thank you,
> [name], Owl & Twig Vintage
