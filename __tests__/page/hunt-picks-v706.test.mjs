// Page v7.06: Best picks from the worker's /hunt (v117) at the top of a single search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const HUNT = {
  term: 'ceramic panther', ms: 900, median: '$80.00',
  picks: [
    { title: 'Lot of 4 ceramic panthers', price: '$41.00', url: 'https://shopgoodwill.com/item/1', image: 'https://img.example.com/1.jpg', src: 'shopgoodwill', time_left: '2h 10m', bids: 1 },
    { title: 'Haeger panther <b>lamp</b>', price: '$95.00', url: 'https://www.ebay.com/itm/2', image: '', src: 'ebay' }
  ],
  rows: [
    { source: 'shopgoodwill', kept: 3, note: '' }, { source: 'ebay', kept: 9, note: '' },
    { source: 'etsy', kept: 0, note: '12 results, none were a true match' },
    { source: 'facebook', kept: 0, gated: true, note: 'Needs your Facebook login.' }
  ],
  dupes: [['https://www.ebay.com/itm/3', 'https://www.vinted.com/items/4']]
};

function setup(hunt) {
  const base = liveFetch().impl, calls = [];
  const fetchImpl = (url) => {
    const u = String(url);
    if (/\/hunt\?/.test(u)) { calls.push(u); const body = hunt; return Promise.resolve({ ok: !!body, status: body ? 200 : 500, json: () => Promise.resolve(body) }); }
    return base(url);
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  return { p, calls };
}
async function search(p, term) { await tick(60); p.$('#otp-q').value = term; p.$('#otp-sa').click(); await tick(300); }

test('a single search shows Best picks, the cross-post line and a chip for every site', async () => {
  const { p, calls } = setup(HUNT);
  await search(p, 'ceramic panther');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /hunt\?q=ceramic%20panther/);
  const box = p.$('#otp-hpicks');
  assert.ok(box, 'the picks box is in the results');
  assert.equal(box.querySelectorAll('.pk-card').length, 2);
  assert.match(box.querySelector('.pk-h').textContent, /typical price \$80\.00/);
  assert.match(box.textContent, /1 listing is posted on two sites/);
  assert.equal(box.querySelectorAll('.pk-sites li').length, 4);
  assert.ok(box.querySelector('.pk-sites .pk-gated'));
  assert.ok(!box.querySelector('.pk-card b b'), 'titles are escaped, not rendered as HTML');
  assert.match(box.textContent, /Haeger panther <b>lamp<\/b>/);
  await p.close();
});

test('a failed hunt leaves no box content, and the regular results still show', async () => {
  const { p } = setup(null);
  await search(p, 'ceramic panther');
  const box = p.$('#otp-hpicks');
  assert.ok(box);
  assert.equal(box.innerHTML, '');
  assert.ok(p.$('#otp-res .hits'), 'the marketplace rows are still there');
  await p.close();
});
