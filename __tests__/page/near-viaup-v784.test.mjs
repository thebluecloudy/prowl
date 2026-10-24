// Page v7.84: ↑ on a stop on the way moves it up one place, and the trip is built through the stops in that order.
// Typed stops go in the order typed; before this the only way to change it was to remove one and type it again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const TRIP = { origin: { town: 'Novi, MI' }, dest: { id: 'D', name: 'Blenko Glass Company', town: 'Milton, WV', lat: 38.4, lng: -82.1 }, route: { mi: 398, min: 390 }, day: '', stops: [], more: [], maps: 'https://www.google.com/maps/dir/?api=1' };
const fx = (calls) => (u) => { const url = String(u); calls.push(url); if (/\/trip\?/.test(url)) return J(TRIP); return J({ places: [], trips: [] }); };
const phone = (win) => Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } });
const vals = (p) => p.$$('#otp-nrVias input').map((x) => x.value);

test('v7.84: ↑ moves a stop on the way up one place; the first has none; the trip goes in the new order', async () => {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN), fetchImpl: fx(calls), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(20);
  for (const v of ['Huntington, WV', 'Toledo, OH', 'Findlay, OH']) {
    p.$('#otp-nrViaAdd').click();
    const inp = p.$$('#otp-nrVias input').pop();
    inp.value = v; inp.dispatchEvent(new p.win.Event('input'));
  }
  assert.equal(p.$('#otp-nrVias [data-viaup="0"]'), null, 'the first stop cannot go higher');
  const up = p.$('#otp-nrVias [data-viaup="1"]');
  assert.equal(up.textContent, '↑');
  assert.equal(up.getAttribute('aria-label'), 'Move stop 2 up');
  up.click(); await tick(5);
  assert.deepEqual(vals(p), ['Toledo, OH', 'Huntington, WV', 'Findlay, OH']);
  p.$('#otp-nrVias [data-viaup="2"]').click(); await tick(5);
  assert.deepEqual(vals(p), ['Toledo, OH', 'Findlay, OH', 'Huntington, WV'], 'Toledo, Findlay, then Huntington: the order of the drive');
  assert.equal(p.doc.activeElement && p.doc.activeElement.getAttribute('data-viaup'), '1', 'focus stays with the stop that moved');
  p.$('#otp-nrTo').value = 'Blenko wv';
  p.$('#otp-nrGo').click(); await tick(150);
  const t = calls.find((u) => /\/trip\?/.test(u));
  assert.deepEqual(decodeURIComponent(/&via=([^&]*)/.exec(t)[1]).split('|'), ['Toledo, OH', 'Findlay, OH', 'Huntington, WV']);
  assert.deepEqual(p.errors, []);
});
