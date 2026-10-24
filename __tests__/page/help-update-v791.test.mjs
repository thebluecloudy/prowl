// v7.91 (Matt: "Update how prowl works section with all the new features of near me, moving pills, etc").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from '../helpers/loadPage.mjs';

test('How Prowl works covers reordering pills, Near me and the day on the road', async () => {
  const p = loadPage({});
  const ms = p.$('#otp-ms').textContent;
  assert.match(ms, /Put your hunts in order/);
  assert.match(ms, /Reorder beside All your hunts/);
  assert.match(ms, /press and hold a pill/);
  assert.match(ms, /Open now/);
  assert.match(ms, /\+ Stop adds any shop to a trip/);
  assert.match(ms, /✓ Been/);
  assert.match(ms, /Next stop at the top says how far/);
  assert.match(ms, /closed by then/);
  assert.match(ms, /Hearts and saved finds live in Flock/);
  const words = p.$$('#otp-ms .gloss dt').map((d) => d.textContent);
  assert.ok(words.includes('Pill') && words.includes('Been'));
  assert.deepEqual(p.errors, []);
  await p.close();
});
