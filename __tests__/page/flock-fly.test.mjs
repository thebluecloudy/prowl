// Page v6.56: Fly. Flock moves on to the next find every 4 seconds until you stop it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

// the 4-second step runs every 60ms here
async function flock(opts) {
  const f = liveFetch(opts);
  const p = loadPage({ fetchImpl: f.impl, storage: { owlTwigSgwTerms: ['panther', 'pyrex'], 'prowl.v36': { seen: true } }, beforeLoad: (w) => {
    w.Math.random = () => 0.5;
    const si = w.setInterval.bind(w);
    w.setInterval = (fn, ms, ...a) => si(fn, ms === 4000 ? 60 : ms, ...a);
  } });
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length >= (opts && opts.only ? 3 : 6));
  await waitFor(() => p.$('#otp-flockRow').getAttribute('aria-busy') === 'false', { timeout: 8000 });
  await tick(1200);
  layout(p);
  return p;
}
// jsdom has no layout: give each card a 100px slot
function layout(p) {
  p.$$('#otp-flockRow .fl-card,#otp-flockRow .fl-note').forEach((c, k) => {
    Object.defineProperty(c, 'offsetTop', { value: k * 100, configurable: true });
    Object.defineProperty(c, 'offsetHeight', { value: 100, configurable: true });
  });
}
const fly = (p) => p.$('#otp-flockFly');
const row = (p) => p.$('#otp-flockRow');

test('Fly sits next to Shuffle and moves to the next card on its own until Stop', async () => {
  const p = await flock();
  const b = fly(p);
  assert.ok(b, 'a Fly button');
  assert.equal(b.nextElementSibling, p.$('#otp-flockShuf'), 'just before Shuffle');
  assert.equal(b.textContent, 'Fly'); assert.equal(b.getAttribute('aria-pressed'), 'false');
  b.click();
  assert.equal(b.textContent, 'Stop'); assert.equal(b.getAttribute('aria-pressed'), 'true');
  await tick(200);
  const y = row(p).scrollTop;
  assert.ok(y >= 200, 'it moved on by itself: ' + y);
  assert.equal(y % 100, 0, 'it lands on a card');
  b.click();
  assert.equal(b.textContent, 'Fly');
  const stopAt = row(p).scrollTop;
  await tick(200);
  assert.equal(row(p).scrollTop, stopAt, 'stopped means stopped');
  await p.close();
});

test('touching the feed stops it', async () => {
  const p = await flock();
  fly(p).click();
  await tick(150);
  row(p).dispatchEvent(new p.win.Event('touchstart'));
  const at = row(p).scrollTop;
  await tick(200);
  assert.equal(row(p).scrollTop, at);
  assert.equal(fly(p).textContent, 'Fly');
  await p.close();
});

test('leaving Flock or switching to Saved stops it', async () => {
  let p = await flock();
  fly(p).click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  assert.equal(fly(p).textContent, 'Fly');
  await p.close();
  p = await flock();
  fly(p).click();
  p.$('#otp-dock .db[data-m="prowl"]').click();
  assert.equal(fly(p).textContent, 'Fly');
  await p.close();
});

test('at the end of the feed it stops by itself', async () => {
  const p = await flock({ only: 'shopgoodwill' });   // a feed small enough to end
  await waitFor(() => /That.s the flock/.test((p.$('#otp-flockRow .fl-end') || {}).textContent || ''), { timeout: 8000 });
  layout(p);
  fly(p).click();
  await waitFor(() => fly(p).textContent === 'Fly', { timeout: 3000 });
  const n = p.$$('#otp-flockRow .fl-card').length;
  assert.equal(row(p).scrollTop, (n - 1) * 100, 'it flew to the last card, then stopped');
  await p.close();
});
