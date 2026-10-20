// Page v7.53 / worker v155 (the owner, on the road: "cannot share the map itinerary"). SHARE offers Send the route
// (the stops and the Google Maps link through the phone's share sheet, or copied; anyone, no sign-in) and Keep it for
// my group (the Pro group trip). A keep that fails says why instead of "try again".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const card = (id, name, town, extra) => Object.assign({ id, name, town, why: 'Antiques', rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name) + '&query_place_id=' + id, lat: 40, lng: -83, hours: null, near: 2 }, extra || {});
const STOPS = [card('S1', "Jeffrey's Antique Gallery", 'Findlay, OH', { nested: [] }), card('S2', 'The Delaware Antique Mall', 'Delaware, OH', { nested: [card('S3', 'Sandusky Street Antiques', 'Delaware, OH')] }), card('S4', 'Chillicothe Antique Emporium', 'Chillicothe, OH', { nested: [] })];
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV');
const trip = (d) => ({ origin: { town: 'Findlay, OH' }, dest: DEST, route: { mi: 244, min: 254, slower: 0, routes: 1 }, day: d, weekday: 2, stops: STOPS, more: [], maps: 'https://www.google.com/maps/dir/?api=1', empty: false });
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = (opt) => (u, o) => { const url = String(u); if (/\/trip\?/.test(url)) { const d = /[&?]day=([\d-]+)/.exec(url); return J(trip(d ? d[1] : '')); } if (/\/trips$/.test(url) && o && o.method === 'POST') return J({ error: 'Trips cannot be saved just now.' }, opt.keepStatus || 503); if (/\/trips$/.test(url)) return J({ trips: [] }); if (/\/near\?/.test(url)) return J({ places: [] }); return J({ items: [] }); };
function phone(win, shared, copied) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.04, longitude: -83.65 } }), 0) } });
  if (shared) Object.defineProperty(win.navigator, 'share', { configurable: true, value: (d) => { shared.push(d); return Promise.resolve(); } });
  if (copied) Object.defineProperty(win.navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
}
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
async function built(storage, before, opt) {
  const p = loadPage({ storage: Object.assign({ 'prowl.v36': { seen: true, hunts: [] } }, storage || {}), fetchImpl: fx(opt || {}), beforeLoad: before });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko wv';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  return p;
}

test('SHARE offers Send the route; it goes through the share sheet with the stops in order and the Maps link, signed out, skipped stops left out', async () => {
  const shared = [];
  const p = await built({}, (w) => phone(w, shared));
  p.$('#otp-nrOut [data-nrskip="S4"]').click(); await tick(20);
  p.$('#otp-nrShare').click();
  const box = p.$('#otp-nrSendBox');
  assert.ok(box, 'the choice opens on the trip');
  assert.deepEqual([...box.querySelectorAll('button')].map((b) => b.textContent), ['Send the route', 'Keep it for my group']);
  p.$('#otp-nrSend').click(); await tick(20);
  assert.equal(shared.length, 1, 'no sign-in asked: the share sheet opened');
  assert.equal(shared[0].title, 'Road trip to Blenko Glass Company');
  const lines = shared[0].text.split('\n');
  assert.deepEqual(lines.slice(0, 6), ['Road trip: Findlay, OH to Blenko Glass Company, Milton, WV', '244 mi, 4 h 14 min of driving', '', "1. Jeffrey's Antique Gallery, Findlay, OH", '2. The Delaware Antique Mall, Delaware, OH (+1 more in town)', 'Final stop: Blenko Glass Company, Milton, WV']);
  assert.match(lines[lines.length - 1], /^Open in Google Maps: https:\/\/www\.google\.com\/maps\/dir\/\?api=1&travelmode=driving&origin=Findlay%2C%20OH&destination=Blenko%20Glass%20Company%2C%20Milton%2C%20WV&waypoints=Jeffrey's%20Antique%20Gallery%2C%20Findlay%2C%20OH%7CThe%20Delaware%20Antique%20Mall%2C%20Delaware%2C%20OH$/);
  assert.doesNotMatch(shared[0].text, /Chillicothe|41\.04|83\.65/, 'the skipped stop is out, and where you stand is never in it');
  p.$('#otp-nrShare').click();
  assert.equal(p.$('#otp-nrSendBox'), null, 'SHARE again closes the choice');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('without a share sheet the route is copied; a keep that fails says why', async () => {
  const copied = [];
  const p = await built({ 'prowl.session': sess() }, (w) => phone(w, null, copied));
  p.$('#otp-nrShare').click();
  p.$('#otp-nrSend').click(); await tick(20);
  assert.equal(copied.length, 1);
  assert.match(copied[0], /^Road trip: Findlay, OH to Blenko Glass Company/);
  assert.match(p.$('#otp-toast').textContent, /Copied\. Paste it into a text or an email\./);
  p.$('#otp-nrKeep').click(); await tick(60);
  assert.equal(p.$('#otp-toast').textContent, 'Trips cannot be saved just now. (503) Send the route still works.');
  assert.deepEqual(p.errors, []);
  await p.close();
});
