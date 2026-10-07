# Prowl big update (2026-10-07 briefing): implementation plan

## Context

Matthew sent 11 spec docs in `flock-mockup-desktop.zip`: a briefing, design rules, and specs for Flock tab, Flock next steps, listing popup, affiliate links, Amazon, Salvation Army, login and privacy. The zip also has 3 mockup PNGs, and 2 of the docs are exact duplicates. The briefing sets the build order. The design rules outrank any spec where they conflict.

Mapping the specs against the code (page v6.37 in `page/prowl.html`, worker v77 in `worker/index.js`, extension 1.5.0) showed that **several specs are out of date**. The plan below follows the code as it actually is:

| Spec says | Reality in repo |
|---|---|
| eBay popup is blocked on Matthew's app key | `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` and `ebayToken()` (client-credentials, `api_scope`) already exist (`worker/index.js:399`). **eBay popup can be built now.** |
| KV + Resend still need setting up | `PROWL_ALERTS` KV is bound, Resend sends through `alSend` (`:2932`), and the cron runs every 5 minutes. |
| Login needs building from scratch | Store login has existed since v5.84: `/apps/prowl/me` → worker `/proxy` with HMAC `pxVerify` (`:3404`), `cid:` mapping, and Pro checked against Shopify orders (`alPro`, `:2793`). Missing: Bearer sessions, and Pro taken from the verified customer id. |
| Privacy: add List-Unsubscribe, POST unsub, footer | Already live (`:2936`, `alUnsub` `:3597`, `alShell`/`alFootText` with `ALERT_ADDRESS`). Missing: KV purge on full unsubscribe, a `mailto:` in List-Unsubscribe, and the "reply unsubscribe" line. |
| `escapeHtml()` | The page's escaper is `esc()` (`page/prowl.html:2168`). |
| "Remove the saved list at the bottom of the Den" | It's `#otp-denFinds` inside the ALL HUNTS pane (`:1852`, `rDenFinds` `:5482`). |
| Photo is a full-screen layer to copy | Photo is a right-side `.drawer` (z 75, covers the dock). Flock needs its own fixed layer: above content, below the dock (z 40). |
| jsdom 89-test suite | The page suite isn't in the repo. Worker tests arrive with the admin work (v78): `worker/__tests__/*.test.mjs`, about 100 tests, run by `.github/workflows/blank.yml`. |

**Coordination with the admin area (v78, merging first from another session):** it adds `worker/admin.js`, `worker/admin-page.js`, `worker/metrics.js`, worker tests and v78 changes in `index.js`. Therefore:
- **Worker versions start at v79:** Salvation Army v79, popup v80, login v81, privacy v82. Page versions are unaffected.
- **Start signal:** Matthew says when the admin has merged. Until then, no implementation that touches `worker/` or CI.
- **Rebase onto `main` after v78 lands**, before PR 0 (it extends `blank.yml` and the worker test harness) and before any worker PR. PR 1 and PR 2 are page-only and could start earlier, but they'd still rebase before merging. The line numbers below are from v77 and must be re-checked after the rebase.
- Every new worker route goes into the `routeKey` table in `worker/metrics.js` (for example `/item` → `item:popup`, `/salvation` → `live:salvation`). Otherwise the admin's speed and error numbers lump them under "other".

**Decisions made (from Q&A):** Watch-for-price-drop is UI only (a local list, no emails). The login brief is built **in full**: Bearer sessions plus Pro from the customer id. A dev-only test harness gets added.

**Ground rules (from `docs/project-instructions.md`):** the page stays one self-contained vanilla-JS file. That means `var`, classic functions, no optional chaining, no Liquid tokens, `addEventListener` only, scoped CSS, and every dynamic string goes through `esc()`. Existing localStorage keys are frozen, and new keys are additive. Backup import must stay backward compatible. The user's TS/React/Zustand preferences **don't apply** to the page, worker or extension. Tests are plain JS ES modules, because the repo has no TS toolchain.

**Deploy reality:** merging to `main` deploys the page through `.github/workflows/deploy-page.yml` and the worker through Cloudflare Workers Builds. Every PR below is therefore a live release. That's why the work is split into small, ordered PRs, each with its own version bump (`PROWL_VERSION` at `page/prowl.html:2164`, plus the changelog comment at the top of `worker/index.js`).

---

## PR 0: Dev harness and spec archive (no live change)

- Save the 9 unique specs into `docs/update-2026-10-07/` with the 3 mockups, and drop the `(1)` duplicates.
- Root `package.json` (`"private": true`, devDependencies: `jsdom` only). Scripts:
  - `test`: `node --test "__tests__/**/*.test.mjs" "worker/__tests__/*.test.mjs"`. Use globs: a bare directory argument fails on Node 22 with "Cannot find module". This runs the existing worker suite alongside the new tests.
  - `lint`: `node --check` on the extracted page script, the worker and the extension JS, plus a Liquid-token scan.
- Generate `package-lock.json` with `npm install` (never hand-edit it).
- `__tests__/helpers/loadPage.mjs`: loads `page/prowl.html` in jsdom with `runScripts:'dangerously'`, a localStorage mock, a `window.open` capture array, and stubs for `fetch`, `clipboard`, `matchMedia`, `IntersectionObserver` and `navigator.share`. It exposes the window for tests.
- `__tests__/helpers/loadWorker.mjs`: first reuses whatever harness `worker/__tests__/` already has. It imports `worker/index.js`, which also loads `./metrics.js` and `./admin.js`, so it must import or copy all of `worker/*.js`. It calls `fetch(req, env)` with a fake env (in-memory KV, a stub CAPS DO, a stubbed global `fetch`).
  - Pure helpers that need direct tests (HTML parsers, sanitizer, signature/session code) get added as **named exports**. Workers ignore those.
- Smoke tests for current behaviour, so later PRs prove they didn't regress anything:
  - dock modes switch correctly
  - hunts render
  - `prowlEpn` tagging and the `'#'` hardening
  - `exportData`/`parseBackup` round-trip, including v1-array import
- CI: extend the existing `.github/workflows/blank.yml`, which already runs the worker tests, so one workflow runs `npm ci && npm run lint && npm test` on PRs touching `page/`, `worker/`, `extension/` or `__tests__/`. Don't add a second, parallel workflow.
- **Merge gate:** a root `package.json` can change how Cloudflare Workers Builds builds. Before PR 0 merges, Matthew confirms in the Cloudflare dashboard (Workers → prowl → Settings → Build) that the root directory is `worker/` and the deploy command is `npx wrangler deploy`. If the root is the repo root, either set it to `worker/` first, or put the dev harness's `package.json` under a `dev/` folder instead. PR 0 doesn't merge until this is confirmed.
- Update `docs/project-instructions.md`:
  - real test commands
  - `esc()` instead of `escapeHtml()`
  - current keys

## PR 1: Flock tab (page v6.38). Spec: `prowl-flock-tab-spec.md`

All edits are in `page/prowl.html`.

**Dock** (`:1803–1810`, handler `:1273–1288`, `rDock` `:3259`):
- Replace the `photo` button with the `flock` button. Use the `#otp-swallow` icon and add the `<em class="bd" id="otp-flbd" hidden>` badge.
- Remove the `photo` branch and add `if(m==='flock'){openFlock();return;}`.
- In `rDock`, set the saved-count badge from the finds store, next to `#otp-ds`.
- Remove the AI-off CSS that hides `#otp-photoBtn` and drops the grid to 5 columns (`:1078–1079`). The dock stays at 6.
- `#otp-cam` and `?photo=1` keep calling `openPhoto()`.

**Screen:**
- `openFlock()` / `closeFlock()`:
  - add `as-feed` to `#otp-flock` and `flock-mode` to `.scout-app-wrapper`
  - hide the home blocks (`#otp-sf, #otp-sgw, #otp-picks, #otp-quick, #otp-res, #otp-guide`)
  - set `st.mode='flock'`, then call `flockStart()` directly
- Every other dock mode and Escape call `closeFlock()`.
- Remove the `flockSync()` call from `rSGW()` (`:4554`) and drop the IntersectionObserver path.
- Optional `?flock=1` deep link, handled next to `?photo=1` (`:5271`).

**Feed CSS:**
- Use the spec block. The layer is `position:fixed`, below the header, with `bottom` set to the dock height and a z-index just under the dock's 40.
- `scroll-snap-type:y mandatory` plus `scroll-snap-stop:always` on `.fl-card`.
- Gem-clean overrides:
  - Price pill top-right, carrying `data-act="margin"` (it gets wired in PR 2).
  - Auction pill bottom-left (`2d 4h · 7 bids`) for ShopGoodwill/auction items, built from the existing `.sgw-m` data.
  - ✕ top-left, star and share bottom-right.
  - `.fl-for` shrinks to a tag.
- Desktop ≥1024px: a 4-column square grid with no snap, and controls that appear on hover (always shown on touch).
- Dark-mode values per the spec, using the existing tokens (`:85`, `:1205` blue hour, midnight).

**Cards:**
- `flockCardHtml` (`:4662`) gets the one-line `fl-card` class hook.
- Also fix a latent bug: when a cached verdict exists, its `fpHtml(FP[url])` box should be stripped from Flock cards too. The exact-string strip misses it today.
- Add `role="feed"` on the row and `role="article"` plus `aria-label` (the title) on each card.
- Arrow/PageUp/PageDown keys move one card.

**Render:**
- `flockRender` (`:4667`) saves and restores `row.scrollTop` in feed mode. Only Shuffle resets the scroll to the top.
- An end card: "That's the flock." with a "Fresh look" button that shuffles.
- Fewer than 2 hunts: a full-screen empty card, "Add two hunts and the flock takes flight.", with a button back to PROWL.

**Feed | Saved toggle** in `.flock-head`:
- Saved renders from `prowl.finds` (`findsGet`, `:5377`), newest first, with the same snap layout.
- Unstarring removes the card immediately.
- Empty state: "Nothing saved yet. Tap the star on any find to keep it here."
- Remove `#otp-denFinds` and `rDenFinds` from the Den. Move its CSV export into the Saved view as a quiet text link at the end card, so the feature isn't lost.

**Discard:**
- New key `prowl.discarded`: an array of `data-u` keys, capped at 500 FIFO, read with `xGet`/`xSet`.
- `flockPool`/`flockCards` and the Saved view filter out discarded keys.
- Swipe:
  - Pointer events on `.fl-card` with `touch-action:pan-y`.
  - Commit at more than 35% of the card width or on a fast flick. Otherwise the card springs back.
  - After any move over 10px, a capture-phase click guard on the row stops the tap from opening the listing.
- ✕ button does the same thing on desktop.
- Discarding a starred item unstars it.
- Toast: `toast('Discarded. <button … id="otp-undis">Undo</button>',5000)`, with a delegated Undo handler.
- Reduced motion: no follow-the-finger or fly-off animation.
- Home search results are unaffected.

**Backup:** add `discarded` to `exportData` (`:3313`) as an additive field, bump `BACKUP_V` to 6, and default it in `applyBackup`. Clear-all also removes it.

**Tests** (`__tests__/page/flock.test.mjs`):
- dock swap
- open/close and home hidden or restored
- empty card for 0–1 hunts
- class hook and roles
- discard persists, filters, caps at 500, Undo works, unstar on discard
- click is suppressed after a swipe
- scroll preserved on re-render but reset by Shuffle
- Saved order and the badge count
- Den no longer shows finds
- backup round-trip for v5 and v6

## PR 2: Flock next steps (page v6.39). Spec: `prowl-flock-next-steps-spec.md`

**Margin sheet:**
- New bottom-sheet component: a `.sheet` aside that reuses the scrim `#otp-sc`, the `.dh` header and the drawer open/close mechanics (`hidden` → next frame `.on`, Escape chain `:3474`).
- On desktop the same element is centred.
- A delegated handler on `#otp-flockRow` for `[data-act="margin"]` calls preventDefault/stopPropagation.
- Pure `marginCalc(p)`: FVF 13.6%, processing 2.7% + $0.25, promoted 2%. Rounded to the cent.
- Label: "Assuming you resell on eBay". Big "You'd clear: $X".
- It closes on outside tap, swipe down or ✕.

**Watchlist:**
- `prowl.watchlist` holds `{u,t,p,s,watchedAt}`.
- The button switches between "Watch for price drop" and "Watching ✓" (on watch, the sheet also closes). Unwatch is in the same place.
- A "Watching" group appears under Saved.
- No alert copy anywhere. The watchlist goes into backup.

**New since last visit:**
- `prowl.flockSeen` holds up to 1000 keys, FIFO, written on `closeFlock`. Excluded from backup.
- NEW badge and a divider that isn't a snap point.
- No divider on the very first visit.

**Share:**
- Bottom-right of the photo, intercepted like the price pill.
- `navigator.share({title,text:price+' via Prowl',url})`, falling back to the clipboard plus a "Link copied." toast.

**Star while logged out → login:**
- `svToggle` (`:5469`) checks the existing login state (the `MAIL` token / `pxMe`, `:4333–4369`).
- When logged out, it stores the pending key in `sessionStorage` (`prowl.pendStar`) and goes to `loginUrl()`.
- On return, once the login check succeeds, it applies the pending star and shows a toast.
- Stars saved locally before this change stay visible.

**Tests:**
- `marginCalc` to the cent
- the sheet opens and the listing doesn't
- watchlist add/remove persists and appears under Watching
- seen/NEW logic, including the first-visit rule
- share and the clipboard fallback
- pending star survives a simulated login return

## PR 3: Salvation Army, marketplace #28 (worker v79, page v6.40). Spec: `prowl-salvation-army-spec.md`

1. **Probe first.**
   - Add `/__salvationtest` in the worker and run it with `worker-probe.yml`.
   - Add the Salvation Army to `.github/scripts/fetch-test.mjs`.
   - If Workers get a 403 (as happened with Depop), **stop and report** to Matthew. Don't silently ship link-only.
2. **Worker:**
   - `salvationCall(q)` fetches `https://shopthesalvationarmy.com/Browse?FullTextQuery=` with a Chrome User-Agent.
   - `salvationNormalize(html)` is a regex/string parser over the server-rendered cards, written in the same style as `poshmarkNormalize` (`:893`). It extracts title, `/Listing/Details/<id>/<slug>` URL, current bid, bid count, time left and image. Tested against a saved fixture HTML file.
   - Add `salvation` to the `SOURCES` map (`:4352`) with a 900s TTL.
  - Also add it to `liveSources()` and `LIVE_CALLS` in `index.js`, which drive the admin's Diagnose and hourly uptime checks.
  - Add `/salvation` → `live:salvation` to `routeKey` in `worker/metrics.js`.
  - Add it to `.github/workflows/scraper-health.yml`.
   - Add it to the email "Also search" and where-to-look lists (`:1115`, `:2459`).
3. **Page**, the full checklist:
   - `M` entry (bolo)
   - `platformIcons`, `SHORT`, `BADGE`, `EMPTY_LINKS`
   - `LIVE_SRC`/`LIVE_NAME`/`LIVE_HOSTS`. The Azure blob image host must be allowed in `cleanItems`.
   - `h38` migration flag in load and `save()`, so saved `st.mkt` sets gain it
   - SEO/JSON-LD/FAQ copy 27→28, and fix the stale "26" in `planTableHtml` (`:5787`)
   - `not-affiliated` list
   - Auction pill for Flock cards
4. **Extension:**
   - Add the Salvation Army to `sites.js`, and also the missing Mercari Japan.
   - Bump to 1.6.0 with a CHANGELOG entry. This goes in its own commit inside this PR.

## PR 4: Listing popup (worker v80, page v6.41). Spec: `prowl-ebay-popup-spec.md`

**Worker `GET /item?url=`:**
- Parses the source and id from the listing URL and only allows the 3 hosts.
- Checks the PCACHE first, kept for 24h. The key covers `gone` results too.
- Has a per-IP cap through the existing `capOk`.
- Registered as `/item` → `item:popup` in the `routeKey` table in `worker/metrics.js`. Debug routes (`/__itemtest`, `/__salvationtest`) get entries too if `routeKey` covers debug paths.

**eBay:**
- `GET /buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=` with `ebayToken()`.
- Header `X-EBAY-C-ENDUSERCTX: affiliateCampaignId=<EPN_CAMPAIGN_ID>`, so the response carries `itemAffiliateWebUrl`.
- Images come from `image` plus `additionalImages`. Check a real response with `/__itemtest` before relying on it.
- Returns `{title,price,images[],descriptionHtml,condition,aspects[],itemWebUrl,itemAffiliateWebUrl}`.

**ShopGoodwill:**
- Probe `shopgoodwill.com/item/<id>`. It's an Angular SPA, so the gallery is probably not in the HTML.
- If it isn't, use the buyer API item-detail endpoint (same host and UA as the search, `:213`/`:311`), which carries every image URL.
- Confirm with the probe either way.

**Salvation Army:** parse the `/Listing/Details/` HTML gallery (Azure blob URLs).

**Ended or unavailable listings** return `{gone:true}`. A 403 from a source is reported as an error and logged, never silently downgraded.

**Description sanitizer `cleanDesc(html)`**, exported and tested:
- Allowlist: `p br b strong i em ul ol li h3 h4`.
- Every attribute, script, iframe, form and style is stripped.
- Length capped.

**Page:**
- Tapping the card body opens the popup. Star, ✕, share and price taps keep their own actions. Only eBay, ShopGoodwill and Salvation Army cards use the popup; other sources keep their direct links.
- It uses the PR 2 sheet component (centred modal on desktop) with `role="dialog"`. Escape closes it and focus returns to the card.
- Gallery: scroll-snap on the main image plus a thumbnail strip, with hotlinked images.
- Title/price/condition/aspects. For auctions, the bid and time-left line.
- Description:
  - Collapsed to about 4 lines with Read more.
  - Re-sanitized on the page by building DOM nodes with `createElement` from a parsed allowlist walk (`<template>` parse, then copy allowed tags as text nodes). The raw HTML is never set through `innerHTML`.
- The Fair price? button (`fpAsk` `:3565`).
- The big "View on eBay ↗" button uses `itemAffiliateWebUrl`. ShopGoodwill and Salvation Army get clean links.
- A per-session memory cache on the page. Nothing is prefetched.

**Tests:**
- worker parsers on fixtures
- `cleanDesc` against a `<script>`/`onerror` payload
- cache hit means no second upstream call
- `gone` state
- page: body tap opens the popup, controls keep their actions, other sources link out directly

## PR 5: Affiliate router (page v6.42). Spec: `prowl-affiliate-links-spec.md`

- Add `AFF` and `prowlAff(url)` beside `prowlEpn` (`page/prowl.html:24`).
  - It runs `prowlEpn` first and keeps the https→`'#'` hardening.
  - Etsy, Reverb, 1stDibs and Depop (Rakuten deeplink, `mid=53555`) each get a per-network click-URL template.
  - **A `YOUR_` placeholder means pass-through**, so no broken links ship before Matthew supplies the tags.
  - Use `startsWith`/`indexOf`, ES5-safe, instead of `endsWith`.
  - An already-tagged URL is never double-wrapped.
- `prowlAff(url, {affUrl})` prefers `itemAffiliateWebUrl` for the popup.
- Switch all 9 `prowlEpn` call sites to `prowlAff` (`:1580, 1598, 1646, 1654, 2169, 3221, 3518, 5488`, plus the PR 1 Saved view). Also run `mk()` marketplace search URLs through it, so Etsy/Reverb/1stDibs search link-outs earn too.
- Disclosure:
  - The footer `p.copyr` (`:1390`) and Help (`:2142`) text is **built from the merchants that are actually active**, so it's always truthful.
  - Today it reads "eBay". Once tags land: "…links to eBay, Etsy, Reverb, or 1stDibs…".
- Tests:
  - placeholders pass through unchanged
  - a fake tag produces the correct Awin/Rakuten/Partnerize URL
  - non-https gives `'#'`
  - no-program hosts are untouched
  - the disclosure lists only active merchants

## PR 6: Login, the full brief (worker v81, page v6.43). Spec: `prowl-login-brief.md`

**Worker sessions:**
- New secret `PROWL_SESSION_SECRET` (Matthew sets it with `wrangler secret put`).
- `sessMint(cid)` makes `base64url(cid.exp.hmac)` with a 30-day expiry. `sessVerify(req)` checks structure, expiry and the HMAC with a constant-time compare.
- Mint the session in the existing verified paths (`/proxy/me`, `/proxy/login`, `:3425/:3434`) and return it as `token`.
- Reuse the existing `pxVerify` (`SHOPIFY_PROXY_SECRET`). Don't add a second HMAC scheme.

**Endpoints:**
- `/verdict`, `/research`, `/appraise` and `/alerts/*` accept `Authorization: Bearer`.
- Add `Authorization` to the CORS allowed headers (`cors()` `:255`). There's no clash with the admin, which uses its own `/admin` routes with a cookie and no CORS.
- IP daily caps stay as the backstop. A Bearer caller is identified by customer id.
- The existing e/t tokens keep working, because the extension depends on them (`member.js`).

**Pro from the customer id:**
- Since v78, `alPro` checks in this order: admin-granted gifts (`gift:<hash>`, `giftoff:<hash>`) and `PRO_EMAILS`, then the cache, then Shopify. `alProSet` records `sub.proCheck` when the store check fails. Keep that order and `proCheck` intact, and add the customer-id check **after the gift and list checks**.
- When the caller has a verified cid, `alPro` queries Shopify orders **by customer id** through the existing GraphQL client (`SHOPIFY_ORDERS_TOKEN`, SKU `PROWL-PRO-MONTHLY`, paid states, `:2776–2849`). This ignores the line-item tag, which closes the gifting hole.
- Cached in `pro:cid:<id>` for 6 hours, with `fresh=1` bypassing it.
- The email/tag path stays for email-only members.
- The brief's REST `variant_id` check is the same rule. Use the existing GraphQL client instead of adding a second API path, and confirm the variant/SKU mapping with Matthew.

**Page:**
- `prowl.session` is stored and excluded from backup like `prowl.owner`.
- It is sent as `Authorization: Bearer` next to `X-Prowl-Owner` in `OH()`/`fpAsk`/`mailStatus`.
- Header shows "Hi, {first name}" with Log out pointing at `/customer_authentication/logout`. Verify that URL against the theme.
- "I already upgraded" calls `alerts/status?fresh=1` with the Bearer token.
- Free AI price checks stay login-optional.

**Tests:**
- session mint/verify: good, expired and tampered tokens
- Bearer accepted on the routes
- Pro comes from the customer's orders and ignores a forged tag on someone else's order
- the e/t path is unchanged

## PR 7: Privacy gaps (worker v82). Spec: `prowl-privacy-pack.md`

- Full unsubscribe (no `h`) in `alUnsub` (`:3621`) now purges every KV key that points to the email, reusing the `/alerts/delete` purge list (`:3592`: `sub:`, `pend:`, `seen:`, `mvf:`, `cid:`) **plus `in:<email>` and `pro:<email>`**, matching the admin's delete action. Pull it into one shared purge helper so the three callers can't drift. Leave `gift:<hash>` alone, since gifts are owner-granted. It logs the key names and a timestamp, not the email. A per-hunt unsubscribe still removes only that hunt.
- List-Unsubscribe gains `<mailto:hello@owlandtwigvintage.com?subject=unsubscribe>`.
- Add the "Or just reply 'unsubscribe' to this email." line to the HTML and text footers.
- Verify (no code): the page sets no cookies of its own, and no trackers fire beyond Google Fonts and Shopify analytics. Report if the theme doesn't render Shopify's banner.
- Tests:
  - full unsubscribe leaves no KV key for the email
  - per-hunt unsubscribe keeps the record
  - one-click POST works
  - both headers are present

## PR 8: Amazon, kill-switched OFF (page v6.44, extension 1.6.x). Spec: `prowl-amazon-affiliate-spec.md`

- **Extension:** `AFF={amz:'YOUR_AMAZON_TAG', amzEnabled:false}`. The "Search Amazon" menu item is only created when it's enabled. Version bump and CHANGELOG entry.
- **Page:**
  - `AMAZON_TAG`, `AMAZON_ON=false` and `amzSearch()` per the spec.
  - The guide renderer (`gdRender`) shows a supply/book link only if the guide data has an explicit `supplies` field and `amzSearch` returns a URL. Nothing renders today.
- Tests: with the switch off, `amazon.com` appears nowhere in the page output or the extension menu.

---

## Matthew's tasks (corrected list)

1. ~~eBay app key~~: **already in the worker.** Only needs confirming that the Browse `get_item_by_legacy_id` call works with it (the PR 4 probe does this).
2. `wrangler secret put PROWL_SESSION_SECRET` (PR 6). This is a **separate secret from the admin's `ADMIN_KEY`**. Never reuse one for the other.
3. Affiliate networks: Awin (Reverb, maybe Etsy), Rakuten (Depop exception pending, maybe Etsy), Partnerize (1stDibs). He supplies the tags.
4. Amazon Associates: later.
5. Privacy admin: Shopify cookie banner, the privacy-policy paragraph, filing the Resend DPA. `ALERT_ADDRESS` is already set.

## Not in this update (from the roadmap)

- Target price alerts, the extension promo banner and `?open_card=` deep links are queued next.
- ⚠️ These need Matthew's decision against the design rules:
  - Unicorn/Steal badge (a quieter tinted price pill is suggested)
  - "SOLD — Missed It" ghosts
  - loss-framed margins
- Blocked: velocity indicators, a sold-comp engine, AI cross-posting.

## Verification (every PR)

1. `npm run lint`: `node --check` on the extracted page script, worker and extension, plus no `{{`/`{%` Liquid tokens.
2. `npm test` is green, including the new tests for that PR.
3. Serve `page/prowl.html` locally and drive it with Playwright Chromium (`/opt/pw-browsers`):
   - Mobile 390px and desktop 1280px.
   - Light, dark and midnight themes.
   - With and without `prefers-reduced-motion`.
   - A hard wheel/flick through 5+ cards stops on each one.
   - Screenshots compared with the mockups in `docs/update-2026-10-07/`.
4. Worker routes probed after deploy through `worker-probe.yml` (`/__salvationtest`, `/__itemtest`, `/item?url=`).
5. Things only Matthew can check on device: iPhone Safari honouring `scroll-snap-stop:always`, and affiliate clicks showing up in the network dashboards.
6. Commits follow the Conventional Commits format. Develop on `claude/trusting-lovelace-0d3cnd`. One PR per section above, opened only when asked.
