// Page v7.51 / worker v154 (the owner, from Gemini's Findlay to Milton run: "some good advice, can we incorporate this
// somehow?"). Each stop says the time to allow, a big mall further off the road says what the detour costs, a town's
// shops a short walk from its stop say so, and the trip head adds up the shops and the drive, saying when it is more
// than a day. Skipping a stop takes its time out of the total.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const H = { offset: -240, periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 10, minute: 0 }, close: { day: d, hour: 18, minute: 0 } })), days: [] };
const card = (id, name, town, why, extra) => Object.assign({ id, name, town, why, rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name) + '&query_place_id=' + id, lat: 40, lng: -83, hours: H, near: 2 }, extra || {});
const STOPS = [
  card('S1', "Jeffrey's Antique Gallery", 'Findlay, OH', '250 dealers', { stay: 90, nested: [] }),
  card('S2', 'Heart of Ohio Antique Center', 'Springfield, OH', '650 dealers', { stay: 240, worth: true, near: 22.4, nested: [] }),
  card('S3', 'Central City Antiques', 'Huntington, WV', 'Antique mall', { stay: 120, nested: [card('S4', 'Village Antiques', 'Huntington, WV', 'Antiques', { walk: true }), card('S5', 'Far Side Antiques', 'Huntington, WV', 'Antiques')] }),
];
const DEST = card('D1', 'The Old Timey Shop Antique Mall', 'Milton, WV', 'Antique mall');
const trip = (d) => ({ origin: { town: 'Findlay, OH' }, dest: DEST, route: { mi: 290, min: 300, slower: 0, routes: 1 }, day: d, weekday: new Date(d + 'T12:00:00Z').getUTCDay(), stops: STOPS, more: [], maps: 'https://www.google.com/maps/dir/?api=1', empty: false });
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = (u) => { const url = String(u); if (/\/trip\?/.test(url)) { const d = /[&?]day=([\d-]+)/.exec(url); return J(trip(d ? d[1] : '')); } if (/\/near\?/.test(url)) return J({ places: [] }); if (/\/trips$/.test(url)) return J({ trips: [] }); return J({ items: [] }); };
const phone = (win) => Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.04, longitude: -83.65 } }), 0) } });

test('a road trip says how long to allow at each stop, what a detour costs, what is a short walk, and adds up the day', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, fetchImpl: fx, beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'The Old Timey Shop Antique Mall, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  const lines = p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row .nr-anchor .nr-x').map((e) => e.textContent);
  assert.deepEqual(lines, ['Allow about 1 h 30 min', 'Allow about 4 h · Worth the detour', 'Allow about 2 h']);
  assert.equal(p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row .nr-anchor .nr-det')[1].textContent, '+22 min', 'v7.72: what it adds is on the card');
  const nested = p.$$('#otp-nrOut .nr-nest .nr-card').map((c) => (c.querySelector('.nr-x') || { textContent: '' }).textContent);
  assert.deepEqual(nested, ['A short walk from the stop', ''], 'Village Antiques is a walk; the other one a drive');
  assert.equal(p.$('#otp-nrOut .nr-dest .nr-x'), null, 'the final stop has no time to allow from the worker');
  assert.equal(p.$('#otp-nrOut .nr-head .nr-plan').textContent, 'About 7 h 30 min in the shops. With the drive, 12 h 30 min: more than a day, so plan a night on the road or Skip a few stops.');
  p.$('#otp-nrOut [data-nrskip="S2"]').click();
  await tick(30);
  assert.equal(p.$('#otp-nrOut .nr-head .nr-plan').textContent, 'About 3 h 30 min in the shops. With the drive, 8 h 30 min.', 'skipping Heart of Ohio takes its four hours out');
  assert.doesNotMatch(p.$('#otp-near').textContent, /Gemini|v7\.\d/);
  assert.deepEqual(p.errors, []);
  await p.close();
});
