// Page v7.75 / worker v163 (the owner: "i would like to make a specific stop on the way from one city to the other ...
// maybe one or two or three, we can go from pin to pin, and find things in between"). Up to three stops on the way,
// with places as you type; the drive goes through them in order, each is in the list as Your stop, never skipped there,
// and the stops go with the trip when it is kept for the group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const card = (id, name, town, extra) => Object.assign({ id, name, town, why: 'Antiques', rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41, lng: -83.6, hours: null, near: 3, nested: [] }, extra || {});
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV');
const VIA = ['Maumee Antique Mall, Maumee, OH', 'Central City Antiques, Huntington, WV'];
const TRIP = { origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 398, min: 390, slower: 0, routes: 1 }, day: '', stops: [card('P1', 'Maumee Antique Mall', 'Maumee, OH', { pin: true }), card('S1', "Jeffrey's Antique Gallery", 'Findlay, OH'), card('P2', 'Central City Antiques', 'Huntington, WV', { pin: true })], more: [], maps: 'https://www.google.com/maps/dir/?api=1', empty: false, via: VIA, pins: 2, detour: 15 };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = (calls) => (u, o) => { const url = String(u); calls.push({ url, o: o || {} }); if (/\/trip\?/.test(url)) return J(Object.assign({}, TRIP, { day: (/[&?]day=([\d-]+)/.exec(url) || [])[1] || '' })); if (/\/trips$/.test(url) && o && o.method === 'POST') return J(Object.assign({}, TRIP, { id: 'tabcdefghi', org: true, mine: true, members: 1, closes: '2026-12-01T00:00:00.000Z', finds: 0 })); if (/\/trips/.test(url)) return J({ trips: [], finds: [] }); if (/\/suggest\?/.test(url)) return J({ places: [{ id: 'x', main: 'Maumee Antique Mall', sub: 'Maumee, OH' }] }); return J({ places: [], items: [] }); };
const phone = (win) => { win.prowlSugMs = 5; Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.48, longitude: -83.47 } }), 0) } }); };
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const type = (p, el, v) => { el.value = v; el.dispatchEvent(new p.win.Event('input')); };

test('add up to three stops on the way, with suggestions; the drive is built through them in order; each is Your stop', async () => {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: fx(calls), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(20);
  assert.equal(p.$('#otp-nrViaAdd').textContent, '+ Add a stop on the way');
  assert.equal(p.$('#otp-nrVia0'), null, 'none until asked');
  p.$('#otp-nrViaAdd').click();
  const v0 = p.$('#otp-nrVia0');
  assert.ok(v0); assert.equal(p.doc.activeElement, v0, 'ready to type');
  assert.equal(v0.getAttribute('aria-label'), 'Stop 1 on the way');
  type(p, v0, 'Maumee ant'); await tick(40);
  p.$('#otp-nrSugV0 .nr-sgb').click(); await tick(5);
  assert.equal(v0.value, 'Maumee Antique Mall, Maumee, OH', 'a suggestion fills it');
  p.$('#otp-nrViaAdd').click(); type(p, p.$('#otp-nrVia1'), 'Toledo, OH');
  p.$('#otp-nrViaAdd').click(); type(p, p.$('#otp-nrVia2'), VIA[1]);
  assert.equal(p.$('#otp-nrViaAdd'), null, 'three at most');
  p.$('#otp-nrVias [data-viax="1"]').click();
  assert.deepEqual([p.$('#otp-nrVia0').value, p.$('#otp-nrVia1').value], VIA, 'Toledo taken out, the rest in order');
  assert.ok(p.$('#otp-nrViaAdd'), 'room for one more');
  p.$('#otp-nrTo').value = 'Blenko wv';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(5);
  await tick(150);
  const c = calls.find((x) => /\/trip\?/.test(x.url));
  assert.match(c.url, new RegExp('&via=' + encodeURIComponent(VIA.join('|')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  assert.equal(p.$('#otp-nrOut .nr-viah').textContent, 'By way of Maumee Antique Mall and Central City Antiques');
  const rows = p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row');
  assert.deepEqual(rows.map((r) => (r.querySelector('.nr-yours') || { textContent: '' }).textContent), ['Your stop', '', 'Your stop']);
  assert.equal(rows[0].querySelector('.nr-skip'), null, 'a stop you named is not skipped in the list');
  assert.ok(rows[1].querySelector('.nr-skip'), 'a shop found on the way can be');
  assert.ok(rows[0].classList.contains('nr-pinrow'));
  p.$('#otp-nrShare').click(); await tick(10);
  const keep = p.$('#otp-nrKeep');
  assert.ok(keep, 'Keep it for my group');
  keep.click(); await tick(80);
  const post = calls.find((x) => /\/trips$/.test(x.url) && x.o.method === 'POST');
  assert.ok(post);
  const b = JSON.parse(post.o.body); assert.deepEqual(b.via, VIA, 'kept with its stops'); assert.equal(b.detour, 15);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v7.76: Build trip comes after the stops; your stops are always in the one Maps link; a stop not found is said', async () => {
  const calls = [];
  const many = Array.from({ length: 11 }, (_, i) => card('S' + i, 'Shop ' + i, 'Town ' + i + ', OH', { n: 1000 + i, tier: 2 }));
  const pins = [card('P1', 'Rookwood Pottery', 'Cincinnati, OH', { pin: true, n: 5, tier: 0 }), card('P2', 'Mosser Glass Warehouse', 'Cambridge, OH', { pin: true, n: 3, tier: 0 })];
  const T = Object.assign({}, TRIP, { stops: [pins[0]].concat(many.slice(0, 6), [pins[1]], many.slice(6)), via: ['Rookwood Pottery, Cincinnati, OH', 'Mosser Glass Warehouse, Cambridge, OH', 'Nowhere Barn, Atlantis, OH'], pins: 2, missing: ['Nowhere Barn, Atlantis, OH'] });
  const base = fx(calls);
  const p = loadPage({ storage: DEN, fetchImpl: (u, o) => (/\/trip\?/.test(String(u)) ? (calls.push({ url: String(u) }), J(T)) : base(u, o)), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(20);
  const go = p.$('#otp-nrGo');
  assert.equal(go.textContent, 'Build trip');
  assert.equal(p.$('#otp-nrForm button'), null, 'not beside the box any more');
  assert.ok(p.$('#otp-nrVias').compareDocumentPosition(go) & 4, 'after the stops');
  assert.ok(p.$('#otp-nrFromP').compareDocumentPosition(go) & 4, 'and after From');
  p.$('#otp-nrTo').value = 'Novi, MI';
  go.click(); await tick(150);
  assert.ok(calls.find((x) => /\/trip\?to=Novi%2C%20MI/.test(x.url)), 'the button builds it');
  const wp = new URL(p.$('#otp-nrStart').href).searchParams.get('waypoints').split('|');
  assert.equal(wp.length, 9, 'one link, nine stops');
  assert.ok(wp.includes('Rookwood Pottery, Cincinnati, OH') && wp.includes('Mosser Glass Warehouse, Cambridge, OH'), 'your stops always, small as they are');
  assert.ok(wp.indexOf('Rookwood Pottery, Cincinnati, OH') < wp.indexOf('Mosser Glass Warehouse, Cambridge, OH'), 'in drive order');
  assert.equal(p.$$('#otp-nrOut .nr-pinrow .nr-nm').length, 0, 'never Listed only');
  assert.equal(p.$$('#otp-nrOut .nr-nm').length, 4, 'four shops left out, said on their cards');
  assert.match(p.$('#otp-nrOut').textContent, /Not found on the map: Nowhere Barn\. The drive still goes there/);
  assert.deepEqual(p.errors, []);
  await p.close();
});
