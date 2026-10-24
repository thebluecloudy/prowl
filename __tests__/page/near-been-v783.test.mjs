// Page v7.83 (the owner: "i stopped at one, now i want to find the next one but i don't know where i am"). On the trip's
// day, ✓ Been marks a stop done: it stays in the list, dimmed; it leaves the Maps link, which then starts from the phone
// (no origin); Next stop names the first one still ahead. Kept per trip in a new key, prowl.nearBeen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const card = (id, name, town, extra) => Object.assign({ id, name, town, why: 'Antiques', rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41, lng: -83.6, hours: null, near: 3, nested: [] }, extra || {});
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV');
const TRIP = {
  origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 398, min: 390, slower: 0, routes: 1 }, day: '',
  stops: [
    card('S1', 'Maumee Antique Mall', 'Maumee, OH', { nested: [card('N1', 'Uptown Antiques', 'Maumee, OH')] }),
    card('S2', "Jeffrey's Antique Gallery", 'Findlay, OH'),
    card('S3', 'Central City Antiques', 'Huntington, WV'),
  ],
  more: [], maps: 'https://www.google.com/maps/dir/?api=1', empty: false,
};
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = (trip) => (u) => {
  const url = String(u);
  if (/\/trip\?/.test(url)) return J(Object.assign({}, trip, { day: (/[&?]day=([\d-]+)/.exec(url) || [])[1] || '' }));
  if (/\/trips/.test(url)) return J({ trips: [], finds: [] });
  return J({ places: [], items: [] });
};
const phone = (win) => { Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } }); };

async function built(storage, trip, pickDay) {
  const p = loadPage({ storage: Object.assign({}, DEN, storage || {}), fetchImpl: fx(trip || TRIP), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(20);
  if (pickDay) { p.$$('#otp-nrDays [data-nrday]')[pickDay].click(); await tick(5); }
  p.$('#otp-nrTo').value = 'Blenko wv';
  p.$('#otp-nrGo').click();
  await tick(150);
  return p;
}
const rows = (p) => p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row');
const been = (p, id) => p.$(`#otp-nrOut .nr-stops [data-nrbeen="${id}"]`);

test('v7.83: ✓ Been marks a stop done: dimmed, out of the Maps link, which starts from the phone; Next stop is the one after', async () => {
  const p = await built();
  assert.equal(p.$('#otp-nrStart').textContent, 'Start in Maps');
  assert.match(p.$('#otp-nrStart').href, /origin=Novi/, 'before: from where the trip starts');
  assert.equal(p.$$('#otp-nrOut .nr-stops [data-nrbeen]').length, 4, 'every stop, and the shop also in town, on the trip day');
  assert.equal(p.$('#otp-nrOut .nr-next'), null, 'no Next stop until you have been somewhere');
  been(p, 'S1').click(); await tick(20);
  const r = rows(p);
  assert.ok(r[0].classList.contains('nr-beenrow'));
  assert.equal(r[0].querySelector('.nr-beent').textContent, '✓ Been there');
  assert.equal(been(p, 'S1').textContent, 'Undo');
  assert.equal(been(p, 'S1').getAttribute('aria-pressed'), 'true');
  assert.equal(p.$('#otp-nrOut .nr-next .nr-n').textContent, "Jeffrey's Antique Gallery", 'Next stop');
  assert.equal(p.$('#otp-nrOut .nr-next .nr-num').textContent, 'B');
  assert.match(p.$('#otp-nrOut .nr-next a.nr-go').href, /destination=Jeffrey/);
  const go = p.$('#otp-nrStart');
  assert.equal(go.textContent, 'Carry on in Maps');
  assert.doesNotMatch(go.href, /origin=/, 'Maps starts from the phone; your position is never in the link');
  assert.doesNotMatch(decodeURIComponent(go.href), /Maumee Antique Mall/, 'a stop you have been to is not driven to again');
  assert.match(decodeURIComponent(go.href), /Jeffrey's Antique Gallery, Findlay, OH\|Central City Antiques/);
  const st = JSON.parse(p.win.localStorage.getItem('prowl.nearBeen'));
  assert.deepEqual(Object.values(st.s), [{ S1: 1 }]);
  been(p, 'S1').click(); await tick(20);
  assert.equal(p.$('#otp-nrOut .nr-next'), null, 'Undo');
  assert.equal(p.$('#otp-nrStart').textContent, 'Start in Maps');
  assert.deepEqual(p.errors, []);
});

test('v7.83: a shop also in town counts as being there; every stop done says so; kept for the same trip after a reload', async () => {
  const p = await built();
  p.$('#otp-nrOut .nr-nest [data-nrbeen="N1"]').click(); await tick(20);
  assert.equal(p.$('#otp-nrOut .nr-next .nr-n').textContent, 'Maumee Antique Mall', 'in Maumee: the big one there is still next');
  for (const id of ['S1', 'S2', 'S3']) { been(p, id).click(); await tick(10); }
  assert.equal(p.$('#otp-nrOut p.nr-next').textContent, 'Every stop done. On to Blenko Glass Company.');
  const keep = { 'prowl.nearBeen': JSON.parse(p.win.localStorage.getItem('prowl.nearBeen')) };
  const q = await built(keep);
  assert.equal(q.$$('#otp-nrOut .nr-beenrow').length, 4, 'the same trip, the same marks');
  assert.deepEqual(q.errors, []);
});

test('v7.83: not on a trip planned for another day; a mark kept for one trip does not touch another', async () => {
  const p = await built(null, null, 2);
  assert.equal(p.$$('#otp-nrOut [data-nrbeen]').length, 0, 'no ✓ Been on a day still to come');
  const other = { 'prowl.nearBeen': { o: ['b:somewhere|novi, mi|'], s: { 'b:somewhere|novi, mi|': { S1: 1 } } } };
  const q = await built(other);
  assert.equal(q.$$('#otp-nrOut .nr-beenrow').length, 0);
  assert.deepEqual(q.errors, []);
});

test('v7.83: a broken or old prowl.nearBeen is ignored, and only the last 10 trips are kept', async () => {
  const p = await built({ 'prowl.nearBeen': [1, 2] });
  assert.equal(p.$$('#otp-nrOut .nr-beenrow').length, 0);
  const s = {}, o = [];
  for (let i = 0; i < 10; i++) { o.push('b:x' + i); s['b:x' + i] = { A: 1 }; }
  const q = await built({ 'prowl.nearBeen': { o, s } });
  been(q, 'S2').click(); await tick(10);
  const st = JSON.parse(q.win.localStorage.getItem('prowl.nearBeen'));
  assert.equal(st.o.length, 10); assert.equal(st.s['b:x0'], undefined, 'the oldest goes');
  assert.deepEqual(q.errors, []);
});
