// Page v7.22 (Matt, 2026-10-18: "I'd like this and any other analytics and graphs in the menu area"): every analytic
// lives on Den › STATS. Everyone sees their own hunting and Your marketplaces. The owner's Prowl usage moved to the admin
// in v7.27 (worker v127); the owner key's devices see a link to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const OWNER = 'abcdefghijklmnop';

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

test('v7.27: the owner gets a link to the admin, and nothing is fetched for it', async () => {
  const calls = [];
  const p = loadPage({ storage: { 'prowl.owner': OWNER }, fetchImpl: (u) => {
    calls.push(String(u));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  } });
  await tick(300);
  open(p);
  await tick(50);
  const own = p.$('#otp-denOwn');
  assert.equal(own.hidden, false);
  assert.match(own.textContent, /in the admin, on its Searches tab/);
  assert.equal(own.querySelector('a').getAttribute('href'), 'https://prowl.thebluecloud.workers.dev/admin#searches');
  assert.ok(!calls.some((u) => /owner-stats/.test(u)), 'the page no longer asks for owner stats');
  assert.deepEqual(p.errors, []);
  await p.close();
});
