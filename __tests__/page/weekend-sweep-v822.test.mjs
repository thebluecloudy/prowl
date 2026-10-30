// Page v8.22 Weekend sweep (worker v193 /weekend): under Den > Local's "Estate sales near you" (the owner's key until
// SALES_PUBLIC), "Sweep this weekend" looks up the place typed above, sends its point (2 decimals), this device's time
// zone and the Den's own hunts, and lists Top picks (with the hunt and where it matched) above the rest, each opening the
// sale's own page on EstateSales.net. Den > Settings gets a Thursday estate sales switch when the worker says it can go.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const OWNER = 'owner-key-0123456789';
const row = (id, name, extra = {}) => ({ id, name, url: 'https://www.estatesales.net/MI/Royal-Oak/48067/' + id, city: 'Royal Oak', st: 'MI', co: 'Totally Vicki LLC', dist: 18.3,
  hours: 'Fri Oct 30, 10 AM–5 PM · Sat Oct 31, 10 AM–3 PM', standout: 'Lots of decorations, typewriter, sewing machine', match: null, ...extra });
const WEEKEND = { r: 25, at: 1, picks: [row('5136894', 'Royal Oak Vintage and Collectible', { match: { hunt: 'typewriter', where: 'the description' } })],
  rest: [row('5132916', 'Rudy estate sales', { city: 'Dearborn', co: '', standout: '166 photos posted' }), row('5000001', 'No link of its own', { url: 'https://evil.example/x' })], total: 3 };

function open(storage, calls, answer = WEEKEND) {
  const fetchImpl = (u, o) => {
    const s = String(u);
    if (/\/geo\?q=/.test(s)) { calls.push({ u: s, o }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ q: 'Novi, MI', lat: 42.4806, lng: -83.4755, town: 'Novi, MI', city: 'Novi', st: 'MI', zip: '48375' }) }); }
    if (/\/weekend\?/.test(s)) { calls.push({ u: s, o }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['typewriter', 'pyrex bowl'], h21: 1, h36: 1, h42: 1, h68: 1 }, ...storage } });
}

test('without the owner key there is no weekend sweep (the estate box stays hidden)', async () => {
  const calls = [], p = open({}, calls);
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  assert.equal(p.$('#otp-wk'), null);
  assert.equal(calls.length, 0);
  await p.close();
});

test('the owner sweeps the weekend: the typed place, the hunts and the time zone go; picks first, links only to EstateSales.net', async () => {
  const calls = [], p = open({ 'prowl.owner': OWNER }, calls);
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  const box = p.$('#otp-wk');
  assert.ok(box, 'the weekend box sits in Estate sales near you');
  assert.match(box.textContent, /This weekend\s*Fri–Sun · 25 mi/);
  assert.equal(p.$('#otp-wkGo').textContent, 'Sweep this weekend');
  p.$('#otp-esIn').value = 'Novi, MI';
  p.$('#otp-wkGo').click();
  await waitFor(() => p.$$('#otp-wk .wk-row').length === 2);
  const wk = calls.find((c) => /\/weekend\?/.test(c.u));
  const q = new URL(wk.u).searchParams;
  assert.equal(q.get('lat'), '42.48'); assert.equal(q.get('lng'), '-83.48', 'the point is rounded before it leaves');
  assert.equal(q.get('r'), '25');
  assert.equal(q.get('h'), 'typewriter|pyrex bowl', 'the Den hunts go along');
  assert.equal(q.get('city'), 'Novi'); assert.equal(q.get('st'), 'MI');
  assert.ok(q.has('tz'));
  assert.equal(wk.o.headers['X-Prowl-Owner'], OWNER);
  const rows = p.$$('#otp-wk .wk-row');
  assert.equal(rows[0].classList.contains('wk-pick'), true);
  assert.match(rows[0].querySelector('.wk-m').textContent, /typewriter · in the description/);
  assert.equal(rows[0].getAttribute('href'), 'https://www.estatesales.net/MI/Royal-Oak/48067/5136894');
  assert.equal(rows[0].target, '_blank');
  assert.match(rows[0].textContent, /Royal Oak, MI · Totally Vicki LLC · 18\.3 mi/);
  assert.match(rows[0].querySelector('.wk-hr').textContent, /Fri Oct 30, 10 AM–5 PM/);
  assert.match(rows[0].querySelector('.wk-so').textContent, /typewriter/);
  assert.match(p.$('#otp-wk').textContent, /Top picks\s*1[\s\S]*Also this weekend\s*1/);
  assert.equal(p.$$('#otp-wk a').filter((a) => !/^https:\/\/www\.estatesales\.net\//.test(a.getAttribute('href'))).length, 0, 'a sale without its own link is never shown');
  assert.match(p.$('#otp-wk').textContent, /Novi, MI/);
  assert.equal(p.$('#otp-wkGo').textContent, 'Sweep again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('nothing that mentions a hunt: the rest are listed under "This weekend nearby" with a note', async () => {
  const calls = [], p = open({ 'prowl.owner': OWNER }, calls, { ...WEEKEND, picks: [], rest: [WEEKEND.rest[0]] });
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  p.$('#otp-esIn').value = 'Novi, MI';
  p.$('#otp-wkGo').click();
  await waitFor(() => p.$$('#otp-wk .wk-row').length === 1);
  assert.match(p.$('#otp-wk').textContent, /None of this weekend’s sales mention your hunts yet[\s\S]*This weekend nearby/);
  await p.close();
});

const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'member@example.com',
  'prowl.v36': { seen: true, hunts: ['rookwood owl'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } };
function openMail(statusExtra) {
  const live = liveFetch({ perSource: 2 }), sent = [];
  const fetchImpl = (u, o) => {
    const s = String(u), body = o && o.body ? JSON.parse(o.body) : null;
    if (/\/alerts\/status$/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on: true, hunts: ['rookwood owl'], prefs: { zip: '48375' }, mail: 'on', free: 5, pro: true, ...statusExtra }) });
    if (/\/alerts\/prefs$/.test(s)) { sent.push({ u: s, body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, prefs: body.prefs }) }); }
    if (/\/alerts\/letter$/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ letter: null }) });
    return live.impl(u, o);
  };
  return { p: loadPage({ fetchImpl, storage: SIGNED }), sent };
}

test('Den > Settings: the Thursday estate sales switch shows when the worker allows it and saves estate off', async () => {
  const { p, sent } = openMail({ estate: true });
  await tick(1600);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(60);
  const set = await waitFor(() => p.$('#otp-estSet'), { timeout: 8000 });
  assert.match(set.textContent, /Thursday estate sales[\s\S]*within 25 miles of 48375/);
  set.querySelector('[data-mail="estate"][data-v="off"]').click();
  await waitFor(() => sent.some((x) => x.body.prefs.estate === 'off'), { timeout: 3000 });
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Den > Settings: no Thursday estate sales switch while the worker says it cannot go', async () => {
  const { p } = openMail({});
  await tick(1600);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(60);
  await waitFor(() => p.$('#otp-letterSet'), { timeout: 8000 });
  assert.equal(p.$('#otp-estSet'), null);
  await p.close();
});
