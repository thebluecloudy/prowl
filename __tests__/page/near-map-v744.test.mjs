// Page v7.44 / worker v150 (the owner: "i stopped at one, now i want to find the next one but i don't know where i am,
// it would be good to pull up a map to show and then i can pick and then get directions to the next"). NEAR ME gets a
// map on both tabs: Leaflet and OpenStreetMap tiles through the page's existing loader, your blue dot with the town the
// worker names, the shops as numbered pins that match the numbered list, a popup with Directions (no origin: Google
// Maps starts from the phone) and In Maps. Every Around-you row has a Directions link beside the card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const WD = new Date().getDay();
const day = (d, h1, h2) => ({ open: { day: d, hour: h1, minute: 0 }, close: { day: d, hour: h2, minute: 0 } });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const descr = (f) => DAYS.map((n, i) => n + ': ' + f(i));
const H_ALWAYS = { offset: -240, periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], days: [] };
const H_NOT_TODAY = { offset: -240, periods: [day((WD + 3) % 7, 10, 17)], days: descr((i) => (i === (WD + 3) % 7 ? '10:00 AM – 5:00 PM' : 'Closed')) };
const H_DAILY = { offset: -240, periods: [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, 10, 18)), days: descr(() => '10:00 AM – 6:00 PM') };
const H_TUE_SUN = { offset: -240, periods: [0, 2, 3, 4, 5, 6].map((d) => day(d, 10, 17)), days: descr((i) => (i === 1 ? 'Closed' : '10:00 AM – 5:00 PM')) };
const card = (id, name, town, why, hours, lat, lng, extra) => Object.assign({ id, name, town, why, rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name) + '&query_place_id=' + id, lat, lng, hours, near: 1 }, extra || {});
const PLACES = [card('A1', 'Always Open Antiques', 'Novi, MI', '120 dealers', H_ALWAYS, 42.49, -83.47), card('B2', 'Weekend Barn', 'Novi, MI', 'Antique mall', H_NOT_TODAY, 42.47, -83.49), card('C3', 'Quiet Thrift', 'Novi, MI', 'Thrift', null, 42.48, -83.46)];
const STOPS = [
  card('S1', 'Maumee Antique Mall', 'Maumee, OH', '300 dealers', H_DAILY, 41.58, -83.65, { nested: [] }),
  card('S2', 'Chillicothe Antique Emporium', 'Chillicothe, OH', '100 dealers', H_TUE_SUN, 39.33, -82.98, { nested: [] }),
  card('S3', 'Central City Antiques', 'Huntington, WV', '60 dealers', H_DAILY, 38.42, -82.45, { nested: [card('S4', 'Olde Central City Vintage', 'Huntington, WV', 'Vintage', H_DAILY, 38.421, -82.451), card('S5', '14th Street Collectibles', 'Huntington, WV', 'Antiques', H_DAILY, 38.422, -82.452)] }),
];
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV', 'Glass factory', H_DAILY, 38.43, -82.13);
const trip = (d) => ({ origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 398, min: 390, slower: 0, routes: 1 }, day: d, weekday: new Date(d + 'T12:00:00Z').getUTCDay(), stops: STOPS, more: [], maps: 'https://www.google.com/maps/dir/?api=1', empty: false });
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const nearFetch = (calls) => (u, o) => {
  const url = String(u); calls.push(url);
  if (/\/near\?/.test(url)) return J({ at: '', town: 'Novi, MI', places: PLACES });
  if (/\/trip\?/.test(url)) { const d = /[&?]day=([\d-]+)/.exec(url); return J(trip(d ? d[1] : '')); }
  if (/\/trips$/.test(url)) return J({ trips: [] });
  return J({ items: [] });
};
/* a phone standing in Novi, and a Leaflet that records what the page draws */
function fakeLeaflet(rec) {
  const layer = () => ({ addTo() { return this; }, bindPopup(h) { rec.pops.push(h); return this; } });
  return {
    map: (el) => { rec.maps.push(el.id); return { fitBounds: (b) => { rec.bounds = b; }, remove: () => { rec.removed++; } }; },
    tileLayer: (u) => { rec.tiles.push(u); return layer(); },
    divIcon: (o) => o,
    marker: (ll, o) => { rec.markers.push({ ll, icon: o.icon, title: o.title }); return layer(); },
    circleMarker: (ll, o) => { rec.dots.push({ ll, o }); return layer(); },
  };
}
function phone(win, rec) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.4806, longitude: -83.4755 } }), 0) } });
  if (rec) win.L = fakeLeaflet(rec);
}
const rec = () => ({ maps: [], tiles: [], markers: [], dots: [], pops: [], bounds: null, removed: 0 });

test('Around you: the town you are in, numbered rows with Directions, and Show on a map draws you and the shops as matching pins', async () => {
  const R = rec(), calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w, R) });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(120);
  assert.match(p.$('#otp-nrLive .nearp').textContent, /^You are in Novi, MI\. /, 'the worker named the town');
  assert.deepEqual(p.$$('#otp-nrLive .nr-list .nr-num').map((e) => e.textContent), ['1', '2', '3'], 'the list is numbered like the pins');
  const go = p.$$('#otp-nrLive .nr-row a.nr-go');
  assert.equal(go.length, 3);
  assert.equal(go[0].textContent, 'Directions');
  assert.equal(go[0].href, 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=Always%20Open%20Antiques%2C%20Novi%2C%20MI&destination_place_id=A1');
  assert.doesNotMatch(go[0].href, /origin=|42\.48/, 'no origin: Maps starts from the phone, and the position is never in a link');
  assert.equal(go[0].target, '_blank');
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 3, 'the cards are still the cards');
  const b = p.$('#otp-nrLive [data-nrmap="around"]');
  assert.equal(b.textContent, 'Show on a map'); assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(p.$('#otp-nrMapA').hidden, true);
  assert.deepEqual(R.maps, [], 'nothing drawn until asked');
  b.click();
  await tick(20);
  assert.equal(p.$('#otp-nrMapA').hidden, false);
  assert.equal(p.$('#otp-nrLive [data-nrmap="around"]').textContent, 'Hide the map');
  assert.deepEqual(R.maps, ['otp-nrMapA']);
  assert.match(R.tiles[0], /tile\.openstreetmap\.org/);
  assert.deepEqual(R.markers.map((m) => m.icon.html), ['1', '2', '3'], 'the pins carry the list numbers');
  same(R.markers[0].ll, [42.49, -83.47]);
  assert.equal(R.markers[0].icon.className, 'nr-pin'); same(R.markers[0].icon.iconSize, [26, 26]);
  assert.equal(R.dots.length, 1, 'one blue dot: you');
  same(R.dots[0].ll, [42.4806, -83.4755]); assert.equal(R.dots[0].o.fillColor, '#1a73e8');
  assert.match(R.pops[0], /<b>Always Open Antiques<\/b>/); assert.match(R.pops[0], /OPEN NOW/);
  assert.match(R.pops[0], /href="https:\/\/www\.google\.com\/maps\/dir\/\?api=1&amp;travelmode=driving&amp;destination=Always%20Open%20Antiques%2C%20Novi%2C%20MI&amp;destination_place_id=A1"[^>]*>Directions</);
  assert.match(R.pops[0], /query_place_id=A1"[^>]*>In Maps</, 'and the shop itself in Maps');
  assert.match(R.pops[1], /CLOSED/);
  assert.match(R.pops[3], /<b>You are here<\/b><br><span>Novi, MI<\/span>/);
  assert.equal(R.bounds.length, 4, 'the view fits the shops and you');
  p.$('#otp-nrLive [data-nrmap="around"]').click();
  await tick(20);
  assert.equal(p.$('#otp-nrMapA').hidden, true);
  assert.equal(p.$('#otp-nrLive [data-nrmap="around"]').textContent, 'Show on a map');
  assert.equal(R.removed, 1, 'the map is taken down when hidden');
  assert.doesNotMatch(p.$('#otp-near').textContent, /v7\.\d|\b\d+ marketplaces/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip: the map shows the anchors numbered, the nested shops as small dots, the final stop as a flag, and you; popups use the trip day; a skipped stop leaves the map', async () => {
  const R = rec(), calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w, R) });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(80);
  p.$('#otp-nrT2').click();
  const monday = p.$$('#otp-nrDays [data-nrday]').find((b) => new Date(b.getAttribute('data-nrday') + 'T12:00:00Z').getUTCDay() === 1);
  monday.click();
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  assert.deepEqual(p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-num').map((e) => e.textContent), ['1', '2', '3'], 'the anchors are numbered');
  assert.equal(p.$$('#otp-nrOut .nr-nest .nr-num').length, 0, 'the nested shops are not');
  assert.equal(p.$('#otp-nrMapT').hidden, true);
  assert.deepEqual(R.maps, []);
  p.$('#otp-nrOut [data-nrmap="trip"]').click();
  await tick(20);
  assert.deepEqual(R.maps, ['otp-nrMapT']);
  assert.deepEqual(R.markers.map((m) => m.icon.html), ['1', '2', '3', '', '', '⚑']);
  assert.deepEqual(R.markers.map((m) => m.icon.className), ['nr-pin', 'nr-pin', 'nr-pin', 'nr-pin nr-pin-sub', 'nr-pin nr-pin-sub', 'nr-pin nr-pin-dest']);
  same(R.markers[3].icon.iconSize, [16, 16]);
  same(R.markers[5].ll, [38.43, -82.13]);
  assert.match(R.pops[1], /<b>Chillicothe Antique Emporium<\/b><br><span>Chillicothe, OH · CLOSED<\/span>/, 'closed on the trip\'s Monday, whatever today is');
  assert.match(R.pops[1], /destination_place_id=S2"[^>]*>Directions</);
  assert.equal(R.dots.length, 1, 'you, from the fix Around you took');
  same(R.dots[0].ll, [42.4806, -83.4755]);
  assert.equal(R.bounds.length, 7);
  p.$('#otp-nrOut [data-nrskip="S2"]').click();
  await tick(20);
  assert.equal(R.removed, 1, 'redrawn: the old map goes');
  assert.deepEqual(R.markers.slice(6).map((m) => m.icon.html), ['1', '2', '', '', '⚑'], 'Chillicothe is off the map and the numbers close up');
  assert.equal(p.$('#otp-nrOut [data-nrmap="trip"]').textContent, 'Hide the map', 'the map stays open through a redraw');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('without Leaflet the loader is asked once from cdnjs; if it fails the box says so and the list stands', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(120);
  assert.equal(p.$('script[src*="leaflet"]'), null, 'not loaded for the list alone');
  p.$('#otp-nrLive [data-nrmap="around"]').click();
  await tick(20);
  const js = p.$('script[src*="leaflet"]');
  assert.ok(js); assert.match(js.src, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.min\.js$/);
  assert.ok(p.$('link[href*="leaflet.min.css"]'));
  assert.equal(p.$('#otp-nrMapA').textContent, 'Loading the map…');
  js.onerror();
  await tick(10);
  assert.equal(p.$('#otp-nrMapA').textContent, 'The map could not load. The list still works.');
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 3);
  assert.deepEqual(p.errors, []);
  await p.close();
});
