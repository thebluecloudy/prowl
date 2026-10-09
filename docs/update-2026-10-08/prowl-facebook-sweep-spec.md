# Prowl Facebook sweep — spec (2026-10-07)

## What it is

Facebook Marketplace finds flow into Prowl on their own. A daily sweep runs his locked hunts against Facebook Marketplace through his connected Facebook account and lands the new finds in the Prowl page, next to the Goodwill panel. No login walls, no manual retyping.

Why this shape: Meta never shipped a Marketplace API, so the public Prowl page can never query Facebook server-side. The account connection lives on Prowl-the-agent's side, not the Worker's. So the agent does the sweeping and hands clean JSON to the Worker; the page just renders it.

## Pipeline

```
cron (daily ~9:05am ET, after the panther hunt)
  → facebook-cli marketplace search (his connected account)
  → dedupe vs seen state
  → POST digest to Worker /fb-ingest (shared secret)
  → Worker stores in KV, serves GET /fb-finds?term=
  → Prowl page renders an FB strip in the live panel
```

## Scope (v1)

- **Terms:** his locked hunts — the same list DAILY runs. One list to keep.
- **Coverage:** same metro set the morning panther hunt uses (14 US metros), `--limit 15` per term per metro, `--max-listing-age-in-days 7`. Volume stays modest; his account is the actor.
- **New finds only:** listing IDs deduped against a per-term seen list (30-day retention). Nothing resurfaces.
- **Read-only:** no seller messages, no saves, no purchases. Ever.

## Data contract

Cron POSTs to `/fb-ingest`:

```json
{
  "term": "ceramic black panther",
  "updated": "2026-10-08T13:05:00Z",
  "items": [
    {"id": "1234567890", "title": "...", "price": "$150",
     "url": "https://www.facebook.com/marketplace/item/1234567890",
     "image": "https://...", "location": "Detroit, MI", "found": "2026-10-08"}
  ]
}
```

Page reads `GET /fb-finds?term=<term>` → `{term, updated, items[]}`. 24h cache on the page; the strip shows "updated this morning" style human timestamps, never raw datetimes.

## Page UI (Claude)

- A compact "Facebook" section inside the live panel, below the Goodwill results. Reuse the existing card styles (photo, price pill, title, location line).
- Card tap → listing opens in a new tab (his browser is logged in, so no wall). **No affiliate tagging on FB links** — there is no program; links stay clean per the money-plumbing rule.
- Empty state sounds like a person ("Nothing new on Facebook for this hunt today."), never a system message.
- Reduced-motion honored; works in both themes.

## Auth

- Sweep side: no new secrets — uses the agent's existing Facebook connection.
- Ingest side: shared secret. Claude generates it, Matthew sets it as a Worker secret (`wrangler secret put FB_INGEST_KEY`) — never in chat, never in the page code. `/fb-ingest` rejects without it. Rate-limit the route.

## Who does what

**Prowl (agent):** the cron, the sweep script, dedupe state, the POST.
**Claude:** `POST /fb-ingest` + `GET /fb-finds` Worker routes (KV-backed), the page strip, secret wiring.
**Matthew:** one paste — the Worker secret. And his existing Facebook connection stays as-is.

## Non-goals

- No Facebook inside the anonymous public page path (no session to use; link-outs already work for logged-in visitors).
- No alerts/push in v1 — the strip is the surface. Target-price alerts come later on the KV+Resend backend already planned.
- No third-party scraper APIs (ToS-violating, flaky — not a foundation).

## Verify

- Sweep runs green 3 days straight; new listings appear in the strip the same morning; seen IDs never resurface.
- `/fb-ingest` 403s without the secret; 413s on oversized bodies.
- Strip renders in both themes, reduced-motion on, mobile + desktop.
- A term with zero new finds shows the human empty state, not a blank hole.
