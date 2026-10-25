// Page v7.98 (Matt: "Trips used to be for groups we need a save trip button and a share inside trips area"). Saving a
// trip for the group and sharing it were under ⋯ More › Share. Now a built trip has ★ Save trip and ↗ Share at its
// top; a kept trip says it is saved, with Invite friends for its organizer and Share the route; and each of your own
// trips in the Trips list has Share (the invite link).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const card = (id, name, town) => ({ id, name, town, why: 'Antique mall', rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat: 40, lng: -83, hours: null, near: 1, nested: [] });
const DEST = card('D1', 'Blenko Glass Company', 'Milton, WV');
const TRIP = (d) => ({ origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 398, min: 390 }, day: d, stops: [card('S1', 'Maumee Antique Mall', 'Maumee, OH'), card('S2', 'Central City Antiques', 'Huntington, WV')], more: [], maps: 'https://www.google.com/maps/dir/?api=1&destination=Blenko', empty: false });
const VIEW = (d, org) => Object.assign(TRIP(d), { id: org ? 'tabcdefghi' : 'tzyxwvutsr', mine: !!org, org: !!org, members: 2, finds: 0 });
const LIST = [{ id: 'tabcdefghi', day: '2026-10-26', origin: 'Novi, MI', dest: DEST, members: 2, stops: 2, org: true }, { id: 'tzyxwvutsr', day: '2026-11-02', origin: 'Toledo, OH', dest: card('D2', 'Heart of Ohio Antiques', 'Springfield, OH'), members: 3, stops: 4, org: false }];
function fx(calls) {
  return (u, o) => {
    const url = String(u); calls.push({ url, o: o || {} });
    if (/\/trip\?/.test(url)) return J(TRIP('2026-10-26'));
    if (/\/trips$/.test(url) && o && o.method === 'POST') return J(VIEW(JSON.parse(o.body).day, true));
    if (/\/trips$/.test(url)) return J({ trips: LIST });
    if (/\/trips\/t[a-z]{9}\/invite$/.test(url)) return J({ code: 'INVITECODE123' });
    if (/\/trips\/t[a-z]{9}\/finds$/.test(url)) return J({ finds: [] });
    if (/\/trips\/tzyxwvutsr$/.test(url)) return J(VIEW('2026-11-02', false));
    if (/\/trips\/tabcdefghi$/.test(url)) return J(VIEW('2026-10-26', true));
    return J({ items: [] });
  };
}
function phone(win, shared) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.4806, longitude: -83.4755 } }), 0) } });
  Object.defineProperty(win.navigator, 'share', { configurable: true, value: (d) => { shared.push(d); return Promise.resolve(); } });
}
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
async function roadTrip(signedIn) {
  const calls = [], shared = [];
  const p = loadPage({ storage: Object.assign({}, DEN, signedIn ? { 'prowl.session': sess() } : {}), fetchImpl: fx(calls), beforeLoad: (w) => phone(w, shared) });
  await tick(30); p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(60);
  return { p, calls, shared };
}
async function build(p) {
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(150);
}
const acts = (p) => [...p.$$('#otp-nrOut .nr-tacts button')].map((b) => b.textContent);

test('a built trip has Save trip and Share at its top; Share sends the route; Save trip keeps it for the group', async () => {
  const { p, calls, shared } = await roadTrip(true);
  await build(p);
  const top = p.$('#otp-nrOut .nr-head .nr-tacts');
  assert.ok(top, 'right under the route line');
  assert.deepEqual(acts(p), ['★ Save trip', '↗ Share']);
  top.querySelector('[data-nrsendr]').click(); await tick(20);
  assert.equal(shared.length, 1);
  assert.match(shared[0].text, /^Road trip: Novi, MI to Blenko Glass Company, Milton, WV/);
  assert.match(shared[0].text, /1\. Maumee Antique Mall, Maumee, OH/);
  top.querySelector('[data-nrkeepb]').click(); await tick(200);
  const post = calls.find((x) => /\/trips$/.test(x.url) && x.o.method === 'POST');
  assert.ok(post, 'one tap saves it');
  assert.equal(JSON.parse(post.o.body).to, 'Blenko Glass Company, Milton, WV');
  assert.match(p.$('#otp-toast').innerHTML, /Trip saved for your group\. Tap <b>Invite friends<\/b> to send it to them\./);
  assert.equal(p.$('#otp-nrOut .nr-saved').textContent, '✓ Saved in Trips');
  assert.deepEqual(acts(p), ['Invite friends', '↗ Share the route'], 'the organizer invites from the top');
  p.$('#otp-nrOut [data-nrinv]').click(); await tick(60);
  assert.ok(calls.some((x) => /\/trips\/tabcdefghi\/invite$/.test(x.url)));
  assert.match(shared[1].text, /^Join my road trip to Blenko Glass Company, Milton, WV on .* in Prowl: .*\?trip=INVITECODE123$/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('signed out, Save trip asks for the sign-in first', async () => {
  const { p } = await roadTrip(false);
  await build(p);
  p.$('#otp-nrOut [data-nrkeepb]').click(); await tick(300);
  assert.match(p.$('#otp-toast').textContent, /Sign in to Prowl to share a trip/);
  await p.close();
});

test('Trips: your own trip has Share (the invite link); a friend\'s trip has none in the list, and opened it shares the route', async () => {
  const { p, calls, shared } = await roadTrip(true);
  const rows = p.$$('#otp-nrTrips .nr-triprow');
  assert.equal(rows.length, 2);
  const mine = rows[0].querySelector('.nr-tripsh'), theirs = rows[1].querySelector('.nr-tripsh');
  assert.equal(mine.textContent, 'Share');
  assert.equal(mine.getAttribute('aria-label'), 'Share the trip to Blenko Glass Company');
  assert.equal(theirs, null, 'only the organizer invites');
  mine.click(); await tick(60);
  assert.ok(calls.some((x) => /\/trips\/tabcdefghi\/invite$/.test(x.url)));
  assert.match(shared[0].text, /^Join my road trip to Blenko Glass Company, Milton, WV on .*\?trip=INVITECODE123$/);
  rows[1].querySelector('[data-nrtrip]').click(); await tick(150);
  assert.equal(p.$('#otp-nrOut .nr-saved').textContent, '✓ Saved in Trips');
  assert.deepEqual(acts(p), ['↗ Share the route'], 'a member shares the route, not an invite');
  assert.equal(p.$('#otp-nrOut [data-nrinv]'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the Trips words point to the new buttons', async () => {
  const { p } = await roadTrip(true);
  assert.match(p.$('#otp-nrTripsPane > .nearp').innerHTML, /build it under Road trip, tap <b>Save trip<\/b>, then <b>Invite friends<\/b>\./);
  await p.close();
});
