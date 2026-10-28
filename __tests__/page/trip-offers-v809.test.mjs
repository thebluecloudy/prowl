// Page v8.09 / worker v183 (the security and trust plan, 2026-10-28): a share by email never puts anyone on a trip.
// The trip waits under NEAR ME > Trips, "Invited to", above Your trips, until they Join (then it opens, as an invite
// link's Join does) or Decline. The organizer's toast is the same for every address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const card = (id, name, extra) => Object.assign({ id, name, town: 'Findlay, OH', why: 'Antiques', rating: 4.6, n: 12, about: '', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41.04, lng: -83.65, hours: null, near: 0.4 }, extra || {});
const DEST = card('D1', 'Blenko Glass Company', { town: 'Milton, WV' }), DEST2 = card('D2', 'Hocking Hills <b>Mall</b>', { town: 'Logan, OH' });
const OFFERS = [{ id: 'tofferaaaa', day: '2026-10-26', origin: 'Novi, MI', dest: DEST, members: 2, stops: 3, org: false }, { id: 'tofferbbbb', day: '2026-10-27', origin: 'Toledo, OH', dest: DEST2, members: 1, stops: 4, org: false }];
const MINE = [{ id: 'tabcdefghi', day: '2026-10-26', origin: 'Novi, MI', dest: card('D3', 'Maumee Antique Mall'), members: 1, stops: 2, org: true }];
const VIEW = (id) => ({ id, mine: true, org: false, members: 3, day: '2026-10-26', weekday: 1, origin: 'Novi, MI', dest: DEST, route: { mi: 398, min: 390 }, stops: [Object.assign(card('A1', "Jeffrey's Antique Gallery"), { nested: [] })], more: [], maps: 'https://www.google.com/maps/dir/?api=1', closes: '2026-10-28T00:00:00.000Z', finds: 0 });
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
function fx(calls, opt) {
  opt = opt || {};
  return (u, o) => {
    const url = String(u); calls.push({ url, o: o || {} });
    if (/\/near\?/.test(url)) return J({ town: 'Findlay, OH', places: [] });
    if (/\/trips\/t[a-z0-9]{9}\/accept$/.test(url)) return opt.ended ? J({ error: 'This trip has ended.' }, 404) : J(Object.assign({}, OFFERS[0], { members: 3, member: true }));
    if (/\/trips\/t[a-z0-9]{9}\/decline$/.test(url)) return J({ ok: true, declined: /trips\/(t[a-z0-9]{9})/.exec(url)[1] });
    if (/\/trips\/t[a-z0-9]{9}\/finds$/.test(url)) return J({ finds: [] });
    if (/\/trips\/t[a-z0-9]{9}$/.test(url)) return J(VIEW(/trips\/(t[a-z0-9]{9})/.exec(url)[1]));
    if (/\/trips$/.test(url)) return J({ trips: opt.none ? [] : MINE, offers: opt.old ? undefined : OFFERS });
    return J({ items: [] });
  };
}
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const phone = (win) => { Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.04, longitude: -83.65 } }), 0) } }); };
async function tripsTab(calls, opt) {
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl: fx(calls, opt), beforeLoad: (w) => phone(w) });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT3').click(); await tick(40);
  return p;
}

test('Invited to sits above Your trips, each offer with Join and Decline; the names are escaped', async () => {
  const p = await tripsTab([]);
  const heads = p.$$('#otp-nrTrips h3').map((h) => h.textContent);
  assert.deepEqual(heads, ['Invited to', 'Your trips']);
  const rows = p.$$('#otp-nrTrips .nr-offer');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector('.tt').textContent, 'Novi, MI → Blenko Glass Company');
  assert.equal(rows[0].querySelector('.nr-tripm').textContent, 'Mon Oct 26 · 2 members');
  assert.equal(rows[1].querySelector('.nr-tripm').textContent, 'Tue Oct 27 · 1 member');
  assert.equal(rows[1].querySelector('.tt b'), null, 'a trip name is text, never markup');
  assert.deepEqual([...rows[0].querySelectorAll('button')].map((b) => b.textContent), ['Join', 'Decline']);
  assert.equal(rows[0].querySelector('[data-nroffer]').getAttribute('data-nroffer'), 'tofferaaaa');
  assert.equal(rows[0].querySelector('[data-nrtrip]'), null, 'an offer does not open like a trip of yours');
  assert.equal(p.$$('#otp-nrTrips [data-nrtrip]').length, 1, 'your own trip is still listed');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Decline posts, drops the row and says so; Join posts, then opens the trip on Road trip', async () => {
  const calls = [];
  const p = await tripsTab(calls);
  p.$('#otp-nrTrips [data-nrdecline="tofferbbbb"]').click(); await tick(40);
  const no = calls.find((x) => /\/decline$/.test(x.url));
  assert.ok(no.url.endsWith('/trips/tofferbbbb/decline')); assert.equal(no.o.method, 'POST');
  assert.equal(p.$$('#otp-nrTrips .nr-offer').length, 1);
  assert.equal(p.$('#otp-nrTrips [data-nrdecline="tofferbbbb"]'), null);
  assert.equal(p.$('#otp-toast').textContent, 'Invitation declined.');
  p.$('#otp-nrTrips [data-nroffer="tofferaaaa"]').click(); await tick(120);
  const yes = calls.find((x) => /\/accept$/.test(x.url));
  assert.ok(yes.url.endsWith('/trips/tofferaaaa/accept')); assert.equal(yes.o.method, 'POST');
  assert.ok(calls.findIndex((x) => /\/trips\/tofferaaaa$/.test(x.url)) > calls.indexOf(yes), 'then the trip is fetched');
  assert.equal(p.$('#otp-nrT2').getAttribute('aria-selected'), 'true', 'the trip opens on Road trip');
  assert.match(p.$('#otp-nrOut .nr-route').textContent, /Blenko Glass Company/);
  assert.match(p.$('#otp-toast').textContent, /You are on the trip/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an ended offer: the worker says so and the row goes; no trips but an offer still shows it; an old worker without offers is fine', async () => {
  const calls = [];
  const p = await tripsTab(calls, { ended: true, none: true });
  assert.match(p.$('#otp-nrTrips').textContent, /Invited to/);
  assert.match(p.$('#otp-nrTrips .nr-empty').textContent, /No group trips yet/);
  p.$('#otp-nrTrips [data-nroffer="tofferaaaa"]').click(); await tick(60);
  assert.match(p.$('#otp-toast').textContent, /This trip has ended\. \(404\)/);
  assert.equal(p.$('#otp-nrTrips [data-nroffer="tofferaaaa"]'), null, 'gone from the list');
  assert.equal(p.$('#otp-nrT3').getAttribute('aria-selected'), 'true', 'still on Trips');
  await p.close();
  const q = await tripsTab([], { old: true });
  assert.equal(q.$$('#otp-nrTrips .nr-offer').length, 0);
  assert.deepEqual(q.$$('#otp-nrTrips h3').map((h) => h.textContent), ['Your trips']);
  assert.deepEqual(q.errors, []);
  await q.close();
});

test('the organizer\'s note and toast no longer say anyone joins by being added', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.ok(!/joins the moment they sign in|They will join the moment/.test(page));
  assert.ok(page.includes("toast('Invite sent. If they use Prowl, they see it under NEAR ME › Trips and can join.',4200);"));
  assert.ok(!/r\.j\.added\?/.test(page) && !/NR\.view\.members=r\.j\.members/.test(page), 'the share answer no longer drives the page');
});
