// Page v7.64 Use my location (the owner, in a car on Android in an app's built-in browser, location off for the site:
// "Location is off ... Type a town" and he did not know what town he was in). A 📍 Use my location button by In a
// location and by From asks the phone from the tap (high accuracy, 10 s, a fix up to a minute old); worker v159
// /geo?lat&lng names the town from a point rounded to ~1 km; the box reads "Chillicothe, OH 45601" and the precise fix
// is the centre or the start (never looked up again as text). Blocked or missing, it says how to allow it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const CHIL = { lat: 39.33, lng: -82.98, town: 'Chillicothe, OH', city: 'Chillicothe', st: 'OH', zip: '45601', cl: 'chillicothe' };
const FIX = { latitude: 39.33312, longitude: -82.98234 };
function fixture(calls, geo) {
  return (u) => {
    const url = String(u); calls.push(url);
    if (/\/geo\?/.test(url)) return geo ? geo(url) : J(CHIL);
    if (/\/near\?/.test(url)) return J({ town: 'Somewhere, ZZ', places: [] });
    if (/\/trip\?/.test(url)) return J({ origin: { town: 'Chillicothe, OH' }, dest: { name: 'Columbus, OH', town: 'Columbus, OH' }, route: { mi: 45, min: 50 }, day: '', stops: [], more: [], maps: 'https://www.google.com/maps/dir/?api=1' });
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
// gps.mode: 'denied' | 'ok' | 'fail'; the first ask (opening NEAR ME) is always denied, like the owner's browser
function phone(win, gps) {
  Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok, err, opt) => {
    gps.asked++; gps.opts.push(opt || null);
    const m = gps.asked === 1 ? 'denied' : gps.mode;
    setTimeout(() => (m === 'ok' ? ok({ coords: FIX }) : err({ code: m === 'denied' ? 1 : 3 })), 0);
  } } });
}
const open = async (p) => { await tick(30); p.$('#otp-localBtn').click(); await tick(120); };
const newGps = (mode) => ({ asked: 0, opts: [], mode });

test('the buttons are there by Change and by From, and the help names how to allow location', async () => {
  const calls = [], gps = newGps('denied');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  assert.equal(p.$('#otp-nrAtMe').textContent, '📍 Use my location');
  assert.equal(p.$('#otp-nrFromMe').textContent, '📍 Use my location');
  assert.equal(p.$('#otp-nrAtMe').type, 'button');
  const t = p.$('#otp-nrLive').textContent;
  assert.match(t, /Location is blocked for this site in this browser/);
  assert.match(t, /tap ⋮, then Open in Chrome/);
  assert.match(t, /Permissions › Location › Allow/);
  assert.match(t, /Or tap Change above and type a town, City, ST or ZIP/);   // v7.71
  assert.ok(!/Location is off for this site/.test(t), 'the old dead end is gone');
  assert.ok(p.$('#otp-nrLive [data-nrme="at"]'), 'the banner offers Use my location too');
  assert.equal(p.$('#otp-nrLive #otp-nrRefresh'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Around you: a tap asks the phone from the gesture and lists the shops where it is, live (v7.71: no snapshot, no lookup)', async () => {
  const calls = [], gps = newGps('ok');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrWhereGo').click();
  assert.equal(p.$('#otp-nrWhereBox').hidden, false);
  p.$('#otp-nrAtMe').click(); await tick(150);
  assert.equal(gps.asked, 2, 'asked again, from the tap');
  assert.equal(calls.filter((u) => /\/geo\?/.test(u)).length, 0, 'where you are is not looked up as a town');
  assert.match(calls.filter((u) => /\/near\?/.test(u)).pop(), /lat=39\.3331&lng=-82\.9823/, 'Around you asks at the fix itself');
  assert.equal(p.win.localStorage.getItem('prowl.nearAt'), null, 'nothing kept: it follows the phone');
  assert.match(p.$('#otp-nrLive h3').textContent, /^Around you/);
  assert.match(p.$('#otp-nrWhere').textContent, /Shops near where you are \(Somewhere, ZZ\)/, 'the pill names the town the worker found');
  assert.equal(p.$('#otp-nrWhereBox').hidden, true, 'the box closes');
  assert.equal(p.$('#otp-nrAtMe').textContent, '📍 Use my location');
  assert.equal(p.$('#otp-nrAtMe').disabled, false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip: From fills with "Town, ST ZIP" and the trip starts at the precise fix, timed like the phone', async () => {
  const calls = [], gps = newGps('ok');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrT2').click(); await tick(30);
  p.$('#otp-nrFromMe').click(); await tick(150);
  assert.equal(p.$('#otp-nrFrom').value, 'Chillicothe, OH 45601');
  assert.equal(p.$('#otp-nrFromMsg').textContent, 'Using your location: Chillicothe, OH.');
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.nearAt')).on, false, 'From does not move Around you');
  p.$('#otp-nrTo').value = 'Columbus, OH';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(150);
  assert.equal(calls.filter((u) => /\/geo\?/.test(u)).length, 1, 'the From text is not geocoded');
  assert.match(calls.filter((u) => /\/trip\?/.test(u)).pop(), /lat=39\.3331&lng=-82\.9823/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip with location blocked: the help, and the Use my location button in it', async () => {
  const calls = [], gps = newGps('denied');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrT2').click(); await tick(30);
  p.$('#otp-nrTo').value = 'Columbus, OH';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await tick(60);
  const out = p.$('#otp-nrOut').textContent;
  assert.match(out, /Location is blocked for this site in this browser/);
  assert.match(out, /Or type a town, City, ST or ZIP in From above/);
  p.$('#otp-nrOut [data-nrme="from"]').click(); await tick(80);
  const msg = p.$('#otp-nrFromMsg');
  assert.equal(msg.hidden, false);
  assert.match(msg.textContent, /Location is blocked.*Open in Chrome/);
  assert.equal(calls.filter((u) => /\/geo\?/.test(u)).length, 0, 'nothing is guessed: no IP lookup, no geocode');
  assert.equal(p.$('#otp-nrFrom').value, '');
  await p.close();
});

test('no fix in time: says so, offers a retry; no geolocation at all: the same help, nothing hidden', async () => {
  const calls = [], gps = newGps('fail');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrAtMe').click(); await tick(80);
  assert.match(p.$('#otp-nrLive').textContent, /^Your location could not be read just now/);   // v7.71: said where the shops go
  assert.ok(p.$('#otp-nrLive #otp-nrRefresh'), 'with a Refresh');
  await p.close();
  const q = loadPage({ storage: DEN, fetchImpl: fixture([]), beforeLoad: (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: undefined }) });
  await open(q);
  assert.equal(q.$('#otp-nrAtMe').hidden, false);
  q.$('#otp-nrAtMe').click(); await tick(30);
  assert.match(q.$('#otp-nrLive').textContent, /Location is blocked for this site in this browser/);
  await q.close();
});

test('a town the worker cannot name still gives a start at the fix, as My location', async () => {
  const calls = [], gps = newGps('ok');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls, () => J({ error: 'not found' }, 404)), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  p.$('#otp-nrT2').click(); await tick(30);
  p.$('#otp-nrFromMe').click(); await tick(150);
  assert.equal(p.$('#otp-nrFrom').value, 'My location');
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.nearAt'));
  assert.equal(saved.lat, FIX.latitude); assert.equal(saved.town, 'My location');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the button sits on the From row and in the Change box; From is right above To; no trip, no bottom bar', async () => {
  const calls = [], gps = newGps('denied');
  const p = loadPage({ storage: DEN, fetchImpl: fixture(calls), beforeLoad: (w) => phone(w, gps) });
  await open(p);
  assert.equal(p.$('#otp-nrFromMe').parentElement, p.$('#otp-nrFrom').parentElement, 'on the From row itself');
  assert.ok(p.$('#otp-nrAtMe').closest('#otp-nrWhereBox'), 'v7.71: in the Change box, over the town box');
  assert.equal(p.$('#otp-nrAtMe').nextElementSibling, p.$('#otp-nrAtForm'));
  assert.equal(p.$('#otp-nrAtMe').type, 'button', 'never submits the typed text');
  const route = p.$('.nr-route');
  assert.ok(route.contains(p.$('#otp-nrFrom')) && route.contains(p.$('#otp-nrForm')), 'From and To share one block');
  assert.equal(p.$('#otp-nrTo').placeholder, 'To: town, City, ST or ZIP (optional)');
  p.$('#otp-nrT2').click(); await tick(30);
  assert.equal(p.$('#otp-nrFoot').hidden, true, 'nothing built: no OPEN IN MAPS / REBUILD FROM HERE / SHARE bar');
  assert.equal(p.$('#otp-nrHere').textContent, 'REBUILD');
  await p.close();
});

test('a built trip with stops shows the bar; a built trip with none does not', async () => {
  const stop = { id: 'S1', name: 'Chillicothe Antique Mall', town: 'Chillicothe, OH', why: '', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=s', lat: 39.4, lng: -82.9, hours: null };
  for (const [stops, shown] of [[[stop], true], [[], false]]) {
    const calls = [], gps = newGps('ok');
    const base = fixture(calls);
    const f = (u) => /\/trip\?/.test(String(u)) ? (calls.push(String(u)), J({ origin: { town: 'Chillicothe, OH' }, dest: { name: 'Columbus, OH', town: 'Columbus, OH', lat: 39.96, lng: -83 }, route: { mi: 45, min: 50 }, day: '', stops, more: [], empty: !stops.length, maps: 'https://www.google.com/maps/dir/?api=1' })) : base(u);
    const p = loadPage({ storage: DEN, fetchImpl: f, beforeLoad: (w) => phone(w, gps) });
    await open(p);
    p.$('#otp-nrT2').click(); await tick(30);
    p.$('#otp-nrFromMe').click(); await tick(150);
    p.$('#otp-nrTo').value = 'Columbus, OH';
    p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
    await tick(200);
    assert.ok(calls.some((u) => /\/trip\?/.test(u)), 'the trip was built');
    assert.equal(p.$('#otp-nrFoot').hidden, !shown, stops.length + ' stops');
    assert.deepEqual(p.errors, []);
    await p.close();
  }
});

test('the From row is written the way Shopify stores it, so the deploy md5 check matches', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<div class="addrow nr-fromrow">\n<input id="otp-nrFrom"'), 'Shopify puts the input on its own line');
  assert.ok(html.includes('📍 Use my location</button>\n</div>'), 'and the closing div');
});
