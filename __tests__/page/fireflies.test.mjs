// Page v6.89: in Uranium, starting a hunt sends a swarm of fireflies across the screen. Nowhere else, never under
// reduced motion, and they are cleared away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
function hunt(p) { p.$('#otp-q').value = 'Fire-King jadeite'; p.$('#otp-sa').click(); }
function theme(p, t) { p.doc.documentElement.setAttribute('data-theme', t); }

test('Uranium: a hunt sends 22 fireflies across, on body, and they are removed', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  theme(p, 'uranium');
  hunt(p);
  const ff = p.$$('body > .pm-ff');
  assert.equal(ff.length, 22);
  assert.ok(ff.every((f) => f.getAttribute('aria-hidden') === 'true' && /ms$/.test(f.style.getPropertyValue('--t'))));
  hunt(p);
  assert.equal(p.$$('.pm-ff').length, 22, 'a second hunt clears the first swarm');
  await waitFor(() => p.$$('.pm-ff').length === 0, { timeout: 8000 });   /* longest is 3.8 s; slack for a busy test run */
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no swarm in other themes or under reduced motion', async () => {
  let p = loadPage({ storage: DEN });
  await tick(30);
  theme(p, 'light');
  hunt(p);
  assert.equal(p.$$('.pm-ff').length, 0);
  await p.close();
  p = loadPage({ storage: DEN, reducedMotion: true });
  await tick(30);
  theme(p, 'uranium');
  hunt(p);
  assert.equal(p.$$('.pm-ff').length, 0);
  await p.close();
});
