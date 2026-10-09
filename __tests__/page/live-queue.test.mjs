// Page v6.61: Vinted answers a burst of searches with "slow down" (429, then a block), so the page sends it one search
// at a time; one the visitor asked for goes ahead of the Flock's, even if it was already waiting. A search that failed,
// or got worker v91's spare answer, is asked again after two minutes instead of never in the visit; a busy
// marketplace is named in the note, and the visitor's own daily limit keeps its own words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const HUNTS = ['pyrex', 'fiesta', 'hull pottery'];

/* every source answers at once except Vinted, whose answers wait until the test lets them go */
function heldVinted({ status = () => 200, body = () => null, sgw = () => 200, boom = () => false } = {}) {
  const calls = [], held = [];
  const impl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    const src = u.pathname.replace(/\//g, '') || 'shopgoodwill', q = u.searchParams.get('q') || '';
    calls.push({ src, q });
    if (boom(q, src)) throw new TypeError('fetch threw at once');
    if (u.pathname.startsWith('/apps/prowl/')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
    const answer = (st) => ({ ok: st === 200, status: st, json: () => Promise.resolve(body(q, st, src) || (st === 429 ? { error: 'busy', retryIn: 60 } : { items: st === 200 ? [{ title: q + ' on ' + src, price: '$5.00', url: 'https://www.' + src + '.com/items/' + encodeURIComponent(q), image: '', src }] : [] })), text: () => Promise.resolve('') });
    if (src === 'shopgoodwill') return Promise.resolve(answer(sgw(q)));
    if (src !== 'vinted') return Promise.resolve(answer(200));
    return new Promise((r) => held.push({ q, go: () => r(answer(status(q))) }));
  };
  const vinted = () => calls.filter((c) => c.src === 'vinted').map((c) => c.q);
  return { impl, calls, held, vinted };
}
const chip = (p, t) => p.$$('.sgw-chip[data-sgw="pick"]').find((c) => c.textContent.indexOf(t) > -1);

async function open(f, hunts = HUNTS) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts, lock: hunts.map((_, i) => i) }, 'prowl.lastHunt': 'pyrex' } });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= hunts.length);
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

test('a run or chip tap for a term the Flock already queued moves it to the front', async () => {
  const f = heldVinted();
  const hunts = ['pyrex', 'fiesta', 'hull pottery', 'blenko', 'fire king'];
  const p = await open(f, hunts);
  p.$('#otp-dock .db[data-m="flock"]').click();   /* the Flock queues Vinted searches behind pyrex */
  await tick(2000);
  assert.deepEqual(f.vinted(), ['pyrex'], 'still one at a time');
  p.$('#otp-dock .db[data-m="prowl"]').click();
  await tick(40);
  /* the chip for the last Den hunt: queued by the Flock or not, it goes next */
  chip(p, 'fire king').click();
  f.held.shift().go();
  await waitFor(() => f.vinted().length === 2);
  assert.equal(f.vinted()[1], 'fire king');
  while (f.held.length) { f.held.shift().go(); await tick(30); }
  await p.close();
});

test('a Vinted search that throws at once fails on its own and does not jam the queue', async () => {
  const f = heldVinted({ boom: (q, src) => src === 'vinted' && q === 'fiesta' });
  const p = await open(f);
  chip(p, 'hull pottery').click();
  chip(p, 'fiesta').click();   /* newest first: fiesta goes next, throws, and hull pottery must still go */
  f.held.shift().go();
  await waitFor(() => f.vinted().length === 3);
  assert.deepEqual(f.vinted(), ['pyrex', 'fiesta', 'hull pottery']);
  await waitFor(() => /Could not reach Vinted just now/.test(p.$('#otp-sgw').textContent));   /* fiesta, on screen */
  f.held.shift().go();
  chip(p, 'hull pottery').click();
  await waitFor(() => /hull pottery on vinted/.test(p.$('#otp-sgw').textContent));
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('a hunt cut at the length limit never keeps half an emoji', async () => {
  const f = heldVinted();
  const p = await open(f);
  p.win.prowlAddHunt('x'.repeat(59) + '\u{1F989}');   /* 61 UTF-16 units: the cut at 60 lands inside the emoji */
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts;
  const last = saved[saved.length - 1];
  assert.ok(!/[\uD800-\uDBFF]$/.test(last), 'no lone surrogate at the end');
  assert.equal(last, 'x'.repeat(59));
  while (f.held.length) { f.held.shift().go(); await tick(30); }
  await p.close();
});

test('the visitor\'s own daily limit keeps its own words and is not asked again for half an hour', async () => {
  const f = heldVinted({ status: () => 429, body: (q, st) => (st === 429 ? { error: 'slow down' } : null) });
  const p = await open(f);
  f.held.shift().go();
  await waitFor(() => /busy on your connection/.test(p.$('#otp-sgw').textContent));
  assert.doesNotMatch(p.$('#otp-sgw').textContent, /Vinted is busy right now/);
  const real = p.win.Date.now;
  p.win.Date.now = () => real.call(p.win.Date) + 5 * 60 * 1000;
  chip(p, 'fiesta').click();
  await waitFor(() => f.held.length === 1);
  f.held.shift().go();
  await tick(40);
  chip(p, 'pyrex').click();
  await tick(60);
  assert.deepEqual(f.vinted(), ['pyrex', 'fiesta'], 'five minutes on, the cap is not asked again');
  await p.close();
});

test('the worker\'s spare answer shows as from earlier today and is asked again after two minutes', async () => {
  let spare = true;
  const f = heldVinted({ body: (q, st, src) => (st === 200 && src === 'vinted' && spare ? { stale: true, staleWhy: 'cooling down', items: [{ title: q + ' from before', price: '$7.00', url: 'https://www.vinted.com/items/old-' + encodeURIComponent(q), image: '', src: 'vinted' }] } : null) });
  const p = await open(f);
  f.held.shift().go();
  await waitFor(() => /pyrex from before/.test(p.$('#otp-sgw').textContent));
  assert.match(p.$('#otp-sgw').textContent, /1 from earlier today/);
  spare = false;
  const real = p.win.Date.now;
  p.win.Date.now = () => real.call(p.win.Date) + 2 * 60 * 1000 + 1000;
  chip(p, 'fiesta').click();
  await waitFor(() => f.held.length === 1);
  f.held.shift().go();
  await tick(40);
  chip(p, 'pyrex').click();
  await waitFor(() => f.vinted().filter((q) => q === 'pyrex').length === 2);
  f.held.shift().go();
  await waitFor(() => /pyrex on vinted/.test(p.$('#otp-sgw').textContent));
  assert.match(p.$('#otp-sgw').textContent, /live now/);
  await p.close();
});

test('ShopGoodwill is asked again after two minutes too', async () => {
  let down = true;
  const f = heldVinted({ sgw: () => (down ? 429 : 200) });
  const p = await open(f);
  await waitFor(() => /ShopGoodwill is busy right now/.test(p.$('#otp-sgw').textContent));
  const sg = () => f.calls.filter((c) => c.src === 'shopgoodwill' && c.q === 'pyrex').length;
  assert.equal(sg(), 1);
  down = false;
  const real = p.win.Date.now;
  p.win.Date.now = () => real.call(p.win.Date) + 2 * 60 * 1000 + 1000;
  chip(p, 'fiesta').click();
  await tick(40);
  chip(p, 'pyrex').click();
  await waitFor(() => sg() === 2);
  await waitFor(() => /pyrex on shopgoodwill/.test(p.$('#otp-sgw').textContent));
  while (f.held.length) { f.held.shift().go(); await tick(30); }
  await p.close();
});
