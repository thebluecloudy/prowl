# Prowl

Free vintage sourcing tool for [Owl & Twig Vintage](https://owlandtwigvintage.com/pages/prowl): one search runs
across every vintage marketplace Prowl covers, from one screen.

## What this repo is

| Path | What it is |
|---|---|
| `page/prowl.html` | The live Prowl page body (`PROWL_VERSION` in it). See `page/README.md`. |
| `worker/` | The Cloudflare Worker: live search, AI checks, Prowl Alerts, the store sign-in, the admin area. |
| `extension/` | The Chrome extension. See `extension/README.md`. |
| `docs/` | Project instructions, the store listing, the privacy section, and each briefing with its status (`docs/update-*`). |
| `src/prowl_body.html` | An archive of page v5.2 (September 2026). Not live; do not edit it. |

`npm test` runs the page, worker and extension tests; `npm run lint` checks the scripts.

## Deploying a change

The page deploys itself. Every push to `main` that touches `page/*.html` runs
`.github/workflows/deploy-page.yml` (`scripts/deploy-page.mjs`), which sends the page
through `pageUpdate` and checks it landed. Shopify refuses a page body over 512 KB, so
what is sent is the page without its comments (`scripts/slim-page.mjs`); the copy in
the repo keeps them. `node scripts/slim-page.mjs` prints both sizes and the room left,
and `npm test` fails if the page without comments is over the limit.

The worker deploys through Cloudflare Workers Builds on every push to `main` (`worker/wrangler.toml`). Merging a PR is
therefore a live release of both.

## Stack

Vanilla JS, conservative syntax (`var`, classic functions, string concatenation).
Deliberately no TypeScript, React, modules, bundler, or npm dependencies — older
mobile browsers matter for thrifters in the field.

## Chrome extension
`extension/` holds the Prowl Chrome extension (a Prowl Pro bonus). It has its own version in `extension/manifest.json`; merging a change to `main` publishes a GitHub release `ext-vX.Y.Z` with the store-ready zip. See `extension/README.md`.
