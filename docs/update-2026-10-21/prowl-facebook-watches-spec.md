# Prowl Facebook watches — spec

## What it is

Persistent monitoring of Facebook Marketplace for saved hunts, with alerts. A watch is a saved hunt plus metros, a price ceiling, and skip-words. The watcher's own browser re-checks the watch on a schedule; when a listing appears that was not there before and passes the filters, the watcher gets an alert carrying the listing and a price read.

The pattern, in one line: the search runs when asked; a watch keeps searching and speaks only when something new matches.

## Where the checks run — the core rule

Checks run in the watcher's own browser, through the Prowl Chrome extension, using the watcher's own logged-in Facebook session and their own connection. This is the only Facebook access model for customer watches.

- The extension fetches Marketplace search results the same way the watcher's browser loads them, parses the listings, and reports matches to the Prowl Worker.
- The server never requests anything from Facebook. It stores watches and listings, and sends alerts. Nothing else.
- The extension never reads, captures, or transmits Facebook credentials or cookies. It does not request the browser's cookies permission. Requests ride the existing session the way any page load does.
- No third-party scraper APIs, no stored sessions, no server-side browsing of Facebook. Not in this version, not as a fallback.

Matthew's own hunts keep running as the sweep spec (`prowl-facebook-sweep-spec.md`) defines — his account, his finds, the page strip. That pipeline is separate and unchanged. It never carries a customer's watch.

## The watch

Fields per watch:
- Term, or a goal sentence that resolves to a term.
- Metros: 1–3 per watch. Default is the watcher's local-pickup set (their ZIP area).
- Price ceiling (optional).
- Skip-words (optional): a listing matching any skip-word never alerts. Exclusions are part of the match, not a cleanup step after it.
- Cadence tier: Weekly, Daily, or Hot.

Watches are login-gated (per the login brief, alerts are a gated feature). Free accounts hold 1 watch at Weekly. Pro holds up to 25 watches at Daily, with up to 3 marked Hot.

A watch only checks while the watcher's browser is open. The product never claims otherwise: the Den shows each watch's last-checked time in human words ("checked 20 minutes ago"), and a watch that has not checked in over a day says so.

## Baseline rule

When a watch is created or its filters change, its first check fills the watch's current results silently. Those listings are the baseline and never alert. Only listings first seen after activation alert.

This is the difference between a watch and a search: nobody gets flooded with yesterday's listings on day one.

## Schedule

The extension schedules checks with the browser's alarm mechanism, per watch:

- Weekly: checked on the Monday run — the first browser session on or after Monday performs the check (catch-up, so a closed laptop on Monday morning never loses the week).
- Daily: once per day, on the first browser session of the day, plus a catch-up if the previous day was missed.
- Hot: every 30 minutes while the browser is open, jittered ±5 minutes per watch so checks never land on a metronome.

If the watcher is not logged in to Facebook when a check comes due, the check skips quietly and retries at the next interval. The watch shows "waiting for Facebook login" in the Den after two skipped checks. Nothing about the account is ever reported to the server beyond "logged in / not logged in" for that check.

## Reporting and dedupe

- On each check, the extension fetches the watch's configuration and seen-state digest from the Worker, runs its searches, diffs locally, and POSTs only candidate new listings to `/fb-ingest` authenticated by the watcher's Prowl session token (no shared secret for watches).
- The Worker diffs again against the authoritative per-watch seen state in KV. Only listings that survive both diffs alert. A listing reported twice — two browsers, a race, a retry — alerts once.
- Seen state retains 30 days, then ages out.

## Alerts

Channel in v1: email via Resend, plus the in-app surface.

- Hot watches: one email per new listing, sent on the check that found it.
- Daily and Weekly watches: one digest email per check cycle per user, collecting every watch's new finds.
- Alert content: photo, title, price, city, and the clean listing link (no affiliate tagging on Facebook links — there is no program). Plus the price read: the Fair price? verdict line on the listed basis, per the honesty rule, and the condition-not-priced-in and stale-listing flags when they fire. A "below the usual asking price" line appears only when computed from real nearby listings in reported data — never estimated.
- Every alert carries a one-tap Hide link. Hide feeds the same persistent discard list FLOCK uses, so a listing hidden from an email never resurfaces anywhere.
- New finds also land in FLOCK as new-since cards under the watch's hunt. Email and in-app never disagree.

## Page and extension UI

- Watches live in the Den with the saved hunts. Each hunt shows its watch state (Off / Weekly / Daily / Hot), metros, ceiling, skip-words, and last-checked time.
- Marking a watch Hot is one tap. The 3-Hot limit is stated where the toggle is, in human words.
- Each watch shows a small filtered count: how many listings its ceiling and skip-words held back since activation. This is how a watcher learns their filters are working.
- A watch on a browser without the extension shows one honest state: "Install the Prowl extension to turn this watch on," with the install link. No fake active state.
- Empty and paused states sound like a person, never a system.

## Data and routes

KV:
- `watch:<customerId>` → the customer's watches.
- `fbseen:<customerId>:<watchId>` → seen listing IDs with first-seen timestamps, 30-day retention.
- `fbfinds:<customerId>:<watchId>` → the watch's current finds for FLOCK and the Den.

Worker:
- Watch CRUD under the app-proxy session (per the login brief).
- `POST /fb-ingest` — session-authenticated for watches; the sweep spec's secret-authenticated ingest for Matthew's own hunts stays a separate route concern.
- Alert fan-out on ingest: diff, match, send via Resend, write FLOCK finds.

Extension:
- Host permission for facebook.com only, plus the Prowl origin for reporting. No cookies permission, no browsing-history permission, no other hosts.
- Holds no state that matters: watch configuration and seen digests are fetched from the Worker each cycle, so a cleared browser loses nothing.

## Disclosure

- The Chrome Web Store listing states plainly what the extension does: it runs the user's saved Facebook Marketplace searches in their browser and sends matching listings to their Prowl account. This sits alongside the affiliate disclosure already required on the listing.
- The privacy policy gains one paragraph: watches run in the user's own browser; Prowl never receives or stores Facebook credentials; the listings a watch matches are stored against the user's Prowl account until the watch is deleted.

## Who does what

- **Claude:** the extension checker (alarm scheduling, Marketplace result parsing, local diff, reporting), watch registry and Worker routes, alert fan-out and email templates, Den UI, FLOCK new-since integration, Web Store listing copy, the privacy paragraph.
- **Matthew:** the standing setup items that already gate alerts — KV namespace bound to the Worker, a Resend account. (The `FB_INGEST_KEY` secret belongs to the sweep spec only; watches do not use it.)
- **Prowl (agent):** nothing in the runtime path. Prowl's Facebook access remains only Matthew's own hunts, as the sweep spec defines.

## Non-goals

- No server-side Facebook access for customer watches, in any form.
- No credential or session handling, anywhere, ever.
- No per-minute cadence. Hot at 30 minutes while the browser is open is the v1 ceiling.
- No Telegram, Slack, or Discord channels in v1. Email and in-app first.
- No seller contact or offer automation of any kind.
- No mobile checking in v1: phone browsers do not run the extension, so watches check from the user's desktop browser. Stated honestly in the UI, never papered over.

## Verify

- Installing the extension and creating a watch fills the baseline silently: zero alerts for listings that already existed.
- A listing posted after activation alerts within one cadence interval of the next browser check (Hot: ≤ ~35 minutes with the browser open), with photo, price, city, and the verdict line.
- Listings matching a skip-word or priced above the ceiling never alert, and increment the watch's filtered count.
- The same listing reported from two browsers alerts once.
- Network inspection during a check shows requests to Facebook only from the browser, and to Prowl only carrying watch configuration and listing data — no cookies, no credentials, in either direction.
- A watch with the browser closed for two days shows its real last-checked time and performs a catch-up check on the next session.
- Hide from an email removes the listing everywhere, including FLOCK.
