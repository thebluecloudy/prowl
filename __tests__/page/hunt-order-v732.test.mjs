// Page v7.32 (the owner, on opening MC Escher: "needs to get to the hunt faster"; "the words fall out of pills
// sometimes"): in a hunt, marketplaces with listings come before the ones with nothing, and buttons keep their words in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

test('marketplaces with listings come first; "Nothing live on ShopGoodwill" goes below them', async () => {
  const f = liveFetch({ perSource: 3, only: 'ebay' });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['mc escher'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
  await tick(50);
  const body = await waitFor(() => { const b = p.$('#otp-sgw .sgw-body'); return b && /Live on eBay/.test(b.textContent) && /ShopGoodwill/.test(b.textContent) && b; }, { timeout: 12000 });
  const txt = body.textContent;
  assert.ok(txt.indexOf('Live on eBay') < txt.indexOf('ShopGoodwill'), 'eBay, which has listings, is above ShopGoodwill');
  assert.match(p.$('#otp-sgw .sgw-body .sgw-grid .sgw-cell[data-u]').getAttribute('data-u'), /ebay\.com/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the home panel hunt buttons wrap instead of running out of the pill; the other-hunts line wraps too', () => {
  const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.match(html, /\.scout-app-wrapper \.hn-go\{height:auto;min-height:40px;padding:8px 16px;white-space:normal;overflow-wrap:anywhere/);
  assert.match(html, /\.scout-app-wrapper \.hn-line\{display:flex;flex-wrap:wrap/);
  assert.match(html, /\.scout-app-wrapper \.hn-pick\{[^}]*max-width:100%[^}]*overflow-wrap:anywhere/);
  /* the review: a rule on every .b cut "Open first N of M" off on phones */
  assert.doesNotMatch(html, /\.scout-app-wrapper \.b\{max-width:100%;overflow:hidden/);
});
