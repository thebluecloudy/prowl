# Prowl status

Update this file in every PR (see `CLAUDE.md`). Last updated 2026-10-24 (v7.76 / v164).

## Live

| | Version | Page room left |
|---|---|---|
| Page | **v7.76** | 393,790 bytes under Shopify's 512 KB (slimmed; the main stylesheet and the main script are sent as links to the worker). The page-css test keeps at least 100 KB |
| Worker | **v164** | |

Recently shipped, newest first:

- **v7.76 / v164: the photo check waits for Check it, takes up to 3 photos, and checks again with a fixed maker**
  (the owner: "the tool searches immediately, but i want to add a picture and then add words, or even another picture,
  and then hit search. or, the ai got it wrong, and i want to go back and add a search term or maker, and rerun").
  - **A tray**: Take a photo / Choose from photos (several at once now) put the photo in a tray of up to 3 (the
    piece, its mark, the back), each with ×; nothing is sent until **Check it**. Maker is now **Maker or words**.
    With a photo in, Check it is the one orange button.
  - **Check again**: after the answer the photos stay. Fix the words or add a close-up and Check again; the AI sees
    the photos again with the words. "Wrong item? Re-price" (text only, it never looked at the photo again) is now
    "Wrong? Fix the maker and check again", which puts the cursor in Maker or words. **Start over** empties the tray.
  - **Worker v164**: `POST /appraise { images: [...] }` (up to `APPRAISE_MAX_PHOTOS` 3; `image` still works); the AI
    gets every photo with a line saying they are one piece, eBay's photo search the first. A free visitor's re-check
    of a photo checked in the last 30 minutes is free, 3 times a photo (Matt's call); it still counts against the
    shared daily pool. The marker is per colo (the Cache API) and keyed by one digest of the address and the photo.
    The answer says `again: true`, and the page tells them the re-check was free.
  - Shared photos from Android (v7.15) land in the tray too. No new keys. Tests:
    `__tests__/page/photo-tray-v776.test.mjs`, `worker/__tests__/photo-tray-v164.test.mjs`; reprice-limit drives the
    price step directly now.
- **v7.75 / v163: stops on the way** (the owner: "i would like to make a specific stop on the way from one city to the
  other ... maybe one or two or three, we can go from pin to pin, and find things in between"). Under Where are you
  headed, **+ Add a stop on the way** opens up to three numbered boxes, each with places as you type and a × (`rNrVias`,
  `NR.vias`, kept for the visit, no new key). The page sends them on their own (`via=A|B|C`), so a name with "and" in it
  stays one stop. The worker (`viaParse`) routes through them in order, as before, finds the shops of each leg, looks
  each stop up as a place and puts it in the list in drive order (`pinStops`: by segment and how far into it), marked
  `pin` ("Your stop", outlined, no Skip; take it out above), once, never also nested, and in the Maps link. The trip
  head says "By way of Maumee Antique Mall and Central City Antiques". Keeping a trip for the group sends its stops and
  its detour (it used to drop the detour); kept trips keep `pin`. Trip cache keys add the stops. A new worker test
  checks every `trip.js` helper the worker calls is imported (the tests hand them all in, so a missing import, as
  `sizeTier` and `stayMinutes` were in this change, only broke live). Tests: `worker/__tests__/trips.test.mjs`,
  `__tests__/page/near-via-v775.test.mjs`.
- **v7.74: iPhone install** (Matt: adding Prowl on an iPhone took three tries; the first icon kept the shop's bar and
  every icon asked him to sign in again). iOS gives each home-screen icon its own empty storage but copies Safari's
  cookies into it once, when it is added. On /pages/prowl-app in Safari or Chrome on an iPhone or iPad, the page keeps
  two cookies scoped to that path, 7 days: `prowl_c1` (email, token, session, Pro) and `prowl_c2` (the prowl.v36 save
  when it is 3 KB or less). The installed app takes them on its first open, before load(), only into an empty store,
  then deletes them. No new localStorage keys. Install steps now say to add from the app page (from /pages/prowl the
  icon keeps the shop's bar), with Safari or Chrome wording and "leave Open as Web App on". Not tried on a real
  iPhone yet: if cookies are not copied, the in-app 6-digit code sign-in is still there. Test
  `__tests__/page/ios-install-v774.test.mjs`.
- **v7.73: NEAR ME benchmarked, polish** (release 3 of 3, after v7.71 Around you and v7.72 Road trip).
  - **The glance check for the car**: on a phone every main Near me button is 48px tall with its words at 17px: the
    tabs, Directions, Build trip / Look there, Change, Use my location, Done and the trip bar (Skip and Reviews are
    48px tall too).
  - **No typing after the first trip**: the last three places a trip was built to sit under Where are you headed? as
    Recent chips; one tap builds the trip there. Kept on this device in a new key, `prowl.nearTo` (five at most, the
    same place once, a place with no route never).
  - **Sentence case** for Near me's own tabs and buttons: Around you · Road trip · Trips; in More, Google Maps
    (Google Maps 1, 2 on a split trip), Apple Maps, Rebuild from here, Share; the copy that names them follows. The
    dock's NEAR ME and the app's other tabs keep their capitals.
  - Tests: `__tests__/page/near-polish-v773.test.mjs`; trip-bar-labels, near-section, road-upgrades, near-road-v772,
    near-bench-v771 and use-my-location take the new words.
- **v7.72: NEAR ME benchmarked, Road trip** (release 2 of 3, after v7.71's Around you; against Google and Apple
  Maps' directions, Waze and Roadtrippers).
  - **Where are you headed? first**: the heading is the destination box's label ("Town, City, ST, ZIP or a shop"),
    and From sits under it as the same pill as Around you: "📍 From where you are" with **Change** (the From box, Use
    my location, its suggestions). One line under them names the kinds that are on, and says an empty destination is
    a loop.
  - **The options in one line**: "Today · leave now · stops up to 15 min off the road · Antiques, Vintage, Thrift"
    with Change. Inside are the kinds, how far off the road, the day and Leave at; changes rebuild the trip **once, on
    Done** (or when the line is folded), not on every chip. Leave at only re-times, as before.
  - **Stops lettered A, B, C** (the map's pins too), with no second counter, and a **+12 min** badge for what each
    adds to the drive (the worker's detour minutes; a loop has none). "Worth the detour" no longer repeats the
    minutes. Skip reads "− Skip".
  - **One Start in Maps**: the bar is Start in Maps (the Google/Apple pick; "(1 of 2)" on a split trip) and More, which
    holds every Google and Apple link, REBUILD and SHARE. A trip with no stops links the drive right in its line
    instead of "open it in Maps below".
  - Fixed on the way: the trip's "Novi, MI → Milton, WV" line no longer breaks into a column (a v7.64 rule meant for
    the From/To block caught it); the blocked and no-fix messages say to tap Change by From, with Type where you start.
  - No new keys. Tests: `__tests__/page/near-road-v772.test.mjs`; near-map, near-plan, near-road, near-section,
    road-upgrades, in-a-location and use-my-location follow the new layout.
- **v7.71: NEAR ME benchmarked, Around you** (the owner: "Using benchmark review the near me feature to make it more
  intuitive"; compared with Google Maps, Apple Maps, Yelp, Waze, Roadtrippers, EstateSales.NET, FB Marketplace and
  NN/g; release 1 of 3, Road trip and polish follow as v7.72 and v7.73).
  - **One place to say where**: a pill at the top, "📍 Shops near where you are (Novi, MI)" or "near Milton, WV",
    with **Change**. It opens Use my location (live, from the tap; no snapshot, no lookup), the town box and the
    recent place as one chip. It replaces the In a location form on show, the Where I am / town bar and the store
    finder's second Where I am bar (`#otp-nearWhere`, gone).
  - **Location asked from a tap, with one line of why**: when the browser has never been asked (Permissions API
    "prompt"), a card says "Prowl uses your location only to find … near you." with Use my location and Type a town
    or ZIP. Said yes before: the shops at once. Blocked: the steps, the same two buttons.
  - **Open now**: off when Near me opens; one tap shows only the shops open now, from the hours already on each place
    (no new search), kept on this device in a new key, `prowl.nearOpen`. Nothing open says so, with Show closed ones
    too.
  - **Cards**: open or closed in words and colour right under the name; **Directions** opens the maps app picked
    (Google, or Apple Maps `?daddr=`); Reviews a quieter link.
  - **More ways to look**: the old Local block in one closed fold at the bottom, nothing removed. Its help ("How these
    work", one short paragraph) never opens by itself. The store searches drop Antique stores, Vintage shops, Flea
    markets, Used books and Record stores, which the chips list in Prowl; **Thrift stores stays** (the owner: "Don't
    remove the thrift from Google map direct").
  - **No dead ends**: a `/near` 503 says "Prowl cannot list the shops here yet." with a Maps search for the first kind
    on; other failures keep Refresh and the same search. The members note on a kept trip points to NEAR ME › TRIPS.
  - No change to old keys (`prowl.nearAt`, `prowl.nearCats`, `prowl.nearSort`, the city stay). Tests:
    `__tests__/page/near-bench-v771.test.mjs`, and the near-me, in-a-location, use-my-location and near-where tests
    moved to the pill.
- **v7.70 / v162: group trips can be deleted or left** (the owner: "i need a way to delete the shared trips"). Each
  row in TRIPS has **Delete** on your own trip and **Leave** on a friend's; the first tap asks ("Delete for
  everyone?" / "Leave this trip?", back after 4 seconds), the second does it (`nrTripDel`). Worker
  `POST /trips/<id>/delete` (the organizer only): the trip, its Finds and their photos in R2 go now, and it leaves
  `trips:all`; this is the expiry sweep's purge, now `tripPurge`. `POST /trips/<id>/leave` (a member; the organizer
  is told to delete instead) takes them off the trip and their list. A deleted trip drops off the other members'
  lists, and out of their index, the next time they look (`GET /trips`). The trip you were on (`prowl.trip`) is
  cleared when it goes. Tests: `worker/__tests__/trips.test.mjs`, `__tests__/page/near-trips-v769.test.mjs`.
- **v7.69 / v161: stars and reviews on every stop, a TRIPS tab with invite links, places as you type** (the owner, on
  the road: "are you able to pull the description, reviews, review stars for each area? I want to see that quickly
  before I decide to even go. And ... sharing a trip to my friends and then them looking it up, it's complicated ...
  a third tab at the top with shared trips"; then "in the roadtripper app, it has a screen that shows you suggested
  places, and then you click on that place, is that possible").
  - **Stars and the line about a place**: every card shows its stars, rating and review count under the name
    (`nrRate`) and Google Maps' line about it, two lines at most (`about`, from the editorial summary the search
    already returned; `placeCard`, kept on group trips by `stopRef` with the rating and count). **Reviews** beside
    Directions opens three of its reviews under the card, each with its author and when, and a link to all of them
    (`nrRvToggle`; worker `GET /reviews?id=`, Place Details, an hour in the cache, 300 a day per address).
  - **TRIPS**, a third tab (`#otp-nrT3`, `nrMode('trips')`): the group trips you are on, yours and friends'; one opens
    on ROAD TRIP. Signed out it says so, with Sign in. The organizer's SHARE on a kept trip has **Invite link**
    (`nrInvite`; worker `POST /trips/<id>/invite`, a code signed like the find links, good while the trip lasts):
    "Join my road trip to Blenko Glass Company, Milton, WV on Mon Oct 26 in Prowl: <page>?trip=<code>" through the
    share sheet. A friend who taps it lands on NEAR ME › TRIPS with the trip shown (`GET /trips/<id>/peek?c=`) and
    **Join this trip** (`POST /trips/<id>/join`, no Pro needed to join, the 24-member cap holds); signed out, the
    invite waits in a new key, `prowl.tripInvite`, through the sign-in. Add by email stays.
  - **Places as you type** in To and From (`nrSugWire`; worker `GET /suggest?q=`, Google's Autocomplete biased to
    where you are, US only, a day in the cache per words and area, 1,500 a day per address): a name with its town
    under it; a tap in To fills it and builds the trip there, in From it fills the box. Not for a "via" trip.
  - Tests: `__tests__/page/near-trips-v769.test.mjs`, `worker/__tests__/trips.test.mjs`, `trip.test.mjs`; the
    NEAR ME tab and button-order tests now expect three tabs and Directions, Reviews, Skip.
- **v7.68: NEAR ME reads at Roadtrippers' size on a phone** (the owner, with Roadtrippers open beside it: "i think the
  text needs to be bigger on the phone ... the font is a good size", then screenshots of its itinerary and screens).
  Up to 600px wide, scoped to `#otp-near`: copy 16px (was 13), a shop's name 18px (14), its town and hours 15px
  (12.5), headings 20px, chips and buttons 15px with 38px targets, the flock's line 16px, every input 16px so an
  iPhone does not zoom in on a tap; nothing under 13px. The bigger words needed the width, so a shop restacks on a
  phone: name, town and hours beside the photo, OPEN NOW and the miles on a line under them, Directions and Skip a
  full-width row under the card; the four footer buttons are 14px so GOOGLE fits. Checked in Chromium at 390px. The
  Aa text size still zooms on top. Page only. Test: `__tests__/page/near-type-v768.test.mjs`.
- **v7.67 / v160: long hunts are cut at a whole word; the live rows search what Best picks does** (Matt, with "Pedlar of
  Dreams: The Story of Howard Kron and Texans Incorporated": "This description finds the item in Best picks but it
  doesn't show it live on eBay"). A run's live rows (`liveTermOf`) cut the term at 60 characters mid-word, "...Texans
  Incorp", and eBay (every word must match) found 0; Best picks sends the whole title to `/hunt` and found 6. New
  `cutWords(s, n)` cuts at the last whole word (one over-long word at n, never half an emoji). The live rows and Best
  picks (`huntTermOf`) both search up to 80, the worker's own `MAX_TERM`; saved hunts (`sgwClean`, 60) end on a whole
  word too, so keeping that title saves "...Texans", which finds the same 6. Already-saved hunts are 60 or fewer
  characters and come out unchanged. Worker v160: `fbTerm`, the worker's copy of the page's hunt key for Facebook
  finds, cuts the same way. Tests: `__tests__/page/long-terms-v767.test.mjs`, `worker/__tests__/fb-sweep.test.mjs`.
  Also `near-flock-v761.test.mjs` no longer races the clock: it failed #217's CI because the flock's 40 ms steps beat a
  fixed 60 ms wait on a slow runner (it saw two steps). It now records every line in order and waits for the last.
- **v7.65: Road trip bar fits a phone** (the owner, 2026-10-22: words spilled out of the pills). Short labels GOOGLE / APPLE / REBUILD / SHARE (legs GOOGLE 1, APPLE 1…), equal-width pills with nowrap + ellipsis; aria-labels keep the full meaning. Page only.
- **v7.64 / v159: 📍 Use my location** (the owner, 2026-10-22, in a car on Android in an app's built-in browser with
  location off for the site: "Location is off for this site ... Type a town" and he did not know what town he was in).
  - A **📍 Use my location** button on the From row itself, right of the field (`#otp-nrFromMe`), and in the In a location
    box beside Look there (`#otp-nrAtMe`), and inside the no-fix messages (`data-nrme`). The tap itself calls `getCurrentPosition` (`meLocate`, high accuracy, 10 s timeout, a fix
    up to 60 s old), so the browser can show its prompt.
  - Worker **v159 `GET /geo?lat=..&lng=..`** (`geoBackRoute`, `gReverse`; pure `geoReverse`, `geoRound` in `trip.js`) names
    the town with the reverse Geocoding API on `GOOGLE_MAPS_KEY`, US only: `{ lat, lng, town, city, st, zip, cl }`. The
    page sends the point rounded to 2 decimals (~1 km) and the worker rounds again before Google, the cache key (30 days)
    and the answer; `GEO_PER_IP` shared with `/geo?q=`; no coordinates logged. A rural fix can name a township.
  - The box reads "Chillicothe, OH 45601" and a line says "Using your location: Chillicothe, OH". The precise fix is kept
    as the place in `prowl.nearAt` with a new field `me:1` (same key, older data loads as before), so the text is never
    geocoded. Around you: it becomes the centre (`atUse`, on). From: kept with `on` unchanged, so Around you does not move;
    the trip is timed like the phone (`fromAt` is empty for a `me` place). If the worker cannot name the town the fix is
    still used, as "My location". It is a snapshot: after driving on, tap it again.
  - Blocked (denied, no geolocation, or not a secure page) replaces the dead end with how to allow it (`nrBlocked`): an
    app's built-in browser, ⋮ › Open in Chrome; Chrome, the icon left of the address › Permissions › Location › Allow;
    iPhone, aA › Website Settings › Location › Allow; or type a town or ZIP. No fix in time says so and offers a retry.
    Never the IP's guess (a phone's IP can sit in another state).
  - Road trip layout (the owner's screenshot the same day: he took the bottom bar's FROM HERE for the new button, "this
    isn't intuitive"): From sits right above To in one block (`.nr-route`), To reads "To: town, City, ST or ZIP
    (optional)"; the bottom bar (`#otp-nrFoot`: OPEN IN MAPS, APPLE MAPS, FROM HERE, SHARE) shows only once a built trip
    has stops (`nrFoot`; an A-to-B route with no shops no longer offers it); FROM HERE is renamed **REBUILD FROM HERE**
    (what it always did: rebuild the trip from where the phone is now).
  - Deploy note: Shopify stores a div holding an input and a button with each on its own line, so the first deploy
    failed its md5 check even though the page went live. The From row is now written that way.
  - Some in-app browsers (WebViews) refuse geolocation outright and show no prompt; for them only Open in Chrome or typing
    a town helps. Not checked on a real phone from here.
  - Tests: `__tests__/page/use-my-location-v764.test.mjs`, `worker/__tests__/geo-reverse.test.mjs`; `in-a-location-v762`
    and `near-section-v736` now expect "Location is blocked for this site".
- **v7.62 / v157: In a location, and Road Trip A to B, Optimize route, Open when you arrive** (the owner, 2026-10-22, testing Milton, WV with location off: only Craigslist and
  Facebook moved, "Location is off for this site, so the shops around you cannot be listed" stayed, Refresh did
  nothing, the shops never listed, and Road trip said "the trip has no starting point" with no way to give one).
  - NEAR ME > Around you has an **In a location** box (`#otp-nrAtForm`): a town, City, ST or a ZIP. Worker **v157
    `GET /geo?q=`** geocodes it with the Geocoding API already on `GOOGLE_MAPS_KEY` (`components=country:US`) and
    answers `{ q, lat, lng, town, city, st, zip, cl }`; `cl` is the nearest Craigslist site within 120 miles, from
    Craigslist's public area list (reference.craigslist.org/Areas, Prowl User-Agent, kept 7 days). Kept 30 days per
    text, misses not kept, `GEO_PER_IP` 200 a day, the text never logged. Pure helpers in `trip.js` (`geoQuery`,
    `geoPlace`, `clAreasSlim`, `clNearest`).
  - The place centres everything NEAR ME shows (`atLive()`): Around you asks `/near` at its point ("Around Milton,
    WV", miles from the middle of town, no "You are at", its own pin on the map instead of your dot); the store
    searches go "near Milton, WV"; garage sales and every Craigslist link use its nearest site around its ZIP
    (`clAt`); Facebook uses the nearest known metro within 60 miles (`FBXY`, `atFb`), else stays unscoped and says
    so; estate sales (owner) load for its City, ST. The saved city (`st.city`) is untouched.
  - Kept on the device in a new key, **`prowl.nearAt`** (`{q,town,city,st,zip,lat,lng,cl,fb,on}`), outside the backup.
    Chips **Where I am** / **Milton, WV** switch between GPS and the place; the same text is never looked up twice.
  - Location off is no longer a dead end (`nrNoFix`): it points to In a location and offers **Use Milton, WV** when a
    place is kept; Refresh shows only when a retry can help (not when location is denied).
  - Road trip has a **From** box (`#otp-nrFrom`, filled with the place when it is in use): a typed start is looked up
    and kept as the last typed place (`nrStart`); empty means the phone. With location off it says to type a start and
    offers **Start from Milton, WV** (`nrNoStart`). A typed start skips the "when you would get there" timing; FROM
    HERE still means the phone (it clears From); Keep it for my group posts the point the trip was built from
    (`NR.builtFrom`).
  - **Road Trip upgrades** (approved by the owner the same day):
    - **A to B, or a loop**: start (From, or the phone) and an optional end (To). No end makes a loop of the Around you
      shops at the start (up to 8, skips honoured), ordered as a round trip, "Then back to". **Detour off the route**:
      5 / 15 / 30 min chips (`#otp-nrDetour`, new key `prowl.nearDetour`, 15 by default), sent as `/trip?detour=`;
      worker `detourParse` (anything else is DETOUR_MIN, 10, so the cache key and kept trips are unchanged without it).
      The corridor search is still 9-mile circles, so a 30-minute detour can miss shops more than ~9 miles off the road.
    - **Optimize route** (`nrOptimize`, button over the stops): worker **`GET /order?p=lat,lng|...[&loop=1][&keep=1]`**
      orders the stops for the shortest drive with the start and end kept, through the public **OSRM demo router**
      (router.project-osrm.org: no key, fair use about 1 request a second, no uptime promise, not for heavy production
      traffic); when it fails, a straight-line nearest-neighbour + 2-opt estimate (`orderEst`, src "est"). 2 to 14
      points (12 stops), rounded to 3 decimals before they leave; kept a day (an estimate 10 minutes). The order lives on
      the trip in the page (`t.order`, applied in `nrVisible`), so the list, the pins and every Maps link follow it.
      Kept group trips reorder only on the device.
    - **Open when you arrive** (`nrEtas`, `nrLateAt`): every stop is timed along the drive from the start: router leg
      times (`/order?keep=1`, one call per new order) or straight-line miles x1.25 at the trip's average speed, plus
      the stop's own stay or 20 minutes. Leave at (`#otp-nrLeave`): empty is now on a trip today; another day needs a
      time. Each card says "Get there ~11:40 AM" and OPEN / CLOSED for then, and a line names the shops closed by then.
      Estate sales along the way (owner only, as EstateSales.net agreed; `nrSales`): `/sales` for up to 4 towns on the
      trip, kept when open on the trip day and within the detour of `/trip`'s new `line` (the route thinned to 160
      points, without its first mile so the start is not in it), each with "Get there" or "Ends before you get there"
      (a date-only end counts as 4 PM).
    - **Exports carry every stop**: Google Maps as before (9 waypoints a link, LEG 1, LEG 2… past that). **Apple Maps**
      (`#otp-nrApple`, `nrAppleUrl`) uses Apple's unified Maps URL, `maps.apple.com/directions?source&destination&
      waypoint…&mode=driving`, documented for iOS 18.4+ / macOS 15.4+ (developer.apple.com/documentation/mapkit/
      unified-map-urls). Apple's docs give no URL limit; Apple Maps routes take 14 stops (support.apple.com), so a link
      carries 13 waypoints and its end, and longer trips split into APPLE LEG 1, 2…, each starting where the last ended.
      Older iOS may open the link without the waypoints: not checked on a real phone from here.
  - Tests: `__tests__/page/in-a-location-v762.test.mjs`, `__tests__/page/road-upgrades-v762.test.mjs`,
    `worker/__tests__/geo.test.mjs`, `worker/__tests__/order.test.mjs`; `near-section-v736` now expects `&detour=15` and
    the detour chips (the detour used to be internal).
- **v7.61: a flock of swallows while NEAR ME looks** (the owner: "there is a lag and small text saying finding. I need
  an animated butterfly or flock of birds while it is searching or something that indicates working in background").
  Around you, Road trip and FROM HERE show a card where five of the page's swallows (`#otp-swallow`) cross from left
  to right, wings beating and bobbing (`nrFlock`, `nrFly`, `nrFlap`), and the line under it moves through what is
  being done every few seconds (`nrFlockRun`): "Finding where you are…", "Looking for antique, vintage and thrift
  shops nearby…", "Sorting them biggest first…", "Checking today's hours…"; on a trip "Mapping the drive to
  Blenko wv…", "Searching the shops along the way…", "Picking the stops worth the time…", "Almost there…". The line
  is a polite live region; the birds are hidden from screen readers. With reduced motion the birds sit still. The
  results replace the card. Page only. Test: `__tests__/page/near-flock-v761.test.mjs`.
- **v7.60: Den settings buttons keep their words inside** (the owner's screenshot: "Standard" spilling out of the Text
  size button). Each settings row is a flex row; its button could shrink below its own label ("Standard", "Swipe",
  "Export" overflowed at 390 and 1280 px). The button now keeps its size (`flex: 0 0 auto`, one line) and the
  description wraps. Test: `__tests__/page/den-buttons-v760.test.mjs`.
- **v7.59: Swipe or Show everything, on the hunt page** (Matt: "I want two modes. I want the swipe mode or show
  everything mode on the hunt page"). A switch over the live finds, in search results and over a favorite hunt pill's
  listings (`viewSw`, `.view-sw`, `data-view`). **Swipe** (the default) keeps v7.31's one sideways row per
  marketplace; **Show everything** lays every find out in a grid (two across on a phone) and opens the full
  marketplace list. It is the v7.08 setting renamed (Keep it simple is now Swipe), same key `prowl.detail`, so the
  Den's How much to show and the switch stay one setting. Tests: `__tests__/page/view-modes-v759.test.mjs`.
- **v7.58: Den hunt names stay in their row; the first-visit chips say they are ideas** (the owner, on a new phone:
  "the letters are spilling out in the den", and the sample hunts "I couldn't delete them. I added one hunt and samples
  went away", picked "label them"). `.tt` wraps long words (`overflow-wrap:anywhere`); at Large / Extra large text
  under 480px the check, watch and remove columns slim down and the watch label hides, so the name keeps room. The
  first-visit chips (`#otp-start`, OLD_DEF) are headed "Ideas to try" with a note that they are not saved and go away
  once you keep a hunt (by design: they were never hunts, so there is nothing to delete). No new keys. Test:
  `__tests__/page/den-wrap-ideas-v758.test.mjs`.
- **The daily ShopGoodwill digest is gone** (2026-10-21, the owner: "Delete it"). `.github/workflows/sgw-digest.yml`
  scraped ShopGoodwill's "Ceramic Panther" search in a headless browser every morning and committed `sgw-digest.json`
  straight to `main`; nothing has read that file since the panel it fed was removed. It cost Actions minutes daily,
  fell under the same ShopGoodwill terms that park the sniper ("any ... script ... or other automated means"), and
  was the only thing pushing to `main` outside a PR, which a required `build` check would have rejected. Removed the
  workflow, `sgw_scrape.py` and `sgw-digest.json`. The worker's live ShopGoodwill results are unchanged.
- **v7.57: near me means where you are; Road trip opens quietly and scrolls on an iPhone** (the owner, in Findlay with
  48377 saved: "This says near me but opens Google at zip code. It should be near me or zip. And road trip does not
  scroll on apple. When I open road trip the keyboard opens by default.").
  - Stores near you: once the phone has a fix (Around you), the searches go around where you are ("antique stores near
    me"; Apple Maps with no place at all), headed "where you are". With a saved place, **Where I am** / **48377** chips
    switch between them for the visit (`nearWhere`, `NEAR_WHERE`, no new key). No fix: the saved place, headed "near
    48377". Garage sales stay on the saved city (Craigslist works by city).
  - Road trip no longer puts the cursor in the destination box on opening (`nrMode`), so the keyboard waits for a tap.
  - Scrolling on an iPhone: on a phone (coarse pointer, or Leaflet's mobile flag) the map no longer takes one-finger
    drags (`dragging: false`, `tap: false`), so a swipe over it scrolls the screen; pinch and the buttons zoom it. A
    mouse still drags it. The scroll box gets `min-height: 0` and its panes `flex: 0 0 auto`, so older Safari cannot
    squeeze the panes to the box. Not checked on a real iPhone from here.
  - Test: `__tests__/page/near-where-v757.test.mjs`.
- **v7.56: Best bets and a busy marketplace open the site itself** (Matt, 2026-10-21: "When I click ruby lane the screen
  changes to one hunt or something. I'm expecting it to open ruby lane", and Vinted busy again: "can you just put a link
  here to run it manually?"). The Best bets pills under a hunt (worker /where) are links (`a.sgw-wh`, ↗) to that
  marketplace's own search for the hunt, in a new tab; no one-site run inside Prowl. A live block that can't load (busy,
  unreachable, offline) adds "Search Vinted yourself ↗" (`liveSelf`, `.lv-self`), on the hunt results and on Daily.
  Test: `__tests__/page/links-out-v756.test.mjs`.
- **v156: group trips can be kept** (the owner: "Group button doesn't work"). Every POST to `/trips` (keep a trip,
  add a member, close it, rebuild a kept trip from here, post a find) answered 405 "GET only" live: the worker's
  GET-only guard sat above the `/trips` dispatch, so those calls never reached `tripsRoute` (the tests call it
  directly and never saw it). Broken since group trips shipped in v132. The POST dispatch now sits above the guard,
  after the cross-site origin check. Worker only. Test: the wiring test in `worker/__tests__/trips.test.mjs` checks
  the order.
- **v7.55: the sold-price row on the hunt pills too** (the owner: "it doesn't show until i hit the hunt button, when i
  click pills it is not there"). Tapping a Your favorite hunts pill draws that hunt's live listings on the home screen
  without a search run, so v7.54's row was not there. `compsRow(t)` now draws it in both places (over the pill's live
  listings, `sgwBody`), and one document listener opens the buttons by `data-comps` / `data-t` (the ids are gone, since
  both can be on the page). The eBay note hides in Keep it simple in both. Tests: `sold-visible-v754.test.mjs`.
- **v7.54: eBay Sold and Terapeak always visible** (the owner: "i had a hard time finding ebay sold and terapeak at
  the bottom of the search area, can you make sure that is always visible?"). The two sold-price buttons were in the
  results footer, which Keep it simple folds behind More places to look. They now sit right under the search title as
  "What has it sold for?" (`.comps-top`), side by side on a phone, in both Keep it simple and Show everything; the
  footer copy is gone. Tests: `__tests__/page/sold-visible-v754.test.mjs`.
- **v7.53 / v155: SHARE sends the route, and a keep that fails says why** (the owner, on the road: "cannot share the
  map itinerary"; SHARE toasted "The trip could not be shared just now"). SHARE only ever kept a Pro group trip, and
  it built the whole trip again on the worker (about a hundred Google calls over a phone connection) and hid the
  reason when that failed. Now SHARE opens a choice on the trip:
  - **Send the route** (`nrSend`, `nrRouteText`): the drive, the stops in order (skipped ones out, "+1 more in town"),
    the final stop and the Google Maps link (each leg's when there are more than nine stops), through the phone's
    share sheet, or copied when there is none. Anyone, no sign-in; the origin is only its town.
  - **Keep it for my group** (`nrKeep`, the old SHARE): a failure toasts the worker's reason and status, or "Prowl
    could not be reached" with no answer at all. On a kept trip the second button is Add a member.
  - Worker: `POST /trips` takes the build `/trip` already cached for the page (`tripKey`, the same key) and builds
    again only when it has gone; a build that throws is a 502 and a save that fails a 503, each with words, logged as
    "trips build" / "trips save".
  - Tests: `__tests__/page/near-send-v753.test.mjs`, `worker/__tests__/trips.test.mjs`, and the SHARE taps in
    `near-section-v736` now pick Keep it for my group.
- **v7.52: the one-site pill is opt-in** (Matt, 2026-10-20, Den > Settings: "this no longer is needed. Unless we can
  have them turn it on if they want"). The Just ShopGoodwill pill beside Hunt is hidden to start with. Den > Settings >
  One-site button has **Off** first, then every marketplace; picking one shows "Just <site>" and Off hides it again.
  Stored as `oneOn` inside `prowl.v36` (no new key); a save or backup without it keeps the pill only when a site other
  than Goodwill was picked by hand. The note no longer says "the bar at the bottom". Import and Clear now refresh the
  picker. Test: `__tests__/page/one-site-optin-v752.test.mjs`; `five-tabs-v730` and `near-me` turn the pill on; the letter's swap test waits for the alerts status.
- **v7.51 / v154: a road trip says how long to allow, what a detour costs, and what is a short walk** (the owner,
  with Gemini's Findlay to Milton write-up: "some good advice, can we incorporate this somehow?"). Gemini's advice,
  filled from Google's data rather than its prose (its store descriptions are its own words and were left out):
  - **Time to allow** ("allocate a dedicated chunk of time"): each stop carries `stay` minutes (`stayMinutes`: from
    the dealer count when Google's summary gives one, 30 min to half a day; else from the size tier, 30 to 120). The
    card says "Allow about 2 h"; the trip head adds the visible stops: "About 7 h 30 min in the shops. With the drive,
    12 h 30 min: more than a day, so plan a night on the road or Skip a few stops." Skipping a stop takes it out.
  - **Worth the detour** (Heart of Ohio, "a slight detour"): an antiques place in the top size tier with a thousand
    reviews (`worthDetour`) may sit up to 30 minutes off the road (`BIG_DETOUR_MIN`) and says "Worth the detour: adds
    about 22 min". Everything else keeps the 10-minute rule.
  - **A short walk** ("district walkability"): a town's shops within 0.4 miles of its stop say "A short walk from the
    stop" (`walk`).
  - Kept group trips keep `stay`, `worth` and `walk` (`stopRef`). Trip cache key v=10.
  - Tests: `worker/__tests__/trip.test.mjs`, `__tests__/page/near-plan-v751.test.mjs`.
- **v7.49: NEAR ME for the road** (the owner: "1-4" of the Near me suggestions). Around you shows how far each shop
  is ("1.4 mi", "< 0.1 mi" next door) with a **Biggest first / Closest first** switch, remembered in the new key
  `prowl.nearSort`; the map numbers its pins in the order shown. On a road trip for today each stop is open or closed
  for when you would get there, driving straight from the phone's spot ("Get there ~11:40 AM · closed by then"),
  estimated on the page from straight-line miles x 1.25 at the trip's own average speed; other days keep that day's
  hours. Every Around-you row, every stop and the final stop has a bold **Directions** button (Skip sits under it).
  Today's hours read at a glance: "Open until 6 PM", "Opens 10 AM", "Opens tomorrow 11 AM", "Closed today · opens Fri
  10 AM" (`nrNext`, `nrNextText`). Page only, no worker change. Tests: `__tests__/page/near-road-v749.test.mjs`.
- **v7.48 / v153: the shop you stand in is always asked for** (the owner, back in Maumee Antique Mall with Antiques on:
  still missing). Asked fresh at the mall's own spot, Google's relevance answer to "antique stores and antique malls"
  had the mall on some asks and not others (antiques + flea: first; antiques + records, or the usual three: missing),
  while every neighbouring cell listed it first. The miss was cached for the cell. Around You now also asks for the
  closest shops of the kinds picked, ranked by distance within 3 miles (`rankPreference: DISTANCE`, `NEAR_HERE_M`,
  one more Text Search per cell and 10 minutes), merged before ranking. Near cache key v=11. The page judges "You are
  at" from the phone's own fix (`nrAt`), not the worker's `near`, which is from whoever asked first in the cell, and
  **Show them too** is a filled button (it read as plain text). Tests: `worker/__tests__/trips.test.mjs` (Google
  leaves out the shop at the spot asked about; it is listed once), `__tests__/page/near-kinds-v747.test.mjs`.
- **v7.47: Around you says which kinds it looked for** (the owner, standing in the middle of Maumee Antique Mall: "it
  doesn't come up"). The search was right: only the Vintage chip was on, and the live worker lists the mall first once
  Antiques is on. The page said "Antique, vintage and thrift shops" whatever the chips were. Now the line names the
  kinds that are on (`nrKinds`), a usual kind that is off is said with **Show them too** (`nrCatsAll`, the same
  `prowl.nearCats` key, saved in chip order), and a listed shop within 0.15 miles is where you are: "You are at
  Maumee Antique Mall in Maumee, OH." Page only. Test: `__tests__/page/near-kinds-v747.test.mjs`.
- **v7.46 / v152: the weekly letter** (the owner, from Cat On Chair 1.9.0's Weekly Recap: "this is perfect ... i like
  that it is in the app too, everyone gets it, sunday is good ... for now keep in den").
  - Every Sunday from 6pm in the member's time zone the panther writes each member with emails on (not paused, not
    turned off): the week in numbers, the best find against its hunt's typical price, the likes saved this week, and
    for the quietest hunt a shorter search (years, model numbers and filler dropped) that one eBay search proved finds
    something, with Try it in the email and Add / Replace in the app. Nothing changes without a tap.
  - Worker: `letter.js` (pure: `wkAdd`, `letterShorters`, `letterBuild`, `letterText`, `letterQuiet`); `wk:<email>` is
    the week's tally (alCheck adds to it), `lt:<email>` the sent letter for 21 days; `POST /alerts/letter` (latest, or
    `preview` of this week so far, 10 a day); `prefs.letter`; `/alerts/unsub?w=letter` stops only the letter (footer
    link and the one-click List-Unsubscribe); at most 4 letters a cron run; wk:/lt: move and go with the member. A member
    with no tally yet waits for next Sunday.
  - Page: Daily shows the latest letter for a week (Save to `prowl.letters`, Share, Close sets `prowl.letterSeen`, both
    new keys); Den > Settings has the Weekly letter switch, "Read this week's so far" and saved letters; the email's
    `?letter=1` opens that switch, `?hunt=` runs a search.
  - Safe by design (the review): the sent marker is saved straight after the send, so a failed write never sends the
    letter twice; the quiet-hunt check uses the lean eBay search and takes one hunt's share of the run's 50 calls; a
    tally older than 8 days starts over (`wkCur`); only the hunts the alerts really search count (`alActive`); Replace
    my hunt swaps in place, so a full Den never loses a hunt; the email's Try link no longer opens Den over the search.
  - Not yet: a "manage my emails" page outside Den; got-away and Fair price in the letter (they live on the device).
  - Tests: `worker/__tests__/letter.test.mjs`, `__tests__/page/weekly-letter-v746.test.mjs`.

- **v7.45 / v151: NEAR ME on a map, and Directions to the next stop** (the owner, on the road: "i stopped at one,
  now i want to find the next one but i don't know where i am, it would be good to pull up a map to show and then i
  can pick and then get directions to the next"). Both tabs get **Show on a map**: Leaflet and OpenStreetMap tiles
  through the estate-sales map's loader (`esLeaflet`, cdnjs, fetched the first time a map is asked for; if it fails the
  box says so and the list stands). Your position is a blue dot with the town the worker now names (`/near` answers
  `town`, one reverse geocode a cell, cached with the list; near cache key v=10), and Around you's copy opens with
  "You are in Maumee, OH." The shops are numbered pins that match the now-numbered list (`nrCard` takes a number); on a
  trip the anchors are numbered, the town's nested shops are small amber dots, the final stop a green flag, and a
  skipped stop leaves the map. A pin's popup has the name, OPEN NOW / CLOSED for the day shown, **Directions** and
  **In Maps**. Every Around-you row has a Directions link beside the card. Directions links name no origin, so
  Google Maps starts from the phone and your position never goes into a link. The map takes the drive's hours on a
  trip (a Monday trip shows Chillicothe CLOSED whatever today is). Tests: `__tests__/page/near-map-v745.test.mjs`,
  `worker/__tests__/trips.test.mjs`.

- **v7.43 / v149: cross-posts are "similar", not "the same piece"** (the owner, on an Etsy panther lamp with a shade at
  180.00 CAD that Prowl called the same as a $129 Poshmark TV lamp: "change to a similar one is on poshmark, go check it
  out, vs saying it is the same"). A title can't prove it is the same piece, so the card says "Similar on Poshmark
  $129.00" and the popup "A similar listing is on Poshmark … It may be the same piece or a lookalike: compare the
  photos, size and marks." Worker `huntSamePiece`: prices in different currencies are never matched. Tests:
  `worker/__tests__/hunt.test.mjs`, `__tests__/page/cross-post-v734.test.mjs`, `hunt-picks-v706.test.mjs`.

- **v7.42 / v148: miles and mph, nowhere a kilometre** (the owner: "don't use km or km/hr, use miles and mph"). The
  worker measures everything in miles now: `haversineMi`, `nearestOnRoute` answers `mi`, the detour speed is 37 mph
  (`DETOUR_MPH`; 3 miles each way is the 10-minute budget), the corridor circles are 15 miles apart and 9 miles wide,
  Around you keeps places within 25 miles (`NEAR_KEEP_MI`) and the walkable cluster is 0.4 miles. Google still takes
  metres (`MI_M`). `/trip` sends `route.mi` (and `how.routes[].mi`); the page reads `mi`, and a trip saved before
  this version with `km` still draws (`nrMiles` converts). Cache keys v=9. Tests and docs say miles too. Tests:
  `worker/__tests__/trip.test.mjs`, `worker/__tests__/trips.test.mjs`, `__tests__/page/near-section-v736.test.mjs`.

- **v7.40: one Filter sheet beside the search box** (the owner, after a look at how Shop, Vinted, Walmart, Airbnb,
  Fiverr and Tock draw their filters on Mobbin: "this is perfect, build it"). A sliders button beside the search box,
  with a count badge, opens the page's bottom sheet (`openSheet`) with four rows that show their value while closed:
  **Sort by** (Best match, Price low to high, Price high to low, Newest first), **Price** (three pills plus min and
  max), **Sites** (the drawer's 29-row list with its SHOP and BOLO tabs, Select all and Clear) and **Skip words**
  (Prowl Pro, as in the email; a Pro member's words go to the email too). Nothing applies until **Show N listings**,
  which counts the live listings on screen that would pass; Clear all sits at the top of the sheet. The filters in
  force are chips under the search box, each with a cross; the badge says how many. They shape every live strip on
  the results screen (a strip says "2 hidden by your filters", or "all hidden" with an Edit filters link), the Best
  picks and Daily's cards; the marketplace rows under More places to look are links and are left alone. With a sort
  on, a strip is one order (no exact/close split); a price in another currency is left alone by a price filter;
  Newest uses `listed` (eBay) or `found` (Daily). Sort, price and skip words are a new key, `prowl.filter`
  (`FLT_KEY`); the sites are the drawer's saved set (`st.mkt`, unchanged key), and the drawer's count follows. Page
  only. Not in this version: on-screen local pickup (the email's ZIP and radius) needs the worker's live eBay search
  to take them. Test: `__tests__/page/filter-sheet-v740.test.mjs`.
- **v146: the detour was the thief.** Build after build (v136 to v145) had no Maumee Antique Mall though every search
  change was aimed at it. v141's diagnostics held the answer: the road passes 2.4 miles from the mall, and the detour
  rule (straight-line distance both ways at 25 mph) called that 11.7 minutes, over the 10-minute line. Now the
  distance is to the road's segments rather than its sampled points (an overview polyline's points sit miles
  apart; `nearestOnRoute`), and the speed off the highway is 37 mph (`DETOUR_MPH`), so about 3 miles each way is the
  budget. Cache keys v=8. Worker only. Tests: `worker/__tests__/trip.test.mjs`.

- **v145: antiques asked on their own, a circle at a time** (the v144 live build, 23 small circles, still had no Maumee
  Antique Mall: since v140 a trip put all three kinds in one question, "antique stores and antique malls, vintage
  stores, thrift stores", and a circle's 20 answers were a mix that crowded the mall out; Around you, which asks
  antiques alone, lists it first). `kindPlan.texts`: antiques alone, then the other text kinds together; two text
  searches a circle, at most 150 a build. Cache keys v=7. Worker only. Tests: `worker/__tests__/trip.test.mjs`,
  `trips.test.mjs`.

- **v144: cache keys v=6.** v143's upload sat on Cloudflare for an hour without taking over (requests still answered
  with v142's 25-mile boxes; Cloudflare's stored script was v143). The keys move so no v142 build is served once v143's
  circles are live, and the push starts a fresh build. If a build ever sits like this again: Cloudflare > Workers &
  Pages > prowl > Deployments shows whether the latest build failed or is waiting to be promoted. Worker only.

- **v143: text searches in small circles** (the live v142 build answered `how.badTypes: antique_store, thrift_store`:
  Google's Nearby Search has neither type, so the typed search can never run for antiques; books and toys keep
  theirs). The corridor goes back to bias circles, now 15 miles apart and 9 miles wide, Around you's radius, which lists
  Maumee Antique Mall first; a strict 27-mile box ranked by distance to its centre never listed the mall. One page a
  circle, at most 130 searches a build (two or three routes, shared circles asked once). Worker only.
  Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`.

- **v142: the typed search really runs, and "via"** (v141's `how` on the live Novi to Blenko build: `refused 20`, every
  Nearby call refused, so the search had fallen back to text all along and the Maumee box, centred 2.4 miles from the
  mall, still never listed it). Nearby now tries each place type on its own when the pair is refused and remembers the
  type Google rejects (`BAD_TYPES`, `how.badTypes`), so `antique_store` keeps working even if `thrift_store` is not a
  type. **Via:** "Blenko Glass Company, Milton, WV via Portsmouth, OH" (up to three towns, joined by "and") routes
  through that town (Routes API `intermediates`, pass-through), is kept on the trip (`via`) and used by FROM HERE
  rebuilds; Google's own alternatives offered the Portsmouth road on one build and not the next. Worker only.
  Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`.

- **v141: `/trip` says how it looked** (`how`: each route's miles, minutes, score, anchors and places found, the boxes
  searched on the chosen road, the Nearby and text search counts, and whether Google refused a place type), so a
  missing stop (Maumee Antique Mall was still absent on v140) can be traced instead of guessed at. Pawn, coin, fabric
  and garden shops are never ours by name too. Worker only.

- **v140: by Google's own types, most popular first** (the v139 live build: a horror museum, a clothing store and a
  business centre were anchors on their review counts, and Maumee Antique Mall was still missing after three pages:
  a free-text search in a dense box never surfaces it). For the kinds that have a Google type (antiques
  `antique_store`, thrift `thrift_store`, books `book_store`, toys `toy_store`) the worker asks Nearby Search inside
  the box's circle, `rankPreference: POPULARITY`, so the 20 answers are the 20 most reviewed antique stores there and a
  museum can never come back (`gPlacesNearby`, `kindSearches`, `kindPlan`); vintage, records and flea markets stay text
  searches. If Google refuses a type the box falls back to the text search. A crowd of reviews counts only for a place
  of our kinds or with a telling name (`OUR_KIND`, `OUR_NAME`); an antiques shop needs 75 (`ANCHOR_REVIEWS_ANTIQUES`,
  Bluegrass Collectors has 90); museums, clothing, business centres and the like are never ours. Around you uses the
  same searches. Cache keys v=5. Worker only. Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`.

- **v139: the boxes read to the end, and nothing that is never ours** (the first live build on v138: "The Mall of
  Monroe", a shopping mall at 3.2 stars, was anchor one; "Garden Cottage Emporium", 4 reviews, an anchor on its name;
  Maumee Antique Mall still missing because the Toledo box's 20 answers were all downtown). Shopping malls, furniture,
  pawn, jewelry and the like are dropped whatever the query returned (`kindAllowed`, `NEVER_KIND`); an anchor needs
  25+ reviews (`ANCHOR_MIN_REVIEWS`) and the next shop in town with the reviews steps up; a box that comes back full
  is read on to its third page (`gPlacesAll`, `TRIP_PAGES_MAX`, at most 120 searches a build). Cache keys v=4.
  Worker only. Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`.

- **v138: the corridor keeps what is on the road** (the owner, against Meta's list: Maumee Antique Mall, 1,776 reviews
  on I-75, and Unique Antiques Warehouse, 600 m off US-23, were missing from the Novi to Blenko build though
  Around you finds both). A corridor circle was a Google *bias*, so its 20 answers wandered 19 miles off to Blissfield
  and Otway. The corridor is now boxes 25 miles apart and 14 miles to a side that Google must stay inside
  (`locationRestriction`; `gPlacesText(..., restrict)`), at most 80 searches a build. Size points add up (`sizeTier`:
  a big-place word, a crowd of reviews, dealers or square feet), so The Delaware Antique Mall (303 reviews) outranks a
  bare "WAREHOUSE 61" and Chillicothe Antique Emporium its warehouse neighbour. A flea market, record store or thrift
  shop is dropped when its chip is off (`kindAllowed`; odd Google kinds such as "Store" stay), so Bluegrass Collectors
  is Ashland's anchor, not Hillbilly Flea Market. Cache keys v=3. Worker only.
  Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`.

- **v137: the trip and near cache keys move to v=2**, so no build kept by v135 is served after v136 (a kept answer
  lives an hour; the owner's first look after the deploy would have shown the old 16-anchor list). Worker only.

- **v7.39 / v136: the road with the most to see** (the owner set Prowl's Novi to Blenko link beside Meta's itinerary:
  Meta's eight anchors ran US-23 through Portsmouth, Ashland and Huntington; Prowl searched only Google's fastest
  drive, US-35, and made 16 anchors out of every town with a hit, so the nine-waypoint Maps link stopped at
  Worthington and Maumee Antique Mall was missing).
  - **Alternative routes:** `/trip` asks Google for its alternatives (up to 3), searches each corridor (a circle and a
    query asked once however many routes share it, at most 60 searches a build), scores each route by its anchors
    (`routeScore`: 1 + size tier each, a little for what is nested) and keeps the best; the page says "The road with
    the most to see, N min longer than the fastest drive" (`route.slower`, `route.routes`).
  - **Antiques get their own query** a circle (`tripQueries`), so a big mall is never crowded out of Google's 20
    answers by vintage and thrift hits.
  - **Anchors:** a town is a stop worth planning around only when its best shop is a real antiques place or has 150+
    reviews (`ANCHOR_REVIEWS`, was 300; `splitAnchors`). The rest come back as `more`: "Smaller shops along the way
    (n)", a collapsed list under the trip, never in the Maps link, no Skip.
  - **Legs:** more than nine anchors become LEG 1, LEG 2 links in the foot, each leg ending at the next leg's first
    stop, the way Meta split it (`nrMapsLegs`).
  - Cost: a build is now about 25 to 50 Text Searches (two or three routes, two queries a circle, shared circles
    asked once), kept an hour per origin cell, destination, day and kinds.
  Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`, `__tests__/page/near-section-v736.test.mjs`.

- **v7.38 / v135: trips for Prowl Alerts members** (the owner tapped SHARE: "it took me to the den and tried to make
  me sign in, but i am pro"). SHARE, Your trips, FROM HERE on a kept trip and SHARE THIS FIND took only a store
  session (`prowl.session`); a member signed in by email code (`prowl.alertTok` + `prowl.alertEmail`) was "signed
  out". The page now sends the alerts email and token as `X-Prowl-Email` / `X-Prowl-Tok` (`nrH`, `nrSigned`), and the
  worker's `tripWho` takes them as it takes a Bearer session: the member's customer id when linked, else `e` + a hash
  of the address (never the address). `tripPro` counts the owner key, the comp list, the member's own Pro and paid
  orders. A share to an address that is an alerts member adds them at once; the email-code sign-in also links the
  account, so waiting invitations join.
  - **Kinds and skips** (the owner: "maybe someone wants to see records, toys, antique or thrift stores"; "let me at
    least discard ones i don't want to go to"). Chips on both tabs: Antiques, Vintage, Thrift (the spec's three, on by
    default), Records, Books, Toys, Flea markets (`prowl.nearCats`, new key, outside the backup; `cats=` on `/near`
    and `/trip`, kept on a trip record; one Google query a circle still). Every stop has **Skip**: a skipped place
    leaves the list and the Maps link (the page builds the link from what is left, `nrMapsFor`), the next shop in its
    town steps up as the anchor, and "N skipped · Show them again" undoes it. Skips are by place id (`prowl.nearSkip`,
    new key), so a shop stays skipped on later trips.
  Tests: `worker/__tests__/trip.test.mjs`, `trips.test.mjs`, `session.test.mjs`, `__tests__/page/near-section-v736.test.mjs`.

- **v7.37 / v134: FROM HERE and Refresh** (the owner: "each time i visit a location, i may want to rebuild, or find
  near places"). On any trip, **FROM HERE** in the foot reads a fresh fix and rebuilds the trip to the same
  destination: the stops behind you drop and the origin becomes that town. On your own kept trip the worker saves it
  (`POST /trips/<id>/rebuild { lat, lng }`, organizer only) so everyone on the trip sees the stops still ahead; on a
  built trip, or someone else's, it redraws your own view. Around you has **Refresh**, which re-reads the phone's
  position and the shops around it (the worker's 10-minute cache is per ~0.6-mile cell, so moving on gives a new list).
  Tests: `__tests__/page/near-section-v736.test.mjs`, `worker/__tests__/trips.test.mjs`.

- **v133: NEAR ME after the first live look** (the owner: "when i did this in meta, it found the best places to visit,
  big antique stores"). Worker only. `/pp` takes Google's photo names, which run past 400 characters, so every card
  photo was a 404 on day one. Around you keeps only places within 25 miles (`NEAR_KEEP_MI`; Google's circle is a bias, and
  Maumee, 60 miles off, was on a Novi list). The size signal counts only words that mean a big antiques place (antique
  mall, antique center or gallery or warehouse, emporium, flea market) and, for an antiques or vintage place, a crowd
  of reviews (300+ is a size, 1,000+ a bigger one; a thrift chain's reviews do not count), so "Pathway Market", a
  thrift shop with 89 reviews, no longer sits above Town Peddler's 2,204. Tests: `worker/__tests__/trip.test.mjs`,
  `trips.test.mjs`.

- **v7.36 / v132: NEAR ME is its own section: Around you, Road trip, group trips and Trip Finds** (the spec of
  2026-10-20, `Prowl NEAR ME, Road Trip & Trip Finds`). Branch `claude/new-session-pffeiw`.
  - **Its own screen.** The dock's NEAR ME opens `#otp-near` (two tabs, AROUND YOU and ROAD TRIP), never the Den. The
    Den's hidden LOCAL tab and the `den-near` dress are gone; the store finder, garage sales and Facebook city
    (`#otp-denLocal`, ids unchanged) moved into Around you under the live cards. How Prowl works and the glossary say so.
  - **Around you** (`GET /near?lat&lng`, worker): the antique, vintage and thrift shops around the phone, ranked size
    first (dealer or booth count, square feet, "mall"/"warehouse"), then rating weighted by review count, then
    distance. A card: photo (through `/pp`, the key never reaches the page), name, town, one-line differentiator,
    today's hours, OPEN NOW / CLOSED worked out when the card is drawn from the week's periods and the place's UTC
    offset (`nrState`). One tap opens Google Maps. Location off or the key not set: the Maps links below still work.
  - **Road trip** (`GET /trip?to&lat&lng&day`): one box, where to. The worker maps the drive (Routes API), searches
    the corridor one circle per 30 miles (Places Text Search), keeps stops within 10 minutes of detour (internal, never
    shown), clusters each town into one anchor with the rest nested, in drive order, hours for the trip's day (seven
    day pills, Today first). **OPEN IN MAPS** is pinned at the foot: one directions link, origin as a town name only,
    anchors as waypoints (nine at most), destination. An empty corridor is plain copy plus the route, never an error.
  - **Group trips** (`/trips`, a store sign-in): SHARE keeps the trip in KV (`trip:<id>`, `trips:<cid>`, `trips:all`) and
    the organizer adds members by account email; the address is hashed (`acct:<hash>`, written at every store
    sign-in), a stranger to Prowl waits in `tripinv:<hash>` and joins at their first sign-in. Every member sees the
    identical trip with live hours. **Pro is decided on the worker:** `PRO_CIDS` (the comp list of customer ids the
    organizer arranges with the owner), a linked member's Pro, or the customer's own paid orders. The page never does.
  - **Trip Finds** (`/trips/<id>/finds`, `/finds/...`): a photo check's result has **SHARE THIS FIND** when a trip is on
    (`prowl.trip`, new key, outside the backup): the photo (shrunk to 800 px JPEG on the phone), what it is, the
    asking price, the call, the nearest stop or town and the member's first name post to the trip. Photos go to R2
    (`PROWL_FINDS`, `finds/<trip>/<find>.jpg`), served only through signed hour-long links to members, refused once
    the trip has expired, and deleted by `tripSweep` 7 days after the trip closes (`FINDS_GRACE_DAYS`). View-only.
  - **Needs the owner** (see Waiting on Matt): only `PRO_CIDS` for a group. The secret `GOOGLE_MAPS_KEY`, the R2
    bucket `prowl-finds` (bound in `wrangler.toml`) and its lifecycle rule were set up on 2026-10-20.
  - Tests: `worker/__tests__/trip.test.mjs` (the pure module, the reference route Novi to Blenko, Monday hours),
    `worker/__tests__/trips.test.mjs` (the routes against a fake Google, KV and R2), `__tests__/page/near-section-v736.test.mjs`;
    `near-me`, `five-tabs-v730` and `local-dock` updated.
- **v7.35 + worker v131: the new plans, and the email ask** (Matt, 2026-10-20: "everything that the customer does is
  free"; "3 hunts is good, pro gets unlimited ... once they get the email, they can adjust this"; "unlimited photo
  checks, people can use to price their stuff"; "we can just say owl and twig vintage". The goal: get the email, so
  alerts bring people back to search and buy through the affiliate links).
  - **Plans (worker v131):** one free plan for every member: alerts for 3 hunts (`ALERT_FREE_HUNTS`, default 3) at the
    pace they pick. The v55 split (members after Oct 4, 2026 got 1 hunt on Mondays; `ALERT_FREE_HUNTS_NEW`) is gone:
    `alFree` no longer reads it and `alFreeWeekly` is always false. Pro covers up to 100 hunts (`AL_MAX_HUNTS`, was
    25) and photo checks are "unlimited" with a fair-use ceiling of 100 a day (`PHOTO_PRO_PER_DAY`, was 25). The
    Den still holds 5 hunts on Free and 100 on Pro (Matt's choice). Emails and perks say the new plan.
  - **Plan copy (page):** every place that quoted 1 hunt on Mondays, 25 hunts or 25 photo checks says Free: 3 hunts,
    Pro: up to 100 hunts, unlimited photo checks (fair use, 100 a day). The plan table follows.
  - **The email ask:** under every email box, "From Owl & Twig Vintage. No password. Your email is never sold or
    shared. One tap to unsubscribe." (`mailTrust`), and a preview of the email from the visitor's own hunt, up to 3
    listings Prowl already has (`mailPreview`; nothing is fetched for it). Daily counts the days it was opened (new key
    `prowl.dailyDays`); from the second day a not-signed-in visitor gets a "Get your daily prowl by email" card. The
    Den's hunts tab says "Your hunts live only on this device. Keep them safe with your email" (`#otp-denSafe`).
  - **For Matt:** the Prowl Pro product page on Shopify (`/products/prowl-pro`) is not in this repo; its description
    may still say 25 hunts and 25 photo checks. Alert capacity is shared (`ALERT_BATCH` hunts per 5-minute run); watch
    the admin's checked counts as members grow.
  Test: `worker/__tests__/plans-v131.test.mjs`, `__tests__/page/email-ask-v735.test.mjs`; the photo copy test in
  `motion.test.mjs` updated.
- **v7.34 / v130: one piece on several sites, with each site's price** (the owner, on a Rookwood owl at $190 on Etsy,
  $211 on Poshmark and on eBay: "show that it is listed in 2 other places, and they have different prices. say someone
  doesn't trust poshmark, but would buy from etsy, or if lowest price need to include the shipping").
  - Worker `hunt.js`: a long title (4+ meaningful words) on two sites is the same piece up to 60% apart
    (`HUNT_XPOST_GAP`, `huntSamePiece`) when neither title has a word the other lacks on both sides (blue vs green glaze
    stays apart), the numbers match (6 vs 4 inch, 1946 vs 1922 stay apart) and both or neither are a lot or pair; short
    titles still need 6%. Every pair in a group must pass on its own (no chains), one listing per site. Copies are grouped, the cheapest leads (one Best pick spot, not
    three), and every copy carries `also`: the other sites with price and link. eBay listings carry `ship` (free or
    $X, from eBay's search; the other sites do not say). `/hunt` cache key v=2.
  - Page: a card says "Also on eBay $205.00 + $12.50 shipping · Poshmark $211.00" (cards drawn before /hunt
    answered get it from pickMark); the popup lists each site with its
    price, shipping when known and a View link ("Shipping is extra unless shown"); Fair price is told.
  - Tests: `worker/__tests__/hunt.test.mjs`, `ebay-ship.test.mjs`, `__tests__/page/cross-post-v734.test.mjs`.

- **v7.33: the popup's Price check, readable and untagged** (the owner, on an Etsy Rookwood vase: "Best pick is
  overlapping price check ... font for price check seems different and too small to read on phone"). The price check
  box carries the listing's data-u, so pickMark tagged it Best pick and the badge sat on its first line; pickMark and
  the badge rules now skip `.pp-fp`. In the popup the price check reads at 16px in the popup's font (notes 14px), not a
  result card's 13px. Page only. Test: `__tests__/page/popup-price-check-v733.test.mjs`.

- **v7.32 / v129: the owner's error list of 2026-10-20.**
  - **A card with no photo gets the listing's own** (a ShopGoodwill camo backpack was blank in Daily, its popup had
    the photos). A missing photo, or one that fails to load, is filled from `/item` (the popup's call, cached in
    ITEMC), one call per listing, kept in PHOTO for redraws, no loop if that photo fails too.
  - **No repair flag for "free from chips, cracks and repairs"** (a Rookwood cat). FLAG_NO also reads "free from",
    "nor", "neither", "absent" and "devoid of"; "n't" counts only right before the damage word (FLAG_NT), so "small
    chip, doesn't affect display" still flags.
  - **A hunt shows its own results first** (opening MC Escher showed New since your last look, the other hunts'
    buttons and Best picks before MC Escher). With a hunt open, the other hunts' new listings are one line, "New in your
    other hunts: Rookwood 9+ · porcelain panther 3", each opening its hunt (`homeNewLine`; Daily counts from another
    baseline, so it is not the target); the New since your last look cards stay only with no hunt open.
    Marketplaces with listings come before the empty ones ("Nothing live on ShopGoodwill" moved down).
  - **"Brookwood" no longer matches the Rookwood hunt** (worker v129). ShopGoodwill's search is loose, so its
    listings keep only titles with every word of the hunt (`sgwExact`: plurals and a final e allowed; filler words such
    as vintage, vtg, antique not required; "M.C. Escher", "Midcentury", "Fire-King" match mc escher, mid century,
    fireking on whole-word edges), in the live search, alerts and liveFetch. No fallback.
  - **Words stay inside the hunt pills** ("the words fall out of pills sometimes"): the home panel's hunt buttons
    (`.hn-go`) wrap onto two lines instead of running out. (A rule on every `.b` was tried and dropped: it cut "Open
    first N of M" off on phones.)
  - Tests: `__tests__/page/card-photo-v732.test.mjs`, `hunt-order-v732.test.mjs`, `popup-flags-v710.test.mjs`,
    `home-new-v709.test.mjs` (now the one-line behaviour), `worker/__tests__/sgw-exact.test.mjs`.

- **v7.31: the first visit, and the extras out of the way** (Matt, 2026-10-20: "yes, do them all, they are good
  ideas"; step 2 of the simplification).
  - **First visit:** How Prowl works no longer opens by itself (it is in the menu). No sample hunts (`DEF` is empty;
    was ceramic panther, Halloween decor, ceramic Christmas tree). Under the search box, `#otp-start`: three steps
    (Search, Keep, Prowl watches) and Try one, the first 8 of `OLD_DEF`. Until a hunt is kept, the wrapper has
    `is-new`, which hides the empty hunts panel, the guide card, the Get the app card and the home Alerts box. The
    "v7.xx · live" line shows only with the owner key.
  - **Keep this hunt** is the primary button on a single-hunt result, with "new ones show in Daily"; once kept, an
    "Email me when they land" link (no alerts sign-in yet) opens Den › Settings.
  - **Results:** one sideways row per marketplace in a hunt, Daily and the home panel (`#otp-res`/`#otp-sgw`
    `.sgw-grid` is a horizontal scroller). A 9-marketplace hunt at 390 px went from about 7,100 px to 3,700 px.
  - **One button per card:** result cards keep only the heart. Save this find is in the listing popup (`.pp-sv`) and
    Fair price? is in its Price check, which now starts open. A site the popup cannot read (Chairish, Poshmark,
    Vinted, Grailed) opens a light popup drawn from the card (`popOpen(card, lite)`, no `/item` call), so Save and
    Fair price? are on every result. Flock cards are unchanged.
  - **More places to look:** the simple mode's Show all N marketplaces is now More places to look, and it also folds
    Facebook in every city, Instagram, eBay Sold, Terapeak and the tab notes (`.rf`). The "tap any row" toast is gone.
  - **Alerts box once:** not on a search (`is-run`), not on a first visit, and Daily's big card is one line ("Want
    these by email?").
  Test: `__tests__/page/first-visit-v731.test.mjs`; `card-row`, `detail-shelf-v708`, `flock-den-near`, `flock-next`,
  `help-app-v710`, `help-film-v714`, `jellycat-v726`, `popup-home`, `salvation` and `five-tabs-v730` updated.
- **v7.30: five tabs, one job each** (Matt, 2026-10-20, after showing his wife: "too complicated for people to use";
  "hunt is ... focused hunts", "DAILY ... maybe we only show new stuff", "local's intent is to be used when you are
  out in the car"). Step 1 of the simplification plan; the first-visit path and the Pro offer come next.
  - **Dock:** HUNT · DAILY · FLOCK · NEAR ME · DEN (was PROWL · GOODWILL · LOCAL · FLOCK · DAILY · DEN). The
    `data-m` values are unchanged (`prowl`, `daily`, `flock`, `local`, `den`); `#otp-oneBtn` is gone.
  - **Just ShopGoodwill:** the one-site search that was the GOODWILL tab is a pill under the search box (`#otp-one`,
    where Near me was), named after the site picked in the Den (`st.one`). Typed: runs that hunt on that site; empty:
    the one-site screen, as before.
  - **Near me:** its own screen: the Den drawer with the Den's tabs hidden (`.den-near`), titled Near me, stores first,
    then garage sales and Facebook, the city box and help after. The Den's LOCAL tab is hidden; DEN always opens the
    Den.
  - **Daily is only what is new:** each locked hunt shows its new listings since the last day's Daily (at most 6) and
    See all opens the hunt; a quiet hunt is one line ("nothing new"). The first Daily on a device is "A first look": a
    few live listings a hunt. The marketplace-by-marketplace blocks left Daily, and the alerts card moved below the
    finds. Daily at 390 px went from about 13,400 px tall to 5,400 px in the 3-hunt check.
  - How Prowl works and Prowl's words name the new tabs (Near me added to the glossary).
  Test: `__tests__/page/five-tabs-v730.test.mjs`; `daily-screen-v709`, `near-me`, `declutter-v703`, `flock` and
  `vinted-invite` updated.
- **v7.29: Possible reproduction in the listing popup, with why** (the owner, on a "Brad Keeler Style" flamingo:
  "possible reproduction shows up in the search listing, but not in the card ... and what is wrong with it, bring it
  back"). A card tagged Possible reproduction opens a popup with the same warning (`.pp-repro`) and the reason: the
  title's own words when they say it ("Brad Keeler Style": made to look like a maker's work; "reissue", "replica":
  not an original), else what the check looks for, and to look for the maker's mark. Fair price is told first. Test:
  `__tests__/page/popup-flags-v710.test.mjs`.

- **v128: Etsy listing details in English** (the owner: a Hertwig panther from a German shop "is in english on etsy but
  shows up in german in the prowl app"). Etsy's API answers in the shop's language; the seller's English is a separate
  translation (`shops/<shop>/listings/<id>/translations/en-US`, then `en-GB`). When the listing's language is not English
  the worker asks for it and uses its title and description; with none it keeps the shop's own text (Etsy's own
  machine translation on its site is not in the API). Tests: `worker/__tests__/item-etsy.test.mjs`.
- **v7.29 / v128: Ships from, for a seller outside the US** (the owner: "flag that it is international / german so that
  you know this before thinking about bidding"). The worker's item details carry `from: { cc, name }` from the Etsy
  shop's `shop_location_country_iso` or the eBay item's `itemLocation.country` (not for the US); the popup shows
  "Ships from Germany" with a line on shipping, customs and import fees (`.pp-intl`), and tells Fair price. Search
  cards don't show it yet (Etsy's search has no shop country). Tests: `worker/__tests__/item.test.mjs`,
  `item-etsy.test.mjs`, `__tests__/page/popup-flags-v710.test.mjs`.

- **v7.28: Found on the Prowl shows only vintage** (the owner: it "is showing new parts it should only show the vintage
  stuff"). `isVintageProduct` was a block list (studio types and tags), so Printify's Scented Soy Candle and Skull Castle
  Woven Blanket (type Home Decor) showed in the Den › About strip. Now a product must be tagged **Vintage** or **Estate**
  (every real find is) and not come from vendor **Printify**; the old block lists still apply. Page only. Test:
  `__tests__/page/found-strip-vintage-v728.test.mjs` (fails on v7.27).

- **v7.27 + worker v127: Prowl usage moves to the admin** (the owner, on Den › Stats' "Prowl usage": "shouldn't this be on
  admin only?"). The admin's Searches tab has a new **Visitors** card: people searching and searches per UTC day for 14
  days and where the page's visitors came from for 7 days (`GET /admin/api/usage`, admin sign-in; read when the tab opens,
  at most every 5 minutes, not on the overview's refresh). `GET /owner-stats` is gone; the Den shows owner-key devices only
  a link to `/admin#searches`. Where visitors came from needs the worker secrets **CF_API_TOKEN** (Account Analytics: Read),
  **CF_ACCOUNT_ID** and **CF_SITE_TAG**; the owner added them on 2026-10-19. Tests: `worker/__tests__/admin.test.mjs`
  (usage), `worker/__tests__/referrers.test.mjs` (was owner-stats), `__tests__/page/den-stats-v722.test.mjs`.
- **v7.26 + worker v126: from Jellycat's shop** (the owner sent us.jellycat.com product screenshots "for inspiration" and
  picked four ideas). Checked in Chromium at 390 px, Light and Blue hour, with stubbed results (beside main's).
  - **Calm result cards:** a result card's title is in normal case and centred, at most 2 lines (was UPPERCASE, 3
    lines), with the price under it in ink (was the accent colour). The border is a thin line, with no offset shadow
    in the New look. Only the results grids change: Flock and the Likes grid keep their own cards, and the "new" glow stays.
  - **Outlined tags:** New, Possible reproduction and "% off" are outlined boxes now, like Jellycat's "Best Seller",
    and Got away is outlined too. **Best pick:** a result that is one of its hunt's Best picks gets an outlined
    "Best pick" tag on the photo (`.is-pick`, `pickMark`, on the same MutationObserver as Got away; only for this
    visit). It stays off Flock and Likes cards.
  - **Seller stars** under the price, on cards and in the popup (`slrHtml`). eBay shows one star and the seller's
    positive feedback, "★ 99.8% (12k)" (`seller { pct, n }` from eBay's feedbackPercentage and feedbackScore, in search
    results and `/item`). Etsy's `/item` shows five stars filled to the shop's review average, with the review count
    (`seller { stars, n }`). Numbers only: the worker never sends the seller's name. `cleanItems` keeps them through
    `slrClean`.
  - **Popup sections:** under + / − headings like Jellycat's PRODUCT DETAILS. **Item details** (specifics and
    description) starts open. **Price check** (Fair price? and What it sold for on eBay) starts closed unless a verdict
    is already in hand. The title, price, stars and Search this on Prowl are centred, and View on eBay stays pinned at the foot. A repaint
    (the details arriving) keeps the sections as the visitor left them.
  - No new localStorage keys. No change to page room (CSS and JS are on the worker).
  - Tests: `__tests__/page/jellycat-v726.test.mjs`, `worker/__tests__/seller-stars.test.mjs`, plus an Etsy case in
    `item-etsy.test.mjs`. `popup-v699` and `flock-bar` were updated for the new markup.
  - Seen in passing: `cleanItems` also drops the worker's `was`/`off`/`listed`/`relisted`. So the sale tag and the
    listing age only show in the popup (from `/item`), never on a results card.
  - Prowl points (a rewards idea from Jellycat Purrks) was planned, then **cancelled by the owner on 2026-10-19**.
    Don't build it unless the owner asks again.
- **v7.25: Blue hour in the Classic look** (the owner: "The blue hour is missing now. Only three themes. But there are
  4 modes. I'm in classic mode"). Classic's dark (labelled Blue hour) and Midnight were the same near-black `#070706`
  since v6.37; only the New look had Blue hour's navy. Classic Blue hour now has the same navy palette (selector
  `[data-theme=dark]:not([data-dark=midnight]) .scout-app-wrapper:not(.k2)`) with Classic's amber accents. Settings and
  How Prowl works now name all four modes (they said "all three"). Checked in Chromium, both looks, all four modes.
  Test: `__tests__/page/blue-hour-classic-v725.test.mjs`.
- **v7.24: a firefly field in the dark themes** (the owner, on GhostNode's starfield: "it has a glow to it and it moves
  with the cursor, I wanted this with fireflies instead"). In Dark, Midnight and Uranium, 12 to 36 fireflies (by screen
  size) drift over the page, each blinking on its own beat; nearer ones are bigger and move more with the mouse, a soft
  glow follows it, and fireflies near it drift in and brighten. Lights on body (`.pm-fly`, like the hunt swarm), z-index
  1 so under the bar, dock and drawers, pointer-events none, `mix-blend-mode:screen`. Transform and opacity only, paused
  while the tab is hidden; never in Light or under reduced motion. New key `prowl.fireflies` = `'0'` turns it off (no
  switch in Settings yet). Touch does not move it. Our own code, not GhostNode's. Checked in Chromium (Uranium 1280 px,
  Dark 390 px). It lives in the page's second script (not served by the worker), about 3.5 KB of the page body.
  Test: `__tests__/page/fireflies-field-v724.test.mjs`.
- **v7.23: from the eBay teardown, in the panther's words** (Matt, 2026-10-18: "keep the panther related terms",
  "keep Den", "keep locked on", "keep it crash free").
  - **On the lookout:** Hunt with an empty box no longer silently re-runs the ticked hunts. It opens "What are we
    hunting?" (`#otp-bolo`): your hunts, locked-on first, then **On the lookout**, BOLO's old auto-filled starter
    terms (`OLD_DEF`) less the ones already yours, 8 each. A chip runs that one hunt (`boloRun`); typing puts them
    away. The hunt sparkle only plays when there is a term. The BOLO marketplace tab is unchanged.
  - **Related hunts on an empty search:** under "Email me when it shows up", "Or try": the hunt with a word fewer,
    then your hunts and On the lookout terms that share a word (`relTerms`, at most 5). Any `[data-bolo]` chip in the
    app runs its hunt.
  - **Got away:** when a popup finds a listing ended, its URL goes in `prowl.gotAway` (new key, newest 300) and every
    card of it, anywhere, gets a "Got away" tag and a grey photo (`.is-gone`, a MutationObserver on the app). It still
    opens, to Watch for the next one. Not `goneGet`: that name was already the un-liked list (v6.48).
  - **Locked on / Hiding:** the Den's lock reads "Locked on" or "Hiding" (aria-pressed), with a 🔔 instead of ◉ when
    the member's alerts watch that hunt (signed in, emails on, within the plan's count: `denBell`). Toasts: "Locked on
    X." / "X is hiding in your Den."
  - **Prowl's words:** a glossary at the end of How Prowl works (Prowl, Hunt, Den, Locked on, Hiding, Daily, Flock,
    On the lookout, Best picks, Pounce, Quarry, Got away, Paw prints).
  - Checked in Chromium at 390 px. Already there, so not rebuilt: Keep in the results header, How Prowl works on a
    first visit, the Daily header, "N new" on Den hunts. "Prowling" stays (Matt: panther words).
  - **Deploy fix (same version):** the first deploy sent v7.23 but failed its md5 check, because Shopify saves a
    `<dd>` that follows `</dt>` on its own line. The glossary is now written that way, and a test fails if body
    markup has `</dt><dd>` again. Markup built inside the scripts is not affected.
  Test: `__tests__/page/lookout-v723.test.mjs`; `motion.test.mjs` (a hunt needs a term to sparkle).
- **v7.22 + worker v125: Den › STATS holds every analytic and graph** (Matt: "I'd like this and any other analytics and
  graphs in the menu area", and "can it show me how someone came to the site?"). New tab between ABOUT and SETTINGS:
  "Your hunting" (this device: searches per day for 14 days from `prowl.runs`, finds saved per week for 8 weeks from
  `prowl.finds`), then Your marketplaces (moved out of Settings). With the owner key (`prowl.owner`) it also shows
  "Prowl usage" from the new `GET /owner-stats` (owner only, 403 otherwise): people searching per day (new stat kind
  `u`, ticked once per search on `/ebay`, distinct daily-salted IP hashes, so it starts at 0 on v125), searches, the
  week's top terms, and **where visitors came from** (Cloudflare Web Analytics referrers via the GraphQL Analytics API,
  `cfReferrers`). Referrers need three worker secrets: **CF_API_TOKEN** (Account Analytics: Read), **CF_ACCOUNT_ID**,
  **CF_SITE_TAG**; without them the panel says "Not connected yet". No new localStorage keys. Tests:
  `__tests__/page/den-stats-v722.test.mjs`, `worker/__tests__/owner-stats.test.mjs`.

- **v7.21 + worker v124: the page's main script is served by the worker** (Matt: "why is there a limit??"). The
  Shopify page body went from 100,030 bytes under the 512 KB cap to 408,229, the way v6.92 moved the stylesheet. The
  repo page keeps the script inline in `<script id="prowl-js">`; **after any change to it run
  `node scripts/build-page-css.mjs`** (it now writes `worker/page-js.js` too, and a test fails until you do; after
  merging main, rebuild). The deploy sends `<script src="…/js/prowl.<hash>.js">` in its place (blocking, so it runs
  where it did) and waits for the worker to serve that hash. If it does not load, the page asks once more, then shows
  "Prowl could not load. Tap to try again". **If the worker is down, Prowl does not run** (before, it ran without live
  results); the browser keeps the script a year. Checked in Chromium: runs, a missed first load retries and runs, a down
  worker shows the note over the styled page. See `page/README.md`, Main script on the worker. Tests:
  `__tests__/page/page-js.test.mjs`; `page-css.test.mjs` and `slim.test.mjs` updated.
- **v7.20 + worker v123: eBay listing age, and phone alerts that say why they failed** (Matt, 2026-10-18).
  - **Listing age** ("is there a way to show ebay aging? how many times it has been listed"): eBay search results and
    `/item` carry `listed` (eBay's itemOriginDate, the first listing, else itemCreationDate) and `relisted` (the
    creation date when it is a day or more later); `ebayAge`, future dates ignored. The popup's detail line reads
    "Listed 12 days ago", or "Listed Mar 2 (7 months ago), relisted Oct 8" (`popAge`, calendar days, UTC). Search
    items keep them in `SVI` (ls/rl) for a popup whose `/item` lacks them. **eBay gives no relist count.**
  - **Phone alerts** (Matt: "Prowl could not reach this phone", it used to work): Send test now goes the way Alert
    this phone does (re-registers this phone, then the worker tests it), so a lost or renewed address is mended.
    `/push/subscribe` and `/push/test` answer `codes` (the push service's status per phone that did not take it); a
    refused key (401/403) or expired address (404/410) gets one fresh subscription; a failure says why (`wpWhy`).
    Not found from here: why it stopped. Phones are stored under a key made with MEMBER_ID_SALT, else ADMIN_KEY, so
    **changing ADMIN_KEY without MEMBER_ID_SALT set disconnects every phone** (re-registering mends it).
  - Pounce's intro says what a quarry is ("the piece you stalk, the way a panther stalks its prey").
  - **Room: 100,030 bytes, 30 over the 100 KB guard** (`page-css.test.mjs`). The next page change must trim first.
  Tests: `__tests__/page/ebay-age-v720.test.mjs`, `__tests__/page/push-button.test.mjs`, `worker/__tests__/ebay-age.test.mjs`,
  `worker/__tests__/push.test.mjs`.
- **v7.19 + worker v122: Pounce with no form, a price range, and two ideas from the UX spec** (Matt, 2026-10-18).
  - **One-tap Pounce** (Matt: "why do I need to fill out the form for Pounce, why can't it just find the items?"):
    each hunt in Den › Settings › Pounce has **🐾 Pounce** (and Describe it). One tap saves a quarry with no
    description, `any: 1`; the worker judges new listings as "any genuine example of what the hunt names" (not a
    thing that only shares a word, a reproduction or a mixed lot). The row reads "Any Padilla it finds"; Edit narrows
    it. The description is optional now (the "Describe the piece in a few words first" check is gone); an empty one
    saves as any. Stop stalking still removes it.
  - **Price range on a quarry** (Matt: "if we are doing max min inches we should have max price/min price too"): Min
    price $ / Max price $ (`lo`, `hi`, whole dollars, 0 = any). The worker's free pre-filter drops a listing whose
    shown price is outside it ("under $40" / "over $300"); a listing with no price goes to the judge.
  - **An ended listing offers to watch for the next one** (the spec's "it just slipped away"): the popup's grey "This
    listing ended." is now "This one got away. Prowl can watch for the next one." with **Watch for the next one**,
    which makes the cleaned title (`popTerm`, as Search this on Prowl) a favorite hunt through `sgwAdd` (a full Den
    says so). On an ended listing View on <site> is no longer pinned. Max price "10% above" from the spec is left out.
  - **A Pounce note opens the find** (the spec's "Alert Match" screen): `?pounce=<url>` still opens Den › Settings at
    the match, and now opens that find's listing popup over it with "🐾 Pounce match for <hunt>", Pounce's reason and
    Not it (`pncPop`, `pncPopNot`). &fp=1 runs Fair price in the popup.
  Tests: `__tests__/page/pounce-popup-v719.test.mjs`, `worker/__tests__/pounce.test.mjs` (any + price range).
  No localStorage keys changed. Free is still 1 quarry, Pro 5.
- **v7.18: a Best picks card opens the listing popup** (Matt: "fix the best picks popup it should have same
  behaviour"; built as v7.17, renumbered when v7.17 merged first). `.pk-card` now carries data-u/t/p/s, and the result-card tap handler opens it with `popOpen` like any
  other card: photos, Fair price?, What it sold for, Share, View on. Picks the popup cannot show (Craigslist,
  Poshmark…) still open in their own tab. Test: `__tests__/page/picks-popup-v718.test.mjs`.
- **v7.17: Undo on a favorite hunt chip's ×** (Matt, 2026-10-17, the gap left after v7.12 made that × a 44 px tap;
  built as v7.13, renumbered when v7.13 to v7.16 merged first). All three things the × does now say so and offer
  Undo for 5 seconds (`CHIP_UNDO`, `chipUndo`, `#otp-unchip`): a locked Den hunt goes back to the Den ("moved back to
  your Den", Undo locks it again if the Den still has it in the same place); the first-visit sample chips are cleared
  ("Sample hunts cleared", Undo brings them back, still not saved); a favorite of your own is removed ("removed from
  your favorites", Undo puts it back in its place in `owlTwigSgwTerms`). Test: `__tests__/page/chip-undo-v717.test.mjs`.
  No localStorage keys changed.
- **v7.16: the launch film, redrawn as the real app** (Matt, 2026-10-17/18: "use my panther", then "my app doesn't
  look like that"). The help's film card (`#otp-film`) plays the new cut: Matt's own panther artwork
  (`video/launch-film/assets/art/prowl-panther.webp`) and an app window drawn from the real page (dotted cream, brown
  outlines, Find the prey, the orange Hunt button, result cards, the dock, the listing popup with the real repair and
  damage flag). The panther glides as a ceramic figurine instead of walking (Matt: "the panther walking looks
  weird"). Only the card's `data-src` changed, to the original upload in Shopify Files
  (`cdn.shopify.com/videos/c/o/v/767c569b...mp4`, Video `46547817005310`, uploaded through the Admin API). Matt takes
  the older uploads down (including Video `46547634979070`, the walking cut). The film says "28 marketplaces" and the page counts 29; Matt: "doesn't matter", leave both.

- **v7.15 + worker v121: share a photo into Prowl on Android** (Matt, 2026-10-17: "Android same way" as the Chrome
  extension's image menu). The installed app shows up in Android's share sheet for images; the photo opens straight
  in Photo check. How: the theme asset `prowl-manifest.json` has a `share_target` (POST multipart, field `photo`, action
  `/pages/prowl-app?share-target=1`); the app page registers `/apps/prowl/sw.js` with scope `/pages/prowl-app` (the
  worker now sends `Service-Worker-Allowed: /pages/prowl-app`; skipped on iPhone, which has no web share target);
  `worker/sw.js` answers only that POST, keeps the photo in Cache Storage (`prowl-share`) and redirects to `?shared=1`,
  where the page runs it through `window.prowlPhotoFile`. The photo never leaves the phone until Photo check sends it
  as before. The app must have been opened once after this update before it can receive a share; Android adds Prowl
  to the share sheet after it refreshes the installed app's manifest (can take up to a day, or reinstall).
  Tests: `__tests__/page/share-photo-v715.test.mjs`, `worker/__tests__/share-target.test.mjs`.

- **v7.14: the launch film in How Prowl works** (Matt, 2026-10-17: "add the horizontal video here, we need a help
  section"). The 20-second film (`video/launch-film/`, HyperFrames) sits at the top of How Prowl works as a play card
  (`#otp-film`; the vertical 1080x1920 cut is generated into `video/launch-film-vertical/`); nothing loads until it is tapped, then a `<video>` plays it from Shopify's CDN (Content › Files) and it
  pauses when the help closes. The film's address is the card's `data-src`; to swap the film, upload the new MP4 to
  Shopify Files and change that one URL. Note the film says "28 marketplaces"; the page counts 29.
  Test: `__tests__/page/help-film-v714.test.mjs`.
- **v7.13: the dock's numbers sit beside the icons** (Matt: the Flock count "is blocking the cool bird icon"). The
  badge (`.db .bd`, Flock and Daily) moved from 50% + 6px, on the icon, to 50% + 14px and 6px from the top, past
  the 22px icon's edge. Checked in Chromium at 412 px and 1280 px, Uranium. Test: `__tests__/page/dock-badge-v713.test.mjs`.
- **v7.12: three fixes from the UI/UX brief check** (Matt, 2026-10-17, items 1 to 3 of the audit).
  - **View on <site> stays on screen** in the listing popup: it sits in `.pp-dock`, sticky at the foot of the
    sheet's scrolling body, so it shows over the photos and details and settles above Share and Close at the end.
    Checked in Chromium at 390 px and 1280 px.
  - **Undo** on "Hunt removed." (Den) and "Removed from saved finds." (any star), 5 seconds. The hunt goes back in
    its place with its tick and lock (`HUNT_UNDO`, `unmap`); a hunt typed in again meanwhile is not doubled. The
    find goes back in its place with its first saved time (`FIND_UNDO`). One toast listener (`#otp-unhunt`,
    `#otp-unfind`); Flock's discard Undo is unchanged.
  - **44 px tap areas** for the favorite hunt chip's ×, the Likes chips' ×, a result card's star, heart and Fair
    price, Flock's Feed/Saved switch and the toast's Undo: an invisible `::after` 44 px across, so nothing looks
    different. The chip's × reaches a few pixels into the chip's own label.
  Test: `__tests__/page/undo-tap-v712.test.mjs`. No localStorage keys changed.
- **v7.11: How Prowl works starts at step 1** (Matt, 2026-10-17: a new visitor's help jumped to step 6). `openM`
  focused Got it, which sits under step 6, so the browser scrolled the help to its end. Now it focuses with
  `preventScroll` and sets the dialog's `scrollTop` to 0 (older Safari ignores `preventScroll`). Test:
  `__tests__/page/help-top-v711.test.mjs` (fails on v7.10).
- **Worker v120: Prowl admin as a phone app** (Matt, 2026-10-17). `/admin` now installs to the home screen: new
  `worker/admin-app.js` serves `/admin/app.webmanifest` (standalone, opens on `#members`), owl icons (180/192/512,
  512 maskable) and `/admin/sw.js` (pass-through, offline note only, caches nothing). Both admin pages link them; CSP
  adds `manifest-src` / `worker-src 'self'`. Install: Android Chrome menu > Install app; iPhone Safari Share > Add to
  Home Screen. Sign-in is still the 12-hour ADMIN_KEY session. Test `worker/__tests__/admin-app.test.mjs`.
- **v7.10: Back keeps your place** (Matt, 2026-10-17: in Daily, a card's popup closed with Android's Back and the
  screen jumped to the top, while its X left it where it was). Back steps onto the history entry Prowl pushed when the
  first layer opened (v6.55), and the browser restored the scroll it had saved with that entry: the top of Daily.
  While Prowl's own entries are in use `history.scrollRestoration` is `manual`; once every layer is closed it is
  `auto` again (`ovScroll`). Reproduced in Chromium on v7.09 (2246 px → 0) and fixed (stays at 2246). Test:
  `__tests__/page/back-button.test.mjs`.
  Also: **a shared find links to Prowl** (Matt: "we say found with prowl but no link"). The sign-off reads "Found with
  Prowl, a vintage search tool from Owl & Twig Vintage: owlandtwigvintage.com/prowl" (`SHARE_HOME`). That address is a
  **Shopify URL redirect Matt adds** (Online Store › Navigation › URL redirects: `/prowl` → `/pages/prowl`); it must
  exist before this merges. Not bit.ly: a shortener reads as spam, and its free plan allows a few links a month.
  Also: **Get the app comes first in How Prowl works** (Matt: "When people first come to it I want them to get to the
  app version but they don't see it until the end"). How Prowl works opens by itself on a first visit; it now starts
  with the Get the Prowl app card (`.otp-getapp[data-mode=help]`: Get the app and Open it now, or Install on the app
  page; hidden in the installed app), and its old step 5 is gone (six steps now). The home page's own app card is often
  hidden for new visitors, since one promo shows at a time and they get the alerts one. A tap on the card closes the
  help. The help's Near me and Daily lines now say what v7.09 made them do. Test: `__tests__/page/help-app-v710.test.mjs`.
  Also, **worker v119 + the listing popup** (Matt, on an Etsy astronaut figurine at 20% off that showed full price and
  said "One arm has a repair."):
  - **Sales:** eBay's `marketingPrice` rides along as `was`/`off` on search results and `/item` (`ebaySale`; not for
    auctions, only when the old price is higher). The popup and result cards show "$358.40 ~~$448.00~~ 20% off";
    Pounce keeps it with a match ("on sale, was $X" on the Den card and in the phone note). **Etsy sales cannot be
    seen:** Etsy's Open API gives the list price only, so an Etsy listing on sale still shows its full price.
  - **Repair and damage flags:** a sentence in the title, condition or description that mentions a repair
    (repaired, restored, glued, touch-up, repainted) or damage (chip, crack, hairline, crazing, broken, missing, as is)
    shows above the fold as "⚠ Mentions a repair" with the seller's words (`popFlags`); a sentence with no/not/without
    ("No chips, cracks or repairs") is not a flag. Fair price is told the flag and the sale first (its details are cut
    at 600 characters).
  - **What it sold for on eBay ↗** in the popup: eBay's sold listings for the cleaned title, in a new tab (`popSold`).
  - The star reads its card if Prowl's 400-listing memory (`SVI`) has dropped the listing, and says so when a save
    cannot be made, instead of doing nothing. Matt's "In flock the star doesn't work" was **not reproduced** (it saved
    in jsdom and in Chromium with a real tap); this only closes a silent failure.
  Tests: `__tests__/page/popup-flags-v710.test.mjs`, `worker/__tests__/ebay-sale.test.mjs`.
- **v7.09: Daily announces itself (Matt, 2026-10-17: "it reads as I tapped DAILY and nothing changed").** Daily is
  its own screen now: the date, **Your daily prowl**, "N hunts · X new since yesterday" and the hunt names; then
  **What's new** at the top, grouped per hunt (up to 6 cards each); then the email card and one block per hunt with
  its live listings ("3 new · 24 live now"). **Live only:** no marketplace rows and no Open all in Daily (Matt: "no one
  should open 500 tabs"); Run the full hunt still opens one hunt's whole screen. New key `prowl.dailySeen`
  (`{d, cur, cs, pd, prev, ps}`): what Daily saw each day as short hashes of the listing links (at most 200 a hunt)
  plus which marketplaces answered; on a new day the last day's list is what Daily compares with, and a marketplace
  that did not answer that day is not counted as new. The first Daily on a device says it starts keeping track.
  The label says "since yesterday", or since the weekday or date of the last Daily. Test:
  `__tests__/page/daily-screen-v709.test.mjs`.
  Also: **LOCAL and Near me open the Maps links** (Matt: "local is not opening local areas, should be opening the
  google links"). Both always open Den › Local at Stores near you (Google Maps, or Apple Maps if picked), with or
  without a hunt typed; they no longer run Facebook, Craigslist, OfferUp, EstateSales and CTBids, which stay on every
  search's rows. Tests: `__tests__/page/near-me.test.mjs`, `__tests__/page/vinted-invite.test.mjs`.
  Also: **the shop's menu no longer draws over Flock** (Matt's screenshot, on a computer: "Shop · Help and info · The
  drop list" over the cards). Two causes. v7.04 gave `main#otp-main` a `view-transition-name` all the time, which makes
  main its own layer, so Flock (fixed inside main, z-index 39) fell under Prowl's top bar and the store header; it is
  now named only while the morph runs (`html.otp-vt`). And the store theme pins its header above any z-index Flock
  has, so Flock now starts under whatever is pinned at the top of the screen that is not Flock (`flClear`, by what is
  drawn there, not the theme's class names; checked again after the morph and on resize). Tried in Chromium against a
  mock sticky header. Test: `__tests__/page/flock-store-header-v709.test.mjs`.
  Also: **new listings are featured on the home page, and glow** (Matt: "it says 1 new, but it isn't obvious", then
  "make them glow"). **New since your last look** (`#otp-homeNew`) sits at the top of the home panel with the listings
  behind the other hunts' "N new" badges: up to 3 a hunt and 8 in all, each tagged New and "for <hunt>", and a button per
  hunt that opens it. They are not marked seen there; opening the hunt does that, as before. Inside a hunt, listings new
  since the last look come first in each marketplace (`frontNew`). Those cards and the strip's glow: a steady ring and a
  breathing light inside the edge (opacity only; steady under reduced motion). The strip shows once the other hunts'
  listings are in hand (Flock or Daily fetch them), as the badges always did. Test: `__tests__/page/home-new-v709.test.mjs`.
  Also: CI's time limit is 10 minutes (was 5): the suite takes about 4.5 and runs were being cancelled mid-test.
- **v7.08 + worker v118: Keep it simple, and shelf scan (Matt picked PIE items 18 and 20, 2026-10-16).**
  - **Keep it simple / Show everything** (Den › Settings, new key `prowl.detail`, `all` = everything). Simple is the
    default: in a search the long marketplace list, the Open all bar, the pop-up warnings and the sign-in note fold
    behind "Show all N marketplaces" (`#otp-dtMore`, adds `.dt-open` to that run); the cross-post line hides.
    Best picks and live finds stay. Wrapper class `dt-simple`.
  - **Shelf scan:** the photo screen has One piece / A whole shelf. Shelf sends `/appraise` mode `shelf`; worker
    v118 asks for at most 3 pieces worth a closer look (`shelfPrompt`), each with where it sits, a fair range and a
    pay-up-to price (`shelfParse`), or "Nothing stands out". Each card has Search this on Prowl. Uses one photo check.
    Not tried against the real model yet.
  Tests: `__tests__/page/detail-shelf-v708.test.mjs`, `worker/__tests__/shelf.test.mjs`.
- **v7.07:** Best picks also show for the hunt picked in Your favorite hunts (Matt: they only came with the search
  box). `huntBox(t)` at the top of `sgwBody`; `huntPaint` fills every `.pk[data-t]` box for that term.
- **v7.06 + worker v117: Best picks, "hunt like Hark" (Hark's spec and code, Matt 2026-10-16).** One call,
  `GET /hunt?q=` (optional `&cl=` Craigslist city, letters only, default detroit), checks every `LIVE_CALLS`
  marketplace plus Craigslist in parallel and answers `{term, ms, median, picks, rows, dupes}`. The matching lives in
  `worker/hunt.js` (pure, tested): every query word or a synonym must be in the title (pottery/porcelain count as
  ceramic, plurals fold), noise phrases per word (Pink Panther, Marvel, Cartier…), cross-posts = 80% same title words
  on two sites with prices within 6% (the dearer one gets `dupeOf`), picks = top 3 by below-median price, quiet live
  auction, lot/pair, photo. Every site keeps a row with a note; Facebook and eBay Sold are listed as login-only.
  A site that is cooling down (or Vinted out of turn) reports a row instead of being fetched. Cached 15 min
  (PCACHE), 150 uncached hunts a visitor a day (`hu:`). Craigslist's static list is untested from a Worker address:
  its row shows what it answered. Page: a Best picks strip at the top of a single search (`#otp-hpicks`; the id
  `otp-picks` was already the shop strip), paw prints while it waits, eBay links tagged `prowl-picks`, chips per
  site; a failed hunt leaves the box empty and the regular results stand. Not yet: Pro alerts from `/hunt`, more
  sources (LiveAuctioneers, Ruby Lane, Mercari US), "close matches" when the gate keeps nothing.
  Tests: `worker/__tests__/hunt.test.mjs`, `__tests__/page/hunt-picks-v706.test.mjs`.
- **v7.05: bigger type and four quick wins from the Flippr teardown (Matt, 2026-10-16).** Ranked with a PIE matrix
  (`claude/prowl-direction-and-roadmap-2026-10-16.md` in the project).
  - **Type floor:** every font size in the main stylesheet moved up one step: under 12px → 12.5, 12–12.5 → 13,
    13–13.5 → 14, 14–14.5 → 15, 15–15.5 → 16 (306 rules). Nothing below 12.5px is left. Text size Standard/Large/
    Extra large and `prowl.textSize` are unchanged. The Den tabs got 4px gaps and no letter-spacing so SETTINGS fits.
  - **Paw prints** (`.paws`, three 🐾 fading in turn) while a live source is loading ("Looking on eBay…") and while
    a photo is being checked. Reduced motion: they stay still.
  - **Photo tips** on the Photo check screen: One piece · Good light · Show the mark (`.apr-tips`). Each `<li>` sits on its
    own line: Shopify rewrites inline list items that way, and the first deploy's md5 check failed on it.
  - **Empty Den:** "No hunts saved yet" with two examples and an "Add my first hunt" button that puts the cursor in
    the Add box (`.den-empty`, `#otp-denStart`).
  - "Free checks left today" already existed (`#otp-aprLeft`), so it was not rebuilt.
  Test: `__tests__/page/type-quickwins-v705.test.mjs`. No localStorage keys, IDs or marketplace changes.
- **v7.04: the dock buttons morph the page (Matt, 2026-10-15).** Pressing Prowl, the one-site button, Local, Flock
  or Daily fades the old main area up and the new one in (160 ms out, 240 ms in). Browsers with View Transitions use
  `document.startViewTransition` with only `main#otp-main` named (`prowl-main`); the root crossfade is switched off
  while `html.otp-vt` is set, so the Shopify header, footer and the dock itself stay still. Other browsers get the
  same fade-in as a class (`otp-in`). Den keeps its drawer slide, Daily with no hunts only toasts, reduced motion
  gets no animation. Test: `__tests__/page/dock-morph.test.mjs`.
- **v7.03: less to read, fewer buttons (Matt picked ideas 1 to 7, 2026-10-14).** Phone home page 690 → 575 words and
  58 → 46 controls (3 screens → 2); Den About 966 → 86 words; Den Settings 548 → 335.
  1. One search button: Hunt. Search All is hidden (kept, other code clicks it); Near me is a small chip.
  2/3. One promo on the home page (`promoPick`, wrapper class `pm-alerts|pm-app|pm-guide`): Alerts for someone not
     signed up (no alert token or store session), the app on a phone browser when its box would show, else the Field
     Guide. Someone with saved guides (`prowl.guides`) always keeps the guide box. The feedback line moved to Den › About.
  4. Header: account + a ☰ menu holding App, Text size, Theme and How Prowl works (same ids and handlers).
  5. "Tap × to move a hunt back to your Den" and the hunt panel's second Aa are gone; the link reads "All your hunts →".
  6. Facebook/Instagram buttons fold into "Facebook and Instagram ›"; the link-only sites in the empty card fold into
     "More places to look ›".
  7. Den › About opens with two lines, the feedback note, the Vault strip, share and byline; the long SEO section is
     still on the page inside a closed "How it works, and how collectors use it". Den › Settings keeps alerts,
     appearance, style and text size up top; marketplaces, AI helpers, one-site, stats, backup, import, clear and
     About sit under "More settings".
  Not a bug after all: "Pro: 25 hunts" is right for alerts (worker `AL_MAX_HUNTS` 25); 100 is the Den cap.
  Test: `__tests__/page/declutter-v703.test.mjs`.
- **v7.02:** tapping a hunt chip in Your favorite hunts scrolls down to that hunt's finds when they sit below the fold
  (Matt, 2026-10-14: on a phone they were under the long chip list). `sgwToBody` runs only on a chip tap, only when
  the finds start below 45% of the screen; on a wide screen they sit beside the chips and nothing moves. Test:
  `__tests__/page/hunt-scroll.test.mjs`.
- **v7.01:** the orange "N new" badge on a favorite hunt chip no longer squashes into "1 / ne / w" beside a long hunt name
  (Matt's screenshot, 2026-10-14): `.sgw-new` is `flex:none; white-space:nowrap`, so the name wraps and the badge
  stays on one line. Test: `__tests__/page/new-badge.test.mjs`.
- **v7.00: Back on Android (Matt, 2026-10-14).** Back closed the installed app when he expected Prowl's home screen.
  Search results now count as a layer: Back clears them and scrolls to the top (`ovAny`/`ovCloseTop` include
  `st.run`; `rRes` resyncs the guard). In the installed app only (`ovApp`: /pages/prowl-app, standalone, fullscreen or
  minimal-ui), Back on the home screen shows "Press Back again to close Prowl." The extra history entry is added on a
  tap (Chrome skips entries pushed without one) and not again for 2.5 s after the toast, so a second Back closes the
  app as Android expects. A browser tab is left alone. A "stay or close" dialog is not possible: pages cannot hold Back
  with a prompt. Test: `__tests__/page/back-root.test.mjs`.
- **v6.99: the listing popup (Matt, 2026-10-13).**
  - **Large text could trap you in the popup.** Large and Extra large zoom the whole app (1.12 / 1.25), and the popup
    is 94vh tall, so zoomed it was taller than the phone and its top bar with the X sat above the screen; only the
    phone's Back button got out. `textSizeApply` now sets `--tz` on the wrapper and the popup, the other sheets, the
    `.md` modals and the photo strip divide their vh heights by it (`dvh` where the browser has it). There is also a
    **Close** button at the bottom of the popup. In large text, or under 420px, the item details stack (label over
    value) instead of squeezing the values into a thin column.
  - **Search this on Prowl:** a pill under the price. It closes the popup, puts a cleaned title in the search box and
    runs the search (`popTerm`: the maker from the item details first, then the title without sales words like rare,
    vintage, MCM or label, sizes, years, quotes or emoji, at most 7 words). A toast says what it searched.
  - **Double-tap the photo to like** (`popLike`): adds the like Flock learns from, with a heart over the photo. It never
    un-likes; the heart button still does that.
  - Seller text escaped twice ("it&#39;s") is decoded once, as text, in the title, details and description
    (`popUnEnt`), and a description that only repeats the title is left out.
  Test: `__tests__/page/popup-v699.test.mjs`. Also: the worker tests for `/item` and Salvation Army load v116's
  Pacific-time helpers (`PT_FMT`, `ptOff`, `sgwMs`) and its `item2` cache key; they had failed since v116.
- **v116:** ShopGoodwill end times are Pacific wall time with no zone; the worker read them as UTC, so live auctions
  showed about 7 hours short or "This listing ended" (Matt bid on one that was still live). `sgwMs` reads them as
  America/Los_Angeles; `itemSgw` trusts ShopGoodwill's own expired flag; item cache key `item2`.
- **v6.98 / v115:** Prowl's notifications reached Matt's Android phone, but Chrome's on-device filter hid the first
  test behind "Possible spam". The notes now say who they are from and why, with no emoji: the test is "Prowl by Owl &
  Twig Vintage / Phone alerts are on. When Pounce spots the piece you described, Prowl shows it here with the photo."
  and a match is "Prowl found a likely (possible) match for <hunt>". The page no longer promises a test the worker
  could not deliver, and tells a member to tap Show notification if Chrome marks it as possible spam.
  Also: **Share sends the find's photo.** Flock's Share and a new **Share this find** button in the listing popup (so
  hunt results, Likes and any card that opens it) send the photo with the title, price and link (`shareFind`). The text reads like a person passing on a find, so
  someone who has never heard of Prowl does not take it for spam or AI: "Found this on eBay: <title> · <price>", the
  marketplace link, then one plain line, "Found with Prowl, a vintage search tool from Owl & Twig Vintage". The
  worker hands the photo over (`GET /img?u=`, Prowl's pages only, images only, 4 MB, 200 a day per visitor, nothing
  kept); a phone that cannot share files, or no photo in time, sends the link alone as before. Tests:
  `__tests__/page/flock-share.test.mjs`, `worker/__tests__/img-share.test.mjs`.
- **v6.97 / v114: Prowl's own notifications (Web Push), and ntfy is gone.** A Pounce match arrives as a notification
  from Prowl itself (Matt, 2026-10-13). Den > Settings > Pounce has **Alert this phone**: it registers Prowl's service
  worker (`worker/sw.js`, served at the shop's `/apps/prowl/sw.js` through the existing app proxy), asks for permission
  on that tap only, subscribes and tells the worker, which sends a test. The worker keeps up to 5 phones per member
  (`push:<salted hash>`, `pushep:` to swap a renewed subscription) and sends with `worker/push.js` (VAPID ES256 + RFC
  8291 aes128gcm, Web Crypto, no dependencies; it posts only to the browsers' own push services). A match that cannot
  go as a notification rides in the next digest (phone-only members: held and tried again); Android shows Check price
  and Not it (a signed 14-day token per match, never the member's sign-in). iPhone: only from the Home Screen app
  (iOS 16.4+), no buttons. **ntfy is removed** (nobody had signed up): its buttons, `/alerts/push` and
  `/alerts/quarry-no` are gone; an old `sub.push` topic is ignored. Tests: `worker/__tests__/push.test.mjs` (RFC 8291
  Appendix A byte for byte), `__tests__/page/push-button.test.mjs`, `worker/__tests__/pounce.test.mjs`.
- **v6.96:** Pounce's phone line names the member's ntfy channel with a Copy button and links to the ntfy app itself
  (`ntfy://ntfy.sh/<channel>`, the app's subscribe link) as well as ntfy's web page. "Open in ntfy" went to the web
  page, so the app never learned the channel (Matt, 2026-10-13: an empty Subscribed topics list).
  Also: switching a live site (ShopGoodwill, eBay, Chairish, Etsy, Poshmark, Vinted, Grailed, Salvation Army) off or
  on in the marketplace list now changes the search on screen too (`liveScope`); turning Chairish back on took a
  reload. Tests: `__tests__/page/live-scope.test.mjs`.
- **v6.95 / v113: Pounce saves for members signed in through the store.** Status, prefs and likes take a store session
  (v82) in place of the email token; Pounce took only the token, so Matt saw the Pounce box but every Save quarry was
  refused ("Sign in to Prowl Alerts first."). The worker's `pounceMember` now takes either, for save, phone alerts and
  the owner test, and the page sends the session with them. The refusal also showed below every hunt, off the screen,
  so the box just stayed open: a Pounce message now shows right under the hunt it is about, "Saving…" shows at once,
  and an answer that is not JSON still says what came back.
- **v6.95:** in Uranium, the band at the top of the Den, the listing popup and the other pop-up screens is a deep
  green gradient (#1e7f24 to #0c330e, from Matt's shades of #3cff49) instead of the bright #39ff14, with a pale title
  (#ebffec), and the popup's View on <site> button matches it (pale label, bright #3cff49 edge). The screens under it stay black, and the home page's section bands keep the bright green. Other themes are
  unchanged. Test: `__tests__/page/uranium-popups.test.mjs`.
- **v6.94:** a tap on a liked ShopGoodwill, eBay, Etsy or Salvation Army find in Den > Likes opens its listing popup
  again. The popup and the Den are both drawers at the same level and the Den comes later in the page, so the popup
  opened behind it and the tap seemed to do nothing (Matt's Haeger pumpkin). The popup now sits above every drawer, and
  closing it keeps the scrim when the Den is still open. Finds from other sites link straight out, as before. Test:
  `__tests__/page/likes-popup.test.mjs`.
- **v6.93 / v112: Pounce** (Hark's branch, brought up to date by Claude). A quarry is one of a member's alert hunts
  plus their own words for the exact piece (skip words, a size range, a reference photo). On the alert clock, a free
  pre-filter drops obvious misses and Muse judges the rest with the photo (yes / maybe / no and a reason). A match taps
  the member's phone through ntfy (Open it, Check price, Not it), or rides at the top of the next digest when there is
  no phone, and shows in Den > Settings > Pounce. Free: 1 quarry and 10 judgements a day; Pro: 5 and 40; the site
  stops at 2,000 a day. Fixed from the review of Hark's 1beb038:
  - editing one quarry re-judges that quarry only (pj: entries are per quarry), not every quarry;
  - a phone-only check (emails off or paused) marks nothing seen, so the digest still has every listing when emails
    come back, and keeps its own list of hunts searched today;
  - listings Pounce did not reach in a run wait in pq: for the day, so the hunt is not searched again every 5 minutes;
    the digest waits up to two hours past the member's hour for those matches;
  - a Muse outage (network, timeout, 429, 5xx, a refused key) marks nothing, stops judging for 10 minutes (pjdown) and
    keeps the listings waiting; only an unreadable listing gets the one-retry-then-let-go rule;
  - a phone-only member's tap that does not go through waits in pp: and is sent on a later run, for up to 3 days;
  - the test that cleared pj: by hand now goes through the real forget.
  The panther no longer pounces and walks when a match arrives: Prowl magic already moves it (Matt). Page test:
  `__tests__/page/pounce.test.mjs`; worker: `worker/__tests__/pounce.test.mjs`.
- **v6.92 / v111:** the page's main stylesheet (141 KB) is served by the worker, so the page body Shopify holds went
  from 886 bytes to 144 KB under the limit. The repo page keeps it inline in `<style id="prowl-css">`, so editing and
  tests are unchanged; the deploy swaps that block for a `<link>` to `/css/prowl.<hash>.css` plus a few lines of
  script (re-adds the link if a sanitizer drops it, retries once if the worker fails). After changing the page's CSS,
  run `node scripts/build-page-css.mjs` (a test fails until you do). The page deploy waits, up to 10 minutes, for the
  worker to serve the new stylesheet before sending. See `page/README.md`, Main stylesheet on the worker.
- **v6.91:** Matt's Vinted invite: one line under a run's first Vinted row ("New to Vinted? Join with Matt's invite:
  you each get $20 when you list 3 items, then $30 each at your first sale. Terms apply."). A referral, not an
  affiliate; the `VINV` constant holds the link and `''` hides it. Matt to confirm Vinted's terms allow it on a public
  page.
- **v6.90:** Near me takes Facebook USA's spot under the search box (Hunt · Search All · Near me). It does what the
  dock's LOCAL does: with a hunt, Facebook (your city), Craigslist, OfferUp, EstateSales.net and CTBids; with none,
  Den > Local. Facebook USA is still on the results ("Facebook Marketplace · search X in N cities") and in the
  Goodwill panel. The dead `.b.fb` styles went with it (+356 bytes of room).
- **v6.89:** in Uranium, starting a hunt sends a swarm of 22 fireflies across the screen (on body, removed when
  done; a new hunt clears the last swarm). Nothing in other themes or under reduced motion.
- **v6.88:** the dock's ALL button is now LOCAL (map pin). With a hunt typed or selected it searches Facebook
  (your city), Craigslist, OfferUp, EstateSales.net and CTBids; with none it opens Den > Local. ALL used to scroll home
  and ask for a term. Search All stays under the search box. Tests that read the count from the dock read the hero.
  Taps answer (dock icons, rows and buttons press in), and a sweep line names each site as a hunt's rows rise, then
  says how many are ready (none under reduced motion). The Shopify search title and description now say 29
  marketplaces, not 28 (set in Shopify).
- **v6.87 / v110:** Etsy's affiliate row is Rakuten Advertising, not Awin (Etsy's US program answered Matt's application
  through Rakuten). Key `etsy_rak` (never `etsy`, which pages v6.60-v6.86 turn into an Awin link), fields Etsy's
  advertiser id (mid) and the Rakuten publisher id, both empty and off; page only, like Depop. The Prowl page's Shopify
  search title and description no longer frame it against Google (set in Shopify, not in the repo): "Prowl — Search 28
  Vintage Marketplaces at Once | Owl & Twig Vintage".
- **v109:** the worker gets its own Shopify order token from a Dev Dashboard app (client credentials; those tokens last
  about a day, which is why the pasted SHOPIFY_ORDERS_TOKEN went 401). Needs SHOPIFY_ORDERS_CLIENT_ID and
  SHOPIFY_ORDERS_CLIENT_SECRET in Cloudflare.
- **v6.86 / v108:** one sign-in, inside the app: tap the account chip, type your email, type the 6-digit code we email
  (POST /alerts/code, /alerts/verify; HMAC only, 10 minutes, 5 tries, same answer for any email). A new email becomes
  a member. Gone from view: the store "Log in" / "Sign in or sign up", the confirm-link and magic-link screens, and the
  Flock star's trip to the store login. Old confirm/sign-in links and the silent store sign-in still work. Upgrade asks
  for the sign-in first, then carries on to checkout. "Hi, name · Log out" moved to a slim line under the header (it
  overlapped the buttons on a computer), on phones too. Limits: 5 codes and 10 wrong guesses per address a day.
- **v6.85 / v107:** an account chip in the header on every screen (the installed app has no store header): the first
  letter of who is signed in, a green ring for Pro, a person when nobody is; it opens Den > Settings, whose Prowl
  Alerts box now shows the plan. A sign-in finished in a browser tab is picked up when the app comes back. Log out
  returns to the page it came from. The "Still looking for your order" card lets go after a day, names the email it
  looks under (with "Switch to it"), and asks the shop afresh 3 times a round, not 15. The worker keeps a "not Pro"
  answer 10 minutes (it was 6 hours) and names Shopify's own error in "pro check failing". On phones the ... home link
  makes way for the chip.
- **v6.84:** a first visit starts with 3 sample hunts (ceramic panther, Halloween decor, ceramic Christmas tree)
  instead of 12. The Den keeps 5 hunts of your own on Free, up to 100 with Prowl Pro (`HUNTS_FREE`/`HUNTS_PRO`). The
  sample hunts (old and new) don't count; nothing saved is ever removed, a full Den just takes no new hunt. Plan table, FAQ and
  billing terms say so. Searching itself has no limit.
- **v6.82:** the header fits on phones in the dark theme (its mushroom chip is hidden under 480px wide, and the bar
  tightens); Help no longer runs off the edge.
- **v6.81 / v106:** estate sales within 30 miles by default with each sale's distance, and "Show N farther"; the
  worker finds EstateSales.net's `filteredSales` list wherever it sits. (#116)
- **v6.80 / v105:** estate-sale links that 404'd now use the sale's own link; a ZIP saved as the Craigslist city
  searches 25 miles around it. (#114)
- **v6.80:** no panther walking across the screen when a hunt starts. The opening animation stays. (#115)
- **v6.79 / v104:** panther QR button, eBay fee fix, photo check on busy photos. (#112, #113)
- **v6.76 / v103:** Estate sales near you (EstateSales.net, with the site's permission), owner-only list and map in
  Den > Local. (#111)

## In flight

| Branch | Owner | What | State |
|---|---|---|---|
| `hark/copy-consistency` | Hark | Page copy matches the app (photo checks, alert cadence, no-account wording, FAQ count) | No PR yet, not reviewed. Will need a new page version. |
| `claude/nice-gates-pl5opz` | Claude | Print Finder moved to its own repo (thebluecloudy/printfinder) | No PR. |
| `ccr-0de21c46-yzs839` | Claude | **v7.77**: Hunt screen from the design brief: full-width Hunt on phones, desktop hunt pills collapse to 12, 44px/15px pills, the sold-price row and Best picks name the hunt, one focus outline | Building (draft PR open). |

Next free numbers: **page v7.78, worker v165**. Claim one here when you start.

## What's next

- **ShopGoodwill sniper: parked, waiting on ShopGoodwill's written consent.** Built and tested (worker part), not
  deployed. ShopGoodwill's Terms of Use (01/22/2025) forbid third-party apps that interact with the site "without our
  prior written consent" and "any ... script ... or other automated means", license the site for "private,
  non-commercial purposes" only, and say not to share passwords. The patch, the plan (owner-only test, then a Pro +
  Sniper tier) and a draft email asking ShopGoodwill are in `docs/sniper/README.md`. Do not ship it without that consent.

The ranked ideas and the order Matt chose are in `docs/priority-matrix.md`: Pounce, then the two-photo photo check
(the piece, then its mark or back), then community-lite.

## Waiting on Matt

- **The branch rule for `main` is set but not enforced** (2026-10-23). Matt added it (require **build**, require up
  to date), but GitHub enforces branch rules on private repositories only on a paid plan (GitHub Pro, about $4 a month);
  on the free plan the rule is saved and ignored (`GET /branches/main` says `protected: false`). Upgrading turns it on
  with nothing else to set. Until then the rule lives in `CLAUDE.md` (Checks and shipping): never merge unless
  `build` is green on the latest commit and the branch is up to date with main.

- **NEAR ME (v7.36 / v132) needs three things in Cloudflare before it does more than the old Maps links:**
  1. Done 2026-10-20: the worker secret **GOOGLE_MAPS_KEY** (Places API (New), Routes API, Geocoding API; API
     restriction only, no website restriction, since only the worker calls Google). Cost: a Road Trip build is about
     13 Text Search calls, cached an hour; Around you is 2 calls, cached 10 minutes per ~0.6 mile.
  2. Done 2026-10-20: the R2 bucket **prowl-finds** exists, `worker/wrangler.toml` binds it, and its lifecycle rule
     (prefix `finds/`, delete 30 days after upload) is the backstop behind the worker's own 7-day cleanup.
  3. For a group: the members' store customer ids in the plain-text variable **PRO_CIDS** (comma list), which is the
     comp list the spec asks for. A member with their own Pro order needs nothing.
  Then test the reference route: NEAR ME > Road trip, "Blenko Glass Company, Milton, WV" from Novi on a Monday pill.
  Open decisions from the spec still open: the 7-day photo grace window (built as the default), hunts on the way
  (not built), the origin (current location on every use, as built).

- **Turn on Prowl's own notifications:** in Cloudflare > Workers > prowl > Settings > Variables and secrets, add
  `VAPID_PRIVATE_JWK` (type Secret) with the private key Claude gave in chat on 2026-10-13 (the public half is in
  `worker/wrangler.toml`). Until then the page offers no phone alerts (finds come by email). Then test: Android Chrome, Den > Settings > Pounce >
  Alert this phone (a test note arrives); iPhone: add Prowl to the Home Screen, open it from there, same button.
  **iPhone gate:** if the test never arrives on iPhone with the service worker at `/apps/prowl/`, tell Claude.

- **Try Pounce:** in Den > Settings > Pounce, set a quarry on one hunt and tap Alert this phone (once
  VAPID_PRIVATE_JWK is in, above). Matches also show in the same place. The Not it button on the phone needs
  MEMBER_ID_SALT or ADMIN_KEY (both are set if admin works).

- **URGENT: Pro checks fail until the order app's keys are in Cloudflare.** In the Shopify Dev Dashboard open the app
  that will read orders ("Prowl"), make sure its access scopes include read_orders (release a new version if you add
  it, and approve it in the store), copy its Client ID and Client secret, then in Cloudflare > Workers > prowl >
  Settings > Variables and secrets add SHOPIFY_ORDERS_CLIENT_ID and SHOPIFY_ORDERS_CLIENT_SECRET (type Secret) and
  Deploy. Then admin > Members > Re-check Pro.
- **In Shopify:** set the PROWLMONTH discount to one use per customer (the code is visible in the page source).
- **Known gap:** if adding Pro to the cart fails, the page falls back to `/products/prowl-pro` without the code.
- **Next:** check Den > Settings shows the free month and that the welcome email came.
- **Facebook alerts cost test** (Apify, 5 real hunts in Detroit/Novi). Needs a go-ahead and the Apify token.
- **Etsy affiliate (Rakuten):** declined 2026-10-11 ("temporarily", reapply after 15 days). Ask Etsy Affiliate US why;
  reapply with https://www.owlandtwigvintage.com/pages/prowl. Once approved, paste Etsy's advertiser id (mid) and the
  Rakuten publisher id in admin > Affiliates > Etsy, Save IDs, Turn on.
- **Estate sales check:** admin > Diagnose > "Check garage-sale sites", then Den > Local with "Novi, MI".

## Done

- **CI uses about half the Actions minutes** (2026-10-21, Hark; fixed up by Claude): `.github/workflows/blank.yml` runs
  on pull requests only (not again on push to `main`), a newer push cancels a PR's older run, npm is cached, and the
  time limit is 15 minutes (the suite takes about 7.5). Every PR runs the suite, docs-only ones too: a path filter
  would leave a required `build` check waiting forever on a PR it skipped, and every PR touches `docs/STATUS.md`,
  which the tests read, so it saved nothing. Run it by hand from the Actions tab to re-check `main`.

- **Free-month checkout test passed** (2026-10-11): "Start my free month" opened checkout with PROWLMONTH
  applied, $0.00 today, $7.00 a month after, card saved; Shopify's subscription page offers Pause, Skip and Cancel.
  Cancel tested too: the store got "canceled a subscription contract". The $0 order stays paid, so Pro runs to the
  end of the free month (Nov 11) and then stops, as no $7 order comes. Known gap: Prowl doesn't see the cancel, so
  Den still says "then $7.00 a month" until then.

## Known issues

- The Flock bar test (`__tests__/page/flock-bar.test.mjs`) fails now and then on main; not caused by recent PRs.
