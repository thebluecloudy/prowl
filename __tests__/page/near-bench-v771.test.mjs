// Page v7.71 (the owner, 2026-10-23: "Using benchmark review the near me feature to make it more intuitive"). Around
// you, against Google Maps, Apple Maps, Yelp, FB Marketplace and NN/g: one place to say where (a pill with Change),
// location asked from a tap with one line of why, Open now (off until tapped, new key prowl.nearOpen), the hours in
// words and colour under the name, Directions in the maps app picked, and the old Local block folded into one closed
// More ways to look without the store searches the chips already cover (Thrift stores stays: the owner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const H_ALWAYS = { offset: -240, periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], days: [] };
const H_NEVER = { offset: -240, periods: [], days: ['Sunday: Closed', 'Monday: Closed', 'Tuesday: Closed', 'Wednesday: Closed', 'Thursday: Closed', 'Friday: Closed', 'Saturday: Closed'] };
const place = (id, name, hours) => ({ id, name, town: 'Novi, MI', why: 'Antique mall', rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat: 42.48, lng: -83.47, hours, near: 1 });
const OPEN = place('A1', 'Always Open Antiques', H_ALWAYS), SHUT = place('B2', 'Shut Barn', H_NEVER);
function fx(calls, places) {
  return (u) => {
    const url = String(u); calls.push(url);
    if (/\/near\?/.test(url)) return J({ town: 'Novi, MI', places: places || [OPEN, SHUT] });
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
// perm: what the Permissions API says ('prompt' | 'granted' | 'denied'), or none at all
function phone(win, gps, perm) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok, err) => { gps.asked++; setTimeout(() => (gps.denied ? err({ code: 1 }) : ok({ coords: { latitude: 42.48, longitude: -83.47 } })), 0); } } });
  if (perm) Object.defineProperty(win.navigator, 'permissions', { configurable: true, value: { query: () => Promise.resolve({ state: perm }) } });
}
async function open(opt) {
  opt = opt || {};
  const calls = [], gps = { asked: 0, denied: !!opt.denied };
  const p = loadPage({ storage: Object.assign({}, DEN, opt.storage || {}), fetchImpl: fx(calls, opt.places), beforeLoad: (w) => phone(w, gps, opt.perm) });
  await tick(30); p.$('#otp-localBtn').click(); await tick(120);
  return { p, calls, gps };
}
const near = (calls) => calls.filter((u) => /\/near\?/.test(u));

test('never asked before: one line of why and a button, and the phone is asked only from the tap', async () => {
  const { p, calls, gps } = await open({ perm: 'prompt' });
  assert.equal(gps.asked, 0, 'no prompt the moment Near me opens');
  assert.equal(near(calls).length, 0);
  const ask = p.$('#otp-nrLive .nr-ask');
  assert.ok(ask, 'the ask card');
  assert.equal(ask.querySelector('h3').textContent, 'Find the shops around you');
  assert.equal(ask.querySelector('.nearp').textContent, 'Prowl uses your location only to find antique, vintage and thrift shops near you.');
  assert.deepEqual([...ask.querySelectorAll('button')].map((b) => b.textContent), ['📍 Use my location', 'Type a town or ZIP']);
  assert.ok(p.$('#otp-nrLive').textContent.trim().split(/\s+/).length < 40, 'under 40 words before the shops');
  ask.querySelector('[data-nrme="at"]').click(); await tick(150);
  assert.equal(gps.asked, 1, 'asked from the tap');
  assert.equal(near(calls).length, 1);
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 2);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('said yes before: the shops at once; said no: how to allow it, and Type a town opens the box ready to type', async () => {
  const yes = await open({ perm: 'granted' });
  assert.equal(yes.gps.asked, 1);
  assert.equal(yes.p.$$('#otp-nrLive .nr-card').length, 2, 'one tap (Near me) to see shops');
  await yes.p.close();
  const no = await open({ perm: 'denied' });
  assert.equal(no.gps.asked, 0, 'a blocked site is not asked again on its own');
  assert.match(no.p.$('#otp-nrLive').textContent, /^Location is blocked for this site/);
  assert.equal(no.p.$('#otp-nrWhereBox').hidden, true);
  no.p.$('#otp-nrLive [data-nrwhere]').click();
  assert.equal(no.p.$('#otp-nrWhereBox').hidden, false);
  assert.equal(no.p.doc.activeElement, no.p.$('#otp-nrAtIn'), 'the town box has the cursor');
  assert.equal(no.p.$('#otp-nrWhereGo').textContent, 'Done');
  assert.deepEqual(no.p.errors, []);
  await no.p.close();
});

test('one place to say where: the pill names it, Change opens Use my location, the town box and the recent place', async () => {
  const { p } = await open({ storage: { 'prowl.nearAt': { q: 'Milton, WV', lat: 38.43, lng: -82.13, town: 'Milton, WV', city: 'Milton', st: 'WV', zip: '25541', cl: 'huntington', fb: '', on: false } } });
  const pill = p.$('#otp-nrWhere');
  assert.equal(pill.querySelector('.nr-wl').textContent, '📍 Shops near where you are (Novi, MI)');
  const go = p.$('#otp-nrWhereGo');
  assert.equal(go.textContent, 'Change');
  assert.equal(go.getAttribute('aria-expanded'), 'false');
  assert.equal(go.getAttribute('aria-controls'), 'otp-nrWhereBox');
  go.click();
  assert.equal(p.$('#otp-nrWhereBox').hidden, false);
  assert.equal(p.$('#otp-nrWhereGo').getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...p.$('#otp-nrWhereBox').children].map((e) => e.id), ['otp-nrAtMe', 'otp-nrAtForm', 'otp-nrAtBar'], 'Use my location first, then the town box, then the recent place');
  assert.equal(p.$('#otp-nrAtIn').placeholder, 'Or type a town, City, ST or ZIP');
  assert.equal(p.$('#otp-nrAtBar').textContent, 'RecentMilton, WV');
  p.$('#otp-nrAtBar [data-nrat="on"]').click(); await tick(120);
  assert.equal(p.$('#otp-nrWhere .nr-wl').textContent, '📍 Shops near Milton, WV');
  assert.equal(p.$('#otp-nrWhereBox').hidden, true, 'it closes once a place is picked');
  assert.match(p.$('#otp-nrLive h3').textContent, /^Around Milton, WV/);
  assert.equal(p.$('#otp-nearWhere'), null, 'no second Where I am bar further down');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Open now: off when Near me opens, one tap shows only the open shops and is kept; nothing open says so, with a way back', async () => {
  const { p } = await open();
  const b = p.$('#otp-nrLive [data-nropen]');
  assert.equal(b.textContent, 'Open now');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 2);
  b.click();
  assert.equal(p.win.localStorage.getItem('prowl.nearOpen'), '1');
  assert.equal(p.$('#otp-nrLive [data-nropen]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(p.$$('#otp-nrLive .nr-card .nr-n').map((e) => e.textContent), ['Always Open Antiques'], 'no new search: the hours are on each shop');
  p.$('#otp-nrLive [data-nropen]').click();
  assert.equal(p.win.localStorage.getItem('prowl.nearOpen'), '');
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 2);
  await p.close();
  const shut = await open({ places: [SHUT], storage: { 'prowl.nearOpen': '1' } });
  assert.equal(shut.p.$('#otp-nrLive [data-nropen]').getAttribute('aria-pressed'), 'true', 'kept on this device');
  assert.equal(shut.p.$('#otp-nrLive .nr-card'), null);
  assert.match(shut.p.$('#otp-nrLive').textContent, /Nothing open right now close by\. Show closed ones too/);
  shut.p.$('#otp-nrLive [data-nropen=""].sgw-ml').click();
  assert.equal(shut.p.$$('#otp-nrLive .nr-card').length, 1);
  assert.deepEqual(shut.p.errors, []);
  await shut.p.close();
});

test('cards: open or closed in words and colour right under the name; Directions follows the maps app picked', async () => {
  const { p } = await open({ storage: { 'prowl.maps': 'apple' } });
  const cards = p.$$('#otp-nrLive .nr-card');
  const h = cards.map((c) => c.querySelector('.nr-n').nextElementSibling);
  assert.ok(h.every((e) => e.classList.contains('nr-h')), 'the hours come first, before the stars');
  assert.ok(h[0].classList.contains('nr-open')); assert.equal(h[0].textContent, 'Open 24 hours');
  assert.ok(h[1].classList.contains('nr-closed'));
  const dir = p.$$('#otp-nrLive .nr-row a.nr-go');
  assert.equal(dir[0].textContent, 'Directions');
  assert.equal(dir[0].href, 'https://maps.apple.com/?daddr=Always%20Open%20Antiques%2C%20Novi%2C%20MI&dirflg=d');
  await p.close();
  const g = await open();
  assert.match(g.p.$('#otp-nrLive .nr-row a.nr-go').href, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&travelmode=driving&destination=Always%20Open%20Antiques/);
  await g.p.close();
  assert.match(PAGE, /\.scout-app-wrapper \.nr-h\.nr-open\{[^}]*font-weight:700/);
  assert.match(PAGE, /\.scout-app-wrapper \.nr-h\.nr-closed\{[^}]*color:#a3361b/);
});

test('More ways to look: one closed fold, its help never opens by itself, the store searches without the chips\' kinds but with Thrift stores', async () => {
  const { p } = await open({ perm: 'prompt' });
  const more = p.$('#otp-nrMore');
  assert.equal(more.tagName, 'DETAILS');
  assert.equal(more.open, false);
  assert.equal(more.querySelector('summary').textContent, 'More ways to look');
  assert.ok(more.contains(p.$('#otp-denLocal')) && more.contains(p.$('#otp-cityIn')) && more.contains(p.$('#otp-nearGrid')), 'nothing removed: the city box, the store searches, garage sales and Facebook are inside');
  assert.equal(p.$('#otp-locHelp').open, false, 'no city yet, and the help still waits to be asked');
  assert.equal(p.$('#otp-locHelp summary').textContent, 'How these work');
  assert.ok(p.$('#otp-locHelp .nearp').textContent.split(/\s+/).length <= 70, 'cut to a short paragraph');
  const labels = p.$$('#otp-nearGrid a.nearc').map((a) => a.textContent);
  assert.deepEqual(labels, ['Thrift stores', 'Estate sales', 'Consignment', 'Salvage yards', 'Auction houses', 'Antique malls', 'Pawn shops']);
  assert.equal(new Set(labels).size, labels.length);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the place cannot be listed yet: said, with a Maps search for the first kind on, never a blank', async () => {
  const calls = [], gps = { asked: 0 };
  const p = loadPage({ storage: Object.assign({ 'prowl.nearCats': ['records'] }, DEN), fetchImpl: (u) => (/\/near\?/.test(String(u)) ? J({ error: 'not set up' }, 503) : fx(calls)(u)), beforeLoad: (w) => phone(w, gps) });
  await tick(30); p.$('#otp-localBtn').click(); await tick(120);
  assert.equal(p.$('#otp-nrLive').textContent, 'Prowl cannot list the shops here yet. Search record stores in Google Maps ↗');
  assert.equal(p.$('#otp-nrLive a').href, 'https://www.google.com/maps/search/?api=1&query=record%20stores%20near%20me');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the members note points to TRIPS, where kept trips are now', () => {
  assert.ok(PAGE.includes('under NEAR ME › Trips.'), 'v7.73: the tab in sentence case');
  assert.ok(!PAGE.includes('under NEAR ME › Road trip'));
});
