/* v132 NEAR ME: the pure trip module. Ranking, hours, clustering, the corridor, the Maps export and the trip record.
   Run: node --test worker/__tests__/trip.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversineKm, decodePolyline, nearestOnRoute, detourMinutes, corridorCenters, sizeTier, differentiator, ratingScore, rankPlaces,
  townOf, townFromAddress, normalizePlace, placeCard, hoursForDay, openAt, alongRoute, clusterStops, mapsDirUrl, hasStreet,
  tripDay, weekdayOf, tripCloses, tripExpires, tripExpired, tripRecord, tripMember, tripView, findRecord,
  DETOUR_MIN, MAPS_WAYPOINTS, FINDS_GRACE_DAYS, CATS, CATS_DEFAULT, catsParse, catsQueries, tripQueries, splitAnchors, routeScore, ANCHOR_REVIEWS, kindAllowed, kindPlan, ANCHOR_REVIEWS_ANTIQUES,
} from "../trip.js";

test("v140: the typed kinds go to Nearby Search, the rest to a text search; a crowd counts only for our kinds; the museum is never ours", () => {
  assert.deepEqual(kindPlan(["antiques", "vintage", "thrift"]), { types: ["antique_store", "thrift_store"], text: "vintage stores", textKeys: ["vintage"] });
  assert.deepEqual(kindPlan(["records", "flea"]), { types: [], text: "record stores, flea markets", textKeys: ["records", "flea"] });
  assert.deepEqual(kindPlan("antiques,books,toys").types, ["antique_store", "book_store", "toy_store"]);
  const mk = (name, n, extra) => Object.assign({ id: name.replace(/\W+/g, ""), name, town: "T", state: "OH", lat: 0, lng: 0, rating: 4.5, n, kind: "Antiques", hours: null, photo: "", url: "", summary: "" }, extra || {});
  assert.equal(sizeTier(mk("The Michigan Museum of Horror", 831, { kind: "Museum" })), 0, "no crowd point for a museum");
  assert.equal(kindAllowed(mk("The Michigan Museum of Horror", 831, { kind: "Museum" }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Clothes Mentor Perrysburg, OH", 163, { kind: "Women's clothing store" }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Greenwood Centre", 518, { kind: "Business center" }), CATS_DEFAULT), false);
  assert.equal(sizeTier(mk("Second Hand Rose Clothing Store", 267, { kind: "Store" })), 0, "an odd kind and a plain name: no crowd point");
  assert.equal(sizeTier(mk("Grandview Mercantile", 697, { kind: "Store" })), 1, "mercantile in the name: the crowd counts");
  assert.equal(sizeTier(mk("Bluegrass Collectors", 90)), 1, "an antiques shop with " + ANCHOR_REVIEWS_ANTIQUES + "+ reviews");
  assert.equal(sizeTier(mk("Bluegrass Collectors", 60)), 0);
  assert.equal(sizeTier(mk("The Mason Jar", 176, { kind: "Home goods store" })), 0);
});

test("v138: size points add up, and a kind whose chip is off is dropped when the kind is plain", () => {
  const mk = (name, n, extra) => Object.assign({ id: name.replace(/\W+/g, ""), name, town: "T", state: "OH", lat: 0, lng: 0, rating: 4.5, n, kind: "Antiques", hours: null, photo: "", url: "", summary: "" }, extra || {});
  assert.equal(sizeTier(mk("The Delaware Antique Mall", 303)), 2, "antique mall + a crowd");
  assert.equal(sizeTier(mk("WAREHOUSE 61", 87, { kind: "Warehouse" })), 1, "a bare warehouse");
  assert.equal(sizeTier(mk("Maumee Antique Mall", 1776)), 3);
  assert.equal(sizeTier(mk("Chillicothe Antique Emporium", 292)), 2);
  assert.equal(sizeTier(mk("American Vintage Warehouse", 246)), 2);
  assert.equal(sizeTier(mk("Pickaway Craft Mall", 232, { kind: "Home goods store" })), 0, "v140: a craft mall with no antiques word earns no crowd point");
  assert.equal(sizeTier(mk("Goodwill", 2500, { kind: "Thrift" })), 0);
  assert.equal(kindAllowed(mk("Hillbilly Flea Market", 970, { kind: "Flea market" }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Hillbilly Flea Market", 970, { kind: "Flea market" }), ["antiques", "flea"]), true);
  assert.equal(kindAllowed(mk("Grandview Mercantile", 697, { kind: "Store" }), CATS_DEFAULT), true, "an odd Google kind stays");
  assert.equal(kindAllowed(mk("Goodwill", 2500, { kind: "Thrift" }), ["antiques"]), false, "thrift off means no thrift");
  assert.equal(kindAllowed(mk("Flipside Records", 100, { kind: "Records" }), "antiques,records"), true);
  /* v139: never ours, and a name alone is no anchor */
  assert.equal(kindAllowed(mk("The Mall of Monroe", 2481, { kind: "Shopping mall", rating: 3.2 }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Woodland Mall", 914, { kind: "Shopping mall" }), ["antiques", "flea"]), false);
  assert.equal(kindAllowed(mk("Sauer Furniture", 300, { kind: "Furniture store" }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Pack Rats Pawn Shop", 300, { kind: "Pawn shop" }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Pack Rats Pawn Shop", 300, { kind: "Store" }), CATS_DEFAULT), false, "v141: by name too");
  assert.equal(kindAllowed(mk("Howard Rare Coin Gallery", 300, { kind: "Store" }), CATS_DEFAULT), false);
  assert.equal(kindAllowed(mk("Maumee Antique Mall", 1776), CATS_DEFAULT), true);
  const cl = (name, n, nested, extra) => Object.assign(placeCard(mk(name, n, extra)), { tier: sizeTier(mk(name, n, extra)), nested: (nested || []).map((x) => placeCard(mk(x[0], x[1]))) });
  const sp = splitAnchors([cl("Garden Cottage Emporium", 4, [["Blessings and Bargains", 12], ["Stuff n Things", 8]], { kind: "Home goods store", rating: 5 }), cl("WAREHOUSE 61", 87, [["The Delaware Antique Mall", 303]])]);
  assert.deepEqual(sp.stops.map((a) => a.name), ["The Delaware Antique Mall"], "the warehouse's town hands the anchor to the mall with the crowd");
  assert.deepEqual(sp.stops[0].nested.map((a) => a.name), ["WAREHOUSE 61"]);
  assert.equal(sp.more.length, 3, "the 4-review emporium and its town are smaller shops");
  assert.ok(sp.more.find((a) => a.name === "Garden Cottage Emporium"));
});

test("v136: antiques get a query of their own on a trip; a town is an anchor only with a real antiques place or a crowd of reviews; the rest are smaller shops", () => {
  assert.deepEqual(tripQueries(["antiques", "vintage", "thrift"]), ["antique stores and antique malls", "vintage stores, thrift stores"]);
  assert.deepEqual(tripQueries(["records"]), ["record stores"]);
  assert.deepEqual(tripQueries(["antiques"]), ["antique stores and antique malls"]);
  assert.equal(ANCHOR_REVIEWS, 150);
  const mk = (name, n, extra) => Object.assign({ id: name.replace(/\W+/g, ""), name, town: "T", state: "OH", lat: 0, lng: 0, rating: 4.6, n, kind: "Antiques", hours: null, photo: "", url: "", summary: "" }, extra || {});
  assert.equal(sizeTier(mk("Chillicothe Antique Emporium", 292)), 2, "an emporium, and 292 reviews is a crowd (v138: the points add up)");
  assert.equal(sizeTier(mk("Two Old Broads and a Geezer", 109, { kind: "Home goods store" })), 0);
  assert.equal(sizeTier(mk("Gaffney's Treasures and Gifts", 60, { kind: "Gift shop" })), 0);
  const clusters = [
    Object.assign(placeCard(mk("Jeffrey's Antique Gallery", 1200)), { tier: 2, nested: [placeCard(mk("Thistle Exchange", 30))] }),
    Object.assign(placeCard(mk("Gaffney's Treasures and Gifts", 60, { kind: "Gift shop" })), { tier: 0, nested: [placeCard(mk("Blue Light Vintage", 40))] }),
    Object.assign(placeCard(mk("The Delaware Antique Mall", 303)), { tier: 1, nested: [] }),
    Object.assign(placeCard(mk("Ellie Mills Mercantile", 5, { rating: 5 })), { tier: 0, nested: [] }),
  ];
  const split = splitAnchors(clusters);
  assert.deepEqual(split.stops.map((s) => s.name), ["Jeffrey's Antique Gallery", "The Delaware Antique Mall"]);
  assert.deepEqual(split.more.map((s) => s.name), ["Gaffney's Treasures and Gifts", "Blue Light Vintage", "Ellie Mills Mercantile"], "ranked by rating weighted by reviews; 5.0 on 5 reviews last");
  assert.ok(!split.more[0].nested && !split.more[0].tier, "flat cards");
  assert.equal(routeScore(split.stops), 3 + 0.25 + 2, "1 + tier each, a little for what is nested");
  assert.ok(routeScore(split.stops) > routeScore([clusters[1], clusters[3]]));
});

test("v135: the kinds to look for: the spec's three by default, any of the seven, as one or two query strings", () => {
  assert.deepEqual(catsParse(""), ["antiques", "vintage", "thrift"]);
  assert.deepEqual(catsParse("records,toys,garbage"), ["records", "toys"]);
  assert.deepEqual(catsParse("garbage"), CATS_DEFAULT);
  assert.deepEqual(catsQueries(["antiques", "records"], 1), ["antique stores and antique malls, record stores"]);
  assert.deepEqual(catsQueries(CATS_DEFAULT, 2), ["antique stores and antique malls, thrift stores", "vintage stores"]);
  assert.deepEqual(catsQueries(["toys"], 2), [CATS.toys], "never more queries than kinds");
  assert.equal(normalizePlace({ id: "r1", displayName: { text: "Flipside Records" }, location: {} }).kind, "Records");
  assert.equal(normalizePlace({ id: "t1", displayName: { text: "Toy Barn" }, primaryType: "toy_store", location: {} }).kind, "Toys");
});

/* ---- the reference route (the spec, §9.2): Novi, MI to Blenko Glass, Milton, WV ---- */
const WAY = [
  { lat: 42.4806, lng: -83.4755 },   /* Novi */
  { lat: 41.6639, lng: -83.5552 },   /* Toledo */
  { lat: 41.5754, lng: -83.6300 },   /* Maumee, where I-75 bends south */
  { lat: 41.0442, lng: -83.6499 },   /* Findlay */
  { lat: 40.2987, lng: -83.0680 },   /* Delaware */
  { lat: 39.9612, lng: -82.9988 },   /* Columbus */
  { lat: 39.3331, lng: -82.9824 },   /* Chillicothe */
  { lat: 38.7317, lng: -82.9977 },   /* Portsmouth */
  { lat: 38.4784, lng: -82.6379 },   /* Ashland */
  { lat: 38.4192, lng: -82.4452 },   /* Huntington */
  { lat: 38.4345, lng: -82.1322 },   /* Milton */
];
/* a route sampled about every kilometre along those legs */
function sampleRoute(way) {
  const out = [];
  for (let i = 0; i < way.length - 1; i++) {
    const a = way[i], b = way[i + 1], n = Math.max(1, Math.round(haversineKm(a, b)));
    for (let k = 0; k < n; k++) out.push({ lat: a.lat + (b.lat - a.lat) * k / n, lng: a.lng + (b.lng - a.lng) * k / n });
  }
  out.push(way[way.length - 1]);
  return out;
}
const ROUTE = sampleRoute(WAY);
const place = (o) => Object.assign({ id: "p_" + o.name.replace(/\W+/g, "").toLowerCase(), state: "OH", rating: 4.6, n: 300, summary: "", kind: "Antiques", photo: "", url: "", hours: null }, o);
const STOPS = [
  place({ name: "Maumee Antique Mall", town: "Maumee", lat: 41.5754, lng: -83.6425, n: 1200, summary: "Over 300 dealers in 53,000 sq ft" }),
  place({ name: "Jeffrey's Antique Gallery", town: "Findlay", lat: 41.0995, lng: -83.6565, n: 900, summary: "An antique mall of 350 dealers" }),
  place({ name: "Delaware Antique Mall", town: "Delaware", lat: 40.2990, lng: -83.0700, n: 400, summary: "Antique mall, 2 floors" }),
  place({ name: "Chillicothe Antique Emporium", town: "Chillicothe", lat: 39.3340, lng: -82.9810, n: 500, summary: "100+ dealers downtown" }),
  place({ name: "Unique Antiques Warehouse", town: "Portsmouth", lat: 38.7330, lng: -82.9960, n: 150, summary: "A warehouse of antiques" }),
  place({ name: "Bluegrass Collectors", town: "Ashland", state: "KY", lat: 38.4790, lng: -82.6400, n: 90, summary: "40 vendors" }),
  place({ name: "Central City Antiques", town: "Huntington", state: "WV", lat: 38.4190, lng: -82.4610, n: 220, summary: "The anchor of Central City's antique row, 60 dealers" }),
  place({ name: "Olde Central City Vintage", town: "Huntington", state: "WV", lat: 38.4193, lng: -82.4605, n: 40 }),
  place({ name: "14th Street Collectibles", town: "Huntington", state: "WV", lat: 38.4188, lng: -82.4600, n: 25, rating: 4.3 }),
  place({ name: "Heritage Station Shops", town: "Huntington", state: "WV", lat: 38.4196, lng: -82.4598, n: 12, rating: 4.9 }),
  place({ name: "Mansfield Antique Barn", town: "Mansfield", lat: 40.7584, lng: -82.5154, n: 300, summary: "200 dealers" }),   /* 40 km off the route */
];

test("haversine and polylines: Novi to Toledo is about 90 km; Google's example polyline decodes", () => {
  const km = haversineKm(WAY[0], WAY[1]);
  assert.ok(km > 85 && km < 100, String(km));
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
  assert.deepEqual(decodePolyline(""), []);
});

test("the corridor: a stop 40 km off the route is out, ten minutes of detour is the line, the circles cover the route", () => {
  const inside = alongRoute(STOPS, ROUTE, DETOUR_MIN);
  assert.ok(!inside.find((p) => p.town === "Mansfield"), "Mansfield is not on the way");
  assert.equal(inside.length, STOPS.length - 1);
  for (const p of inside) assert.ok(p.near <= DETOUR_MIN && p.prog >= 0, p.name);
  assert.equal(detourMinutes(0), 0);
  assert.ok(detourMinutes(3) <= DETOUR_MIN && detourMinutes(4) > DETOUR_MIN, "about 3 km each way is the budget at 40 km/h");
  const centers = corridorCenters(ROUTE);
  assert.ok(centers.length >= 13 && centers.length <= 20, "a 640 km route in ~40 km steps: " + centers.length);
  assert.ok(haversineKm(centers[centers.length - 1], WAY[WAY.length - 1]) < 25, "the last circle reaches the destination");
  const far = nearestOnRoute(ROUTE, { lat: 40.7584, lng: -82.5154 });
  assert.ok(far.km > 30, String(far.km));
});

test("the reference route: anchors in drive order, Huntington's Central City as one cluster, Mansfield out", () => {
  const anchors = clusterStops(alongRoute(STOPS, ROUTE, DETOUR_MIN));
  assert.deepEqual(anchors.map((a) => a.name), [
    "Maumee Antique Mall", "Jeffrey's Antique Gallery", "Delaware Antique Mall", "Chillicothe Antique Emporium",
    "Unique Antiques Warehouse", "Bluegrass Collectors", "Central City Antiques",
  ]);
  const hunt = anchors[anchors.length - 1];
  assert.equal(hunt.town, "Huntington, WV");
  assert.deepEqual(hunt.nested.map((n) => n.name), ["Heritage Station Shops", "Olde Central City Vintage", "14th Street Collectibles"], "nested by rank, not by name");
  assert.equal(anchors.find((a) => a.name === "Maumee Antique Mall").why, "300 dealers");
  assert.equal(anchors.find((a) => a.name === "Unique Antiques Warehouse").why, "Warehouse");
});

test("ranking: size first, then rating weighted by reviews, then distance", () => {
  const a = place({ name: "Tiny Shop", town: "X", lat: 0, lng: 0, rating: 5.0, n: 3, near: 1 });
  const b = place({ name: "Big Mall", town: "X", lat: 0, lng: 0, rating: 4.2, n: 50, near: 9, summary: "150 dealers" });
  const c = place({ name: "Good Shop", town: "X", lat: 0, lng: 0, rating: 4.8, n: 900, near: 5 });
  const d = place({ name: "Same Shop", town: "X", lat: 0, lng: 0, rating: 4.8, n: 900, near: 2 });
  assert.deepEqual(rankPlaces([a, b, c, d]).map((p) => p.name), ["Big Mall", "Same Shop", "Good Shop", "Tiny Shop"]);
  assert.equal(sizeTier(b), 3);
  /* v133: the words that mean a big antiques place, and a crowd of reviews; not "market" on a thrift shop */
  assert.equal(sizeTier(place({ name: "Pathway Market", town: "X", lat: 0, lng: 0, kind: "Thrift", n: 89 })), 0);
  assert.equal(sizeTier(place({ name: "Pathway Market", town: "X", lat: 0, lng: 0, kind: "Thrift", n: 2500 })), 0, "a thrift chain's reviews are not a size");
  assert.equal(sizeTier(place({ name: "Motor City Antique Gallery", town: "X", lat: 0, lng: 0, n: 1054 })), 3, "antique gallery and a thousand reviews");
  assert.equal(sizeTier(place({ name: "Rusty Relics Vintage and Antiques", town: "X", lat: 0, lng: 0, n: 227 })), 1, "v136: 150+ reviews on an antiques place is a size");
  assert.equal(sizeTier(place({ name: "Dixieland Flea Market", town: "X", lat: 0, lng: 0, n: 2306 })), 3);
  assert.equal(sizeTier(place({ name: "Le Shoppe Vintage Market", town: "X", lat: 0, lng: 0, n: 16 })), 1);
  assert.deepEqual(rankPlaces([
    place({ name: "Pathway Market", town: "X", lat: 0, lng: 0, kind: "Thrift", rating: 4.9, n: 89, near: 17 }),
    place({ name: "Town Peddler Craft and Antique Mall", town: "X", lat: 0, lng: 0, rating: 4.7, n: 2204, near: 14 }),
    place({ name: "Motor City Antique Gallery", town: "X", lat: 0, lng: 0, rating: 4.7, n: 1054, near: 47 }),
  ]).map((p) => p.name), ["Town Peddler Craft and Antique Mall", "Motor City Antique Gallery", "Pathway Market"], "the malls before the thrift shop");
  assert.equal(sizeTier(place({ name: "Red Barn Antique Mall", town: "X", lat: 0, lng: 0 })), 2, "antique mall, and the fixture's 300 reviews");
  assert.equal(sizeTier(place({ name: "Red Barn Antique Mall", town: "X", lat: 0, lng: 0, n: 12 })), 1);
  assert.equal(sizeTier(place({ name: "Corner Thrift", town: "X", lat: 0, lng: 0, summary: "12,000 square feet" })), 2);
  assert.ok(ratingScore(5.0, 3) < ratingScore(4.8, 900), "few reviews pull toward 4.0");
  assert.equal(ratingScore(0, 0), 0);
  assert.equal(differentiator(place({ name: "Corner Thrift", town: "X", lat: 0, lng: 0, summary: "12,000 square feet" })), "12,000 sq ft");
  assert.equal(differentiator(place({ name: "Corner Thrift", town: "X", lat: 0, lng: 0, kind: "Thrift" })), "Thrift");
});

const EMPORIUM = {   /* Chillicothe Antique Emporium: Tuesday to Sunday, never Monday */
  offset: -240,
  days: ["Monday: Closed", "Tuesday: 10:00 AM – 5:00 PM", "Wednesday: 10:00 AM – 5:00 PM", "Thursday: 10:00 AM – 5:00 PM", "Friday: 10:00 AM – 5:00 PM", "Saturday: 10:00 AM – 5:00 PM", "Sunday: 12:00 – 5:00 PM"],
  periods: [0, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: d === 0 ? 12 : 10, minute: 0 }, close: { day: d, hour: 17, minute: 0 } })),
};
const BLENKO = {   /* the visitor center and glassblowing viewing: Monday to Saturday mornings */
  offset: -240,
  days: ["Monday: 9:00 AM – 3:30 PM", "Tuesday: 9:00 AM – 3:30 PM", "Wednesday: 9:00 AM – 3:30 PM", "Thursday: 9:00 AM – 3:30 PM", "Friday: 9:00 AM – 3:30 PM", "Saturday: 10:00 AM – 3:00 PM", "Sunday: Closed"],
  periods: [1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: 9, minute: 0 }, close: { day: d, hour: 15, minute: 30 } })).concat([{ open: { day: 6, hour: 10, minute: 0 }, close: { day: 6, hour: 15, minute: 0 } }]),
};

test("hours (the spec, §9.3): on a Monday the Emporium is CLOSED and Blenko shows its Monday schedule", () => {
  assert.deepEqual(hoursForDay(EMPORIUM, 1), { open: false, text: "Closed" });
  assert.deepEqual(hoursForDay(EMPORIUM, 2), { open: true, text: "10:00 AM – 5:00 PM" });
  assert.deepEqual(hoursForDay(BLENKO, 1), { open: true, text: "9:00 AM – 3:30 PM" });
  assert.deepEqual(hoursForDay(BLENKO, 0), { open: false, text: "Closed" });
  assert.equal(weekdayOf("2026-10-26"), 1, "a Monday");
  assert.deepEqual(hoursForDay(null, 1), { open: null, text: "" });
  assert.deepEqual(hoursForDay({ periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], days: [] }, 3), { open: true, text: "Open 24 hours" });
  assert.equal(hoursForDay({ periods: [{ open: { day: 3, hour: 9, minute: 30 }, close: { day: 3, hour: 18, minute: 0 } }], days: [] }, 3).text, "9:30 AM–6 PM");
});

test("open now is worked out from the periods and the place's UTC offset, at the moment asked", () => {
  const monNoon = Date.parse("2026-10-26T16:00:00Z");   /* noon in Ohio (UTC-4) */
  assert.equal(openAt(EMPORIUM, monNoon), false);
  assert.equal(openAt(BLENKO, monNoon), true);
  assert.equal(openAt(BLENKO, Date.parse("2026-10-26T20:00:00Z")), false, "4 PM: closed at 3:30");
  assert.equal(openAt(EMPORIUM, Date.parse("2026-10-27T15:00:00Z")), true, "Tuesday 11 AM");
  assert.equal(openAt(EMPORIUM, Date.parse("2026-10-27T13:30:00Z")), false, "Tuesday 9:30, not yet");
  const bar = { offset: 0, periods: [{ open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }] };
  assert.equal(openAt(bar, Date.parse("2026-10-31T01:00:00Z")), true, "an overnight close counts past midnight");
  assert.equal(openAt(bar, Date.parse("2026-10-31T03:00:00Z")), false);
  assert.equal(openAt({ periods: [], offset: 0 }, monNoon), null);
  assert.equal(openAt({ periods: EMPORIUM.periods, offset: null }, monNoon), null, "no offset, no answer");
});

test("Google's place becomes a card: name, town, differentiator, hours, a proxied photo, a pin link", () => {
  const g = {
    id: "ChIJabc", displayName: { text: "Maumee Antique Mall" }, formattedAddress: "1552 Reynolds Rd, Maumee, OH 43537, USA",
    addressComponents: [{ longText: "1552", types: ["street_number"] }, { longText: "Reynolds Road", types: ["route"] }, { longText: "Maumee", types: ["locality"] }, { longText: "Ohio", shortText: "OH", types: ["administrative_area_level_1"] }],
    location: { latitude: 41.5754, longitude: -83.6425 }, rating: 4.6, userRatingCount: 1234, utcOffsetMinutes: -240,
    editorialSummary: { text: "Over 300 dealers under one roof." }, primaryTypeDisplayName: { text: "Antique Store" },
    photos: [{ name: "places/ChIJabc/photos/XYZ" }], googleMapsUri: "https://maps.google.com/?cid=1",
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 10, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } }], weekdayDescriptions: ["Monday: 10:00 AM – 6:00 PM"] },
  };
  const p = normalizePlace(g), c = placeCard(p, 2.5);
  assert.equal(p.town, "Maumee"); assert.equal(p.state, "OH"); assert.equal(p.kind, "Antiques");
  assert.equal(c.town, "Maumee, OH"); assert.equal(c.why, "300 dealers"); assert.equal(c.near, 2.5);
  assert.equal(c.photo, "/pp?n=places%2FChIJabc%2Fphotos%2FXYZ");
  assert.equal(c.hours.offset, -240); assert.equal(c.hours.periods.length, 1);
  assert.match(c.url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Maumee%20Antique%20Mall%20Maumee&query_place_id=ChIJabc$/, "a maps.google.com link that is not www.google.com/maps is not trusted");
  assert.equal(normalizePlace(null), null);
  assert.equal(normalizePlace({ displayName: { text: "no id" } }), null);
  assert.deepEqual(townOf([{ long_name: "Novi", types: ["locality", "political"] }, { long_name: "Michigan", short_name: "MI", types: ["administrative_area_level_1"] }]), { town: "Novi", state: "MI" });
  assert.equal(townFromAddress("123 Main St, Maumee, OH 43537, USA"), "Maumee, OH");
  assert.equal(townFromAddress("Milton, WV, USA"), "Milton, WV");
  assert.equal(townFromAddress("nowhere"), "");
});

test("the Maps export: origin town only, anchors as waypoints in drive order, nine at most, nested stops left out", () => {
  const anchors = clusterStops(alongRoute(STOPS, ROUTE, DETOUR_MIN));
  const u = new URL(mapsDirUrl("Novi, MI", anchors, "Blenko Glass Company, Milton, WV"));
  assert.equal(u.origin + u.pathname, "https://www.google.com/maps/dir/");
  assert.equal(u.searchParams.get("origin"), "Novi, MI");
  assert.equal(u.searchParams.get("destination"), "Blenko Glass Company, Milton, WV");
  const wp = u.searchParams.get("waypoints").split("|");
  assert.equal(wp[0], "Maumee Antique Mall, Maumee, OH");
  assert.equal(wp[wp.length - 1], "Central City Antiques, Huntington, WV");
  assert.ok(!wp.find((w) => /Heritage Station/.test(w)), "nested stops are not waypoints");
  const many = Array.from({ length: 14 }, (_, i) => ({ name: "Stop " + i, town: "T" + i }));
  assert.equal(new URL(mapsDirUrl("A", many, "B")).searchParams.get("waypoints").split("|").length, MAPS_WAYPOINTS);
  assert.equal(mapsDirUrl("A", [], "B"), "https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=A&destination=B");
  assert.ok(!hasStreet(u.toString()), "no street in the link");
  assert.equal(hasStreet("6311 Haggerty Rd, West Bloomfield"), true);
  assert.equal(hasStreet("Novi, MI"), false);
});

test("the trip record: the organizer is its first member, the origin is a town, it closes after its day and expires a week later", () => {
  const now = Date.parse("2026-10-20T15:00:00Z");
  assert.equal(tripDay("", now), "2026-10-20");
  assert.equal(tripDay("2026-10-26", now), "2026-10-26");
  assert.equal(tripDay("2026-12-25", now), "2026-10-20", "too far ahead: today");
  assert.equal(tripDay("2026-10-01", now), "2026-10-20", "in the past: today");
  assert.equal(tripDay("garbage", now), "2026-10-20");
  const built = { origin: { town: "Novi, MI" }, dest: { name: "Blenko Glass Company", town: "Milton, WV", id: "ChIJblenko" }, route: { km: 640, min: 390 },
    stops: clusterStops(alongRoute(STOPS, ROUTE, DETOUR_MIN)) };
  const t = tripRecord("t_abc", "1234567", built, "2026-10-26", now);
  assert.deepEqual(t.members, ["1234567"]); assert.equal(t.org, "1234567");
  assert.equal(t.origin, "Novi, MI"); assert.equal(t.day, "2026-10-26");
  assert.equal(t.closes, "2026-10-28T00:00:00.000Z");
  assert.equal(t.expires, new Date(Date.parse(t.closes) + FINDS_GRACE_DAYS * 86400000).toISOString());
  assert.equal(tripExpires(tripCloses("2026-10-26")), t.expires);
  assert.equal(tripExpired(t, now), false);
  assert.equal(tripExpired(t, Date.parse("2026-11-05T00:00:00Z")), true);
  assert.equal(t.stops.length, 7); assert.equal(t.stops[6].nested.length, 3);
  assert.ok(!JSON.stringify(t).match(/summary|rating/), "the record keeps only what a stop needs");
  assert.equal(tripMember(t, "1234567"), true); assert.equal(tripMember(t, 1234567), true); assert.equal(tripMember(t, "999"), false);
  const v = tripView(t, { p_maumeeantiquemall: EMPORIUM });
  assert.equal(v.members, 1); assert.equal(v.stops[0].hours, EMPORIUM); assert.equal(v.stops[1].hours, null);
  assert.equal(new URL(v.maps).searchParams.get("origin"), "Novi, MI");
  assert.equal(new URL(v.maps).searchParams.get("destination"), "Blenko Glass Company, Milton, WV");
  assert.ok(!hasStreet(JSON.stringify(v)), "nothing a member sees carries a street address");
});

test("a find keeps the lines of the photo check and the member's first name, never an email", () => {
  const f = findRecord("f1", "1234567", "Matt", { item: "Blenko 384 decanter, tangerine", price: "$45", verdict: "FAIR", fair: "$40–$70", stop: "Central City Antiques", town: "Huntington, WV" }, Date.parse("2026-10-26T18:00:00Z"));
  assert.equal(f.by, "1234567"); assert.equal(f.name, "Matt"); assert.equal(f.price, "$45"); assert.equal(f.verdict, "FAIR");
  assert.equal(f.at, "2026-10-26T18:00:00.000Z");
  const g = findRecord("f2", "1", "", { item: "mail me at a@b.co", price: "lots" });
  assert.equal(g.name, "A member"); assert.equal(g.price, ""); assert.ok(!/@/.test(g.item));
});
