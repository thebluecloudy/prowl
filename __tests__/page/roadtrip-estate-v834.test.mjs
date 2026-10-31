// Page v8.34 / worker v207 (Matt, 2026-10-31: "part of estate sale was to fold it into road trip map that will take you
// to each one"; he chose both):
// A) Plan my week › a day › Open in Road trip: NEAR ME › Road trip with that day's sales as fixed stops, in the planner's
//    drive order, on Road trip's own map, timed, with Road trip's Google Maps and Apple Maps links (street addresses), a
//    loop back to the start, Rebuild from here; sales whose address is not posted yet are left out with a note.
// B) Estate sales on the way: a Road trip built by a Pro member or the owner key asks GET /trip/sales for the sales open
//    on the trip's day near the route, shows them under the stops and as their own pins on the map, and Add stop puts one
//    in the trip; free visitors ask nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const OWNER = 'owner-key-0123456789';
const okJ = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
/* a Leaflet stand-in that records the pins */
function leaflet(w, pins) {
  w.L = { Browser: { mobile: false }, map: () => ({ fitBounds() {}, remove() {}, on() {}, closePopup() {} }), tileLayer: () => ({ addTo() { return this; } }), divIcon: (o) => o,
    marker: (ll, o) => { const m = { ll, cls: o.icon.className, html: o.icon.html, title: o.title, addTo() { pins.push(m); return m; }, bindPopup(h) { m.pop = h; return m; } }; return m; },
    circleMarker: () => ({ addTo() { return this; }, bindPopup() { return this; } }) };
}

/* ---- A: Plan my week › Open in Road trip ---- */
function satH(h) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(h); return d.getTime(); }
const row = (id, name, o = {}) => ({ id, name, url: 'https://www.estatesales.net/MI/Novi/48375/' + id, city: 'Novi', st: 'MI', co: 'Co', dist: 3, hours: 'Sat, 9 AM–4 PM', standout: '',
  match: null, img: 'https://picturescdn.estatesales.net/' + id + '/1-1/c.jpg', addr: id.slice(-3) + ' Grand River Ave', lat: 42.48 + Number(id.slice(-1)) * 0.01, lng: -83.47, days: [{ s: satH(9), e: satH(16) }], ...o });
const SWEEP = { r: 25, at: 1, total: 4,
  picks: [row('5200001', 'Pyrex house', { match: { hunt: 'pyrex', where: 'the description' } })],
  rest: [row('5200002', 'Tool barn'), row('5200003', 'Hidden address', { addr: '', addrAt: satH(-20) }), row('5200004', 'Garage finds')] };
function rigA(o = {}) {
  const calls = [], pins = [];
  const fetchImpl = (u) => {
    const s = String(u); calls.push(s);
    if (/\/geo\?q=/.test(s)) return okJ({ q: 'x', lat: 42.4806, lng: -83.4755, town: 'Novi, MI', city: 'Novi', st: 'MI', zip: '48375' });
    if (/\/weekend\?/.test(s)) return okJ(SWEEP);
    if (/\/order\?/.test(s)) { const pts = new URL(s).searchParams.get('p').split('|'), order = pts.map((_, i) => i); if (!/keep=1/.test(s)) order.splice(1, order.length - 1, ...order.slice(1).reverse()); return okJ({ order, legs: pts.map(() => ({ min: 10, mi: 6 })), src: 'osrm' }); }
    if (/\/trips$/.test(s)) return okJ({ trips: [] });
    return okJ({ items: [] });
  };
  const phone = (w) => { leaflet(w, pins); Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.33, longitude: -83.05 } }), 0) } }); };
  return { calls, pins, p: loadPage({ fetchImpl, beforeLoad: phone, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'], h21: 1, h36: 1, h42: 1, h68: 1 }, 'prowl.owner': OWNER, ...(o.storage || {}) } }) };
}
async function planDay(p, calls) {
  await tick(50);
  p.$('#otp-dock .db[data-m="local"]').click(); await tick(50);
  p.$('#otp-nrT4').click(); await tick(30);
  p.$('#otp-wkIn').value = 'Novi, MI';
  p.$('#otp-wkGo').click();
  await waitFor(() => p.$('#otp-wkPlan'));
  p.$('#otp-wkPlan').click();
  await waitFor(() => p.$('#otp-wp input[data-wpid="5200002"]'));
  const b = p.$('#otp-wp input[data-wpid="5200002"]'); b.checked = true; b.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await waitFor(() => p.$$('#otp-wp .wp-stop').length === 2);
  await waitFor(() => calls.some((c) => /\/order\?loop=1&p=/.test(c)));
  await tick(60);
}
const anchors = (p) => p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-n').map((e) => e.textContent);

test('A: Open in Road trip takes a planned day to Road trip: the sales in the planner\'s order as Estate sale stops, timed, on the map, with Maps links', async () => {
  const { p, calls, pins } = rigA();
  await planDay(p, calls);
  const order = p.$$('#otp-wp .wp-day .wp-stop b').map((e) => e.textContent);
  assert.equal(order.length, 2);
  const addr = (n) => (n === 'Pyrex house' ? '001' : '002') + ' Grand River Ave', first = addr(order[0]), second = addr(order[1]);
  const btn = p.$('#otp-wp .wp-day [data-wp="trip"]');
  assert.match(btn.textContent, /Open in Road trip/);
  btn.click(); await tick(80);
  assert.equal(p.$('#otp-nrT2').getAttribute('aria-selected'), 'true', 'NEAR ME › Road trip');
  assert.deepEqual(anchors(p), order, 'the planner\'s drive order');
  const out = p.$('#otp-nrOut');
  assert.match(out.querySelector('.nr-route').textContent, /Novi, MI → the day’s estate sales and back/);
  assert.equal(p.$$('#otp-nrOut .nr-yours').filter((e) => e.textContent === 'Estate sale').length, 2);
  assert.match(out.textContent, /Left out, the address is not posted yet: Hidden address\./);
  assert.match(out.textContent, /Get there ~9 AM/, 'timed from the planner\'s leave time: the first is reached as it opens');
  assert.match(out.textContent, /Allow about 45 min/);
  assert.ok(p.$$('#otp-nrOut img.nr-ph').some((i) => /picturescdn\.estatesales\.net\/5200002/.test(i.src)), 'each sale\'s photo');
  assert.ok(!out.querySelector('[data-nropt]'), 'no Optimize route: the planner already ordered the day by its hours');
  assert.ok(!out.querySelector('[data-nrrv]'), 'no Google reviews for a sale');
  /* the map: Road trip's own, already on, lettered pins and the start's flag */
  assert.equal(p.$('#otp-nrMapT').hidden, false);
  await tick(30);
  assert.deepEqual(pins.filter((m) => m.cls === 'nr-pin').map((m) => m.html).slice(-2), ['A', 'B'], 'lettered in drive order (the map is drawn again as the leg times come in)');
  assert.ok(pins.some((m) => /nr-pin-dest/.test(m.cls)));
  /* Maps: the street addresses, in order, from the start and back to it */
  const g = decodeURIComponent(p.$('#otp-nrLegs a').href), a = decodeURIComponent(p.$('#otp-nrApple a').href);
  assert.match(g, /origin=Novi, MI/); assert.match(g, /destination=Novi, MI/);
  assert.match(g, new RegExp('waypoints=' + first + ', Novi, MI\\|' + second + ', Novi, MI'));
  assert.match(a, new RegExp('^https://maps\\.apple\\.com/directions\\?source=Novi, MI&destination=Novi, MI&waypoint=' + first + ', Novi, MI&waypoint=' + second));
  assert.match(p.$$('#otp-nrOut a.nr-go')[0].href, new RegExp('destination=' + first.replace(/ /g, '%20')), 'Directions go to the address, with no Google place id');
  assert.ok(!/destination_place_id/.test(p.$$('#otp-nrOut a.nr-go')[0].href));
  assert.equal(p.$('#otp-nrHere').hidden, false, 'Rebuild from here');
  assert.ok(calls.some((c) => /\/order\?keep=1&loop=1&p=42\.48\d,-83\.47\d\|/.test(decodeURIComponent(c))), 'leg times for the loop, as Road trip asks');
  assert.ok(!calls.some((c) => /\/trip\/sales/.test(c)), 'a planned day asks for no estate sales on the way: they are the trip');
  /* × Remove takes a sale off */
  p.$('#otp-nrOut [data-nresx="es5200002"]').click(); await tick(20);
  assert.deepEqual(anchors(p), ['Pyrex house'], 'Tool barn taken off');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('A: Rebuild from here plans the day again from the phone; Maps starts at the phone and comes back to the start point', async () => {
  const { p, calls } = rigA();
  await planDay(p, calls);
  p.$('#otp-wp .wp-day [data-wp="trip"]').click(); await tick(80);
  p.$('#otp-nrHere').click();
  await waitFor(() => /Rebuilt from where you are/.test(p.doc.body.textContent) || p.$$('#otp-nrOut .nr-route').length);
  await tick(80);
  assert.match(p.$('#otp-nrOut .nr-route').textContent, /^Here → the day’s estate sales and back/);
  const g = decodeURIComponent(p.$('#otp-nrLegs a').href);
  assert.ok(!/origin=/.test(g), 'from the phone');
  assert.match(g, /destination=42\.3300,-83\.0500/, 'back to where you rebuilt from');
  assert.deepEqual(p.errors, []);
  await p.close();
});

/* ---- B: estate sales on the way ---- */
const DEN = { 'prowl.v36': { seen: true, hunts: ['pyrex'] } };
const shop = (id, name, town, lat, lng) => ({ id, name, town, why: 'Antiques', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat, lng, hours: null, nested: [], n: 200, rating: 4.6 });
const DEST = shop('D', 'Toledo Antique Mall', 'Toledo, OH', 41.65, -83.54);
/* the trip is tomorrow, leaving at 8 AM (the Leave at box), so the times hold whenever the test runs */
const D0 = new Date(Date.now() + 86400000);
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const TODAY = ymd(D0), WDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][D0.getDay()];
const at = (h) => { const d = new Date(D0); d.setHours(h, 0, 0, 0); return d.getTime(); };
const trip = () => ({ origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 60, min: 70 }, day: TODAY, stops: [shop('S1', 'Monroe Mall', 'Monroe, MI', 41.92, -83.4)], more: [], maps: 'https://www.google.com/maps/dir/?api=1',
  line: [[42.4, -83.45], [42.2, -83.42], [41.92, -83.4], [41.65, -83.54]] });
const sale = (id, name, o = {}) => ({ id, name, url: 'https://www.estatesales.net/MI/Taylor/48180/' + id, city: 'Taylor', st: 'MI', co: 'Co', dist: 1, off: 1, prog: 1, hours: 'Sat, 8 PM–11 PM',
  img: 'https://picturescdn.estatesales.net/' + id + '/1-1/c.jpg', addr: '12 Eureka Rd', lat: 42.21, lng: -83.43, match: null, pick: false, days: [{ s: at(20), e: at(23) }], ...o });
const ON_WAY = { day: TODAY, mi: 3, lists: 2, total: 3, sales: [
  sale('5300001', 'Taylor Pyrex sale', { off: 0.4, pick: true, match: { hunt: 'pyrex', where: 'the description' } }),
  sale('5300002', 'Hidden sale', { off: 1.2, addr: '' }),
  sale('5300003', 'Flat Rock barn', { off: 2.1, lat: 42.09, lng: -83.29, addr: '9 Gibraltar Rd', city: 'Flat Rock', img: '' }),
] };
function rigB(o = {}) {
  const calls = [], pins = [];
  const fetchImpl = (u) => {
    const url = String(u); calls.push(url);
    if (/\/trip\/sales\?/.test(url)) return okJ(o.sales || ON_WAY);
    if (/\/trip\?/.test(url)) { o.trips = (o.trips || 0) + 1; return okJ(o.tripFn ? o.tripFn(o.trips) : trip()); }
    if (/\/order\?/.test(url)) { const n = new URL(url).searchParams.get('p').split('|').length; return okJ({ order: Array.from({ length: n }, (_, i) => i), legs: Array.from({ length: n }, () => ({ min: 15, mi: 10 })), src: 'osrm' }); }
    if (/\/trips$/.test(url)) return okJ({ trips: [] });
    return okJ({ items: [] });
  };
  const phone = (w) => { leaflet(w, pins); Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } }); };
  return { calls, pins, p: loadPage({ storage: Object.assign({}, DEN, o.storage || {}), fetchImpl, beforeLoad: phone }) };
}
async function toTrip(p, to) {
  await tick(30); p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click(); await tick(20);
  p.$('#otp-nrDays [data-nrday="' + TODAY + '"]').click();
  p.$('#otp-nrLeave').value = '08:00';
  p.$('#otp-nrTo').value = to;
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(250);
}

test('B: a Road trip asks /trip/sales for the estate sales on the way (owner or Pro), and shows them with photo, hours, miles off the road and Add stop', async () => {
  const { p, calls } = rigB({ storage: { 'prowl.owner': OWNER } });
  await toTrip(p, 'Toledo');
  await waitFor(() => p.$('#otp-nrSales .nr-es'));
  const q = calls.find((c) => /\/trip\/sales\?/.test(c)), sp = new URL(q).searchParams;
  assert.equal(sp.get('p'), '42.40,-83.45|42.20,-83.42|41.92,-83.40|41.65,-83.54', 'the route /trip answered, 2 decimals');
  assert.equal(sp.get('day'), TODAY);
  assert.equal(sp.get('h'), 'pyrex', 'the Den\'s hunts, for Top picks');
  const box = p.$('#otp-nrSales');
  assert.match(box.querySelector('summary').textContent, /^Estate sales on the way · 3$/);
  assert.match(box.textContent, new RegExp('Open on ' + WDAY + ' within 3 mi of the road'));
  const rows = p.$$('#otp-nrSales .nr-esr');
  assert.match(rows[0].textContent, /Top pick · pyrex[\s\S]*Taylor Pyrex sale[\s\S]*Taylor, MI · 0\.4 mi off the road[\s\S]*Sat, 8 PM–11 PM/);
  assert.ok(rows[0].querySelector('img.wk-img').src.includes('picturescdn.estatesales.net/5300001'));
  assert.equal(rows[0].querySelector('a').href, 'https://www.estatesales.net/MI/Taylor/48180/5300001');
  assert.ok(rows[0].querySelector('[data-nresadd="5300001"]'));
  assert.match(rows[1].textContent, /Address not posted yet/);
  assert.ok(!rows[1].querySelector('[data-nresadd]'), 'a sale with no street address cannot be added');
  assert.ok(rows[2].querySelector('.wk-noimg'), 'no photo: the house glyph');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('B: the sales have their own layer on the map; Add stop puts one in the trip where it adds the least driving, timed and in the Maps link', async () => {
  const { p, calls, pins } = rigB({ storage: { 'prowl.owner': OWNER } });
  await toTrip(p, 'Toledo');
  await waitFor(() => p.$('#otp-nrSales .nr-es'));
  p.$('#otp-nrOut [data-nrmap="trip"]').click(); await tick(40);
  const es = pins.filter((m) => /nr-pin-es/.test(m.cls));
  assert.equal(es.length, 3, 'a pin for each sale, apart from the stops');
  assert.match(es[0].pop, /Taylor Pyrex sale[\s\S]*Sat, 8 PM–11 PM[\s\S]*data-nresadd="5300001"[\s\S]*Sale page/);
  assert.doesNotMatch(es[1].pop, /data-nresadd/, 'address pending: no Add stop in its popup either');
  p.$('#otp-nrSales [data-nresadd="5300001"]').click(); await tick(60);
  assert.deepEqual(anchors(p), ['Taylor Pyrex sale', 'Monroe Mall'], 'Taylor comes before Monroe on the way south');
  const card = p.$$('#otp-nrOut .nr-stops > .nr-stop')[0];
  assert.match(card.textContent, /Estate sale[\s\S]*Taylor Pyrex sale/);
  assert.match(card.textContent, /Get there ~8 PM/, 'not open yet when you would pass: the trip waits for it');
  assert.ok(card.querySelector('[data-nresx="es5300001"]'), 'x Remove');
  assert.match(p.$('#otp-nrSales').textContent, /✓ On the trip/);
  assert.equal(pins.filter((m) => /nr-pin-es/.test(m.cls)).slice(-2).length, 2);
  await tick(30);
  const g = decodeURIComponent(p.$('#otp-nrLegs a').href);
  assert.match(g, /waypoints=12 Eureka Rd, Taylor, MI\|Monroe Mall, Monroe, MI/, 'Maps goes to its street address, in drive order');
  assert.ok(calls.filter((c) => /\/order\?keep=1/.test(c)).some((c) => new URL(c).searchParams.get('p').split('|').length === 4), 'the legs are asked again with it');
  /* the sale stays when the trip is built again */
  p.$('#otp-nrHere').click(); await tick(300);
  assert.deepEqual(anchors(p), ['Taylor Pyrex sale', 'Monroe Mall'], 'Rebuild from here keeps the estate sale you added');
  p.$('#otp-nrOut [data-nresx="es5300001"]').click(); await tick(30);
  assert.deepEqual(anchors(p), ['Monroe Mall']);
  assert.ok(p.$('#otp-nrSales [data-nresadd="5300001"]'), 'back in the list to add');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('B: free and signed-out visitors ask for no estate sales on the way', async () => {
  const { p, calls } = rigB();
  await toTrip(p, 'Toledo');
  await tick(80);
  assert.ok(calls.some((c) => /\/trip\?/.test(c)));
  assert.ok(!calls.some((c) => /\/trip\/sales/.test(c)));
  assert.equal(p.$('#otp-nrSales').textContent, '');
  assert.deepEqual(p.errors, []);
  await p.close();
});

/* ---- review fixes (2026-10-31) ---- */
const wayDay = () => { const d = new Date(satH(9)); return ymd(d); };

test('review: Rebuild from here on a planned day leaves out the sales marked Been, and the marks do not hang on the start\'s name', async () => {
  const k = 'e:|' + wayDay();
  const { p, calls } = rigA({ storage: { 'prowl.nearBeen': { o: [k], s: { [k]: { es5200001: 1 } } } } });
  await planDay(p, calls);
  p.$('#otp-wp .wp-day [data-wp="trip"]').click(); await tick(80);
  assert.ok(p.$('#otp-nrOut [data-nrbeen="es5200001"].on'), 'Pyrex house shows as Been on the day opened from Novi, MI');
  p.$('#otp-nrHere').click();
  await waitFor(() => /^Here → /.test((p.$('#otp-nrOut .nr-route') || {}).textContent || ''));
  await tick(80);
  assert.deepEqual(anchors(p), ['Tool barn'], 'the sale you have been to does not come back');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('review: the estate sales on the way say when some of the route could not be checked, apart from a long drive', async () => {
  let r = rigB({ storage: { 'prowl.owner': OWNER }, sales: { ...ON_WAY, missing: 1, partial: 0 } });
  await toTrip(r.p, 'Toledo'); await waitFor(() => r.p.$('#otp-nrSales .nr-es'));
  assert.match(r.p.$('#otp-nrSales').textContent, /Some of the route could not be checked just now\./);
  assert.doesNotMatch(r.p.$('#otp-nrSales').textContent, /long drive/);
  await r.p.close();
  r = rigB({ storage: { 'prowl.owner': OWNER }, sales: { ...ON_WAY, missing: 0, partial: 1 } });
  await toTrip(r.p, 'Toledo'); await waitFor(() => r.p.$('#otp-nrSales .nr-es'));
  assert.match(r.p.$('#otp-nrSales').textContent, /Only the first stretch of a long drive is checked\./);
  assert.doesNotMatch(r.p.$('#otp-nrSales').textContent, /could not be checked/);
  assert.deepEqual(r.p.errors, []);
  await r.p.close();
});

test('review: an added sale does not follow you to a trip somewhere else, nor onto a rebuilt road it is now far from', async () => {
  let r = rigB({ storage: { 'prowl.owner': OWNER } });
  await toTrip(r.p, 'Toledo'); await waitFor(() => r.p.$('#otp-nrSales .nr-es'));
  r.p.$('#otp-nrSales [data-nresadd="5300001"]').click(); await tick(60);
  assert.deepEqual(anchors(r.p), ['Taylor Pyrex sale', 'Monroe Mall']);
  r.p.$('#otp-nrTo').value = 'Ann Arbor';
  r.p.$('#otp-nrForm').dispatchEvent(new r.p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(250);
  assert.deepEqual(anchors(r.p), ['Monroe Mall'], 'a new destination is a new trip');
  assert.deepEqual(r.p.errors, []);
  await r.p.close();
  /* Rebuild from here, and the road now runs ~15 mi east of the sale */
  const far = () => { const t = trip(); t.line = t.line.map(([a, b]) => [a, b + 0.3]); return t; };
  r = rigB({ storage: { 'prowl.owner': OWNER }, tripFn: (n) => (n === 1 ? trip() : far()) });
  await toTrip(r.p, 'Toledo'); await waitFor(() => r.p.$('#otp-nrSales .nr-es'));
  r.p.$('#otp-nrSales [data-nresadd="5300001"]').click(); await tick(60);
  r.p.$('#otp-nrHere').click(); await tick(300);
  assert.deepEqual(anchors(r.p), ['Monroe Mall'], 'more than ~3 mi off the new road: left behind');
  assert.deepEqual(r.p.errors, []);
  await r.p.close();
});

test('review: a stop you skipped keeps its place in the order when an estate sale is added, and comes back there', async () => {
  const two = () => { const t = trip(); t.stops = [shop('S0', 'Romulus Mall', 'Romulus, MI', 42.3, -83.43), shop('S1', 'Monroe Mall', 'Monroe, MI', 41.92, -83.4)]; return t; };
  const { p } = rigB({ storage: { 'prowl.owner': OWNER }, tripFn: two });
  await toTrip(p, 'Toledo'); await waitFor(() => p.$('#otp-nrSales .nr-es'));
  assert.deepEqual(anchors(p), ['Romulus Mall', 'Monroe Mall']);
  p.$('#otp-nrOut [data-nrskip="S0"]').click(); await tick(40);
  assert.deepEqual(anchors(p), ['Monroe Mall']);
  p.$('#otp-nrSales [data-nresadd="5300003"]').click(); await tick(60);
  assert.deepEqual(anchors(p), ['Flat Rock barn', 'Monroe Mall']);
  p.$('#otp-nrUnskip').click(); await tick(40);
  assert.deepEqual(anchors(p), ['Romulus Mall', 'Flat Rock barn', 'Monroe Mall'], 'Romulus back first, not at the end');
  assert.deepEqual(p.errors, []);
  await p.close();
});
