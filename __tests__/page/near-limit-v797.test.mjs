// Page v7.97 (worker v170; Matt: "near me cost. it was only me and i ran it about 20 times"). Google's place searches
// now have a daily ceiling for all of Prowl, and Road trip is 10 builds a day each. Near me says each plainly, with the
// Maps search still offered, instead of "could not be found just now".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const MILTON = { q: 'Milton, WV', lat: 38.4345, lng: -82.1322, town: 'Milton, WV', city: 'Milton', st: 'WV', zip: '25541', cl: 'huntington' };
function fixture(calls, near, trip) {
  return (u) => {
    const url = String(u); calls.push(url);
    if (/\/geo\?/.test(url)) return J(MILTON);
    if (/\/near\?/.test(url)) return near();
    if (/\/trip\?/.test(url)) return trip();
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
function phone(win) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } });
  Object.defineProperty(win.navigator, 'permissions', { configurable: true, value: { query: () => Promise.resolve({ state: 'granted' }) } });
}
const LIMIT = () => J({ error: 'daily limit', empty: true, places: [], stops: [] }, 429);
async function roadTrip(p, to) {
  p.$('#otp-nrT2').click(); await tick(30);
  p.$('#otp-nrTo').value = to;
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(150);
  return p.$('#otp-nrOut').textContent;
}

test('Around you past the day\'s ceiling: said plainly, with the Maps search', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls, LIMIT, LIMIT), beforeLoad: phone });
  await tick(30); p.$('#otp-localBtn').click(); await tick(150);
  assert.equal(p.$('#otp-nrLive').textContent, 'Near me has looked up all the shops it can for today. It is back tomorrow. Search antique stores in Google Maps ↗');
  assert.ok(p.$('#otp-nrLive a[href^="https://www.google.com/maps/search/"]'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip past the day\'s ceiling: back tomorrow, and a map search for the place typed', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls, () => J({ town: 'Novi, MI', places: [] }), LIMIT), beforeLoad: phone });
  await tick(30); p.$('#otp-localBtn').click(); await tick(120);
  const out = await roadTrip(p, 'Milton, WV');
  assert.ok(calls.some((u) => /\/trip\?/.test(u)), 'it asked');
  assert.equal(out, 'Road trips have looked up all the shops they can for today. They are back tomorrow. For now, search the map there: Antique stores near Milton, WV');
  assert.equal(p.$('#otp-nrOut a').getAttribute('href'), 'https://www.google.com/maps/search/?api=1&query=antique%20stores%20near%20Milton%2C%20WV');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip past one person\'s 10 a day: said, not "could not be built"', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls, () => J({ town: 'Novi, MI', places: [] }), () => J({ error: 'slow down' }, 429)), beforeLoad: phone });
  await tick(30); p.$('#otp-localBtn').click(); await tick(120);
  assert.equal(await roadTrip(p, 'Milton, WV'), 'That is a lot of road trips for one day. Try again tomorrow.');
  await p.close();
});
