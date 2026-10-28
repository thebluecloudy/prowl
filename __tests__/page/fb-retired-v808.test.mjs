// Page v8.08 (Matt, 2026-10-28): the morning Facebook sweep is retired, so the Facebook strip goes. Facebook stays a
// link-out search under More places to look. Replaces fb-strip.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('no strip and no call to the retired /fb-finds, even on the owner\'s device', async () => {
  const live = liveFetch({ perSource: 2 });
  const p = loadPage({ fetchImpl: live.impl, storage: { 'prowl.owner': 'owner-key-0123456789', 'prowl.v36': { seen: true, hunts: ['Pyrex Butterprint'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
  await tick(60);
  p.$('.sgw-chip[data-sgw="pick"]').click();
  await waitFor(() => p.$$('.sgw-card, .sgw-grid a').length > 0, { timeout: 8000 });
  await tick(200);
  assert.equal(live.calls.filter((u) => /fb-finds/.test(u)).length, 0);
  assert.equal(p.$('.sgw-fbh'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the strip\'s code is gone; Facebook link-out searches stay', () => {
  assert.doesNotMatch(PAGE, /fb-finds|PROWL_FB_PUBLIC|function fbBlock|function fbFetch|sgw-fbh/);
  assert.match(PAGE, /function fbCityUrl\(/);
  assert.match(PAGE, /function fbOwnerKey\(/);
});
