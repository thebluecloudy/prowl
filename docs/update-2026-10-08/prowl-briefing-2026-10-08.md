# /prowl briefing — Thursday 2026-10-08

> **Repo note (2026-10-09):** what was already built, what is new, and what was decided is in `STATUS.md` next to this
> file. Unchanged specs this refers to are in `docs/update-2026-10-07/`.

For Claude. Read top to bottom, build in order. Detailed specs are separate files — this is the map.
Yesterday's briefing (`prowl-briefing-2026-10-07.md`) plus yesterday's build is verified live tonight; this only covers what changed.

## 0. Read first: design rules

Matthew's standing rules, outrank any spec when they conflict (`prowl-design-rules.md`):

- **Seamless.** The machinery is never the product.
- **One tap from intent.** No multi-step button flows.
- No spinners where content can stream in. No confirmations where undo exists.
- Empty states sound like a person, never a system. No badges explaining the machinery.
- **Money is plumbing, not product.** Affiliate links behave exactly like normal links. Footer disclosure only. If tagging fails, fall back to the clean URL.
- Free stays a real funnel: login gates Pro, alerts, saved hunts only.
- Marketing: pitch what Prowl does for you, never what competitors can't do. Text on screen over the real page, no AI voice.

## Live status check (verified 2026-10-08 ~7:30 PM ET)

1. **SEO fix FAQ half is live.** The "What is Prowl?" answer is now benefit-led (no "Google search rarely reaches"). JSON-LD half not verifiable from a text fetch — confirm in the source.
2. **Hero copy is stale: says 26, live count is 28.** Three spots on the same page:
   - "Search 26 vintage marketplaces at once. Free."
   - "…builds the same search for all 26 vintage marketplaces on one screen…"
   - "ShopGoodwill auctions, Facebook Marketplace and 26 more, searched directly."
   The FAQ on the same page already says 28. Change 26 → 28, "26 more" → "27 more". (Chrome Web Store listing still says 26 too — that's Matthew's manual edit in the store dashboard, plus the affiliate-disclosure line Google now requires post-Honey policy.)
3. **Title tag still says "Prowl — Find Vintage Pieces Google Can't Search."** The Oct-7 fix didn't cover it. It violates his no-competitor-framing rule — flag for his call, don't change it without his say-so. Suggested direction: "Prowl — Search 28 Vintage Marketplaces at Once | Owl & Twig Vintage" — Matthew rules.
4. **Depop links are clean right now.** Matthew stripped the Rakuten tags himself this evening (account terminated — see below). Footer disclosure "Some links to eBay earn Owl & Twig a small commission" is currently accurate; extend it to name merchants again only when tags go back on (per `prowl-affiliate-links-spec.md`).

## Build order

### 1. FB sweep — `prowl-facebook-sweep-spec.md` (NEW, Oct 8)
The big open item. No external dependency except Matthew pasting one secret.
- New Worker routes: `POST /fb-ingest` (shared-secret auth) and `GET /fb-finds?term=` (served from KV).
- Page renders an FB strip in the live panel.
- Daily agent cron on my side runs `facebook-cli marketplace search` over his locked hunts, dedupes, POSTs to /fb-ingest. That cron is mine to set up — build the two routes + the strip.
- **Matthew's action:** paste the Worker secret once the routes are ready. Nothing else.

### 2. Burst throttle — `prowl-ai-burst-throttle-brief.md` (still open)
Paste-ready, no setup from him. The 400/day sitewide AI cap is burnable (verified: burst rounds all returned 200, no per-IP throttle, no rate-limit headers). If this isn't built yet, it's the single biggest live hole — build it before anything discretionary.

### 3. Privacy pack — `prowl-privacy-pack.md` (approved Oct 3)
Claude's half: email footer + one-click unsubscribe headers, POST unsubscribe, KV purge on unsubscribe. Still needs his postal address in the footer copy (a PO box works) — ask him, don't ship with a placeholder.

### 4. Login — `prowl-login-brief.md` (unchanged)
New Shopify customer accounts + app proxy. Still blocked on his two setup steps (see "Matthew's tasks"). No movement expected from Claude until then.

### 5. Flock next steps — `prowl-flock-next-steps-spec.md` (unchanged)
Margin sheet, price-drop watchlist, NEW badges, share, logged-out star → Shopify login. Already specced; build after item 2.

### 6. Affiliate router — `prowl-affiliate-links-spec.md` (status: PAUSED for Depop; repo note: Rakuten closed 2026-10-09, see the spec's note)
- **Depop is on ice.** Rakuten terminated Matthew's whole publisher network account today (boilerplate, no specific violation). Appeal sent to ra-compliance@rakuten.com with Depop's Louis Spencer's approval attached; Louis nudged too (he's in London — reads it Friday morning UK time). **Scheduled recheck: Oct 14, 9 AM ET.**
- In the code: mark the Depop Rakuten deeplink (mid=53555) path PAUSED. Clean-URL fallback is the current live behavior — keep it until reinstatement is confirmed, and ask before re-tagging.
- Etsy/Reverb tagging: unchanged, still waiting on his network setups (see tasks).

### 7. Amazon — `prowl-amazon-affiliate-spec.md`
Still kill-switched OFF. No change.

## Matthew's tasks (ask him — don't work around)

1. **Worker secret** → unblocks item 1. One paste when the routes are ready.
2. **Chrome Web Store listing** → 26 → 28 marketplaces + affiliate disclosure line. His manual edit.
3. **Title tag call** → "Find Vintage Pieces Google Can't Search" vs benefit-led. His call.
4. **Postal address** → privacy email footer (item 3). PO box works.
5. **Shopify: new customer accounts ON + custom app** (Dev Dashboard, read_customers + read_orders, app proxy) → unblocks item 4.
6. **Cloudflare KV namespace + Resend account** → unblocks saved-hunt alerts / watch-for-price-drop.
7. **Awin / Partnerize / Rakuten networks** → Etsy, Reverb tags. Rakuten specifically: wait for the Oct-14 recheck.
8. **Six social posts delivered today** — his move (Instagram, Facebook, Threads ranked top).

## Later roadmap (unchanged)

Target price alerts, extension banner, `?open_card=` deep link (queue next). Web push + state sync need KV + login first. The ⚠️ constitution-tension items (steal badges, SOLD ghosts, loss-framed margins) are still his call. Velocity indicators and the sold comp engine stay parked (no legitimate data source).

**One research note for Matthew, not a build item:** eBay closed its $1.2B Depop acquisition July 30, 2026 (he already has this context from Oct 7) — if Rakuten doesn't reinstate, the EPN route for Depop is the known fallback. No action until the Oct-14 recheck.

## Global verify

- Every spec's own verify list, then: no "26" anywhere on the page; FB strip renders only real listings; Depop links are clean URLs; JSON-LD description is the benefit-led version; title tag matches whatever Matthew ruled.
- Burst throttle: repeat the three burst rounds — all should now 429 or throttle, not 200.
- Nothing in the UI names the machinery. iPhone Safari: snap-stop honored; `prefers-reduced-motion` throughout.
