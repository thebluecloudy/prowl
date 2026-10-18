# Ideas

New products and big features the owner wants to keep in mind. They are not planned, and no version numbers are
claimed. `docs/FUTURE-WORK.md` holds smaller Prowl features that were planned and then parked. When one of these
ideas starts, write a spec next to it and claim version numbers in `docs/STATUS.md` as usual.

## 1. A listing service for antique dealers

*Noted 2026-10-18. The owner: "I want to make an online antique store listing service", "I am trying to be
ambitious", using AI to do what used to take a company of people. Open: the owner has their own idea for the dealer
side, still to be written down here.*

**The pitch.** A dealer snaps a piece. About 60 seconds later it is listed, priced, checked for reproductions, and
in front of every collector hunting for it.

**Why it could work.** Prowl already has the buyers: collectors with saved hunts, email alerts and Pounce. A new
listing can go straight to the people looking for it, which Etsy and eBay cannot promise a seller. Listing is the job
dealers hate, and Prowl already does the hard parts:
- naming the piece, its maker and era (photo check, `/appraise`);
- pricing it (Fair price);
- checking for reproductions (the reproduction tag, `jevClean`).

**Jobs AI does instead of staff.**
- **Writing listings:** title, description and condition from 3 photos.
- **Authentication:** a reproduction check on every listing.
- **Trust and safety:** listings and messages screened for scams, fakes and banned items such as ivory. Only the
  unclear cases go to the owner.
- **Support:** an AI assistant for buyers and sellers that hands the owner what it can't answer.
- **Marketing:** a search-friendly page and a social post for every listing.
- **Matching buyers:** hunts and Pounce do it.

What stays human: winning the first dealers, the final say on disputes and bans, and the money and legal setup.

**Money: don't hold the buyers' money at first.** Do what BGG's GeekMarket does: the buyer pays the seller directly
(GeekMarket listings take PayPal, check or COD), and BGG bills the seller a share of the sale afterwards, 3% in its
seller guide. Charge dealers instead, for example $15–30 a month. Taking payments means refunds, chargebacks, fraud,
payouts to sellers, and probably collecting sales tax as a marketplace. Add checkout through Stripe Connect only once
there is volume.

**Steps.**
1. Talk to 10–20 dealers before building (Michigan antique malls and booth dealers). Would they pay to have their
   pieces matched to collectors' hunts?
2. Snap-to-listing for 20 dealers, free. Their listings show in Prowl's results and are matched to hunts.
3. Charge $15–30 a month once their pieces sell faster.
4. Post the same listing to eBay and Etsy too. Tools like Vendoo and List Perfectly already sell cross-listing to
   dealers, but they don't identify the piece or find buyers for it.
5. Checkout, once volume justifies it.

**Build notes.** Use its own repo, not `page/prowl.html` (that page is ES5, size-capped and already crowded). Run it
on Cloudflare like the worker: a Worker, D1 for listings and accounts, and R2 for photos. Prowl reads its listings
as one more live source, the way it reads Salvation Army (`LIVE_SRC`, `LIVE_CALLS`).

## 2. Auto-sniping for auctions

*Noted 2026-10-18. The owner's idea; no details yet.*

**The idea.** The collector sets the most they will pay for an auction, and Prowl bids for them in the last
seconds, so the price isn't pushed up early. Prowl already shows bids and time left for eBay, ShopGoodwill,
Salvation Army and HiBid auctions, and Pounce already finds the right listings.

**Questions to answer first.**
- **Can a third party bid at all?**
  - eBay: bidding for a user goes through eBay's Buy Offer API, which needs eBay's approval. Check the current terms.
  - ShopGoodwill, Salvation Army and HiBid: there's no public bidding API. Bidding would need the member's own login,
    and each site's terms may forbid automated bids. Check them.
- **Credentials:** never store members' marketplace passwords. Use the site's own sign-in (OAuth) where it exists.
  Where it doesn't, the plain version below is the safe one.
- **Timing:** the worker's cron runs every 5 minutes (`worker/wrangler.toml`), which is far too coarse for a snipe.
  Bidding to the second needs something like Cloudflare Durable Object alarms.
- **Fees and liability:** a missed or wrong bid is real money, so the terms of service need to cover it.

**A safe first version: snipe reminders.** No credentials and no bidding by Prowl. A phone alert about 2 minutes
before the end, carrying the member's max price, with one tap to the listing's bid page. It reuses push and Pounce,
and shows whether members want real sniping before any of the above is built.
