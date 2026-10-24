// Page v7.85: an open group trip has Delete (your own) or Leave (a friend's) at its foot, the same two taps as the
// TRIPS list, so you need not go back to the list to be done with a trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const card = (id, name, extra) => Object.assign({ id, name, town: 'Findlay, OH', why: 'Antiques', rating: 4.6, n: 1201, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41.04, lng: -83.65, hours: null, near: 0.4, nested: [] }, extra || {});
const DEST = card('D1', 'Blenko Glass Company', { town: 'Milton, WV' });
const VIEW = { id: 'tabcdefghi', mine: true, org: true, members: 2, day: '2026-10-26', weekday: 1, origin: 'Novi, MI', dest: DEST, route: { mi: 398, min: 390 }, stops: [card('A1', "Jeffrey's Antique Gallery")], more: [], maps: 'https://www.google.com/maps/dir/?api=1', closes: '2026-10-28T00:00:00.000Z', finds: 0 };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fx = (calls, org) => (u, o) => {
  const url = String(u); calls.push({ url, o: o || {} });
  if (/\/trips\/tabcdefghi\/finds$/.test(url)) return J({ finds: [] });
  if (/\/trips\/tabcdefghi\/(delete|leave)$/.test(url)) return J({ ok: true });
  if (/\/trips\/tabcdefghi$/.test(url)) return J(Object.assign({}, VIEW, { org }));
  if (/\/trips$/.test(url)) return J({ trips: [{ id: 'tabcdefghi', day: '2026-10-26', origin: 'Novi, MI', dest: DEST, members: 2, stops: 1, org }] });
  return J({ places: [], items: [] });
};
const phone = (win) => Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.04, longitude: -83.65 } }), 0) } });

async function open(org) {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: fx(calls, org), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT3').click(); await tick(40);
  p.$('#otp-nrTrips [data-nrtrip="tabcdefghi"]').click(); await tick(80);
  return { p, calls };
}

test('v7.85: your own open trip has Delete at its foot; the first tap asks, the second deletes it and closes it', async () => {
  const { p, calls } = await open(true);
  const b = p.$('#otp-nrOut .nr-tripend [data-nrdel="tabcdefghi"]');
  assert.ok(b, 'Delete at the foot of the open trip');
  assert.equal(b.textContent, 'Delete');
  assert.match(p.$('#otp-nrOut .nr-tripend').textContent, /for everyone, with its Finds/);
  b.click();
  assert.equal(b.textContent, 'Delete for everyone?');
  b.click(); await tick(30);
  assert.equal(calls.filter((x) => /\/trips\/tabcdefghi\/delete$/.test(x.url) && x.o.method === 'POST').length, 1);
  assert.equal(p.$('#otp-nrOut').textContent, '', 'the trip is closed');
  assert.match(p.$('#otp-toast').textContent, /Trip deleted for everyone/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v7.85: a friend\'s open trip has Leave instead', async () => {
  const { p, calls } = await open(false);
  const b = p.$('#otp-nrOut .nr-tripend [data-nrdel="tabcdefghi"]');
  assert.equal(b.textContent, 'Leave');
  b.click(); b.click(); await tick(30);
  assert.ok(calls.find((x) => /\/trips\/tabcdefghi\/leave$/.test(x.url)));
  assert.match(p.$('#otp-toast').textContent, /You left the trip/);
  assert.deepEqual(p.errors, []);
  await p.close();
});
