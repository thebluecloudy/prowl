// Page v7.62 / worker v157 Road Trip upgrades (the owner, 2026-10-22): a detour of 5, 15 or 30 minutes off the route;
// no end makes a loop of the shops around the start; Optimize route reorders the stops for the shortest drive (worker
// /order); every stop is timed from the start and the leave time and a shop closed by then is flagged ("Open when you
// arrive"), estate sales over by then too (owner); Google Maps and Apple Maps carry every stop, in legs past their caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const D = new Date();
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const LATER = new Date(D.getTime() + 2 * 86400000), LDAY = ymd(LATER), LWD = LATER.getDay();
const hrs = (open, close) => ({ offset: -new Date().getTimezoneOffset(), periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: open, minute: 0 }, close: { day: d, hour: close, minute: 0 } })), days: [] });
const shop = (id, name, town, lat, lng, h, x) => Object.assign({ id, name, town, why: 'Antiques', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat, lng, hours: h || null, nested: [] }, x || {});
const DEST = shop('D', 'Blenko Glass Company', 'Milton, WV', 38.4345, -82.1322);
function mkTrip(stops, extra) { return Object.assign({ origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 300, min: 300 }, day: '', stops, more: [], maps: 'https://www.google.com/maps/dir/?api=1', line: [[41.5, -83.6], [40.0, -83.0], [38.5, -82.5]] }, extra || {}); }
function fx(calls, o) {
  return (u, init) => {
    const url = String(u); calls.push(url);
    if (/\/trip\?/.test(url)) return J(o.trip(url));
    if (/\/order\?/.test(url)) return J(o.order ? o.order(url) : { error: 'x' }, o.order ? 200 : 500);
    if (/\/near\?/.test(url)) return J({ town: 'Novi, MI', places: o.near || [] });
    if (/\/sales\?/.test(url)) return J({ items: o.sales || [] });
    if (/\/geo\?/.test(url)) return J({ q: 'Milton, WV', lat: 38.4345, lng: -82.1322, town: 'Milton, WV', city: 'Milton', st: 'WV', zip: '25541', cl: 'huntington' });
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
const phone = (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } });
async function toTrip(p, to) {
  await tick(30); p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click(); await tick(20);
  p.$('#otp-nrTo').value = to;
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);
}
const anchors = (p) => p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-n').map((e) => e.textContent);

test('the detour: 5, 15 or 30 minutes, 15 by default, remembered, and the trip is rebuilt with it', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: fx(calls, { trip: () => mkTrip([shop('S1', 'Maumee Antique Mall', 'Maumee, OH', 41.57, -83.64)]) }), beforeLoad: phone });
  await toTrip(p, 'Blenko');
  assert.match(calls.filter((u) => /\/trip\?/.test(u)).pop(), /&detour=15$/);
  assert.equal(p.$('#otp-nrDetour [aria-pressed="true"]').textContent, '15 min');
  p.$('#otp-nrDetour [data-nrdet="30"]').click(); await tick(60);
  assert.match(calls.filter((u) => /\/trip\?/.test(u)).pop(), /&detour=15$/, 'v7.72: not yet');
  p.$('#otp-nrOptsDone').click(); await tick(200);
  assert.match(calls.filter((u) => /\/trip\?/.test(u)).pop(), /&detour=30$/);
  assert.equal(p.win.localStorage.getItem('prowl.nearDetour'), '30');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Optimize route: one tap reorders the stops for the shortest drive, and the Maps links follow', async () => {
  const calls = [];
  const S = [shop('A', 'Alpha Antiques', 'Toledo, OH', 41.65, -83.54), shop('B', 'Bravo Barn', 'Findlay, OH', 41.04, -83.65), shop('C', 'Charlie Mall', 'Columbus, OH', 39.96, -83.0)];
  const order = (url) => /keep=1/.test(url) ? { order: [0, 1, 2, 3, 4], legs: [60, 60, 60, 60].map((m) => ({ min: m, mi: m })), src: 'osrm' } : { order: [0, 2, 1, 3, 4], legs: [40, 30, 50, 60].map((m) => ({ min: m, mi: m })), src: 'osrm' };
  const p = loadPage({ storage: DEN, fetchImpl: fx(calls, { trip: () => mkTrip(S), order }), beforeLoad: phone });
  await toTrip(p, 'Blenko');
  assert.deepEqual(anchors(p), ['Alpha Antiques', 'Bravo Barn', 'Charlie Mall']);
  const keep = calls.find((u) => /\/order\?keep=1/.test(u));
  assert.ok(keep, 'the drive is timed leg by leg');
  assert.match(decodeURIComponent(keep), /p=42\.480,-83\.470\|41\.650,-83\.540\|41\.040,-83\.650\|39\.960,-83\.000\|38\.434,-82\.132$/, 'start, stops, end');
  p.$('#otp-nrOut [data-nropt]').click(); await tick(80);
  const opt = calls.filter((u) => /\/order\?p=/.test(u)).pop();
  assert.ok(opt, 'asked the worker for the order');
  assert.deepEqual(anchors(p), ['Bravo Barn', 'Alpha Antiques', 'Charlie Mall'], 'in the order the router gave');
  const g = new URL(p.$('#otp-nrMaps').href);
  assert.equal(g.searchParams.get('waypoints'), 'Bravo Barn, Findlay, OH|Alpha Antiques, Toledo, OH|Charlie Mall, Columbus, OH');
  assert.match(p.$('#otp-toast').textContent, /Reordered for the shortest drive: about 3 h of driving, 1 h less/);
  assert.match(p.$('#otp-nrOut .nr-etan').textContent, /leaving now and allowing about 20 min at a stop\.$/, 'router times, not estimated');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Open when you arrive: on another day with a leave time, a shop closed by the time you get there is named', async () => {
  const calls = [];
  const S = [shop('A', 'Early Bird Antiques', 'Toledo, OH', 41.65, -83.54, hrs(6, 8)), shop('B', 'All Day Mall', 'Findlay, OH', 41.04, -83.65, hrs(8, 22))];
  const p = loadPage({ storage: DEN, fetchImpl: fx(calls, { trip: () => mkTrip(S, { day: LDAY }) }), beforeLoad: phone });
  await tick(30); p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click(); await tick(20);
  p.$(`#otp-nrDays [data-nrday="${LDAY}"]`).click();
  p.$('#otp-nrTo').value = 'Blenko';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);
  assert.equal(p.$('#otp-nrOut .nr-etan'), null, 'another day and no leave time: no arrival times');
  const leave = p.$('#otp-nrLeave'); leave.value = '09:00'; leave.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await tick(30);
  assert.match(p.$('#otp-nrOut .nr-etan').textContent, /leaving at 9 AM/);
  assert.match(p.$('#otp-nrOut .nr-late').textContent, /^Closed by the time you get there: Early Bird Antiques\./);
  const card = (n) => p.$$('#otp-nrOut a.nr-card').find((a) => a.querySelector('.nr-n').textContent === n);
  assert.match(card('Early Bird Antiques').querySelector('.nr-h').textContent, /^Get there ~/);
  assert.equal(card('All Day Mall').querySelector('.nr-st').textContent, 'OPEN');
  void LWD;
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no end: a loop of the shops around the start, ordered by the router, then back', async () => {
  const calls = [];
  const near = [shop('N1', 'One Antiques', 'Novi, MI', 42.49, -83.48), shop('N2', 'Two Thrift', 'Novi, MI', 42.47, -83.46), shop('N3', 'Three Vintage', 'Wixom, MI', 42.52, -83.53)];
  const order = (url) => /keep=1/.test(url) ? { order: [0, 1, 2, 3], legs: [5, 5, 5, 5].map((m) => ({ min: m, mi: m })), src: 'osrm' } : { order: [0, 3, 1, 2], legs: [6, 4, 3, 5].map((m) => ({ min: m, mi: m })), src: 'osrm' };
  const p = loadPage({ storage: DEN, fetchImpl: fx(calls, { trip: () => { throw new Error('no trip for a loop'); }, near, order }), beforeLoad: phone });
  await toTrip(p, '');
  await tick(80);
  assert.equal(calls.filter((u) => /\/trip\?/.test(u)).length, 0);
  assert.ok(calls.some((u) => /\/order\?loop=1&p=/.test(u)), 'ordered as a loop');
  assert.match(p.$('#otp-nrOut .nr-route').textContent, /^Novi, MI → the shops around it and back$/);
  assert.deepEqual(anchors(p), ['Three Vintage', 'One Antiques', 'Two Thrift']);
  assert.match(p.$('#otp-nrOut .nr-back').textContent, /^Then back to Novi, MI/);
  const g = new URL(p.$('#otp-nrMaps').href);
  assert.equal(g.searchParams.get('origin'), 'Novi, MI'); assert.equal(g.searchParams.get('destination'), 'Novi, MI');
  assert.equal(p.$('#otp-nrApple a').textContent, 'APPLE');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Apple Maps and Google Maps carry every stop: one link up to their caps, legs past them, each starting where the last ended', async () => {
  const calls = [];
  const S = [];
  for (let i = 1; i <= 15; i++) S.push(shop('S' + i, 'Shop ' + i, 'Town ' + i + ', OH', 41.6 - i * 0.2, -83.5 + i * 0.05));
  const p = loadPage({ storage: DEN, fetchImpl: fx(calls, { trip: () => mkTrip(S) }), beforeLoad: phone });
  await toTrip(p, 'Blenko');
  const apple = p.$$('#otp-nrApple a');
  assert.deepEqual(apple.map((a) => a.textContent), ['APPLE 1', 'APPLE 2']);
  const a1 = new URL(apple[0].href), a2 = new URL(apple[1].href);
  assert.equal(a1.origin + a1.pathname, 'https://maps.apple.com/directions');
  assert.equal(a1.searchParams.get('source'), 'Novi, MI');
  assert.equal(a1.searchParams.getAll('waypoint').length, 13, 'Apple Maps takes 14 stops: 13 on the way and the end');
  assert.equal(a1.searchParams.get('waypoint'), 'Shop 1, Town 1, OH');
  assert.equal(a1.searchParams.get('destination'), 'Shop 14, Town 14, OH', 'leg 1 ends at the next leg\'s first stop');
  assert.equal(a1.searchParams.get('mode'), 'driving');
  assert.equal(a2.searchParams.get('source'), 'Shop 14, Town 14, OH');
  assert.deepEqual(a2.searchParams.getAll('waypoint'), ['Shop 15, Town 15, OH']);
  assert.equal(a2.searchParams.get('destination'), 'Blenko Glass Company, Milton, WV');
  const g = p.$$('#otp-nrLegs a');
  assert.deepEqual(g.map((a) => a.textContent), ['GOOGLE 1', 'GOOGLE 2'], 'Google takes 9 waypoints a link');
  const all = [];
  for (const a of apple) { const u = new URL(a.href); all.push(...u.searchParams.getAll('waypoint')); }
  assert.equal(all.length + 1, 15, 'every stop is in an Apple link (Shop 14 as leg 1\'s end)');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('estate sales along the way (owner): within the detour, open on the trip day; one over before you get there says so', async () => {
  const calls = [];
  const today = ymd(D);
  const S = [shop('A', 'Alpha Antiques', 'Toledo, OH', 41.65, -83.54)];
  const sales = [
    { name: 'Big Toledo Sale', url: 'https://www.estatesales.net/OH/Toledo/1', start: today, end: today + 'T00:01:00', city: 'Toledo', st: 'OH', lat: 41.66, lon: -83.55 },
    { name: 'Far Away Sale', url: 'https://www.estatesales.net/OH/Lima/2', start: today, end: today, city: 'Lima', st: 'OH', lat: 40.74, lon: -84.9 },
  ];
  const p = loadPage({ storage: Object.assign({ 'prowl.owner': 'owner-key-0123456789' }, DEN), fetchImpl: fx(calls, { trip: () => mkTrip(S), sales }), beforeLoad: phone });
  await toTrip(p, 'Blenko');
  await tick(80);
  assert.ok(calls.some((u) => /\/sales\?st=OH&city=Toledo/.test(u)), 'the towns on the trip');
  const box = p.$('#otp-nrSales');
  assert.match(box.textContent, /Estate sales along the way \(1\)/);
  assert.match(box.textContent, /Big Toledo Sale/);
  assert.doesNotMatch(box.textContent, /Far Away Sale/, 'outside the detour');
  assert.match(box.textContent, /Ends before you get there/);
  await p.close();
  const q = loadPage({ storage: DEN, fetchImpl: fx([], { trip: () => mkTrip(S), sales }), beforeLoad: phone });
  await toTrip(q, 'Blenko');
  assert.equal(q.$('#otp-nrSales').textContent, '', 'everyone else: no estate sales (EstateSales.net said yes to the owner only)');
  await q.close();
});
