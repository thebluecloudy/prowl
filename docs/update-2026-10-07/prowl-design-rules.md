# Prowl design rules — Matthew's standing rules for Claude

Reference this on every /prowl build. These outrank any spec's details when they conflict.

## The one rule

It should feel seamless — like they don't even know what's happening — while providing all this value. The machinery is never the product.

## Feel

- **One tap from intent.** No "pushing buttons then pushing more buttons to go."
- No spinners where content can stream in. No confirmations where undo exists.
- Empty states sound like a person ("Nothing saved yet. Tap the star…"), never a system ("0 items in collection").
- No badges, labels, or markers explaining the machinery.

## Money

- Monetization is plumbing, not product. Affiliate links behave exactly like normal links: same tab behavior, no interstitials, no markers.
- The only visible trace of the whole system is the footer disclosure — never inline, never a modal, never on first click.
- If a redirect or tag ever fails, fall back to the clean URL. Never strand the user.
- Free stays a real funnel: login gates Pro, alerts, and saved hunts only. Free AI price checks stay login-optional.

## Marketing

- Pitch what Prowl does for you, never what competitors can't do.
- Marketing video: text on screen over the real page, no AI voice. (AI voices stay in the private morning brief.)
