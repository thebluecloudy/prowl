// Page v8.22 Plan my weekend (worker v193 /order and /weekend/plan): the Sweep's sales as a day-by-day route. "Plan my
// weekend" under the Sweep results (and the Thursday email's button, ?wkplan=<ids>&wkp=<picks>&wkzip=ZIP&wkx&wks) opens
// the planner in NEAR ME > Estate sales, beside Trips: Top picks checked, the rest one tap; each checked sale on a day it is open (Saturday, then Sunday, then
// Friday), at most 5 a day, 45 min at each, never reached before it opens or within 30 min of closing; what does not fit
// is named; address-pending sales stay off the route; Road Trip's /order orders each day; one Google and one Apple Maps
// link a day; Rebuild from here starts a day again from the phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const OWNER = 'owner-key-0123456789';
const NOVI = { lat: 42.4806, lng: -83.4755, label: 'Novi, MI' };
/* a fixed weekend for the pure split: Fri Nov 20 - Sun Nov 22 2026, judged from Thursday Nov 19, 8 AM (local time) */
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const THU = at(19, 8);
const J = (x) => JSON.parse(JSON.stringify(x));   /* out of the page's realm, for deepEqual */
const day = (d, h1, h2) => ({ s: at(d, h1), e: at(d, h2) });
let n = 0;
const S = (o = {}) => ({ id: String(5100000 + ++n), name: 'Sale ' + n, url: 'https://www.estatesales.net/MI/Novi/48375/' + (5100000 + n), city: 'Novi', st: 'MI',
  addr: n + ' Main St', lat: 42.48 + n * 0.002, lng: -83.47, dist: 2, days: [day(21, 9, 16), day(22, 10, 15)], ...o });

function page(extra = {}) { return loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'], h21: 1, h36: 1, h42: 1, h68: 1 } }, ...extra }); }

test('the split: Top picks first, Saturday before Sunday before Friday, 45 minutes at each stop, every stop open when reached', async () => {
  const p = page(); await tick(30);
  const split = p.win.prowlWpSplit;
  const a = S({ pick: true }), b = S(), fri = S({ days: [day(20, 9, 15)] }), same = S({ lat: a.lat, lng: a.lng });
  const r = J(split([b, a, fri, same], NOVI, THU, {}));
  assert.deepEqual(r.days.map((d) => new Date(at(+d.key.slice(8), 12)).getDay()), [5, 6], 'a Friday-only sale gets Friday; the rest go to Saturday');
  const sat = r.days[1];
  assert.equal(sat.items.length, 3);
  for (const st of sat.sched.stops) { const w = sat.items.find((x) => x.s.id === st.id).w; assert.ok(st.at >= w.o, 'never before it opens'); assert.ok(st.at <= w.c - 30 * 60000, 'never within 30 min of closing'); assert.equal(st.late, false); }
  assert.equal(sat.sched.stops[0].at, at(21, 9), 'you leave so the first sale is reached as it opens');
  assert.deepEqual(r.dropped, []);
  /* two sales at one spot: the second is reached exactly WP_STAY (45 min) after the first */
  const two = J(split([S({ lat: 42.5, lng: -83.4 }), S({ lat: 42.5, lng: -83.4 })], NOVI, THU, {})).days[0].sched.stops;
  assert.equal(two[1].at - two[0].at, 45 * 60000);
  await p.close();
});

test('the split respects hours: a morning sale goes before an afternoon one, the wait is shown, and one that closes too soon is dropped with why', async () => {
  const p = page(); await tick(30);
  const am = S({ days: [day(21, 9, 12)] }), pm = S({ days: [day(21, 13, 16)] }), short = S({ days: [{ s: at(21, 9), e: at(21, 9, 25) }] });
  const r = J(p.win.prowlWpSplit([pm, am, short], NOVI, THU, {}));
  assert.equal(r.days.length, 1);
  assert.deepEqual(r.days[0].sched.stops.map((x) => x.id), [am.id, pm.id]);
  const last = r.days[0].sched.stops[1];
  assert.equal(last.at, at(21, 13), 'reached at 1 PM, not before');
  assert.ok(last.wait > 60 * 60000, 'the wait for the afternoon sale is known');
  assert.equal(r.dropped.length, 1);
  assert.equal(r.dropped[0].s.id, short.id);
  assert.match(r.dropped[0].why, /No time left|hours do not fit/);
  /* Saturday 2 PM: the morning sale is over; only the afternoon one is left, reached from now */
  const later = J(p.win.prowlWpSplit([am, pm], NOVI, at(21, 14), {}));
  assert.deepEqual(later.days[0].items.map((x) => x.s.id), [pm.id]);
  assert.ok(later.days[0].sched.stops[0].at >= at(21, 14), 'never in the past');
  assert.match(later.dropped[0].why, /No time left/);
  await p.close();
});

test('the split caps a day at 5 stops: a sale open Sunday too moves there, a Saturday-only one is dropped and named', async () => {
  const p = page(); await tick(30);
  const satOnly = Array.from({ length: 6 }, () => S({ days: [day(21, 8, 18)] }));
  const both = S({ days: [day(21, 8, 18), day(22, 8, 18)] });
  const r = J(p.win.prowlWpSplit(satOnly.concat([both]), NOVI, THU, {}));
  const sat = r.days.find((d) => d.key === '2026-11-21'), sun = r.days.find((d) => d.key === '2026-11-22');
  assert.equal(sat.items.length, 5, 'WP_CAP: 5 a day');
  assert.ok(sun && sun.items.length >= 1, 'the overflow goes to Sunday');
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].why, /already has 5 stops/);
  assert.equal(r.dropped[0].full, 1);
  await p.close();
});

test('a sale without a street address yet is address pending: never on the route', async () => {
  const p = page(); await tick(30);
  const ok = S(), pend = S({ addr: '' });
  const r = J(p.win.prowlWpSplit([ok, pend], NOVI, THU, {}));
  assert.deepEqual(r.pending.map((x) => x.id), [pend.id]);
  assert.ok(!r.days.some((d) => d.items.some((x) => x.s.id === pend.id)));
  await p.close();
});

/* ---- the screen ---- */
/* the coming Saturday at h:00 local time, always in the future */
function satH(h) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(h); return d.getTime(); }
const row = (id, name, o = {}) => ({ id, name, url: 'https://www.estatesales.net/MI/Novi/48375/' + id, city: 'Novi', st: 'MI', co: 'Co', dist: 3, hours: 'Sat, 9 AM–4 PM', standout: '',
  match: null, img: '', addr: id.slice(-3) + ' Grand River Ave', lat: 42.48 + Number(id.slice(-1)) * 0.01, lng: -83.47, days: [{ s: satH(9), e: satH(16) }], ...o });
const SWEEP = { r: 25, at: 1, total: 4,
  picks: [row('5200001', 'Pyrex house', { match: { hunt: 'pyrex', where: 'the description' } })],
  rest: [row('5200002', 'Tool barn'), row('5200003', 'Hidden address', { addr: '', addrAt: satH(-20) }), row('5200004', 'Garage finds')] };

function rig(o = {}) {
  const calls = [];
  const fetchImpl = (u, opt) => {
    const s = String(u); calls.push({ u: s, o: opt });
    const ok = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
    if (/\/geo\?q=/.test(s)) return ok({ q: 'x', lat: 42.4806, lng: -83.4755, town: 'Novi, MI', city: 'Novi', st: 'MI', zip: '48375' });
    if (/\/weekend\?/.test(s)) return ok(SWEEP);
    if (/\/weekend\/plan\?/.test(s)) return o.plan ? o.plan(s) : ok({ start: { lat: 42.47, lng: -83.47, town: 'Novi, MI', zip: '48375' }, sales: [SWEEP.picks[0], SWEEP.rest[0], SWEEP.rest[1]].map((x, i) => ({ ...x, match: null, pick: i === 0 })), missing: ['5299999'] });
    if (/\/order\?/.test(s)) { const pts = new URL(s).searchParams.get('p').split('|'), order = pts.map((_, i) => i); if (o.rev && !/keep=1/.test(s)) order.splice(1, order.length - 1, ...order.slice(1).reverse()); return ok({ order, legs: pts.map(() => ({ min: 10, mi: 6 })), src: 'osrm' }); }
    return ok({ items: [] });
  };
  return { calls, p: loadPage({ fetchImpl, url: o.url, beforeLoad: o.beforeLoad, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'], h21: 1, h36: 1, h42: 1, h68: 1 }, ...(o.storage || {}) } }) };
}
async function sweep(p) {
  await tick(50);
  p.$('#otp-dock .db[data-m="local"]').click();
  await tick(50);
  p.$('#otp-nrT4').click();
  await tick(30);
  p.$('#otp-wkIn').value = 'Novi, MI';
  p.$('#otp-wkGo').click();
  await waitFor(() => p.$('#otp-wkPlan'));
}

test('Plan my weekend under the Sweep: Top picks checked, the rest one tap; each day ordered by /order with Google and Apple Maps links', async () => {
  const { p, calls } = rig({ storage: { 'prowl.owner': OWNER } });
  await sweep(p);
  assert.match(p.$('#otp-wkPlan').textContent, /Plan my weekend/);
  p.$('#otp-wkPlan').click();
  await waitFor(() => p.$('#otp-wp .wp-day'));
  assert.ok(p.$('#otp-nrWkPane #otp-wpHost #otp-wp'), 'the planner opens in NEAR ME > Estate sales');
  assert.equal(p.$('#otp-nrT4').getAttribute('aria-selected'), 'true');
  assert.match(p.$('#otp-wpHost .nearh').textContent, /Plan my weekend/);
  assert.equal(p.$('#otp-wkHost').hidden, true, 'in place of the Sweep');
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false, 'not a sheet any more');
  assert.match(p.$('#otp-wp .wp-from').textContent, /From Novi, MI/, 'the place the sweep used');
  const box = (id) => p.$('#otp-wp input[data-wpid="' + id + '"]');
  assert.equal(box('5200001').checked, true, 'a Top pick starts checked');
  assert.equal(box('5200002').checked, false, 'the others are one tap');
  assert.equal(box('5200003'), null, 'an address-pending sale has no box');
  assert.match(p.$('#otp-wp').textContent, /Address pending\s*1[\s\S]*Hidden address[\s\S]*address pending/);
  assert.equal(p.$$('#otp-wp .wp-stop').length, 1);
  await waitFor(() => calls.some((c) => /\/order\?keep=1&loop=1&p=/.test(c.u)), { timeout: 3000 });   /* one stop: only its leg times */
  box('5200002').checked = true;
  box('5200002').dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await waitFor(() => p.$$('#otp-wp .wp-stop').length === 2);
  await waitFor(() => calls.some((c) => /\/order\?loop=1&p=/.test(c.u)));
  const ord = calls.filter((c) => /\/order\?loop=1&p=/.test(c.u)).pop();
  assert.equal(new URL(ord.u).searchParams.get('p').split('|').length, 3, 'the start and the two stops');
  await tick(50);
  const day = p.$('#otp-wp .wp-day');
  assert.match(day.querySelector('.wk-h').textContent, /Saturday[\s\S]*2 stops/);
  assert.match(day.textContent, /Get there ~9 AM · open 9 AM–4 PM/);
  const links = [...day.querySelectorAll('.wp-go a')];
  assert.equal(links.length, 2, 'one Google Maps and one Apple Maps link');
  assert.match(links[0].href, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
  assert.match(decodeURIComponent(links[0].href), /001 Grand River Ave, Novi, MI/);
  assert.match(decodeURIComponent(links[0].href), /origin=Novi, MI/);
  assert.match(links[1].href, /^https:\/\/maps\.apple\.com\/directions\?/);
  assert.match(decodeURIComponent(links[1].href), /002 Grand River Ave/);
  assert.ok(day.querySelector('[data-wp="here"]'), 'Rebuild from here');
  p.$('#otp-wkBack').click();
  await tick(20);
  assert.equal(p.$('#otp-wpHost').hidden, true, 'back to the Sweep');
  assert.equal(p.$$('#otp-wk .wk-row').length, 4, 'with its results still there');
  assert.ok(p.$('#otp-wkPlan'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Rebuild from here starts the day again from the phone: /order is asked from the new point', async () => {
  const phone = (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.33, longitude: -83.05 } }), 0) } });
  const { p, calls } = rig({ storage: { 'prowl.owner': OWNER }, beforeLoad: phone });
  await sweep(p);
  p.$('#otp-wkPlan').click();
  await waitFor(() => p.$('#otp-wp [data-wp="here"]'));
  p.$('#otp-wp [data-wp="here"]').click();
  await waitFor(() => calls.some((c) => /\/order\?/.test(c.u) && /^42\.330,-83\.050\|/.test(new URL(c.u).searchParams.get('p'))));
  await tick(50);
  const g = p.$('#otp-wp .wp-go a').href;
  assert.ok(!/origin=/.test(g), 'from where the phone is, Maps starts at the phone');
  assert.match(p.$('#otp-wp .wp-sum').textContent, /done ~/);
  await p.close();
});

test('the Thursday email link opens the planner with no app or sign-in: the sale ids, picks, ZIP and signature go to /weekend/plan', async () => {
  const url = 'https://www.owlandtwigvintage.com/pages/prowl-app?wkplan=5200001,5200002,5200004,5299999&wkp=5200001&wkzip=48375&wkx=1900000000&wks=abc123';
  const { p, calls } = rig({ url });
  await waitFor(() => p.$('#otp-wp .wp-day'), { timeout: 5000 });
  const c = calls.find((x) => /\/weekend\/plan\?/.test(x.u));
  const q = new URL(c.u).searchParams;
  assert.equal(q.get('ids'), '5200001,5200002,5200004,5299999');
  assert.equal(q.get('p'), '5200001'); assert.equal(q.get('zip'), '48375'); assert.equal(q.get('x'), '1900000000'); assert.equal(q.get('s'), 'abc123');
  assert.ok(q.has('tz'));
  assert.equal(c.o.headers['X-Prowl-Owner'], undefined, 'no owner key needed');
  assert.equal(p.win.location.search, '', 'the plan link leaves the address bar');
  assert.equal(p.$('#otp-near').hidden, false, 'NEAR ME opens');
  assert.equal(p.$('#otp-nrT4').hidden, false, 'its Estate sales tab shows for the link, with no owner key');
  assert.equal(p.$('#otp-nrT4').getAttribute('aria-selected'), 'true');
  assert.ok(p.$('#otp-nrWkPane #otp-wp'), 'the planner is in NEAR ME > Estate sales');
  assert.equal(p.$('#otp-wkBack'), null, 'no way back to a Sweep it cannot use');
  assert.match(p.$('#otp-wp .wp-from').textContent, /From 48375 \(Novi\)/, 'the ZIP the sweep used');
  assert.equal(p.$('#otp-wp input[data-wpid="5200001"]').checked, true);
  assert.match(p.$('#otp-wp').textContent, /1 sale from the email has ended/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no start from the link and no saved ZIP: just one ZIP box; a ZIP plans the route', async () => {
  const url = 'https://www.owlandtwigvintage.com/pages/prowl-app?wkplan=5200001,5200002&wkp=5200001&wkzip=48375&wkx=1900000000&wks=abc';
  const { p, calls } = rig({ url, plan: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ start: null, sales: [{ ...SWEEP.picks[0], pick: true }, SWEEP.rest[0]], missing: [] }) }) });
  await waitFor(() => p.$('#otp-wpZip'), { timeout: 5000 });
  assert.equal(p.$$('#otp-wp input').length, 1, 'only the ZIP box');
  assert.equal(p.$('#otp-wp .wp-day'), null);
  p.$('#otp-wpZip').value = '48375';
  p.$('#otp-wp [data-wp="zip"]').click();
  await waitFor(() => p.$('#otp-wp .wp-day'));
  assert.ok(calls.some((x) => /\/geo\?q=48375/.test(x.u)));
  await p.close();
});

test('a link that ran out says so', async () => {
  const url = 'https://www.owlandtwigvintage.com/pages/prowl-app?wkplan=5200001&wkzip=48375&wkx=1&wks=abc';
  const { p } = rig({ url, plan: () => Promise.resolve({ ok: false, status: 410, json: () => Promise.resolve({ error: 'this link has run out' }) }) });
  await waitFor(() => p.$('#otp-wp .es-err'), { timeout: 5000 });
  assert.match(p.$('#otp-wp').textContent, /run out/);
  await p.close();
});

test('an optimizer order that would reach a sale after it closes is not used: the hours-safe order stays, with real leg times', async () => {
  const am = row('5300001', 'Morning sale', { match: { hunt: 'pyrex', where: 'the title' }, days: [{ s: satH(9), e: satH(11) }] });
  const pm = row('5300002', 'Afternoon sale', { match: { hunt: 'pyrex', where: 'the title' }, days: [{ s: satH(13), e: satH(16) }] });
  const { p, calls } = rig({ storage: { 'prowl.owner': OWNER }, rev: true });
  SWEEP._keep = [SWEEP.picks, SWEEP.rest];
  SWEEP.picks = [am, pm]; SWEEP.rest = [];
  try {
    await sweep(p);
    p.$('#otp-wkPlan').click();
    await waitFor(() => calls.some((c) => /\/order\?keep=1&loop=1&p=/.test(c.u)) && p.$('#otp-wp .wp-kept'));
    assert.ok(calls.some((c) => /\/order\?loop=1&p=/.test(c.u)), 'Optimize route was asked first');
    const names = p.$$('#otp-wp .wp-stop b').map((b) => b.textContent);
    assert.deepEqual(names, ['Morning sale', 'Afternoon sale']);
    assert.equal(p.$('#otp-wp .nr-ended'), null, 'nothing reached after it closes');
    assert.match(p.$('#otp-wp .wp-kept').textContent, /every sale is open when you get there/);
  } finally { SWEEP.picks = SWEEP._keep[0]; SWEEP.rest = SWEEP._keep[1]; delete SWEEP._keep; }
  await p.close();
});
