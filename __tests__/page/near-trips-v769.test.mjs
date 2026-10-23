// Page v7.69 / worker v161 (the owner: "are you able to pull the description, reviews, review stars for each area? I
// want to see that quickly before I decide to even go. And ... sharing a trip to my friends and then them looking it
// up, it's complicated ... a third tab at the top with shared trips"). Cards show stars, the review count and the
// line about the place; Reviews opens three of them; TRIPS lists the group trips; an invite link joins in one tap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const CODE = 'tabcdefghi.0123456789abcdef01234567';
const card = (id, name, extra) => Object.assign({ id, name, town: 'Findlay, OH', why: 'Antiques', rating: 4.6, n: 1201, about: 'Sprawling mall with hundreds of booths.', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41.04, lng: -83.65, hours: null, near: 0.4 }, extra || {});
const PL = [card('A1', "Jeffrey's Antique Gallery"), card('B2', 'Quiet Thrift', { rating: 0, n: 0, about: '' })];
const DEST = card('D1', 'Blenko Glass Company', { town: 'Milton, WV' });
const VIEW = { id: 'tabcdefghi', mine: true, org: true, members: 2, day: '2026-10-26', weekday: 1, origin: 'Novi, MI', dest: DEST, route: { mi: 398, min: 390 }, stops: [Object.assign({}, PL[0], { nested: [] })], more: [], maps: 'https://www.google.com/maps/dir/?api=1', closes: '2026-10-28T00:00:00.000Z', finds: 0 };
const REV = { id: 'A1', rating: 4.6, n: 1201, about: 'Sprawling mall with hundreds of booths.', url: 'https://maps.google.com/?cid=1', reviews: [{ stars: 5, text: 'Three floors of booths. Bring water.', author: 'Pat', when: 'a month ago' }, { stars: 4, text: 'Good glass.', author: 'Lee', when: '2 weeks ago' }, { stars: 3, text: 'Busy on Saturdays.', author: 'Sam', when: 'a week ago' }] };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
function fx(calls, opt) {
  opt = opt || {};
  return (u, o) => {
    const url = String(u); calls.push({ url, o: o || {} });
    if (/\/near\?/.test(url)) return J({ town: 'Findlay, OH', places: PL });
    if (/\/reviews\?id=A1$/.test(url)) return J(REV);
    if (/\/trips\/tabcdefghi\/peek\?c=/.test(url)) return J({ id: 'tabcdefghi', day: '2026-10-26', origin: 'Novi, MI', dest: DEST, members: 1, stops: 3, org: false, member: false });
    if (/\/trips\/tabcdefghi\/join$/.test(url)) return J({ id: 'tabcdefghi', members: 2, member: true });
    if (/\/trips\/tabcdefghi\/invite$/.test(url)) return J({ code: CODE, dest: DEST, day: '2026-10-26' });
    if (/\/trips\/tabcdefghi\/finds$/.test(url)) return J({ finds: [] });
    if (/\/trips\/tabcdefghi$/.test(url)) return J(Object.assign({}, VIEW, opt.friend ? { org: false } : {}));
    if (/\/trips$/.test(url)) return J({ trips: opt.none ? [] : [{ id: 'tabcdefghi', day: '2026-10-26', origin: 'Novi, MI', dest: DEST, members: 2, stops: 1, org: true }] });
    return J({ items: [] });
  };
}
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const phone = (win, shared) => { Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.04, longitude: -83.65 } }), 0) } }); if (shared) Object.defineProperty(win.navigator, 'share', { configurable: true, value: (d) => { shared.push(d); return Promise.resolve(); } }); };

test('a card shows its stars, review count and the line about it; Reviews opens three under it, once fetched', async () => {
  const calls = [];
  const p = loadPage({ storage: DEN, fetchImpl: fx(calls), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(120);
  const c = p.$$('#otp-nrLive .nr-card');
  assert.equal(c[0].querySelector('.nr-r').textContent, '★★★★★ 4.6 · 1,201 reviews');
  assert.equal(c[0].querySelector('.nr-r').getAttribute('aria-label'), 'Rated 4.6 out of 5 from 1,201 reviews');
  assert.equal(c[0].querySelector('.nr-about').textContent, 'Sprawling mall with hundreds of booths.');
  assert.equal(c[1].querySelector('.nr-r'), null, 'no rating, no stars');
  assert.equal(c[1].querySelector('.nr-about'), null);
  const b = p.$('#otp-nrLive [data-nrrv="A1"]');
  assert.equal(b.textContent, 'Reviews');
  b.click(); await tick(30);
  const box = p.$('#otp-nrLive .nr-rvbox');
  assert.ok(box, 'under the card');
  assert.equal(box.previousElementSibling.querySelector('.nr-n').textContent, "Jeffrey's Antique Gallery");
  assert.equal(box.querySelectorAll('.nr-rv').length, 3);
  assert.equal(box.querySelector('.nr-rvw').textContent, '★★★★★ Pat · a month ago');
  assert.equal(box.querySelector('.nr-rvt').textContent, 'Three floors of booths. Bring water.');
  assert.equal(box.querySelector('a.b').href, 'https://maps.google.com/?cid=1');
  assert.equal(b.textContent, 'Hide reviews'); assert.equal(b.getAttribute('aria-expanded'), 'true');
  b.click();
  assert.equal(p.$('#otp-nrLive .nr-rvbox'), null);
  b.click(); await tick(10);
  assert.equal(calls.filter((x) => /\/reviews\?/.test(x.url)).length, 1, 'read once');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('TRIPS: a third tab; signed out it says sign in; signed in it lists the trips and opens one on Road trip', async () => {
  const out = loadPage({ storage: DEN, fetchImpl: fx([]), beforeLoad: (w) => phone(w) });
  await tick(30);
  out.$('#otp-localBtn').click(); await tick(60);
  out.$('#otp-nrT3').click(); await tick(20);
  assert.equal(out.$('#otp-nrTripsPane').hidden, false); assert.equal(out.$('#otp-nrTrip').hidden, true); assert.equal(out.$('#otp-nrAround').hidden, true);
  assert.match(out.$('#otp-nrTrips').textContent, /Sign in to Prowl to see your group trips/);
  assert.ok(out.$('#otp-nrTripsIn'), 'with a Sign in button');
  await out.close();
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: fx([]), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT3').click(); await tick(40);
  assert.equal(p.$('#otp-nrT3').getAttribute('aria-selected'), 'true');
  assert.equal(p.$('#otp-nrFoot').hidden, true);
  p.$('#otp-nrTrips [data-nrtrip="tabcdefghi"]').click(); await tick(60);
  assert.equal(p.$('#otp-nrT2').getAttribute('aria-selected'), 'true', 'the trip opens on Road trip');
  assert.equal(p.$('#otp-nrTrip').hidden, false);
  assert.match(p.$('#otp-nrOut .nr-route').textContent, /Blenko Glass Company/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the organizer sends an invite link; a friend lands on it, sees the trip on TRIPS, joins in one tap', async () => {
  const shared = [], calls = [];
  const o = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: fx(calls), beforeLoad: (w) => phone(w, shared) });
  await tick(30);
  o.$('#otp-localBtn').click(); await tick(60);
  o.$('#otp-nrT3').click(); await tick(40);
  o.$('#otp-nrTrips [data-nrtrip="tabcdefghi"]').click(); await tick(60);
  o.$('#otp-nrShare').click();
  assert.deepEqual(o.$$('#otp-nrSendBox button').map((b) => b.textContent), ['Send the route', 'Invite link', 'Add by email']);
  o.$('#otp-nrInvite').click(); await tick(30);
  assert.equal(shared.length, 1);
  assert.equal(shared[0].text, 'Join my road trip to Blenko Glass Company, Milton, WV on Mon Oct 26 in Prowl: https://www.owlandtwigvintage.com/pages/prowl?trip=' + CODE);
  await o.close();
  const fcalls = [];
  const f = loadPage({ url: 'https://www.owlandtwigvintage.com/pages/prowl?trip=' + CODE, storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: fx(fcalls, { friend: true }), beforeLoad: (w) => phone(w) });
  await tick(500);
  assert.equal(f.win.location.search, '', 'the address is tidied');
  assert.equal(f.$('#otp-near').hidden, false, 'NEAR ME opens by itself');
  assert.equal(f.$('#otp-nrT3').getAttribute('aria-selected'), 'true', 'on TRIPS');
  assert.ok(fcalls.find((x) => x.url.endsWith('/trips/tabcdefghi/peek?c=' + encodeURIComponent(CODE))));
  const jc = f.$('#otp-nrJoin .nr-joincard');
  assert.match(jc.textContent, /You are invited/); assert.match(jc.textContent, /Novi, MI → Blenko Glass Company, Milton, WV/); assert.match(jc.textContent, /Mon Oct 26 · 3 stops · 1 member/);
  f.$('#otp-nrJoinGo').click(); await tick(80);
  const join = fcalls.find((x) => /\/join$/.test(x.url));
  assert.deepEqual(JSON.parse(join.o.body), { c: CODE });
  assert.equal(f.win.localStorage.getItem('prowl.tripInvite'), null, 'used up');
  assert.equal(f.$('#otp-nrT2').getAttribute('aria-selected'), 'true', 'the trip itself opens');
  assert.match(f.$('#otp-nrOut .nr-route').textContent, /Blenko Glass Company/);
  assert.deepEqual(f.errors, []);
  await f.close();
  const s = loadPage({ url: 'https://www.owlandtwigvintage.com/pages/prowl?q=x&trip=' + CODE, storage: DEN, fetchImpl: fx([]), beforeLoad: (w) => phone(w) });
  await tick(500);
  assert.equal(s.win.location.search, '?q=x', 'other parameters stay');
  assert.match(s.$('#otp-nrJoin').textContent, /Sign in to Prowl to join it/);
  assert.ok(s.$('#otp-nrJoinIn'));
  assert.equal(s.win.localStorage.getItem('prowl.tripInvite'), CODE, 'kept through the sign-in');
  await s.close();
});

test('places as you type a destination; a tap fills To and builds the trip there; From only fills', async () => {
  const calls = [];
  const SUG = { places: [{ id: 'ChIJblenko', main: 'Blenko Glass Company', sub: 'Milton, WV' }, { id: 'ChIJmilton', main: 'Milton', sub: 'WV' }] };
  const base = fx(calls);
  const p = loadPage({ storage: DEN, fetchImpl: (u, o) => (/\/suggest\?/.test(String(u)) ? (calls.push({ url: String(u), o: o || {} }), J(SUG)) : /\/trip\?/.test(String(u)) ? (calls.push({ url: String(u), o: o || {} }), new Promise(() => {})) : base(u, o)), beforeLoad: (w) => { phone(w); w.prowlSugMs = 5; } });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click();
  const to = p.$('#otp-nrTo');
  assert.equal(to.getAttribute('role'), 'combobox'); assert.equal(to.getAttribute('aria-controls'), 'otp-nrSug');
  to.value = 'Bl'; to.dispatchEvent(new p.win.Event('input')); await tick(30);
  assert.equal(calls.filter((x) => /\/suggest\?/.test(x.url)).length, 0, 'two letters: nothing asked');
  to.value = 'Blenko gl'; to.dispatchEvent(new p.win.Event('input')); await tick(40);
  const ask = calls.find((x) => /\/suggest\?/.test(x.url));
  assert.match(ask.url, /\/suggest\?q=Blenko%20gl&lat=41\.04&lng=-83\.65$/, 'near where you are');
  const box = p.$('#otp-nrSug');
  assert.equal(box.hidden, false); assert.equal(to.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...box.querySelectorAll('.nr-sgb')].map((b) => b.textContent), ['Blenko Glass CompanyMilton, WV', 'MiltonWV']);
  box.querySelector('.nr-sgb').click(); await tick(20);
  assert.equal(to.value, 'Blenko Glass Company, Milton, WV');
  assert.equal(box.hidden, true);
  assert.ok(calls.find((x) => /\/trip\?.*to=Blenko%20Glass%20Company%2C%20Milton%2C%20WV/.test(x.url)), 'the trip is built there');
  const from = p.$('#otp-nrFrom'), fb = p.$('#otp-nrSugF');
  let changed = 0; from.addEventListener('change', () => changed++);
  from.value = 'Mil'; from.dispatchEvent(new p.win.Event('input')); await tick(40);
  assert.equal(fb.hidden, false);
  fb.querySelectorAll('.nr-sgb')[1].click(); await tick(10);
  assert.equal(from.value, 'Milton, WV'); assert.equal(changed, 1);
  to.value = 'Blenko via Portsmouth, OH'; to.dispatchEvent(new p.win.Event('input')); await tick(30);
  assert.equal(box.hidden, true, 'a "via" trip is typed by hand');
  assert.deepEqual(p.errors, []);
  await p.close();
});
