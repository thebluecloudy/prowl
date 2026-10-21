// Page v7.56 (Matt, 2026-10-21): Vinted busy again, "can you just put a link here to run it manually?", and Best bets:
// "When I click ruby lane the screen changes to one hunt or something. I'm expecting it to open ruby lane."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

function open() {
  const live = liveFetch({ perSource: 2 });
  const fetchImpl = (u, o) => {
    const s = String(u);
    if (/\/where\?/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ best: [{ id: 'etsy' }, { id: 'rubylane' }, { id: 'bonanza' }] }) });
    if (/\/vinted\?/.test(s)) return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'busy' }) });
    return live.impl(u, o);
  };
  return loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['Ceramic panther'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
}

test('Best bets open that marketplace\'s own search, not a one-site run', async () => {
  const p = open();
  await tick(60);
  p.$('.sgw-chip[data-sgw="pick"]').click();
  const rl = await waitFor(() => p.$('.sgw-where ~ a.sgw-wh[data-m="rubylane"]'), { timeout: 8000 });
  assert.equal(rl.tagName, 'A');
  assert.equal(rl.target, '_blank');
  assert.match(rl.href, /rubylane\.com/);
  assert.match(decodeURIComponent(rl.href).replace(/\+/g, ' ').toLowerCase(), /ceramic panther/);
  assert.match(rl.textContent, /^Ruby Lane/);
  assert.equal(p.$$('.sgw-where ~ a.sgw-wh').length, 3);
  assert.equal(p.$('[data-sgw="where"]'), null, 'no button that starts a run inside Prowl');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a marketplace too busy to load live says so and links to the same search on its own site', async () => {
  const p = open();
  await tick(60);
  p.$('#otp-q').value = 'Ceramic panther';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  const a = await waitFor(() => p.$$('#otp-res .sgw-note a.lv-self').find((x) => /vinted\.com/.test(x.href)), { timeout: 10000 });
  assert.match(a.closest('.sgw-note').textContent, /Vinted is busy right now/);
  assert.match(a.textContent, /Search Vinted yourself/);
  assert.equal(a.target, '_blank');
  assert.match(decodeURIComponent(a.href).replace(/\+/g, ' ').toLowerCase(), /ceramic panther/);
  assert.equal(p.$$('#otp-res a.lv-self').length, 1, 'only the one that failed');
  assert.deepEqual(p.errors, []);
  await p.close();
});
