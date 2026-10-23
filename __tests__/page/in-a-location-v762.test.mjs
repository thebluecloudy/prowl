// Page v7.62 In a location (the owner tested Milton, WV with location off: only Craigslist and Facebook moved, the
// "Location is off" banner stayed, Refresh did nothing, the shops never listed and Road trip had "no starting point").
// A typed town, "City, ST" or ZIP is looked up once (worker v157 /geo), kept on the device (prowl.nearAt), and centres
// Around you, the store searches, garage sales, Craigslist, Facebook and Road trip's start, with no GPS at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const MILTON = { q: 'Milton, WV', lat: 38.4345, lng: -82.1322, town: 'Milton, WV', city: 'Milton', st: 'WV', zip: '25541', cl: 'huntington' };
const PL = [
  { id: 'B1', name: 'Blenko Glass Company', town: 'Milton, WV', why: 'Glass', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=b', lat: 38.433, lng: -82.135, hours: null, near: 0.2 },
  { id: 'C1', name: 'Central City Antiques', town: 'Huntington, WV', why: '60 dealers', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=c', lat: 38.4192, lng: -82.4452, hours: null, near: 17 },
];
function fixture(calls, geo) {
  return (u) => {
    const url = String(u); calls.push(url);
    if (/\/geo\?/.test(url)) return geo ? geo(url) : J(MILTON);
    if (/\/near\?/.test(url)) return J({ town: 'Somewhere, ZZ', places: PL });
    if (/\/trip\?/.test(url)) return J({ origin: { town: 'Milton, WV' }, dest: { name: 'Blenko Glass Company', town: 'Milton, WV' }, route: { mi: 3, min: 8 }, day: '', stops: [], more: [], maps: 'https://www.google.com/maps/dir/?api=1' });
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
function phone(win, gps) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok, err) => { gps.asked++; setTimeout(() => (gps.denied ? err({ code: 1 }) : ok({ coords: { latitude: 42.48, longitude: -83.47 } })), 0); } } });
}
const open = async (p) => { await tick(30); p.$('#otp-localBtn').click(); await tick(120); };
const live = (p) => p.$('#otp-nrLive').textContent;

test('location off: the banner offers In a location instead of a dead end, and a typed place lists the shops there', async () => {
  const calls = [], gps = { asked: 0, denied: true };
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  assert.match(live(p), /Location is blocked for this site in this browser.*Or tap Change above and type a town, City, ST or ZIP/);   // v7.64: says how to allow it; v7.71: Change
  assert.equal(p.$('#otp-nrLive #otp-nrRefresh'), null, 'no Refresh that cannot help: Use my location asks again');
  assert.equal(p.$('#otp-nrAtBar').hidden, true, 'nothing typed yet, no chips');
  assert.equal(p.$('#otp-nrWhereBox').hidden, true, 'v7.71: the town box waits behind Change');
  p.$('#otp-nrLive [data-nrwhere]').click();
  assert.equal(p.$('#otp-nrWhereBox').hidden, false, 'Type a town or ZIP opens it');
  p.$('#otp-nrAtIn').value = '  Milton,   WV ';
  p.$('#otp-nrAtForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(120);
  const geo = calls.filter((u) => /\/geo\?/.test(u));
  assert.equal(geo.length, 1);
  assert.match(geo[0], /\/geo\?q=Milton%2C%20WV$/);
  const near = calls.filter((u) => /\/near\?/.test(u)).pop();
  assert.match(near, /lat=38\.4345&lng=-82\.1322/, 'Around you asks at the typed place');
  assert.match(p.$('#otp-nrLive h3').textContent, /^Around Milton, WV/);
  assert.match(live(p), /biggest first\. Miles are from the middle of town/);
  assert.match(p.$('#otp-nrWhere').textContent, /Shops near Milton, WV/, 'v7.71: the pill names the place');
  assert.equal(p.$('#otp-nrWhereBox').hidden, true, 'and the box closes');
  assert.ok(!/You are at/.test(live(p)), 'never "you are at" a shop you are not standing in');
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 2);
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.nearAt'));
  assert.equal(saved.town, 'Milton, WV'); assert.equal(saved.on, true); assert.equal(saved.cl, 'huntington'); assert.equal(saved.q, 'Milton, WV');
  assert.equal(p.$('#otp-nrAtBar').hidden, true, 'v7.71: the place in use is on the pill, not a chip too');
  // the store searches, garage sales and Craigslist move there too
  assert.equal(p.$('#otp-nearScope').textContent, 'near Milton, WV');
  assert.equal(p.$('#otp-nearWhere'), null, 'v7.71: no second Where I am bar');
  assert.equal(p.$('#otp-nearGrid a.nearc').href, 'https://www.google.com/maps/search/?api=1&query=thrift%20stores%20near%20Milton%2C%20WV');
  assert.equal(p.$('#otp-salesScope').textContent, 'near Milton, WV');
  const gms = p.$$('#otp-salesGrid a').map((a) => a.href);
  assert.equal(gms[1], 'https://huntington.craigslist.org/search/gms?postal=25541&search_distance=25#search=1~list~0~0', 'its nearest Craigslist site, around its ZIP');
  assert.match(p.$('#otp-denLocalList').textContent, /Craigslist · Milton, WV/);
  assert.match(p.$('#otp-fbHubNote').textContent, /Facebook has no page Prowl can use near Milton, WV/);
  assert.equal(gps.asked, 1, 'the phone was asked once, before the place was typed');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the typed place is remembered: it opens there with no lookup and no GPS; Where I am goes back and keeps it a tap away', async () => {
  const calls = [], gps = { asked: 0, denied: true };
  const p = loadPage({ storage: Object.assign({ 'prowl.nearAt': Object.assign({ on: true, fb: '' }, MILTON) }, DEN), fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  assert.equal(calls.filter((u) => /\/geo\?/.test(u)).length, 0);
  assert.equal(gps.asked, 0);
  assert.match(calls.filter((u) => /\/near\?/.test(u)).pop(), /lat=38\.4345&lng=-82\.1322/);
  p.$('#otp-nrWhereGo').click();
  assert.equal(p.$('#otp-nrAtMe').textContent, '📍 Use my location');
  p.$('#otp-nrAtMe').click(); await tick(120);   // v7.71: Where I am is Change › Use my location
  assert.equal(gps.asked, 1, 'Where I am asks the phone');
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.nearAt')).on, false, 'the place is kept, not in use');
  assert.match(live(p), /Location is blocked/);   // v7.64
  const use = p.$('#otp-nrLive [data-nrat="on"]');
  assert.equal(use.textContent, 'Use Milton, WV', 'the banner offers the remembered place');
  assert.equal(p.$('#otp-nearScope').textContent, 'where you are');
  assert.equal(p.$('#otp-nrAtBar [data-nrat="on"]').textContent, 'Milton, WV', 'and it is a Recent chip under Change');
  use.click(); await tick(120);
  assert.match(p.$('#otp-nrLive h3').textContent, /^Around Milton, WV/);
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.nearAt')).on, true);
  // the same text typed again is not looked up again
  p.$('#otp-nrAtIn').value = 'milton, wv';
  p.$('#otp-nrAtForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(60);
  assert.equal(calls.filter((u) => /\/geo\?/.test(u)).length, 0);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a place Prowl cannot find says so in plain words and changes nothing', async () => {
  const calls = [], gps = { asked: 0, denied: true };
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls, () => J({ error: 'not found' }, 404)), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrAtIn').value = 'Zzyzx <b>nowhere</b>';
  p.$('#otp-nrAtForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(60);
  const err = p.$('#otp-nrAtErr');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /^Prowl could not find “Zzyzx <b>nowhere<\/b>”\. Try the town and its state/);
  assert.equal(err.querySelector('b'), null, 'the typed text is text, never markup');
  assert.equal(p.win.localStorage.getItem('prowl.nearAt'), null);
  assert.equal(p.$('#otp-nrAtGo').textContent, 'Look there');
  await p.close();
});

test('near a metro Prowl knows, Facebook searches that marketplace', async () => {
  const calls = [], gps = { asked: 0, denied: true };
  const novi = { q: '48377', lat: 42.5012, lng: -83.4784, town: 'Novi, MI', city: 'Novi', st: 'MI', zip: '48377', cl: 'detroit' };
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls, () => J(novi)), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrAtIn').value = '48377';
  p.$('#otp-nrAtForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(120);
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.nearAt')).fb, 'detroit');
  assert.match(p.$('#otp-fbHubNote').textContent, /Searching Facebook in the Detroit marketplace, the closest Prowl knows to Novi, MI\./);
  assert.match(p.$('#otp-nrLive h3').textContent, /^Around Novi, MI/);
  await p.close();
});

test('Road trip: no GPS needed. With location off it points to From; a typed From is the start', async () => {
  const calls = [], gps = { asked: 0, denied: true };
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrT2').click(); await tick(30);
  assert.equal(p.$('#otp-nrFrom').value, '', 'no typed place yet: From is where you are');
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(60);
  assert.match(p.$('#otp-nrOut').textContent, /Location is blocked for this site in this browser.*Or tap Change by From above and type a town, City, ST or ZIP/);   // v7.64
  assert.ok(!/no starting point/.test(p.$('#otp-nrOut').textContent));
  p.$('#otp-nrFrom').value = 'Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(120);
  const trip = calls.filter((u) => /\/trip\?/.test(u)).pop();
  assert.ok(trip, 'the trip was built');
  assert.match(trip, /lat=38\.4345&lng=-82\.1322/, 'from the typed place');
  assert.match(p.$('#otp-nrOut .nr-route').textContent, /^Milton, WV → Blenko Glass Company/);
  assert.equal(p.$('#otp-nrOut .nr-etan'), null, 'no stops on this trip, nothing to time (road-upgrades-v762 times a typed start)');
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.nearAt'));
  assert.equal(saved.town, 'Milton, WV'); assert.equal(saved.on, false, 'kept as the last typed place, Around you left alone');
  await p.close();
});

test('Road trip with the place in use: From starts filled in, and the location-off message offers the remembered place', async () => {
  const calls = [], gps = { asked: 0, denied: true };
  const p = loadPage({ storage: Object.assign({ 'prowl.nearAt': Object.assign({ on: true, fb: '' }, MILTON) }, DEN), fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrT2').click(); await tick(30);
  assert.equal(p.$('#otp-nrFrom').value, 'Milton, WV');
  p.$('#otp-nrFrom').value = '';
  p.$('#otp-nrTo').value = 'Huntington, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(60);
  const b = p.$('#otp-nrOut [data-nrfrom]');
  assert.equal(b.textContent, 'Start from Milton, WV');
  b.click(); await tick(120);
  assert.match(calls.filter((u) => /\/trip\?/.test(u)).pop(), /to=Huntington%2C%20WV&lat=38\.4345&lng=-82\.1322/);
  assert.equal(calls.filter((u) => /\/geo\?/.test(u)).length, 0, 'the remembered place needs no lookup');
  assert.deepEqual(p.errors, []);
  await p.close();
});
