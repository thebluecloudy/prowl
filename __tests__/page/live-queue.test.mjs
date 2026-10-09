// Page v6.61: Vinted answers a burst of searches with "slow down" (429, then a block), so the page sends it one search
// at a time; one the visitor asked for goes ahead of the Flock's. A search that failed is asked again after two
// minutes instead of staying failed for the whole visit, and a busy marketplace is named in the note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const HUNTS = ['pyrex', 'fiesta', 'hull pottery'];

/* every source answers at once except Vinted, whose answers wait until the test lets them go */
function heldVinted({ status = () => 200 } = {}) {
  const calls = [], held = [];
  const impl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    const src = u.pathname.replace(/\//g, '') || 'shopgoodwill', q = u.searchParams.get('q') || '';
    calls.push({ src, q });
    if (u.pathname.startsWith('/apps/prowl/')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
    const answer = (st) => ({ ok: st === 200, status: st, json: () => Promise.resolve({ items: st === 200 ? [{ title: q + ' on ' + src, price: '$5.00', url: 'https://www.' + src + '.com/items/' + encodeURIComponent(q), image: '', src }] : [] }), text: () => Promise.resolve('') });
    if (src !== 'vinted') return Promise.resolve(answer(200));
    return new Promise((r) => held.push({ q, go: () => r(answer(status(q))) }));
  };
  const vinted = () => calls.filter((c) => c.src === 'vinted').map((c) => c.q);
  return { impl, calls, held, vinted };
}
const chip = (p, t) => p.$$('.sgw-chip[data-sgw="pick"]').find((c) => c.textContent.indexOf(t) > -1);

async function open(f) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS, lock: [0, 1, 2] }, 'prowl.lastHunt': 'pyrex' } });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= 3);
  await waitFor(() => f.vinted().length >= 1);
  return p;
}

test('Vinted gets one search at a time; the others wait their turn and the panel says it is looking', async () => {
  const f = heldVinted();
  const p = await open(f);
  assert.deepEqual(f.vinted(), ['pyrex']);
  chip(p, 'fiesta').click();
  chip(p, 'hull pottery').click();
  await tick(60);
  assert.deepEqual(f.vinted(), ['pyrex'], 'nothing more goes to Vinted while one is out');
  assert.ok(f.calls.some((c) => c.src === 'ebay' && c.q === 'hull pottery'), 'other marketplaces are not held up');
  assert.match(p.$('#otp-sgw').textContent, /Looking on Vinted/, 'the waiting search shows as looking, not blank');

  f.held.shift().go();
  await waitFor(() => f.vinted().length === 2);
  /* the latest one the visitor asked for goes first */
  assert.deepEqual(f.vinted(), ['pyrex', 'hull pottery']);
  await tick(60);
  assert.equal(f.vinted().length, 2, 'still one at a time');
  f.held.shift().go();
  await waitFor(() => f.vinted().length === 3);
  assert.deepEqual(f.vinted(), ['pyrex', 'hull pottery', 'fiesta']);
  f.held.shift().go();
  await waitFor(() => /hull pottery on vinted/.test(p.$('#otp-sgw').textContent) || /fiesta on vinted/.test(p.$('#otp-sgw').textContent));
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('the same term is never asked twice at once, even when it is not the newest', async () => {
  const f = heldVinted();
  const p = await open(f);
  chip(p, 'fiesta').click();
  chip(p, 'pyrex').click();
  chip(p, 'fiesta').click();
  await tick(60);
  while (f.held.length) { f.held.shift().go(); await tick(40); }
  await tick(60);
  assert.deepEqual(f.vinted().slice().sort(), ['fiesta', 'pyrex']);
  await p.close();
});

test('a busy answer names the marketplace, and the search is asked again only after two minutes', async () => {
  let busy = true;
  const f = heldVinted({ status: () => (busy ? 429 : 200) });
  const p = await open(f);
  f.held.shift().go();
  await waitFor(() => /Vinted is busy right now/.test(p.$('#otp-sgw').textContent));
  assert.doesNotMatch(p.$('#otp-sgw').textContent, /on your connection/);

  /* back to it within two minutes: the answer stands, Vinted is not asked again */
  chip(p, 'fiesta').click();
  await waitFor(() => f.held.length === 1);
  f.held.shift().go();
  await tick(40);
  chip(p, 'pyrex').click();
  await tick(60);
  assert.deepEqual(f.vinted(), ['pyrex', 'fiesta']);

  /* two minutes on, it is asked again */
  busy = false;
  const real = p.win.Date.now;
  p.win.Date.now = () => real.call(p.win.Date) + 2 * 60 * 1000 + 1000;
  chip(p, 'fiesta').click();
  chip(p, 'pyrex').click();
  await waitFor(() => f.vinted().length === 3);
  assert.deepEqual(f.vinted(), ['pyrex', 'fiesta', 'fiesta'], 'fiesta was busy too, so it goes again first');
  f.held.shift().go();
  await waitFor(() => f.vinted().length === 4);
  assert.deepEqual(f.vinted().slice(3), ['pyrex']);
  f.held.shift().go();
  await waitFor(() => /pyrex on vinted/.test(p.$('#otp-sgw').textContent));
  await p.close();
});
