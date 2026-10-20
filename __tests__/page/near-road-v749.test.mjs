// Page v7.49 (Matt, 2026-10-20: "1-4" of the NEAR ME suggestions): built for the car. Around you shows how far each
// shop is and can list the closest first; on today's road trip each stop is open or closed for when you would get
// there, not now; every Around-you row and every trip stop has a bold Directions; hours read "Open until 6 PM",
// "Opens 10 AM", "Closed today · opens Fri 10 AM".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
function fn(name) {
  const i = PAGE.indexOf('function ' + name + '(');
  assert.ok(i > -1, name);
  const eol = PAGE.indexOf('\n', i), line = PAGE.slice(i, eol);
  return /\}\s*(\/\*.*\*\/)?\s*$/.test(line) && !/\{\s*$/.test(line) ? line : PAGE.slice(i, PAGE.indexOf('\n}\n', i) + 2);
}
const H = new Function(['nrTime', 'nrHm', 'nrNext', 'nrNextText'].map(fn).join('\n') + "\nvar NR_D3=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return { nrNext, nrNextText };")();
/* a Wednesday, 9:00 at the place (UTC offset 0 keeps the arithmetic plain) */
const WED9 = Date.UTC(2026, 9, 21, 9, 0);
const per = (d, h1, h2) => ({ open: { day: d, hour: h1, minute: 0 }, close: { day: d, hour: h2, minute: 0 } });
const hrs = (periods) => ({ offset: 0, periods, days: [] });

test('hours you can read at a glance', () => {
  const T = (h, when) => H.nrNextText(H.nrNext(h, when || WED9));
  assert.equal(T(hrs([per(3, 8, 18)])), 'Open until 6 PM');
  assert.equal(T(hrs([per(3, 10, 17)])), 'Opens 10 AM');
  assert.equal(T(hrs([per(4, 11, 16)])), 'Opens tomorrow 11 AM');
  assert.equal(T(hrs([per(5, 10, 17)])), 'Closed today · opens Fri 10 AM');
  assert.equal(T(hrs([{ open: { day: 0, hour: 0, minute: 0 }, close: null }])), 'Open 24 hours');
  assert.equal(T(hrs([per(3, 8, 18)]), WED9 + 10 * 3600000), 'Closed today · opens Wed 8 AM', 'after closing: next week');
  assert.equal(H.nrNext(null, WED9), null, 'no hours, no claim');
  /* an evening that runs past midnight is open until then */
  assert.equal(T(hrs([{ open: { day: 2, hour: 18, minute: 0 }, close: { day: 3, hour: 2, minute: 0 } }]), Date.UTC(2026, 9, 20, 23, 30)), 'Open until 2 AM');
});

const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const ALWAYS = { offset: 0, periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], days: [] };
function soonShut() {
  /* open from an hour ago until 30 minutes from now, at the place (UTC) */
  const a = new Date(Date.now() - 3600000), b = new Date(Date.now() + 1800000);
  return { offset: 0, periods: [{ open: { day: a.getUTCDay(), hour: a.getUTCHours(), minute: a.getUTCMinutes() }, close: { day: b.getUTCDay(), hour: b.getUTCHours(), minute: b.getUTCMinutes() } }], days: [] };
}
const place = (id, name, lat, lng, hours) => ({ id, name, town: 'Novi, MI', why: 'Antiques', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat, lng, hours: hours || ALWAYS });
/* the worker's order is biggest first: Big Mall 1.4 mi, Far Barn 6.8 mi, Corner Shop next door */
const AROUND = [place('A', 'Big Mall', 42.5, -83.47), place('B', 'Far Barn', 42.4, -83.4), place('C', 'Corner Shop', 42.4808, -83.4757)];
function setup(trip) {
  const calls = [];
  const fetchImpl = (u) => {
    const url = String(u); calls.push(url);
    if (/\/near\?/.test(url)) return J({ places: AROUND, town: 'Novi, MI' });
    if (/\/trip\?/.test(url)) return J(trip());
    return J({ items: [] });
  };
  const p = loadPage({ storage: DEN, fetchImpl, beforeLoad: (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.4806, longitude: -83.4755 } }), 0) } }) });
  return { p, calls };
}

test('Around you: miles on every card, Biggest first or Closest first, remembered, and the pins follow the order', async () => {
  const { p } = setup(() => ({}));
  await tick(30);
  p.$('#otp-localBtn').click();
  await tick(150);
  const names = () => p.$$('#otp-nrLive .nr-card .nr-n').map((e) => e.textContent);
  const miles = () => p.$$('#otp-nrLive .nr-card .nr-mi').map((e) => e.textContent);
  assert.deepEqual(names(), ['Big Mall', 'Far Barn', 'Corner Shop'], 'biggest first, the worker\'s order');
  assert.deepEqual(miles(), ['1.4 mi', '6.8 mi', '< 0.1 mi'], 'next door is not "0 mi"');
  assert.match(p.$('#otp-nrLive .nearp').textContent, /biggest first/);
  assert.equal(p.$('#otp-nrLive [data-nrsort=""]').getAttribute('aria-pressed'), 'true');
  p.$('#otp-nrLive [data-nrsort="near"]').click();
  await tick(20);
  assert.deepEqual(names(), ['Corner Shop', 'Big Mall', 'Far Barn'], 'closest first');
  assert.deepEqual(p.$$('#otp-nrLive .nr-list .nr-num').map((e) => e.textContent), ['1', '2', '3'], 'numbered as shown');
  assert.match(p.$('#otp-nrLive .nearp').textContent, /closest first/);
  assert.equal(p.win.localStorage.getItem('prowl.nearSort'), 'near', 'remembered (new key)');
  assert.deepEqual(p.$$('#otp-nrLive .nr-row a.nr-go').map((a) => a.textContent), ['Directions', 'Directions', 'Directions']);
  assert.match(PAGE, /if\(mode==='around'\)\{var A=NR\.aroundShown\|\|NR\.around\|\|\[\];/, 'the map numbers its pins in the order shown');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a road trip today: each stop is open or closed for when you would get there; every stop has Directions over Skip', async () => {
  const today = () => { const d = new Date(), m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; };
  /* 300 miles in 300 minutes: a mile a minute. Toledo is about 50 miles off as the crow flies, so about an hour */
  const trip = () => ({ origin: { town: 'Novi, MI' }, route: { mi: 300, min: 300 }, day: today(), weekday: new Date().getDay(), maps: 'https://www.google.com/maps/dir/?api=1',
    dest: place('D', 'Blenko Glass Company', 38.43, -82.2),
    stops: [Object.assign(place('S1', 'Open All Day Mall', 41.65, -83.54), { nested: [place('S2', 'Shuts Soon Vintage', 41.66, -83.55, soonShut())] })] });
  const { p } = setup(trip);
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);
  assert.match(p.$('#otp-nrOut .nr-etan').textContent, /for when you would get there/);
  const card = (name) => p.$$('#otp-nrOut a.nr-card').find((a) => a.querySelector('.nr-n').textContent === name);
  const open = card('Open All Day Mall'), shut = card('Shuts Soon Vintage');
  assert.equal(open.querySelector('.nr-st').textContent, 'OPEN');
  assert.match(open.querySelector('.nr-h').textContent, /^Get there ~\d{1,2}(:\d{2})? (AM|PM) · open 24 hours$/);
  assert.equal(shut.querySelector('.nr-st').textContent, 'CLOSED', 'open now, but shut before you get there');
  assert.match(shut.querySelector('.nr-h').textContent, /^Get there ~.+ · closed by then$/);
  assert.equal(p.$$('#otp-nrOut .nr-stops .nr-acts').length, 2, 'the anchor and its nested shop');
  for (const a of p.$$('#otp-nrOut .nr-stops .nr-acts')) {
    assert.equal(a.children[0].textContent, 'Directions'); assert.match(a.children[0].href, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&travelmode=driving&destination=/);
    assert.doesNotMatch(a.children[0].href, /origin=/, 'Maps starts from the phone');
    assert.equal(a.children[1].textContent, 'Skip');
  }
  assert.ok(p.$('#otp-nrOut .nr-dest a.nr-go'), 'the final stop has Directions too');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a trip on another day keeps that day\'s hours (no arrival time)', async () => {
  const later = () => { const d = new Date(Date.now() + 2 * 86400000), m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; };
  const trip = () => ({ origin: { town: 'Novi, MI' }, route: { mi: 300, min: 300 }, day: later(), maps: 'https://www.google.com/maps/dir/?api=1', dest: place('D', 'Blenko', 38.43, -82.2), stops: [Object.assign(place('S1', 'Open All Day Mall', 41.65, -83.54), { nested: [] })] });
  const { p } = setup(trip);
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);
  assert.equal(p.$('#otp-nrOut .nr-etan'), null);
  assert.doesNotMatch(p.$('#otp-nrOut .nr-stops').textContent, /Get there/);
  await p.close();
});
