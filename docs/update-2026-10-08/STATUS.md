# Oct 8 briefing: where each item stands (checked 2026-10-09)

The Oct 8 briefing (`prowl-briefing-2026-10-08.md`) was checked item by item against the repo at page v6.63 /
worker v92 / extension 1.6.4. Each claim was then checked again by a second reviewer. New or changed files from that
briefing are in this folder; the unchanged ones (design rules, login, privacy pack, Flock next steps, Amazon) are in
`docs/update-2026-10-07/`.

## 1. Facebook sweep (new): built in worker v94 / page v6.65

- **Worker routes:** `POST /fb-ingest` and `GET /fb-finds?term=`, keeping each term's last 7 days of finds in the
  `PROWL_ALERTS` KV as `fb:<term>` (merged by listing id, so a find stays for the week even if that hunt is not
  opened the morning it came). The contract with the sweep is in the comment above `handleFetch` in `worker/index.js`.
- **Page strip:** a "Facebook Marketplace" section under the Goodwill block, newest first. When the last sweep found
  nothing new it says so for the right day ("today", "yesterday"), above the week's earlier finds. A sweep that
  stopped more than 2 days ago is hidden, and a hunt that was not swept shows nothing.
- **Who sees it:** only Matthew's devices (the `?owner=` key) by default, because the sweep runs through his own
  Facebook account. To show it to everyone, set `FB_FINDS = "public"` in `worker/wrangler.toml` and
  `PROWL_FB_PUBLIC=true` in the page.

Left for Matthew: set the `FB_INGEST_KEY` secret (24+ random characters) and give it to the sweep. Left for
Prowl-the-agent: the morning cron, the sweep and the seen-ID dedupe.

## 2. AI burst throttle (new): the hole is closed; the binding is not needed

The brief was written against the Oct 2 worker, where the per-visitor counters did nothing (the edge cache is a no-op
on workers.dev). Since then:
- worker v48: counters are in the Caps Durable Object (global, exact, fail closed), plus a per-network cap (IPv4 /24,
  IPv6 /48).
- v55: free Fair price is 1 per visitor per day.
- v72: each site pool can spend at most a sixth of its day in any hour, and over that answers 429 "busy now" with
  Retry-After.

One address now gets 1 free Fair price. Emptying the day's pool takes 400 addresses over at least 6 hours. The
Cloudflare rate-limit binding would only add per-minute pacing for Pro members and the owner key; Matthew can ask for
it.

Worker v93 closed the remaining gaps:
- A request refused before any paid call ("busy now", or a full network) gives the visitor's check back. A failed AI
  call does not, so a listing cannot be made to fail on purpose and retried for free.
- Research and the photo price step have a per-network cap.
- A test runs the real counters.

## 3. Copy

- **Static counts:** the page's static HTML said 26 in nine places. Browsers showed 28 once the script ran, but
  crawlers and text fetches did not. Fixed in page v6.64, along with "16 more" and the SHOP/BOLO tab labels.
  `__tests__/page/counts.test.mjs` now compares every static count with the running page.
- **"and 26 more" was right.** The line names two sites, and 2 + 26 = 28; the briefing's "27 more" would claim 29. It
  now reads "All 28, from ShopGoodwill auctions to Facebook Marketplace", with the live count.
- **Page title:** "Find Vintage Pieces Google Can't Search" is a Shopify page SEO setting (Online Store > Pages >
  Prowl > Search engine listing), not part of the page body. It is Matthew's call, and he should check the meta
  description in the same panel.
- **Chrome Web Store:** paste the text from `docs/chrome-store-listing.md`. It gives no count on purpose: the
  extension opens 27 sites (no Craigslist), so "28" would be wrong there. Remove any affiliate line, since 1.6.4 tags
  nothing.

Still open, for Matthew to confirm first: if `JEV_RESULTS` (AI sorting of live search results) is on, each live
search cache miss makes a paid sorting call from a 3,000-a-day pool. That pool has no hourly share and no per-visitor
count beyond the 2,500-a-day search cap. The cost stays bounded either way, and results show unsorted once it runs out.

## 4. Privacy pack: built before this briefing (v28 to v83)

Already in place:
- Footer, one-click headers and POST unsubscribe.
- The reply-"unsubscribe" line.
- The mailbox address, in `ALERT_ADDRESS` in `wrangler.toml`.

Worker v93 fixed:
- The purge left `moved:` and `mv:` records pointing at the address, and earlier addresses' Pro cache (`pro:`, which
  had no expiry; it now expires after 7 days). A newer change-of-address request retires the older link.
- Counters named after an email address (Pro limits, sign-in, confirm, move, test email, likes sync) now use a salted
  one-way code, per the no-addresses-in-counters rule.
- The alert clock logged addresses.
- A one-click unsubscribe with an old token answered 200.
- The https link now comes first in List-Unsubscribe.
- Reply-To defaults to hello@.

Still Matthew's:
- **Unsubscribe behaviour.** Unsubscribing turns emails off and keeps the account (Pro and sign-in survive); Delete in
  Den > Settings removes everything. So paste `docs/privacy-policy-prowl-section.html` into the privacy policy, not the
  pack's paragraph, which says unsubscribing deletes the record. That file was brought up to date for v93 / v6.64 (store
  sign-in, synced likes, earlier addresses, network limits, the analytics beacon).
- **Cloudflare Web Analytics beacon.** It is cookieless, but the policy should mention it.

## 5. Login: live since Oct 1

Store login through the app proxy shipped in worker v39 / page v5.84. Bearer sessions and Pro from the customer's
orders shipped in worker v82 / page v6.44.

The brief's secret names are not used: the code reads `SHOPIFY_PROXY_SECRET` and `SHOPIFY_ORDERS_TOKEN`. Left for
Matthew:
- confirm `PROWL_SESSION_SECRET` is set (32+ characters);
- tap Log out once on his phone.

Page v6.64 fixed three things:
- A customer with no first name got no greeting or Log out.
- There was no Log in link when signed out.
- A star held for the sign-in was not saved in the installed app until a reload.

## 6. Affiliates: every slot kept (Matthew, 2026-10-09)

Matthew: "I want affiliates, just keep them there as I apply for them." Etsy, Reverb, 1stDibs and Amazon stay as
switched-off slots in the admin Affiliates tab; only eBay is on.

- **Etsy:** its slot is built for Awin; if he is approved elsewhere, change the template before turning it on.
- **Depop:** stays out (Rakuten closed the account on 2026-10-09).
- **Den research links:** the Den's saved-research "Sold before" eBay links now go through the router (page v6.64).

## 7. Amazon: still off

Before turning Amazon on:
- the Field Guide has to return `supplies`, since the worker does not ask for them yet;
- the footer needs Amazon's own sentence ("As an Amazon Associate, Owl & Twig earns from qualifying purchases").

## Matthew's task list, corrected

1. `FB_INGEST_KEY` (the routes are live with worker v94), and whether the Facebook strip stays owner-only.
2. Chrome Web Store text (above), and confirm the store serves 1.6.4.
3. The page title (and meta description).
4. Postal address: done (`ALERT_ADDRESS`).
5. Login: only `PROWL_SESSION_SECRET` and one Log out tap. Nothing else; the custom app and proxy are live.
6. KV and Resend: done, both live.
7. Affiliate networks: apply when ready; each program is turned on in Admin > Affiliates with no code change.
