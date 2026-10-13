// Page v6.96: switching a live site off or on in the marketplace list changes the search on screen, not only the next
// one. Matt turned Chairish off, then on again, and had to reload the page to see its results (2026-10-13).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

function fetcher(calls) {
  return (u) => {
    const url = String(u);
    calls.push(url);
    const m = /\/(ebay|chairish|etsy|poshmark|vinted|grailed|salvation)\?q=/.exec(url);
    const src = m ? m[1] : 'shopgoodwill';
    const host = { chairish: 'https://www.chairish.com/product/1/x', ebay: 'https://www.ebay.com/itm/123456789' }[src] || 'https://shopgoodwill.com/item/1234';
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ title: 'Ceramic panther ' + src, price: '$40', url: host, image: '', src }] }), text: () => Promise.resolve('') });
  };
}

test('Chairish off and back on: its live strip goes and comes back on the search already on screen', async () => {
  const calls = [];
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, fetchImpl: fetcher(calls) });
  await tick(40);
  p.$('#otp-q').value = 'ceramic panther';
  p.$('#otp-sa').click();
  await waitFor(() => p.$('#otp-res .rlive[data-lv="chairish"] .sgw-cell'), { timeout: 6000 });
  p.$('#otp-shw').click();
  const box = () => p.$('#otp-mk input[data-m="chairish"]');
  box().checked = false;
  box().dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await tick(30);
  assert.equal(p.$('#otp-res .rlive[data-lv="chairish"]'), null, 'off: gone from the search on screen');
  assert.ok(p.$('#otp-res .rlive[data-lv="ebay"]'), 'the other sites stay');
  box().checked = true;
  box().dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await waitFor(() => p.$('#otp-res .rlive[data-lv="chairish"] .sgw-cell'), { timeout: 6000 });
  assert.match(p.$('#otp-res .rlive[data-lv="chairish"]').textContent, /Ceramic panther chairish/, 'on: back without a reload');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a site that is not live (a link-out marketplace) leaves the search on screen alone', async () => {
  const calls = [];
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, fetchImpl: fetcher(calls) });
  await tick(40);
  p.$('#otp-q').value = 'ceramic panther';
  p.$('#otp-sa').click();
  await waitFor(() => p.$('#otp-res .rlive[data-lv="ebay"] .sgw-cell'), { timeout: 6000 });
  const before = p.$('#otp-res .run-live').innerHTML;
  p.$('#otp-shw').click();
  const m = p.$('#otp-mk input[data-m="mercari"]');
  m.checked = false;
  m.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await tick(30);
  assert.equal(p.$('#otp-res .run-live').innerHTML, before);
  await p.close();
});
