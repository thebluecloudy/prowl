# Prowl points: a plan (not built)

The owner's idea, from **Jellycat Purrks**, Jellycat's rewards scheme (launched January 2026). On Jellycat:

- members earn points for buying Jellies and finishing challenges;
- five tiers (the first is "Bronze Skater") and collectable badges;
- every product page shows a small chip, "Earn 620 points".

This file is the plan for the owner to approve or change. No code exists yet. When it is approved, take the next
free version number from `docs/STATUS.md`.

## The catch: Prowl never sees a purchase

Jellycat pays points on what you buy. Prowl sends people to eBay, Etsy and the rest, and never learns who bought
what. Affiliate reports are totals, never per person. So Prowl's points reward **hunting**, not buying.

## What earns points

| Action | Points | Read from |
|---|---|---|
| Run a hunt (once per term per day) | 5 | `prowl.runs` (already kept) |
| Save a find | 10 | `prowl.finds` (already kept) |
| Lock on a hunt in the Den | 15, once per hunt | `prowl.v36` lock list |
| Ask Fair price? | 5 | the Fair price cache |
| Watch for the next one on a listing that got away | 10 | `prowl.gotAway` |
| A Pounce match that is "it" | 25 | Pounce (signed in) |
| Prowl 7 days in a row | 50 | `prowl.runs` dates |

Most of these can be counted from data the page already keeps. A visitor would then start with the points their past
hunting earned, not with 0.

## Tiers (panther words; five, like Purrks)

| Tier | From |
|---|---|
| Cub | 0 |
| Scout | 250 |
| Stalker | 1,000 |
| Prowler | 3,000 |
| Black Panther | 10,000 |

## Badges (collectable, one each)

- First Pounce
- Night Prowl: a hunt after midnight
- Seven-day Prowl
- Full Den: 5 hunts locked on
- Best Pick Saved: you saved a Best pick
- The One That Got Away: you watched for the next one
- Fair Judge: 10 Fair price checks
- Every Corner: you hunted on 10 marketplaces

## Where it shows

- **Den › STATS:** a "Your points" card at the top: the tier, the points, how far to the next tier and the badges
  (earned in colour, the rest greyed).
- **Popup:** a small chip by the price, like "Earn 620 points": "Save it: +10 points". It only shows when saving
  would earn something.
- **Toasts:** "+10 points" when a find is saved; "You're a Stalker now" when a tier is reached. These obey reduced
  motion, like the hunt sparkle.
- How Prowl works gets a short "Points" part, and the glossary gets Points and the tier names.

## The decision for the owner: what can points buy?

1. **Bragging rights only (recommended first).** The tier, badges and perhaps a tier-only colour theme. Everything
   stays on the phone, as one new key, `prowl.points` (earned badges and a log of the one-time points). No worker
   change and nothing to cheat for, since points unlock nothing that costs Prowl money.
2. **Points for Pro days.** For example, 1,000 points for 7 days of Pro, using the worker's existing `giftPro`. The
   points then have to be counted by the worker, against the signed-in member's own actions, because anyone can
   edit their own localStorage. That is a larger, worker-side build (KV counters, limits per day, an admin view).
   It is only worth building if option 1 shows people care.

## Rules it keeps (CLAUDE.md)

- Only one new localStorage key; no old key changes. Backup export and import carry it, and older backups (without
  it) still load.
- No member PII leaves the device for option 1. For option 2, the worker stores counts by member id, never emails.
- ES5 page script; CSS scoped under `.scout-app-wrapper`.

## Questions for the owner

1. Option 1 first, or go straight to Pro days?
2. A name: "points", "paw points", or something else? ("Paw prints" already means "Prowl is still looking".)
3. Should a visitor's past hunting count, so they start partway up the tiers?
