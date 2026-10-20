// Page v7.39 / worker v132 (the spec of 2026-10-20: NEAR ME section, Road Trip, Trip Finds). NEAR ME is its own screen
// with two tabs: Around you (the shops around the phone, OPEN NOW / CLOSED worked out when the card is drawn) and Road
// trip (one box, where to; the stops in drive order, one anchor a town with the rest nested, hours for the trip's day,
// OPEN IN MAPS pinned, SHARE for the group, the Finds feed). The photo check gets SHARE THIS FIND while a trip is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const API = 'https://prowl.thebluecloud.workers.dev';
const WD = new Date().getDay();
const day = (d, h1, h2) => ({ open: { day: d, hour: h1, minute: 0 }, close: { day: d, hour: h2, minute: 0 } });
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const descr = (f) => DAYS.map((n, i) => n + ': ' + f(i));
const H_ALWAYS = { offset: -240, periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], days: [] };
const H_NOT_TODAY = { offset: -240, periods: [day((WD + 3) % 7, 10, 17)], days: descr((i) => (i === (WD + 3) % 7 ? '10:00 AM – 5:00 PM' : 'Closed')) };
const H_DAILY = { offset: -240, periods: [0, 1, 2, 3, 4, 5, 6].map((d) => day(d, 10, 18)), days: descr(() => '10:00 AM – 6:00 PM') };
const H_TUE_SUN = { offset: -240, periods: [0, 2, 3, 4, 5, 6].map((d) => day(d, 10, 17)), days: descr((i) => (i === 1 ? 'Closed' : '10:00 AM – 5:00 PM')) };
const H_BLENKO = { offset: -240, periods: [1, 2, 3, 4, 5].map((d) => day(d, 9, 15)), days: descr((i) => (i === 0 || i === 6 ? 'Closed' : '9:00 AM – 3:30 PM')) };
const card = (id, name, town, why, hours, extra) => Object.assign({ id, name, town, why, rating: 4.6, n: 300, photo: '/pp?n=places%2F' + id + '%2Fphotos%2FP1', url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name) + '&query_place_id=' + id, lat: 0, lng: 0, hours, near: 1 }, extra || {});
const PLACES = [card('A1', 'Always Open Antiques', 'Novi, MI', '120 dealers', H_ALWAYS), card('B2', 'Weekend Barn', 'Novi, MI', 'Antique mall', H_NOT_TODAY), card('C3', 'Quiet Thrift', 'Novi, MI', 'Thrift', null, { photo: '' })];
const STOPS = [
  card('S1', 'Maumee Antique Mall', 'Maumee, OH', '300 dealers', H_DAILY, { nested: [] }),
  card('S2', 'Chillicothe Antique Emporium', 'Chillicothe, OH', '100 dealers', H_TUE_SUN, { nested: [] }),
  card('S3', 'Central City Antiques', 'Huntington, WV', '60 dealers', H_DAILY, { nested: [card('S4', 'Olde Central City Vintage', 'Huntington, WV', 'Vintage', H_DAILY), card('S5', '14th Street Collectibles', 'Huntington, WV', 'Antiques', H_DAILY)] }),
];
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV', 'Glass factory', H_BLENKO);
const MAPS = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=Novi%2C%20MI&destination=Blenko%20Glass%20Company%2C%20Milton%2C%20WV&waypoints=Maumee%20Antique%20Mall%2C%20Maumee%2C%20OH%7CChillicothe%20Antique%20Emporium%2C%20Chillicothe%2C%20OH%7CCentral%20City%20Antiques%2C%20Huntington%2C%20WV';
const MORE = [card('M1', 'Gaffney\'s Treasures and Gifts', 'Marion, OH', 'Gift shop', H_DAILY), card('M2', 'Ellie Mills Mercantile', 'Jackson, OH', 'Home goods store', H_DAILY)];
const trip = (d, empty) => ({ origin: { town: 'Novi, MI' }, dest: DEST, route: { km: 640, min: 390, slower: 42, routes: 2 }, day: d, weekday: new Date(d + 'T12:00:00Z').getUTCDay(), stops: empty ? [] : STOPS, more: empty ? [] : MORE, maps: MAPS, empty: !!empty });
const VIEW = (d) => Object.assign(trip(d), { id: 'tabcdefghi', mine: true, org: true, members: 1, closes: '2026-12-01T00:00:00.000Z', finds: 0 });
const FINDS = [{ id: 'fabcdefghi', by: '', name: 'Hark', at: '2026-10-26T18:00:00.000Z', item: 'Blenko 384 decanter, tangerine', price: '$45', verdict: 'FAIR', fair: '$40–$70', stop: 'Central City Antiques', town: 'Huntington, WV', photo: '/finds/tabcdefghi/fabcdefghi.jpg?e=1&s=abc' }];
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
function nearFetch(calls, opt = {}) {
  return (u, o) => {
    const url = String(u); calls.push({ url, o: o || {} });
    if (/\/near\?/.test(url)) return opt.near503 ? J({ error: 'not set up', places: [] }, 503) : J({ at: '', places: PLACES });
    if (/\/trip\?/.test(url)) { const d = /[&?]day=([\d-]+)/.exec(url), t = trip(d ? d[1] : '', /to=nowhere/.test(url)); if (/lat=38\.4192/.test(url)) { t.origin = { town: 'Huntington, WV' }; t.stops = [STOPS[2]]; } return J(t); }
    if (/\/trips\/t[a-z0-9]{9}\/rebuild$/.test(url)) return J(Object.assign(VIEW('2026-10-26'), { origin: 'Huntington, WV', stops: [STOPS[2]] }));
    if (/\/trips$/.test(url) && o && o.method === 'POST') { const b = JSON.parse(o.body); return J(VIEW(b.day)); }
    if (/\/trips$/.test(url)) return J({ trips: [{ id: 'tabcdefghi', day: '2026-10-26', origin: 'Novi, MI', dest: DEST, members: 2, stops: 3, org: true }] });
    if (/\/trips\/t[a-z0-9]{9}\/finds$/.test(url) && o && o.method === 'POST') return J(Object.assign({}, FINDS[0], { by: 'me' }));
    if (/\/trips\/t[a-z0-9]{9}\/finds$/.test(url)) return J({ finds: FINDS });
    if (/\/trips\/t[a-z0-9]{9}\/share$/.test(url)) return J({ ok: true, added: true, pending: false, members: 2 });
    if (/\/trips\/t[a-z0-9]{9}$/.test(url)) return J(VIEW('2026-10-26'));
    if (/\/appraise$/.test(url)) return J({ item: 'Blenko 384 decanter (tangerine)', fair: '$40–$70', verdict: 'FAIR', basis: 'sold', condition: 'Good', sure: 'high', why: 'sold prices' });
    return J({ items: [] });
  };
}
/* a phone standing in Novi, a canvas that shrinks, an Image that loads */
function phone(win, geo) {
  let fixes = 0;
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok, err, opt) => setTimeout(() => {
    if (geo === 'denied') return err({ code: 1 });
    fixes++;
    const moved = opt && opt.maximumAge === 0 && fixes > 1;   /* a fresh fix later on: the phone is in Huntington now */
    ok({ coords: moved ? { latitude: 38.4192, longitude: -82.4452 } : { latitude: 42.4806, longitude: -83.4755 } });
  }, 0) } });
  win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }), save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} });
  win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
}
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const today = () => { const d = new Date(), m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; };

test('the dock\'s NEAR ME opens its own screen with two tabs; the Den is not involved and has no Local tab', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(60);
  const near = p.$('#otp-near');
  assert.equal(near.hidden, false);
  assert.equal(p.$('#otp-den').hidden, true);
  assert.deepEqual(p.$$('#otp-near .tab').map((b) => b.textContent), ['AROUND YOU', 'ROAD TRIP']);
  assert.equal(p.$('#otp-nrAround').hidden, false); assert.equal(p.$('#otp-nrTrip').hidden, true);
  assert.ok(near.contains(p.$('#otp-nearGrid')), 'the store finder is inside Around you');
  assert.ok(near.contains(p.$('#otp-salesGrid')) && near.contains(p.$('#otp-fbHubBar')), 'and garage sales and the Facebook city');
  assert.equal(p.$('#otp-denT2'), null);
  assert.doesNotMatch(PAGE, /den-near/, 'the Den dress is gone');
  assert.deepEqual(p.$$('#otp-den .tab').map((b) => b.textContent), ['ALL HUNTS', 'LIKES', 'ABOUT', 'STATS', 'SETTINGS']);
  p.$('#otp-nrT2').click();
  assert.equal(p.$('#otp-nrTrip').hidden, false); assert.equal(p.$('#otp-nrAround').hidden, true);
  assert.equal(p.$$('#otp-nrDays .hubc').length, 7, 'seven day pills');
  assert.equal(p.$('#otp-nrDays .hubc.on').textContent, 'Today');
  assert.equal(p.$('#otp-nrFoot').hidden, true, 'no trip yet: no footer');
  p.$('#otp-nearClose').click();
  await tick(350);
  assert.equal(near.hidden, true);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Around you: the shops around the phone, with OPEN NOW / CLOSED worked out from the hours when the card is drawn', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(120);
  const c = calls.find((x) => /\/near\?/.test(x.url));
  assert.ok(c, 'asked the worker'); assert.match(c.url, /\/near\?lat=42\.4806&lng=-83\.4755&cats=antiques%2Cvintage%2Cthrift$/);
  const cards = p.$$('#otp-nrLive .nr-card');
  assert.equal(cards.length, 3);
  assert.equal(cards[0].querySelector('.nr-n').textContent, 'Always Open Antiques');
  assert.equal(cards[0].querySelector('.nr-t').textContent, 'Novi, MI · 120 dealers');
  assert.equal(cards[0].querySelector('.nr-st').textContent, 'OPEN NOW');
  assert.equal(cards[0].querySelector('.nr-h').textContent, 'Open 24 hours');
  assert.equal(cards[0].querySelector('img.nr-ph').getAttribute('src'), API + '/pp?n=places%2FA1%2Fphotos%2FP1', 'the photo through the worker');
  assert.equal(cards[0].href, PLACES[0].url, 'one tap opens Google Maps');
  assert.equal(cards[0].target, '_blank');
  assert.equal(cards[1].querySelector('.nr-st').textContent, 'CLOSED');
  assert.equal(cards[1].querySelector('.nr-h').textContent, 'Closed');
  assert.equal(cards[2].querySelector('.nr-st'), null, 'no hours, no claim');
  assert.equal(cards[2].querySelector('.nr-h').textContent, 'Hours not listed');
  assert.ok(cards[2].querySelector('.nr-ph.nr-nop'), 'a placeholder where there is no photo');
  assert.ok(p.$$('#otp-nearGrid a.nearc').length >= 8, 'the Maps links are still under the cards');
  assert.doesNotMatch(p.$('#otp-near').textContent, /v7\.\d|\b\d+ marketplaces/, 'no version, no marketplace count');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Around you without a fix or without the key: plain words, and the Maps links carry it', async () => {
  const denied = loadPage({ storage: DEN, fetchImpl: nearFetch([]), beforeLoad: (w) => phone(w, 'denied') });
  await tick(30);
  denied.$('#otp-localBtn').click();
  await tick(120);
  assert.match(denied.$('#otp-nrLive').textContent, /Location is off for this site/);
  assert.equal(denied.$('#otp-nrLive .nr-card'), null);
  assert.ok(denied.$$('#otp-nearGrid a.nearc').length >= 8);
  await denied.close();
  const off = loadPage({ storage: DEN, fetchImpl: nearFetch([], { near503: true }), beforeLoad: (w) => phone(w) });
  await tick(30);
  off.$('#otp-localBtn').click();
  await tick(120);
  assert.equal(off.$('#otp-nrLive').innerHTML, '', 'not set up yet: nothing said, the links below do the job');
  assert.ok(off.$$('#otp-nearGrid a.nearc').length >= 8);
  assert.deepEqual(off.errors, []);
  await off.close();
});

test('Road trip: one box, the stops in drive order with the town\'s others nested, the final stop, OPEN IN MAPS with the origin as a town', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(60);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  const c = calls.find((x) => /\/trip\?/.test(x.url));
  assert.ok(c, 'one submit, straight to the worker');
  assert.match(c.url, new RegExp('/trip\\?to=Blenko%20Glass%20Company%2C%20Milton%2C%20WV&lat=42\\.4806&lng=-83\\.4755&day=' + today() + '&cats=antiques%2Cvintage%2Cthrift$'));
  assert.equal(p.$('#otp-nrOut .nr-route').textContent, 'Novi, MI → Blenko Glass Company, Milton, WV');
  assert.match(p.$('#otp-nrOut .nr-head .nearp').textContent, /^398 mi · 6 h 30 min of driving · Trip day /);
  const anchors = p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-n').map((e) => e.textContent);
  assert.deepEqual(anchors, ['Maumee Antique Mall', 'Chillicothe Antique Emporium', 'Central City Antiques']);
  const nested = p.$$('#otp-nrOut .nr-stop:nth-child(3) .nr-nest .nr-sub .nr-n').map((e) => e.textContent);
  assert.deepEqual(nested, ['Olde Central City Vintage', '14th Street Collectibles']);
  assert.equal(p.$('#otp-nrOut .nr-stop:nth-child(3) .nr-nesth').textContent, 'Also in Huntington');
  assert.equal(p.$('#otp-nrOut .nr-dest .nr-n').textContent, 'Blenko Glass Company');
  const foot = p.$('#otp-nrFoot');
  assert.equal(foot.hidden, false);
  const maps = p.$('#otp-nrMaps');
  assert.equal(maps.textContent, 'OPEN IN MAPS'); assert.equal(maps.href, MAPS);
  const u = new URL(maps.href);
  assert.equal(u.searchParams.get('origin'), 'Novi, MI', 'a town, never a street');
  assert.equal(u.searchParams.get('waypoints').split('|').length, 3, 'anchors only');
  assert.equal(p.$('#otp-nrShare').textContent, 'SHARE');
  assert.doesNotMatch(p.$('#otp-near').textContent, /10 min|detour/i, 'the detour budget is internal');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip on a Monday: Chillicothe renders CLOSED and Blenko shows its Monday hours; an empty corridor is plain copy with the route', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(60);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  const monday = p.$$('#otp-nrDays .hubc').find((b) => new Date(b.getAttribute('data-nrday') + 'T12:00:00Z').getUTCDay() === 1);
  monday.click();
  await tick(120);
  assert.equal(p.$('#otp-nrDays .hubc.on').getAttribute('data-nrday'), monday.getAttribute('data-nrday'), 'the day pill sticks');
  const c = calls.filter((x) => /\/trip\?/.test(x.url)).pop();
  assert.match(c.url, new RegExp('&day=' + monday.getAttribute('data-nrday') + '&cats='), 'rebuilt for that day');
  assert.match(p.$('#otp-nrOut .nr-head .nearp').textContent, /Trip day Monday/);
  const emporium = p.$$('#otp-nrOut a.nr-anchor').find((a) => /Chillicothe/.test(a.textContent));
  assert.equal(emporium.querySelector('.nr-st').textContent, 'CLOSED');
  assert.match(emporium.querySelector('.nr-h').textContent, /^Closed/);
  const blenko = p.$('#otp-nrOut .nr-dest a.nr-anchor');
  assert.equal(blenko.querySelector('.nr-h').textContent, '9:00 AM – 3:30 PM', 'the Monday schedule');
  const maumee = p.$$('#otp-nrOut a.nr-anchor').find((a) => /Maumee/.test(a.textContent));
  assert.match(maumee.querySelector('.nr-st').textContent, /^OPEN/);
  p.$('#otp-nrTo').value = 'nowhere';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  assert.match(p.$('#otp-nrOut .nr-empty').textContent, /No shops of the kinds you picked are worth a stop inside this route/);
  assert.equal(p.$('#otp-nrOut .nr-stop'), null);
  assert.equal(p.$('#otp-nrFoot').hidden, false, 'the route is still offered');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('SHARE: signed out it asks for the store sign-in; signed in it keeps the trip for the group, the add-member row, Finds, and the trip you are on', async () => {
  const out = loadPage({ storage: DEN, fetchImpl: nearFetch([]), beforeLoad: (w) => phone(w) });
  await tick(30);
  out.$('#otp-localBtn').click(); await tick(60);
  out.$('#otp-nrT2').click();
  out.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  out.$('#otp-nrForm').dispatchEvent(new out.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  out.$('#otp-nrShare').click();
  await tick(400);
  assert.match(out.$('#otp-toast').textContent, /Sign in to Prowl to share a trip/);
  assert.equal(out.$('#otp-den').hidden, false, 'the sign-in lives in Den > Settings');
  await out.close();
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click();
  await tick(60);
  assert.ok(p.$('#otp-nrTrips .nr-tripb'), 'signed in: your trips are listed');
  assert.match(p.$('#otp-nrTrips .nr-tripb').textContent, /Novi, MI → Blenko Glass Company.*Mon Oct 26 · 2 members · yours/);
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  p.$('#otp-nrShare').click();
  await tick(150);
  const post = calls.find((x) => /\/trips$/.test(x.url) && x.o.method === 'POST');
  assert.ok(post, 'one tap keeps the trip');
  assert.deepEqual(JSON.parse(post.o.body), { to: 'Blenko Glass Company, Milton, WV', lat: 42.4806, lng: -83.4755, day: today(), cats: 'antiques,vintage,thrift' });
  assert.match(post.o.headers.Authorization, /^Bearer /);
  assert.equal(p.$('#otp-nrShareRow').hidden, false, 'the add-member row is open');
  assert.match(p.$('#otp-nrMembers').textContent, /1 on this trip/);
  assert.equal(p.$('#otp-nrOut .nr-stops .nr-stop').parentNode.children.length, 3, 'the same stops');
  assert.ok(p.$('#otp-nrFinds'), 'the Finds feed under the trip');
  assert.equal(p.$$('#otp-nrFindList .nr-find').length, 1);
  const f = p.$('#otp-nrFindList .nr-find');
  assert.equal(f.querySelector('img').getAttribute('src'), API + FINDS[0].photo, 'the signed photo link, through the worker');
  assert.equal(f.querySelector('b').textContent, 'Blenko 384 decanter, tangerine');
  assert.equal(f.querySelector('.nr-findp').textContent, 'Asking $45');
  assert.equal(f.querySelector('.nr-findv').textContent, 'FAIR · $40–$70');
  assert.equal(f.querySelector('.nr-findw a').textContent, 'Central City Antiques', 'tap through to its stop');
  assert.equal(f.querySelector('.nr-findw a').href, STOPS[2].url);
  assert.match(f.querySelector('.nr-findw').textContent, /· Hark$/);
  const kept = JSON.parse(p.win.localStorage.getItem('prowl.trip'));
  assert.equal(kept.id, 'tabcdefghi'); assert.equal(kept.stops.length, 5, 'anchors and nested, for the photo check\'s nearest stop');
  assert.deepEqual(Object.keys(kept.stops[0]).sort(), ['lat', 'lng', 'name', 'town', 'url']);
  p.$('#otp-nrEmail').value = 'friend@example.com';
  p.$('#otp-nrAdd').click();
  await tick(100);
  const share = calls.find((x) => /\/share$/.test(x.url));
  assert.deepEqual(JSON.parse(share.o.body), { email: 'friend@example.com' });
  assert.match(p.$('#otp-nrMembers').textContent, /2 on this trip/);
  assert.match(p.$('#otp-toast').textContent, /Added/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the photo check: SHARE THIS FIND while a trip is on, one tap to the trip\'s Finds; no button without a trip', async () => {
  const calls = [];
  const storage = Object.assign({}, DEN, { 'prowl.session': sess(), 'prowl.trip': { id: 'tabcdefghi', name: 'Blenko Glass Company', day: today(), stops: [{ name: 'Central City Antiques', town: 'Huntington, WV', lat: 42.4806, lng: -83.4755 }] } });
  const p = loadPage({ storage, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-aprP').value = '$45';
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'find.jpg', { type: 'image/jpeg' }));
  await tick(300);
  assert.ok(calls.find((x) => /\/appraise$/.test(x.url)), 'the photo check ran');
  const btn = p.$$('#otp-aprOut button').find((b) => b.textContent === 'SHARE THIS FIND');
  assert.ok(btn, 'the button is on the result');
  assert.equal(p.$('#otp-aprOut .apr-links').firstChild, btn, 'first in the row');
  btn.click();
  await tick(200);
  const post = calls.find((x) => /\/trips\/tabcdefghi\/finds$/.test(x.url) && x.o.method === 'POST');
  assert.ok(post, 'posted to the trip');
  const body = JSON.parse(post.o.body);
  assert.match(body.img, /^data:image\/jpeg;base64,/);
  assert.equal(body.item, 'Blenko 384 decanter'); assert.equal(body.price, '$45'); assert.equal(body.verdict, 'FAIR'); assert.equal(body.fair, '$40–$70');
  assert.equal(body.stop, 'Central City Antiques', 'the stop you are standing at'); assert.equal(body.town, 'Huntington, WV');
  assert.equal(btn.textContent, 'Shared with your group');
  assert.equal(btn.disabled, true);
  await p.close();
  const none = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: nearFetch([]), beforeLoad: (w) => phone(w) });
  await tick(30);
  none.win.prowlPhotoFile(new none.win.File([new Uint8Array([0xff, 0xd8, 0xff])], 'find.jpg', { type: 'image/jpeg' }));
  await tick(300);
  assert.ok(none.$$('#otp-aprOut button').length > 0, 'the result drew');
  assert.equal(none.$$('#otp-aprOut button').find((b) => b.textContent === 'SHARE THIS FIND'), undefined, 'no trip, no button');
  const old = loadPage({ storage: Object.assign({}, DEN, { 'prowl.trip': { id: 'tabcdefghi', day: '2026-01-05', stops: [] } }) });
  await tick(30);
  assert.equal(old.win.prowlTripActive(), null, 'a trip whose day has passed is over');
  await none.close(); await old.close();
});

test('v7.39: FROM HERE rebuilds from where the phone is now; on your kept trip the worker saves it; Refresh re-reads Around you', async () => {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(120);
  assert.equal(p.$$('#otp-nrLive .nr-card').length, 3);
  assert.ok(p.$('#otp-nrRefresh'), 'Around you has Refresh');
  p.$('#otp-nrRefresh').click();
  await tick(120);
  const nears = calls.filter((x) => /\/near\?/.test(x.url));
  assert.equal(nears.length, 2); assert.match(nears[1].url, /lat=38\.4192/, 'a fresh fix, not the cached one');
  p.$('#otp-nrT2').click(); await tick(60);
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  const here = p.$('#otp-nrHere');
  assert.equal(here.hidden, false); assert.equal(here.textContent, 'FROM HERE');
  here.click();
  await tick(200);
  const trips = calls.filter((x) => /\/trip\?/.test(x.url));
  assert.equal(trips.length, 2); assert.match(trips[1].url, /to=Blenko%20Glass%20Company%2C%20Milton%2C%20WV&lat=38\.4192&lng=-82\.4452/);
  assert.equal(p.$('#otp-nrOut .nr-route').textContent, 'Huntington, WV → Blenko Glass Company, Milton, WV');
  assert.deepEqual(p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-n').map((e) => e.textContent), ['Central City Antiques'], 'the stops behind are gone');
  /* a kept trip of your own: the worker rebuilds it for the whole group */
  p.$('#otp-nrShare').click();
  await tick(150);
  assert.ok(p.$('#otp-nrFinds'), 'kept');
  here.click();
  await tick(200);
  const rb = calls.find((x) => /\/rebuild$/.test(x.url));
  assert.ok(rb, 'the worker was asked'); assert.deepEqual(JSON.parse(rb.o.body), { lat: 38.4192, lng: -82.4452 });
  assert.equal(p.$('#otp-nrOut .nr-route').textContent, 'Huntington, WV → Blenko Glass Company, Milton, WV');
  assert.ok(p.$('#otp-nrFinds'), 'still the kept trip, with its Finds');
  assert.match(p.$('#otp-toast').textContent, /Rebuilt from Huntington, WV/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v7.39: a Prowl Alerts sign-in (email code) shares trips too, with its email and token on the call', async () => {
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'matt@example.com', 'prowl.alertPro': '1' }), fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(60);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(60);
  assert.ok(p.$('#otp-nrTrips .nr-tripb'), 'your trips are listed for an alerts member');
  const list = calls.find((x) => /\/trips$/.test(x.url));
  assert.equal(list.o.headers['X-Prowl-Email'], 'matt@example.com'); assert.equal(list.o.headers['X-Prowl-Tok'], 'tok-0123456789abcdef');
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  p.$('#otp-nrShare').click();
  await tick(150);
  const post = calls.find((x) => /\/trips$/.test(x.url) && x.o.method === 'POST');
  assert.ok(post, 'kept without a store sign-in');
  assert.equal(post.o.headers['X-Prowl-Email'], 'matt@example.com');
  assert.equal(p.$('#otp-den').hidden, true, 'not sent to the Den');
  assert.ok(p.$('#otp-nrShareRow'), 'the add-member row');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v7.39: the kinds to look for are chips on both tabs, and Skip takes a stop out of the list and the Maps link', async () => {
  const calls = [];
  const p1 = loadPage({ storage: DEN, fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p1.$('#otp-localBtn').click(); await tick(120);
  assert.deepEqual(p1.$$('#otp-nrCatsA .hubc').map((b) => b.textContent), ['Antiques', 'Vintage', 'Thrift', 'Records', 'Books', 'Toys', 'Flea markets']);
  assert.deepEqual(p1.$$('#otp-nrCatsA .hubc.on').map((b) => b.textContent), ['Antiques', 'Vintage', 'Thrift'], 'the spec\'s three by default');
  p1.$('#otp-nrCatsA [data-nrcat="records"]').click();
  await tick(120);
  assert.match(calls.filter((x) => /\/near\?/.test(x.url)).pop().url, /&cats=antiques%2Cvintage%2Cthrift%2Crecords$/, 'Around you looks again with records');
  assert.deepEqual(JSON.parse(p1.win.localStorage.getItem('prowl.nearCats')), ['antiques', 'vintage', 'thrift', 'records'], 'kept on this phone');
  p1.$('#otp-nrT2').click();
  assert.deepEqual(p1.$$('#otp-nrCats .hubc.on').map((b) => b.textContent), ['Antiques', 'Vintage', 'Thrift', 'Records'], 'the same chips on Road trip');
  await p1.close();
  /* a fresh page (the stub phone moves after a fresh fix): the chips are remembered, Thrift goes off, a trip is built */
  const p2 = loadPage({ storage: Object.assign({}, DEN, { 'prowl.nearCats': ['antiques', 'vintage', 'thrift', 'records'] }), fetchImpl: nearFetch(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p2.$('#otp-localBtn').click(); await tick(60);
  p2.$('#otp-nrT2').click();
  const p = p2;
  p.$('#otp-nrCats [data-nrcat="thrift"]').click();
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  assert.match(calls.filter((x) => /\/trip\?/.test(x.url)).pop().url, /&cats=antiques%2Cvintage%2Crecords$/);
  assert.equal(p.$$('#otp-nrOut .nr-stops > .nr-stop').length, 3);
  assert.equal(p.$$('#otp-nrOut .nr-skip').length, 5, 'Skip on every anchor and nested stop; the final stop has none');
  /* skip Chillicothe: gone from the list and from the Maps link */
  p.$('#otp-nrOut [data-nrskip="S2"]').click();
  await tick(30);
  assert.deepEqual(p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-n').map((e) => e.textContent), ['Maumee Antique Mall', 'Central City Antiques']);
  let wp = new URL(p.$('#otp-nrMaps').href).searchParams.get('waypoints').split('|');
  assert.deepEqual(wp, ['Maumee Antique Mall, Maumee, OH', 'Central City Antiques, Huntington, WV']);
  assert.match(p.$('#otp-nrOut .nr-skipped').textContent, /^1 skipped/);
  /* skip the Huntington anchor: the next shop in town steps up */
  p.$('#otp-nrOut [data-nrskip="S3"]').click();
  await tick(30);
  assert.deepEqual(p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor .nr-n').map((e) => e.textContent), ['Maumee Antique Mall', 'Olde Central City Vintage']);
  assert.deepEqual(p.$$('#otp-nrOut .nr-nest .nr-n').map((e) => e.textContent), ['14th Street Collectibles']);
  wp = new URL(p.$('#otp-nrMaps').href).searchParams.get('waypoints').split('|');
  assert.deepEqual(wp, ['Maumee Antique Mall, Maumee, OH', 'Olde Central City Vintage, Huntington, WV']);
  assert.deepEqual(Object.keys(JSON.parse(p.win.localStorage.getItem('prowl.nearSkip'))), ['S2', 'S3'], 'skips stay on this phone, by place');
  p.$('#otp-nrUnskip').click();
  await tick(30);
  assert.equal(p.$$('#otp-nrOut .nr-stops > .nr-stop').length, 3, 'all back');
  assert.equal(p.$('#otp-nrOut .nr-skipped'), null);
  assert.equal(p.$('#otp-nrMaps').href, MAPS, 'the full link again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v7.39: the road with the most to see is said; smaller shops sit apart and never in Maps; more than nine anchors become legs', async () => {
  const calls = [];
  const many = Array.from({ length: 11 }, (_, i) => card('L' + i, 'Stop ' + i, 'Town ' + i + ', OH', 'Antique mall', H_DAILY, { nested: [] }));
  const fx = nearFetch(calls);
  const p = loadPage({ storage: DEN, fetchImpl: (u, o) => (/to=eleven/.test(String(u)) ? J(Object.assign(trip('2026-10-26'), { stops: many, more: [] })) : fx(u, o)), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  assert.equal(p.$('#otp-nrOut .nr-alt').textContent, 'The road with the most to see, 42 min longer than the fastest drive.');
  const more = p.$('#otp-nrOut .nr-more');
  assert.ok(more, 'the smaller shops');
  assert.equal(more.querySelector('summary').textContent, 'Smaller shops along the way (2)');
  assert.deepEqual([...more.querySelectorAll('.nr-n')].map((e) => e.textContent), ['Gaffney\'s Treasures and Gifts', 'Ellie Mills Mercantile']);
  assert.equal(more.querySelector('.nr-skip'), null, 'nothing to skip there');
  assert.doesNotMatch(p.$('#otp-nrMaps').href, /Gaffney/, 'never in the Maps link');
  assert.equal(p.$$('#otp-nrLegs a').length, 1); assert.equal(p.$('#otp-nrMaps').textContent, 'OPEN IN MAPS');
  p.$('#otp-nrTo').value = 'eleven';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(120);
  const legs = p.$$('#otp-nrLegs a');
  assert.deepEqual(legs.map((a) => a.textContent), ['LEG 1', 'LEG 2']);
  const l1 = new URL(legs[0].href), l2 = new URL(legs[1].href);
  assert.equal(l1.searchParams.get('origin'), 'Novi, MI');
  assert.equal(l1.searchParams.get('waypoints').split('|').length, 9);
  assert.equal(l1.searchParams.get('destination'), 'Stop 9, Town 9, OH', 'leg 1 ends at a stop');
  assert.equal(l2.searchParams.get('origin'), 'Stop 9, Town 9, OH', 'leg 2 starts there');
  assert.deepEqual(l2.searchParams.get('waypoints').split('|'), ['Stop 10, Town 10, OH']);
  assert.equal(l2.searchParams.get('destination'), 'Blenko Glass Company, Milton, WV');
  assert.equal(legs[0].id, 'otp-nrMaps');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the page says v7.40, and keeps every old localStorage key (prowl.trip was v7.36\'s one new one; v7.40 adds prowl.filter)', () => {
  assert.match(PAGE, /var PROWL_VERSION='v7\.40'/);
  assert.match(PAGE, /var FLT_KEY='prowl\.filter'/);
  assert.match(PAGE, /var TRIP_KEY='prowl\.trip'/);
  assert.match(PAGE, /var CATS_KEY='prowl\.nearCats',SKIP_KEY='prowl\.nearSkip'/);
  for (const k of ['prowl.v36', 'owlTwigSearches', 'prowl.likes', 'prowl.maps', 'prowl.salesPlace', 'prowl.session']) assert.ok(PAGE.includes("'" + k + "'") || PAGE.includes(k), k);
  assert.doesNotMatch(PAGE, /\{\{|\{%/, 'no Liquid openers');
});
