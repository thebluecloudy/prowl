// Page v6.57: Fly has a speed setting: a chip shown while flying, in Shuffle's place, that cycles 2-10 seconds and is
// remembered on this device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

async function flock(storage = {}) {
  const f = liveFetch(), asked = [];
  const p = loadPage({ fetchImpl: f.impl, storage: { owlTwigSgwTerms: ['panther', 'pyrex'], 'prowl.v36': { seen: true, hunts: [] }, ...storage }, beforeLoad: (w) => {
    w.Math.random = () => 0.5;
    const si = w.setInterval.bind(w);
    // Fly's step runs every 60ms here; the interval it asked for is recorded
    w.setInterval = (fn, ms, ...a) => { if (ms >= 2000 && ms <= 10000 && ms % 1000 === 0) { asked.push(ms); return si(fn, 60, ...a); } return si(fn, ms, ...a); };
  } });
  p.asked = asked;
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length >= 4);
  return p;
}
const sp = (p) => p.$('#otp-flockFlySp');
const flyingClass = (p) => p.$('#otp-flock').classList.contains('flying');

test('the speed chip shows while flying, in Shuffle\'s place, and starts at 4s', async () => {
  const p = await flock();
  assert.ok(sp(p), 'a speed chip');
  assert.equal(sp(p).textContent, '4s');
  assert.ok(!flyingClass(p), 'not shown before flying');
  p.$('#otp-flockFly').click();
  assert.ok(flyingClass(p), 'shown while flying (Shuffle hides)');
  assert.deepEqual(p.asked, [4000]);
  p.$('#otp-flockFly').click();
  assert.ok(!flyingClass(p), 'back to Fly and Shuffle');
  await p.close();
});

test('tapping the chip cycles 4 → 6 → 8 → 10 → 2 → 3 → 4 and keeps flying at the new speed', async () => {
  const p = await flock();
  p.$('#otp-flockFly').click();
  const seen = [];
  for (let i = 0; i < 6; i++) { sp(p).click(); seen.push(sp(p).textContent); }
  assert.deepEqual(seen, ['6s', '8s', '10s', '2s', '3s', '4s']);
  assert.deepEqual(p.asked, [4000, 6000, 8000, 10000, 2000, 3000, 4000], 'each change restarts the timer at the new speed');
  assert.equal(p.$('#otp-flockFly').textContent, 'Stop', 'still flying');
  assert.match(sp(p).getAttribute('aria-label'), /every 4 seconds/);
  await p.close();
});

test('the speed is remembered on this device', async () => {
  let p = await flock();
  p.$('#otp-flockFly').click();
  sp(p).click(); sp(p).click();   // 8s
  assert.equal(p.win.localStorage.getItem('prowl.flySpeed'), '8');
  await p.close();
  p = await flock({ 'prowl.flySpeed': '8' });
  assert.equal(sp(p).textContent, '8s');
  p.$('#otp-flockFly').click();
  assert.deepEqual(p.asked, [8000]);
  await p.close();
  p = await flock({ 'prowl.flySpeed': '999' });
  assert.equal(sp(p).textContent, '4s', 'a bad stored value falls back to 4s');
  await p.close();
});
