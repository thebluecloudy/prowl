// Page v7.78 (the owner: "i may want to go to a store ... and then you click on that place"): + Stop on a shop makes it
// one of your stops on the way. From Around you it waits under Road trip; on a trip you just built, the trip is built
// again through it, in drive order among your other stops. Three at most; your own stops have no + Stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const card = (id, name, town, extra) => Object.assign({ id, name, town, why: 'Antiques', rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41, lng: -83.6, hours: null, near: 3, nested: [] }, extra || {});
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV');
const PIN = 'Central City Antiques, Huntington, WV';
const TRIP = {
  origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 398, min: 390, slower: 0, routes: 1 }, day: '',
  stops: [
    card('S1', 'Maumee Antique Mall', 'Maumee, OH', { lat: 41.56, nested: [card('N1', 'Uptown Antiques', 'Maumee, OH', { lat: 41.56 })] }),
    card('S2', "Jeffrey's Antique Gallery", 'Findlay, OH', { lat: 41.04 }),
    card('P1', 'Central City Antiques', 'Huntington, WV', { lat: 38.42, pin: true }),
  ],
  more: [card('M1', 'Little Barn Antiques', 'Bowling Green, OH', { lat: 41.37 })],
  maps: 'https://www.google.com/maps/dir/?api=1', empty: false, via: [PIN], pins: 1, detour: 15,
};
const AROUND = [card('A1', 'Antique Mall of Findlay', 'Findlay, OH'), card('A2', 'Old Mill Antiques', 'Findlay, OH')];
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = (calls) => (u, o) => {
  const url = String(u); calls.push({ url, o: o || {} });
  if (/\/trip\?/.test(url)) return J(TRIP);
  if (/\/near\?/.test(url)) return J({ town: 'Findlay, OH', places: AROUND });
  if (/\/trips/.test(url)) return J({ trips: [], finds: [] });
  return J({ places: [], items: [] });
};
const phone = (win) => { win.prowlSugMs = 5; Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.04, longitude: -83.65 } }), 0) } }); };
const viaOf = (url) => decodeURIComponent((/&via=([^&]*)/.exec(url) || [])[1] || '').split('|').filter(Boolean);
const trips = (calls) => calls.filter((x) => /\/trip\?/.test(x.url));

async function built(calls) {
  const p = loadPage({ storage: Object.assign({}, DEN), fetchImpl: fx(calls), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(20);
  p.$('#otp-nrViaAdd').click();
  p.$('#otp-nrVia0').value = PIN; p.$('#otp-nrVia0').dispatchEvent(new p.win.Event('input'));
  p.$('#otp-nrTo').value = 'Blenko wv';
  p.$('#otp-nrGo').click();
  await tick(150);
  return p;
}

test('v7.78: + Stop in Around you puts the shop under Road trip as a stop on the way, without building yet', async () => {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN), fetchImpl: fx(calls), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(80);
  const b = p.$$('#otp-nrLive .nr-row .nr-addv');
  assert.equal(b.length, 2, 'every shop in Around you has + Stop');
  assert.equal(b[0].textContent, '+ Stop');
  assert.equal(b[0].getAttribute('aria-label'), 'Make Antique Mall of Findlay one of your stops on the way');
  b[0].click(); await tick(20);
  assert.equal(p.$('#otp-nrTrip').hidden, false, 'Road trip is open');
  assert.equal(p.$('#otp-nrVia0').value, 'Antique Mall of Findlay, Findlay, OH');
  assert.notEqual(p.doc.activeElement && p.doc.activeElement.tagName, 'INPUT', 'no keyboard (the owner)');
  assert.equal(trips(calls).length, 0, 'nothing built until Build trip');
  assert.match(p.$('#otp-toast').textContent, /Now say where you are headed/);
  p.$('#otp-nrT1').click(); await tick(40);
  p.$$('#otp-nrLive .nr-addv')[0].click(); await tick(10);
  assert.equal(p.$$('#otp-nrVias input').length, 1, 'the same shop twice is one stop');
  assert.match(p.$('#otp-toast').textContent, /already a stop/);
  assert.deepEqual(p.errors, []);
});

test('v7.78: + Stop on a built trip builds it again through the shop, in drive order among your stops', async () => {
  const calls = [];
  const p = await built(calls);
  const rows = p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row');
  assert.ok(rows[0].querySelector('.nr-addv'), 'a shop found on the way has + Stop');
  assert.equal(rows[2].querySelector('.nr-addv'), null, 'your own stop has none');
  assert.ok(p.$('#otp-nrOut .nr-nest .nr-addv'), 'so does a shop also in town');
  rows[1].querySelector('.nr-addv').click(); await tick(150);
  const T = trips(calls);
  assert.equal(T.length, 2, 'built again');
  assert.deepEqual(viaOf(T[1].url), ["Jeffrey's Antique Gallery, Findlay, OH", PIN], 'Findlay comes before Huntington on the drive');
  assert.match(T[1].url, /[?&]to=Blenko%20wv/);
  assert.deepEqual(p.$$('#otp-nrVias input').map((x) => x.value), ["Jeffrey's Antique Gallery, Findlay, OH", PIN]);
  assert.deepEqual(p.errors, []);
});

test('v7.78: a smaller shop along the way can be made a stop too; it goes where the drive passes it', async () => {
  const calls = [];
  const p = await built(calls);
  const more = p.$('#otp-nrOut .nr-more .nr-addv');
  assert.ok(more, '+ Stop among the smaller shops');
  more.click(); await tick(150);
  assert.deepEqual(viaOf(trips(calls)[1].url), ['Little Barn Antiques, Bowling Green, OH', PIN]);
  assert.deepEqual(p.errors, []);
});

test('v7.78: three stops on the way is the most; + Stop then says so and changes nothing', async () => {
  const calls = [];
  const p = await built(calls);
  p.$('#otp-nrOut [data-nraddid="S1"]').click(); await tick(150);
  p.$('#otp-nrOut [data-nraddid="S2"]').click(); await tick(150);
  assert.equal(p.$$('#otp-nrVias input').length, 3);
  const n = trips(calls).length;
  const left = p.$$('#otp-nrOut .nr-addv');
  assert.ok(left.length, 'the smaller shops still offer it');
  left[left.length - 1].click(); await tick(60);
  assert.equal(trips(calls).length, n, 'no new build');
  assert.equal(p.$$('#otp-nrVias input').length, 3);
  assert.match(p.$('#otp-toast').textContent, /Three stops on the way is the most/);
  assert.deepEqual(p.errors, []);
});
