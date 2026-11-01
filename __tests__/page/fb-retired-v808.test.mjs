// Page v8.08 (Matt, 2026-10-28): the morning Facebook sweep through Matt's own account is retired. Page v8.26 (worker
// v200) brings the strip back through Apify for Pro members (fb-strip-v826.test.mjs). What stays from v8.08: no session
// cookies, nothing on anyone's account, and Facebook is still a link-out search under More places to look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('a visitor who is not Pro (and not the owner) never asks /fb-finds; the Facebook row only says Pro shows finds there (v8.45)', async () => {
  const live = liveFetch({ perSource: 2 });
  const p = loadPage({ fetchImpl: live.impl, storage: { 'prowl.v36': { seen: true, hunts: ['Pyrex Butterprint'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
  await tick(60);
  p.$('.sgw-chip[data-sgw="pick"]').click();
  await waitFor(() => p.$$('.sgw-card, .sgw-grid a').length > 0, { timeout: 8000 });
  await tick(200);
  assert.equal(live.calls.filter((u) => /fb-finds/.test(u)).length, 0);
  const h = p.$('.sgw-fbh');
  assert.ok(!h || /Pro/.test(h.parentNode.textContent), 'at most the Pro preview row');
  assert.equal(p.$$('.sgw-fbh').length <= 1, true);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no session cookies: the strip never sets or sends a cookie, Facebook link-out searches stay', () => {
  const i = PAGE.indexOf('var FB={cache:'), strip = PAGE.slice(i, PAGE.indexOf('function sgwCont(', i));
  assert.ok(i > 0);
  assert.doesNotMatch(strip, /document\.cookie|credentials:|PROWL_FB_PUBLIC/);
  assert.match(PAGE, /function fbCityUrl\(/);
  assert.match(PAGE, /function fbOwnerKey\(/);
});
