// Page v7.73 (the owner: "Using benchmark review the near me feature to make it more intuitive", release 3 of 3,
// polish). The glance check for the car: every main button in Near me 48px tall with its words at 17px on a phone;
// no typing after the first trip (the last places a trip was built to, as chips under Where are you headed?, in a new
// key prowl.nearTo); and one label style, sentence case, for Near me's tabs and buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const shop = (id, name, town, lat, lng) => ({ id, name, town, why: 'Antiques', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat, lng, hours: null, nested: [], near: 5 });
const trip = (to) => ({ origin: { town: 'Novi, MI' }, dest: shop('D', to, '', 38.43, -82.13), route: { mi: 300, min: 300 }, day: '', stops: [shop('S1', 'Maumee Antique Mall', 'Maumee, OH', 41.57, -83.64)], more: [], maps: 'https://www.google.com/maps/dir/?api=1' });
function fx(calls) {
  return (u) => {
    const url = String(u); calls.push(url);
    const m = /\/trip\?to=([^&]*)/.exec(url);
    if (m) { const to = decodeURIComponent(m[1]); return /nowhere/i.test(to) ? J({ error: 'no route' }, 404) : J(trip(to)); }
    if (/\/near\?/.test(url)) return J({ town: 'Novi, MI', places: [] });
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
const phone = (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } });
async function roadTrip(storage) {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, storage || {}), fetchImpl: fx(calls), beforeLoad: phone });
  await tick(30); p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click(); await tick(20);
  return { p, calls };
}
async function build(p, to) {
  p.$('#otp-nrTo').value = to;
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(150);
}
const saved = (p) => JSON.parse(p.win.localStorage.getItem('prowl.nearTo') || 'null');

test('no trips yet: no Recent row', async () => {
  const { p } = await roadTrip();
  assert.equal(p.$('#otp-nrRecent').hidden, true);
  assert.equal(p.$('#otp-nrRecent').innerHTML, '');
  await p.close();
});

test('each place a trip was built to is kept, newest first, once; a place with no route is not', async () => {
  const { p } = await roadTrip();
  await build(p, 'Blenko Glass Company, Milton, WV');
  await build(p, 'Columbus, OH');
  await build(p, 'blenko glass company, milton, wv');
  await build(p, 'Nowhere at all');
  assert.deepEqual(saved(p), ['blenko glass company, milton, wv', 'Columbus, OH'], 'the same place once, as last typed; the miss left out');
  const row = p.$('#otp-nrRecent');
  assert.equal(row.hidden, false);
  assert.equal(row.querySelector('.nr-recl').textContent, 'Recent');
  assert.deepEqual([...row.querySelectorAll('[data-nrto]')].map((b) => b.textContent), ['blenko glass company, milton, wv', 'Columbus, OH']);
  assert.ok(p.$('#otp-nrForm').compareDocumentPosition(row) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'under the destination box');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('one tap on a recent place builds the trip there, no typing', async () => {
  const { p, calls } = await roadTrip({ 'prowl.nearTo': ['Columbus, OH', 'Blenko Glass Company, Milton, WV'] });
  assert.deepEqual(p.$$('#otp-nrRecent [data-nrto]').map((b) => b.textContent), ['Columbus, OH', 'Blenko Glass Company, Milton, WV'], 'kept from an earlier visit');
  p.$('#otp-nrRecent [data-nrto="1"]').click(); await tick(150);
  assert.equal(p.$('#otp-nrTo').value, 'Blenko Glass Company, Milton, WV');
  assert.match(calls.filter((u) => /\/trip\?/.test(u)).pop(), /to=Blenko%20Glass%20Company%2C%20Milton%2C%20WV&/);
  assert.equal(p.$('#otp-nrOut .nr-dest .nr-n').textContent, 'Blenko Glass Company, Milton, WV');
  assert.deepEqual(saved(p)[0], 'Blenko Glass Company, Milton, WV', 'and it moves to the front');
  await p.close();
});

test('at most five kept and three shown; a typed place is text, never markup; a broken key is ignored', async () => {
  const { p } = await roadTrip({ 'prowl.nearTo': ['A', 'B', 'C', 'D', 'E'] });
  await build(p, '<b>F</b>');
  assert.deepEqual(saved(p), ['<b>F</b>', 'A', 'B', 'C', 'D']);
  const chips = p.$$('#otp-nrRecent [data-nrto]');
  assert.equal(chips.length, 3);
  assert.equal(chips[0].textContent, '<b>F</b>');
  assert.equal(chips[0].querySelector('b'), null);
  await p.close();
  const q = await roadTrip({ 'prowl.nearTo': { not: 'a list' } });
  assert.equal(q.p.$('#otp-nrRecent').hidden, true);
  assert.deepEqual(q.p.errors, []);
  await q.p.close();
});

test('sentence case: Near me\'s tabs and the trip\'s buttons', async () => {
  const { p } = await roadTrip();
  assert.deepEqual(p.$$('#otp-near .tab').map((b) => b.textContent), ['Around you', 'Road trip', 'Trips']);
  await build(p, 'Blenko');
  assert.deepEqual([p.$('#otp-nrStart'), p.$('#otp-nrFootMore'), p.$('#otp-nrMaps'), p.$('#otp-nrApple a'), p.$('#otp-nrHere'), p.$('#otp-nrShare')].map((e) => e.textContent),
    ['Start in Maps', '⋯ More', 'Google Maps', 'Apple Maps', 'Rebuild from here', 'Share']);
  await p.close();
  for (const s of ['Tap More › Rebuild from here, then try again.', 'More › Share › Invite link sends it', 'then More › Share › Keep it for my group']) assert.ok(PAGE.includes(s), s);
});

test('the glance check: on a phone every main Near me button is 48px tall with its words at 17px', () => {
  const at = PAGE.indexOf('/* v7.73 glance check for the car');
  assert.ok(at > 0);
  const block = PAGE.slice(PAGE.lastIndexOf('@media (max-width:600px){', at), PAGE.indexOf('\n}\n', at));
  const rule = (sel) => { const r = block.split('\n').find((l) => l.includes(sel) && l.includes('{')); assert.ok(r, sel); return r; };
  for (const sel of ['#otp-near .tab{', '#otp-near .nr-acts>.nr-go', '#otp-near .addrow button', '#otp-near .nr-wc', '#otp-near .b.nr-mebig', '#otp-near .nr-optdone', '#otp-near .nr-foot .b{']) {
    const r = rule(sel);
    assert.match(r, /min-height:48px/, sel);
    assert.match(r, /font-size:17px/, sel);
  }
  assert.match(rule('#otp-near .nr-acts>.nr-skip'), /min-height:48px/, 'Skip and Reviews are as easy to hit');
  assert.ok(PAGE.indexOf('/* v7.73 glance check') > PAGE.indexOf('.scout-app-wrapper #otp-near .nr-foot .b{font-size:14px'), 'after the older phone sizes, so it wins');
});
