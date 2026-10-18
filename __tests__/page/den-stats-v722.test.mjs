// Page v7.22 (Matt, 2026-10-18: "I'd like this and any other analytics and graphs in the menu area"): every analytic
// lives on Den › STATS. Everyone sees their own hunting and Your marketplaces; the owner (prowl.owner key) also sees
// worker /owner-stats: people searching per day, searches, top terms and where visitors came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const OWNER = 'abcdefghijklmnop';
const day = (i) => new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
const STATS = { days: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), people: i, searches: i * 3, terms: i })),
  top: [{ term: 'pyrex <b>butterprint</b>', people: 9 }], refs: { list: [{ host: 'instagram.com', views: 40 }, { host: '', views: 12 }] } };

function open(p) { p.$('#otp-denBtn').click(); p.$('#otp-denT6').click(); }

test('Stats tab holds the graphs; Settings no longer does', async () => {
  const now = Date.now();
  const p = loadPage({ storage: { 'prowl.runs': [{ m: 'prowl', t: ['mccoy'], s: 'ALL', at: now }, { m: 'prowl', t: ['pyrex'], s: 'ALL', at: now }],
    'prowl.finds': [{ title: 'Vase', url: 'https://x.test/1', at: now }] } });
  await tick(300);
  open(p);
  assert.equal(p.$('#otp-denStatsP').hidden, false);
  assert.equal(p.$('#otp-denSettings').hidden, true);
  assert.ok(!p.$('#otp-denSettings').querySelector('#otp-denStats'), 'Your marketplaces moved out of Settings');
  const mine = p.$('#otp-denMine').textContent;
  assert.match(mine, /Searches, last 14 days\s*2/);
  assert.match(mine, /Finds saved, last 8 weeks\s*1/);
  assert.equal(p.$('#otp-denMine').querySelectorAll('.dx-col').length, 22);
  assert.equal(p.$('#otp-denOwn').hidden, true, 'no owner key: no usage panel');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('owner sees usage, top terms (escaped) and referrers', async () => {
  const calls = [];
  const p = loadPage({ storage: { 'prowl.owner': OWNER }, fetchImpl: (u, o) => {
    if (String(u).indexOf('owner-stats') > -1) { calls.push(o && o.headers); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(STATS) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  } });
  await tick(300);
  open(p);
  await tick(50);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]['X-Prowl-Owner'], OWNER);
  const own = p.$('#otp-denOwn');
  assert.equal(own.hidden, false);
  assert.match(own.textContent, /People searching, 14 days/);
  assert.match(own.textContent, /instagram\.com\s*40/);
  assert.match(own.textContent, /Direct or app\s*12/);
  assert.ok(!own.querySelector('b b'), 'term HTML is escaped');
  assert.match(own.textContent, /pyrex <b>butterprint<\/b>/);
  assert.match(own.querySelector('.dx-kpi').textContent, /^(\d+)people-days/);
  await p.close();
});

test('owner panel says when referrers are not connected or the key is refused', async () => {
  let status = 200;
  const p = loadPage({ storage: { 'prowl.owner': OWNER }, fetchImpl: (u) => String(u).indexOf('owner-stats') > -1
    ? Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(Object.assign({}, STATS, { refs: { off: true } })) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') }) });
  await tick(300);
  open(p); await tick(50);
  assert.match(p.$('#otp-denOwn').textContent, /Not connected yet/);
  await p.close();
  status = 403;
  const q = loadPage({ storage: { 'prowl.owner': OWNER }, fetchImpl: (u) => String(u).indexOf('owner-stats') > -1
    ? Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({}) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') }) });
  await tick(300);
  open(q); await tick(50);
  assert.match(q.$('#otp-denOwn').textContent, /owner key on this device was not accepted/);
  await q.close();
});
