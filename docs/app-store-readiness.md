# Prowl on the App Store: readiness checklist

*Started 2026-10-10. The goal: someone asks "is it on the App Store?" and the answer is yes, with Owl & Twig Vintage
as the seller. This comes after the current bugs and ideas are done.*

Tools already on hand: **Applyra** (applyra.io, free tier: App Store and Google Play keyword research and rank
tracking) and **RevenueCat** (free tier: in-app purchases and subscriptions on iOS and Android).

Work down the phases in order. Anything marked **decide** is Matt's call before the work under it starts.

---

## Phase 0: Decisions to make first

- [ ] **decide: Who is the seller?** Enrol as an *organization* so the store shows "Owl & Twig Vintage", not a personal
      name. That needs a legal entity (an LLC or similar) and a free D-U-N-S number, which can take a week or two to
      come through. If the shop is not a legal entity, enrol as an individual now and move to an organization later
      (Apple can convert the account, but it takes a support request).
- [ ] **decide: The store name.** `prowl.app` is taken (Matt checked 2026-10-10), and plain "Prowl" is very likely
      taken on the App Store too. Store names must be unique and are at most 30 characters, plus a 30-character subtitle.
      Candidates to check in Applyra and App Store Connect:
      - "Prowl: Vintage Finder"
      - "Prowl by Owl & Twig"
      - "Prowl – Thrift & Antique Alerts"
      Do not put "Goodwill", "eBay" or another company's name in the name or subtitle: Apple rejects other companies'
      trademarks there. They can go in the description.
      **What the App Store search showed (Matt, 2026-10-10):** at least eight apps already start with "Prowl", each
      with a suffix: "Prowl (Press9)", "Prowl: Location Assistant", "Powell Prowl: Rate Chase", "Prowl: Easy Push
      Notifications" (Prowl Solutions LLC), "Prowl - Horror Hide & Seek IRL", "Prowl - Web Monitor", "Prowl: Job
      Application Tracker", "Prowl (96a41b)". So:
      - Plain "Prowl" is gone; "Prowl: <what it does>" is the normal pattern and is allowed.
      - The suffix has to say vintage at a glance. "Prowl - Web Monitor" also watches sites and alerts you, so
        "Prowl: Alerts" or "Prowl: Price Watch" would blur into it.
      - **Check trademarks before committing to the name.** Prowl Solutions LLC has a long-running "Prowl"
        notification app and a company named Prowl. Search the USPTO trademark database (tmsearch.uspto.gov) for
        PROWL in classes 9 (apps) and 42 (software services), and ask a trademark attorney if anything live comes up.
        "Prowl by Owl & Twig" ties the name to the shop, which helps whatever the search finds.
- [ ] **decide: How Prowl Pro is sold in the app.** Today Pro is a Shopify product (`/products/prowl-pro`) with a free
      month. Apple's rule (Guideline 3.1.1) is that digital features bought in an iPhone app go through Apple's in-app
      purchase. Options:
      1. **In-app purchase through RevenueCat** (Apple takes 15% under its Small Business Program). The worker must then
         treat a RevenueCat Pro entitlement the same as a Shopify Pro membership.
      2. **US only: a link out to buy on the website.** Apple has allowed this in the US since 2025. Read the current
         wording of 3.1.1(a) and 3.1.3 on the day you submit, because it keeps changing.
      3. **Both:** in-app purchase in the app, plus the Shopify product on the web, one Pro account.
      Whatever is chosen, a person who already pays on Shopify must get Pro in the app after signing in
      (Guideline 3.1.3(b), multiplatform services).
- [ ] **decide: A domain of Prowl's own.** A short address is easier to say out loud than
      `owlandtwigvintage.com/pages/prowl`. It also solves two technical problems below (universal links and Android's
      Digital Asset Links both need files at `/.well-known/` on the domain, which Shopify pages cannot serve). The worker
      could serve those files on a domain pointed at Cloudflare. Check availability before getting attached to a name.
- [ ] **Reserve the name early.** Creating the app record in App Store Connect holds the name for you, even before the
      app is built. Do it as soon as the developer account is active.

## Phase 1: Accounts and setup

- [ ] Apple Developer Program: $99 a year (developer.apple.com/programs).
- [ ] A Mac with Xcode, or a cloud build service (Codemagic, Ionic Appflow, or GitHub Actions macOS runners), to build
      and sign the iOS app.
- [ ] App Store Connect: create the app record (bundle ID, for example `com.owlandtwigvintage.prowl`, which cannot be
      changed later) and reserve the name.
- [ ] RevenueCat: create the project, connect App Store Connect (App Store Connect API key plus in-app purchase key),
      define the `pro` entitlement and its products (monthly, annual, and a lifetime option if you want one).
- [ ] Applyra: add the candidate names and keywords. Look up "vintage", "thrift", "antique", "estate sale",
      "goodwill finds", "collectibles" and similar terms, and note difficulty and traffic.
- [ ] Google Play Console: $25 once. **New personal accounts must run a closed test with at least 12 testers for 14
      days in a row before they can publish to production.** Line up 12 testers (friends, customers) early.

## Phase 2: Build the app shell

The page is one self-contained HTML file, which suits a wrapper app well. The plan is
[Capacitor](https://capacitorjs.com): it wraps a web page in a native iOS/Android app and adds native features as plugins.
The page stays vanilla JavaScript.

- [ ] **Bundle the page inside the app, don't just load the website.** An app that only shows a remote website is the
      most common rejection (Guideline 4.2, minimum functionality). Ship `prowl.html` in the app and have it call the
      worker for live data, the same as now.
- [ ] Audit what the page expects from Shopify, which it will not have inside the app:
  - [ ] relative links (`/products/...`, `/pages/...`, `/`)
  - [ ] the `/products.json` fetch for the found strip
  - [ ] the store sign-in, and how a signed-in member is known
  - [ ] the curtain intro and the app shell (`/pages/prowl-app`, the home-screen install offer, which should be hidden
        in the app)
- [ ] An app flag so the page knows it is in the app: hide the install offers ("Get the app", "Add Prowl to your
      home screen"), and Ko-fi if Apple objects to tip links.
- [ ] App icon (1024×1024, no transparency) and launch screen: the panther.
- [ ] Links out to marketplaces open in the system browser or the marketplace's own app, not inside Prowl.
- [ ] Popup stagger ("Open all") still works when it opens external links from the app.

## Phase 3: The native features that justify the app

These are what make Prowl more than a website in a box, which is what App Review checks.

- [ ] **Push notifications with the item's photo** when a hunt finds something (the panther brings back its catch).
  - iOS: APNs. Photos in notifications need a Notification Service Extension that downloads the image.
  - Check whether the Cloudflare worker can call APNs directly (APNs requires HTTP/2). If not, send through Firebase
    Cloud Messaging, which delivers to both iOS and Android over a plain HTTPS call.
  - Store each device's push token against the member's hunts in the worker, next to the email alerts.
  - Ask for notification permission only after the first hunt is saved, with a sentence on why ("so the panther can
    tell you when it finds a Roseville jardiniere"), not on first launch.
- [ ] **Share sheet** for finds (already uses `navigator.share`; check it in the wrapper).
- [ ] Optional, later: a home-screen widget showing the latest catch.

## Phase 4: Privacy, accounts and permissions

- [ ] **Privacy policy URL.** Extend `docs/privacy-policy-prowl-section.html` to cover the app: push tokens, what the
      worker stores, RevenueCat, crash reporting if any.
- [ ] **App privacy labels** in App Store Connect ("nutrition labels"): list every kind of data collected (email for
      alerts, purchase history, device token, any analytics) and whether it is linked to the person.
- [ ] **Account deletion in the app.** If the app lets someone create an account or sign in (alerts, Pro), it must
      also let them delete it from inside the app (Guideline 5.1.1(v)). A link to an email address is not enough.
- [ ] **Sign in with Apple** is required only if the app offers a third-party social login such as Google or Facebook
      (Guideline 4.8). Signing in to Owl & Twig's own store account does not trigger it. Re-check if a social login is
      ever added.
- [ ] Location (Den › Local, the city for Craigslist/Facebook): if the app asks for it, write the permission text, and
      keep "type your city" working for people who say no.
- [ ] Camera (photo search): permission text for the camera and the photo library.

## Phase 5: Content and data rights

App Review can ask whether you are allowed to show other sites' listings and photos (Guideline 5.2). This is also part
of the trust the app is meant to build.

- [ ] For every live source (ShopGoodwill, eBay, Etsy, Chairish, Poshmark, Vinted, Grailed, Salvation Army, Facebook
      sweep, garage sales), write down how the worker reads it (official API, public feed, or the site's own page) and
      what that site's terms say about it. gsalr.com was already dropped for this reason (worker v101).
- [ ] Prefer official APIs where they exist (eBay Browse API, Etsy Open API) and keep their attribution rules.
- [ ] Link-out-only marketplaces (they open in the browser) carry no data risk; note them as such.
- [ ] Affiliate programs: check each program's rules on mobile apps, as was done for email and the extension (Rakuten
      bars its links in email without written permission; see `page/README.md`, Affiliate tags).

## Phase 6: The store listing

- [ ] Name and subtitle (from Phase 0, checked in Applyra).
- [ ] Keywords field: 100 characters, commas, no spaces, no words already in the name. Build it from Applyra.
- [ ] Description: start with the hunter and the panther: you say what you want, the panther hunts while you live your
      life, and it brings back what it finds. Collector framing, never reseller framing.
- [ ] Screenshots: 6.9-inch iPhone set is required (1320×2868 or 1290×2796); iPad set too if the app runs on iPad.
      Lead with the catch (a notification with a photo), then the Haul, then search across 29 marketplaces.
- [ ] App preview video (optional): the panther walking across, a find arriving.
- [ ] Support URL (a page on the site with an email address) and marketing URL.
- [ ] Age rating questionnaire (it links to marketplaces with user-generated listings, so answer the "unrestricted web
      access" and user-generated content questions carefully).
- [ ] Category: Shopping (primary), Lifestyle or Utilities (secondary).
- [ ] Price: free, with Pro as in-app purchase or as decided in Phase 0.

## Phase 7: Test and submit

- [ ] TestFlight: internal testers first (you), then external testers (needs a short beta review by Apple).
- [ ] Google Play closed test: 12+ testers for 14 days (Phase 1).
- [ ] Test on an old, small iPhone (an SE) and a big one, in light, dark and Uranium.
- [ ] Test Pro: buy, restore purchases (Apple requires a Restore button), cancel, and the Shopify-member sign-in.
- [ ] Test notifications: allowed, denied, and turned on later in Settings.
- [ ] **App Review notes:** explain what Prowl does in two sentences, give a demo account with Pro and a saved hunt that
      reliably finds something, and say where the native features are (push with photos, share).
- [ ] Submit. First reviews usually take a day or two; a rejection comes with the guideline number. Fix it and resubmit,
      or reply in App Store Connect if the reviewer misunderstood.

## Phase 8: After launch

- [ ] Put the App Store and Google Play badges on the Prowl page, the panther QR sheet, and the Chrome extension
      listing.
- [ ] Switch the QR code to a link that opens the store on phones and the web page on computers (the Prowl domain
      from Phase 0 can do this).
- [ ] Ask for ratings at a happy moment (after someone likes a catch), with Apple's built-in review prompt, which Apple
      limits to three times a year.
- [ ] Track keyword rankings weekly in Applyra and adjust the subtitle and keywords.
- [ ] Watch RevenueCat for trial-to-paid conversion and the lifetime-versus-subscription mix.

---

## What exists already that helps

| Already built | Where | How it helps |
|---|---|---|
| Installable web app (manifest, home-screen install) | `/pages/prowl-app`, the app shell in `page/prowl.html` | The same page goes in the wrapper |
| Email alerts with photos | `worker/index.js` (Prowl Alerts) | Push notifications reuse the same matching; only delivery is new |
| Store sign-in and Pro check | worker, `extension/member.js` | The app signs in the same way; RevenueCat adds a second way to be Pro |
| Privacy section | `docs/privacy-policy-prowl-section.html` | Starting point for the app's privacy policy |
| Panther QR and Send the link | page v6.77 | Becomes "Get it on the App Store" once the app is live |
