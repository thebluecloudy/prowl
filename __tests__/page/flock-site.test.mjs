// Page v6.53: every Flock card says where the find is sold, in a pill on the photo; an auction's time and bids sit
// in the same bottom-left stack, so the two never overlap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const NAMES = { 'shopgoodwill.com': 'ShopGoodwill', 'www.ebay.com': 'eBay', 'www.etsy.com': 'Etsy', 'www.chairish.com': 'Chairish', 'www.poshmark.com': 'Poshmark' };
async function flock(opts) {
  const f = liveFetch(opts);
  const p = loadPage({ fetchImpl: f.impl, storage: { owlTwigSgwTerms: ['panther', 'pyrex'] }, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length >= 4);
  await waitFor(() => p.$('#otp-flockRow').getAttribute('aria-busy') === 'false', { timeout: 8000 });
  return p;
}

test('every card carries a pill naming the site it is sold on', async () => {
  const p = await flock();
  const cards = p.$$('#otp-flockRow .fl-card');
  const seen = new Set();
  for (const c of cards) {
    const host = new URL(c.getAttribute('data-u')).hostname;
    const pill = c.querySelector('.fl-tags .fl-site');
    assert.ok(pill, 'site pill on ' + host);
    if (NAMES[host]) assert.equal(pill.textContent, NAMES[host], host);
    seen.add(pill.textContent);
  }
  assert.ok(seen.size >= 2, 'more than one site in the mix: ' + [...seen].join(', '));
  await p.close();
});

test('an auction shows its site and its time and bids in one stack', async () => {
  const p = await flock({ only: 'shopgoodwill' });
  const c = p.$('#otp-flockRow .fl-card');
  const tags = c.querySelector('.fl-tags');
  assert.deepEqual([...tags.children].map((x) => x.className), ['fl-site', 'fl-auc']);
  assert.equal(tags.querySelector('.fl-site').textContent, 'ShopGoodwill');
  assert.match(tags.querySelector('.fl-auc').textContent, /^2d 4h · \d+ bids?$/);
  await p.close();
});
