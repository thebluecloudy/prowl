# Prowl

Free vintage sourcing dashboard for [Owl & Twig Vintage](https://owlandtwigvintage.com/pages/prowl) — searches 24 marketplaces from one screen, including the ones Google doesn't index.

## What this repo is

A backup and version history of the Prowl source. The live app is a single self-contained HTML block pasted into a Shopify Custom Liquid section — there is no build step, no backend, no dependencies. All user data lives in `localStorage`.

- `src/prowl_body.html` — the complete page body, exactly as it sits in Shopify
- `docs/project-instructions.md` — architecture guardrails, data contract, verification checklist

## Current state

| | |
|---|---|
| Version | v5.2 |
| Source pulled from live | 2026-09-20T21:22:28Z |
| Size | 116,040 bytes |
| md5 | `465737d88d5af5265c1ba7ca3c876e81` |
| Marketplaces | 24 |
| Shopify page ID | 137091285246 |
| Page editor | https://admin.shopify.com/store/owlandtwigvintage/pages/137091285246 |

`src/prowl_body.html` is a byte-for-byte copy of the live page body at the time
above. Verify drift by refetching `page.body` and comparing the md5.

## Known gap in v5.2

The Field Guide posts link into Prowl with the search term already chosen —
`/pages/prowl?q=hen%20on%20nest` — and 64 of the 92 published guides do this,
26 prefilled links in total. **v5.2 reads nothing off the query string.** There
is no `URLSearchParams`, no `location.search`, no term parser anywhere in the
body, so every one of those links lands on an empty Prowl.

`docs/project-instructions.md` states the intended behaviour under *Behavior*
("URL prefill populates the input; the user must tap Search") and the
verification checklist tests for it, but the code has never implemented it.

## Deploying a change

1. Edit `src/prowl_body.html`
2. Run the verification checklist in `docs/project-instructions.md`
3. Paste the whole file into the Custom Liquid section of the Prowl page
4. Save, then refetch the live body and diff against this file

The `pageUpdate` GraphQL mutation fails on a body this size, so the paste is the
deploy path. A carrier artifact with a copy-to-clipboard button is the usual way
to move the bytes without retyping them.

## Stack

Vanilla JS, conservative syntax (`var`, classic functions, string concatenation).
Deliberately no TypeScript, React, modules, bundler, or npm dependencies — older
mobile browsers matter for thrifters in the field.
