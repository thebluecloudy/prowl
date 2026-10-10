// Page v6.76: Den > Local has "Estate sales near you" for the owner only (worker v103 GET /sales reads EstateSales.net,
// with the site's permission). A city and state go to the worker with the owner key; the sales list by start date,
// each opening on EstateSales.net, and "Show on a map" loads Leaflet only when asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const OWNER = 'owner-key-0123456789';
const SALES = {
  city: 'Novi', st: 'MI', at: 1,
  items: [
    { id: '2', name: 'Later sale', url: 'https://www.estatesales.net/MI/Wixom/48393/2', start: '2026-10-17T13:00:00Z', end: '2026-10-18T20:00:00Z', city: 'Wixom', st: 'MI', lat: 42.52, lon: -83.53 },
    { id: '1', name: 'Sooner sale', url: 'https://www.estatesales.net/MI/Novi/48377/1', start: '2026-10-11T13:00:00Z', end: '2026-10-11T20:00:00Z', city: 'Novi', st: 'MI', addr: '1 Main St', lat: 42.48, lon: -83.47 },
  ],
};

function open(storage, calls) {
  const fetchImpl = (u, o) => {
    if (/\/sales\?/.test(String(u))) { calls.push({ u: String(u), o }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SALES) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] }, ...storage } });
}

test('without the owner key the estate-sales box stays hidden and empty', async () => {
  const calls = [], p = open({}, calls);
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  assert.equal(p.$('#otp-esBox').hidden, true);
  assert.equal(p.$('#otp-esBox').innerHTML, '');
  assert.equal(calls.length, 0);
  await p.close();
});

test('the owner asks for a city: sent with the owner key, listed soonest first, linking out; the map loads Leaflet once', async () => {
  const calls = [], p = open({ 'prowl.owner': OWNER }, calls);
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  const box = p.$('#otp-esBox');
  assert.equal(box.hidden, false);
  assert.match(box.textContent, /Estate sales near you\s*Only you see this/);
  p.$('#otp-esIn').value = 'nowhere';
  p.$('#otp-esGo').click();
  assert.match(p.$('#otp-esBox .es-err').textContent, /two-letter state/);
  assert.equal(calls.length, 0);
  p.$('#otp-esIn').value = 'novi , mi';
  p.$('#otp-esGo').click();
  await waitFor(() => p.$$('#otp-esBox .es-row').length === 2);
  assert.equal(calls[0].u, 'https://prowl.thebluecloud.workers.dev/sales?st=MI&city=novi');
  assert.equal(calls[0].o.headers['X-Prowl-Owner'], OWNER);
  assert.equal(p.win.localStorage.getItem('prowl.salesPlace'), 'novi, MI');
  const rows = p.$$('#otp-esBox .es-row');
  assert.deepEqual(rows.map((a) => a.querySelector('b').textContent), ['Sooner sale', 'Later sale']);
  assert.equal(rows[0].getAttribute('href'), 'https://www.estatesales.net/MI/Novi/48377/1');
  assert.equal(rows[0].target, '_blank');
  assert.match(rows[0].textContent, /1 Main St · Novi, MI/);
  assert.match(box.textContent, /2 sales near Novi, MI from EstateSales\.net/);
  const leaflet = () => p.$$('head script').filter((s) => /leaflet\/1\.9\.4\/leaflet\.min\.js$/.test(s.src));
  assert.equal(leaflet().length, 0, 'no map code until asked');
  p.$('#otp-esMapB').click();
  assert.equal(leaflet().length, 1);
  assert.equal(p.$('#otp-esMap').hidden, false);
  assert.equal(p.$('#otp-esMapB').textContent, 'Hide the map');
  p.$('#otp-esMapB').click();
  assert.equal(p.$('#otp-esMap').hidden, true);
  p.$('#otp-esMapB').click();
  assert.equal(leaflet().length, 1, 'loaded once');
  assert.deepEqual(p.errors, []);
  await p.close();
});
