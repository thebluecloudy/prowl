// Page v7.57 (the owner, in Findlay with 48377 saved: the store searches said near me but opened Google Maps at the
// ZIP, "it should be near me or zip"; "road trip does not scroll on apple"; "when I open road trip the keyboard opens
// by default"). The store searches go around where you are once the phone has said so, with Where I am / the saved
// place a tap apart; Road trip opens without the keyboard; the map lets one finger scroll the screen on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [], city: '48377' } };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const PL = [{ id: 'A1', name: "Jeffrey's Antique Gallery", town: 'Findlay, OH', why: 'Antiques', rating: 4.6, n: 1201, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41.05, lng: -83.65, hours: null, near: 1 }];
const fx = (u) => { const url = String(u); if (/\/near\?/.test(url)) return J({ town: 'Findlay, OH', places: PL }); if (/\/trips$/.test(url)) return J({ trips: [] }); return J({ items: [] }); };
function phone(win, opt) {
  opt = opt || {};
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok, err) => setTimeout(() => (opt.denied ? err({ code: 1 }) : ok({ coords: { latitude: 41.04, longitude: -83.65 } })), 0) } });
  if (opt.maps) win.L = { Browser: { mobile: !!opt.touch }, map: (el, o) => { opt.maps.push(o); return { fitBounds() {}, remove() {} }; }, tileLayer: () => ({ addTo() { return this; } }), divIcon: (o) => o, marker: () => ({ addTo() { return this; }, bindPopup() { return this; } }), circleMarker: () => ({ addTo() { return this; }, bindPopup() { return this; } }) };
}
const links = (p) => p.$$('#otp-nearGrid a.nearc').map((a) => a.href);

test('with a fix the store searches go around where you are; 48377 is one tap away; Apple Maps gets no place for where you are', async () => {
  const p = loadPage({ storage: DEN, fetchImpl: fx, beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(120);
  assert.equal(p.$('#otp-nearScope').textContent, 'where you are');
  assert.deepEqual(p.$$('#otp-nearWhere button').map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')), ['Where I am:true', '48377:false']);
  assert.equal(links(p)[0], 'https://www.google.com/maps/search/?api=1&query=antique%20stores%20near%20me');
  assert.ok(links(p).every((u) => /near%20me$/.test(u) && !/48377/.test(u)), 'no ZIP while you are somewhere else');
  p.$('#otp-nearWhere [data-nw="place"]').click();
  assert.equal(p.$('#otp-nearScope').textContent, 'near 48377');
  assert.equal(links(p)[0], 'https://www.google.com/maps/search/?api=1&query=antique%20stores%20near%2048377');
  p.$('#otp-nearMaps [data-mp="apple"]').click();
  assert.equal(links(p)[0], 'https://maps.apple.com/?q=antique%20stores%2048377');
  p.$('#otp-nearWhere [data-nw="me"]').click();
  assert.equal(links(p)[0], 'https://maps.apple.com/?q=antique%20stores', 'Apple Maps searches around where you stand');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no fix: the saved place, said as such; no saved place: no chips, near me', async () => {
  const p = loadPage({ storage: DEN, fetchImpl: fx, beforeLoad: (w) => phone(w, { denied: true }) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(120);
  assert.equal(p.$('#otp-nearScope').textContent, 'near 48377');
  assert.equal(links(p)[0], 'https://www.google.com/maps/search/?api=1&query=antique%20stores%20near%2048377');
  await p.close();
  const q = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, fetchImpl: fx, beforeLoad: (w) => phone(w, { denied: true }) });
  await tick(30);
  q.$('#otp-localBtn').click(); await tick(120);
  assert.equal(q.$('#otp-nearWhere').hidden, true);
  assert.equal(q.$('#otp-nearScope').textContent, 'where you are');
  assert.equal(links(q)[0], 'https://www.google.com/maps/search/?api=1&query=antique%20stores%20near%20me');
  assert.deepEqual(q.errors, []);
  await q.close();
});

test('Road trip opens without the keyboard; on a phone the map lets one finger scroll the screen', async () => {
  const maps = [];
  const p = loadPage({ storage: DEN, fetchImpl: fx, beforeLoad: (w) => phone(w, { touch: true, maps }) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(120);
  p.$('#otp-nrT2').click(); await tick(30);
  assert.notEqual(p.doc.activeElement, p.$('#otp-nrTo'), 'the destination box waits to be tapped');
  p.$('#otp-nrT1').click(); await tick(60);
  p.$('#otp-nrLive [data-nrmap="around"]').click(); await tick(20);
  assert.equal(maps.length, 1);
  assert.equal(maps[0].dragging, false, 'one finger scrolls, not the map');
  assert.equal(maps[0].tap, false);
  assert.equal(maps[0].scrollWheelZoom, false);
  assert.deepEqual(p.errors, []);
  await p.close();
  const desk = [];
  const d = loadPage({ storage: DEN, fetchImpl: fx, beforeLoad: (w) => phone(w, { maps: desk }) });
  await tick(30);
  d.$('#otp-localBtn').click(); await tick(120);
  d.$('#otp-nrLive [data-nrmap="around"]').click(); await tick(20);
  assert.equal(desk[0].dragging, true, 'a mouse still drags the map');
  await d.close();
});
