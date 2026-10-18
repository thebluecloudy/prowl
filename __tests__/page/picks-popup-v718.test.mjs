// Page v7.18 (Matt, 2026-10-18: "fix the best picks popup it should have same behaviour"): a Best picks card opens the
// same listing popup as every other result card; a site the popup cannot show still opens in its own tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PICKS = { term: 'haeger panther', ms: 900, median: '$120.00', dupes: [], rows: [{ source: 'ebay', kept: 2 }, { source: 'craigslist', kept: 1 }],
  picks: [
    { title: 'Royal Haeger panther 26 inch', price: '$85.00', url: 'https://www.ebay.com/itm/123456789012', image: 'https://i.ebayimg.com/p.jpg', src: 'ebay' },
    { title: 'Haeger panther planter', price: '$40', url: 'https://detroit.craigslist.org/wyn/atq/d/panther/7712345678.html', image: '', src: 'craigslist', where: 'Novi' },
  ] };
const ITEM = { title: 'Royal Haeger panther 26 inch', price: '$85.00', images: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg'], description: '', condition: 'Used', aspects: [], url: 'https://www.ebay.com/itm/123456789012' };

function open() {
  const fetchImpl = (u) => {
    const s = String(u);
    if (/\/hunt\?q=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PICKS) });
    if (/\/item\?url=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ITEM) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['haeger panther'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
}

test('an eBay pick opens the listing popup, with its photos and the usual buttons', async () => {
  const p = open();
  const card = await waitFor(() => p.$('.pk-card[data-s="ebay"]'), { timeout: 8000 });
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  card.querySelector('img').dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, 'no new tab');
  await waitFor(() => p.$('#otp-sheet').classList.contains('on'));
  await tick(60);
  assert.equal(p.$$('#otp-sheetB .pp-gal img').length, 2, 'the photos');
  assert.ok(p.$('#otp-sheetB .pp-go'), 'View on eBay');
  assert.ok(p.$('#otp-sheetB [data-ppshare]'), 'Share this find');
  assert.ok(p.$('#otp-sheetB .pp-sold'), 'What it sold for');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a Craigslist pick still opens Craigslist in its own tab', async () => {
  const p = open();
  const card = await waitFor(() => p.$('.pk-card[data-s="craigslist"]'), { timeout: 8000 });
  let prevented = null;
  p.win.addEventListener('click', (e) => { prevented = e.defaultPrevented; e.preventDefault(); });   /* after the page's handler; keeps jsdom from navigating */
  card.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(prevented, false, 'the page lets the link open');
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false, 'no popup');
  assert.equal(card.getAttribute('target'), '_blank');
  await p.close();
});
