// Page v7.34 (the owner, on one Rookwood owl at $190 on Etsy and $211 on Poshmark: "show that it is listed in 2 other
// places, and they have different prices. say someone doesn't trust poshmark, but would buy from etsy, or if lowest
// price need to include the shipping"): worker v130 gives every copy `also`; the card says so, the popup lists each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const ETSY = 'https://www.etsy.com/listing/1111111111', POSH = 'https://poshmark.com/listing/owl-222', EBAY = 'https://www.ebay.com/itm/333333333333';
const T = 'Rookwood Pottery ceramic owl Trinket pin ashtray 6" Cream';
const lead = { title: T, price: '$190.00', url: ETSY, image: 'https://i.etsystatic.com/o.jpg', src: 'etsy',
  also: [{ src: 'ebay', price: '$205.00', url: EBAY, ship: '$12.50' }, { src: 'poshmark', price: '$211.00', url: POSH }, { src: 'x', price: '$1', url: 'javascript:alert(1)' }] };
const HUNTD = { term: 'rookwood owl', ms: 900, median: '$197.93', dupes: [[ETSY, POSH], [ETSY, EBAY]], picks: [lead],
  rows: [{ source: 'etsy', kept: 1, items: [lead] },
    { source: 'poshmark', kept: 1, items: [{ title: T, price: '$211.00', url: POSH, src: 'poshmark', dupeOf: ETSY, also: [{ src: 'etsy', price: '$190.00', url: ETSY }, { src: 'ebay', price: '$205.00', url: EBAY, ship: '$12.50' }] }] }] };
const ITEM = { title: T, price: '$190.00', images: ['https://i.etsystatic.com/o.jpg'], description: '', condition: '', aspects: [], url: ETSY };

function open() {
  const fetchImpl = (u) => {
    const s = String(u);
    if (/\/hunt\?q=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(HUNTD) });
    if (/\/item\?url=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ITEM) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['rookwood owl'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
}

test('the Best pick card says where else the same piece is listed, with each price and eBay\'s shipping', async () => {
  const p = open();
  const card = await waitFor(() => p.$('.pk-card[data-s="etsy"]'), { timeout: 8000 });
  assert.equal(p.$$('.pk-card').length, 1, 'one owl, one Best pick');
  assert.equal(card.querySelector('.sgw-also').textContent, 'Also on eBay $205.00 + $12.50 shipping · Poshmark $211.00');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('its popup lists each site with its price and a link, so the visitor can pick the site they trust', async () => {
  const p = open();
  const card = await waitFor(() => p.$('.pk-card[data-s="etsy"]'), { timeout: 8000 });
  card.querySelector('img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheet').classList.contains('on'));
  await tick(60);
  const box = await waitFor(() => p.$('#otp-sheetB .pp-also'));
  assert.match(box.querySelector('b').textContent, /The same piece is also on/);
  const rows = [...box.querySelectorAll('li')];
  assert.equal(rows.length, 2, 'the javascript: link is dropped');
  assert.match(rows[0].textContent, /^eBay\$205\.00\+ \$12\.50 shipping/);
  assert.match(rows[1].textContent, /^Poshmark\$211\.00/);
  assert.match(rows[1].querySelector('a').getAttribute('href'), /^https:\/\/poshmark\.com\/listing\/owl-222/);
  assert.equal(rows[1].querySelector('a').target, '_blank');
  assert.match(box.textContent, /This one is \$190\.00 here\. Shipping is extra unless shown/);
  assert.match(p.$('#otp-sheetB .pp-fp').getAttribute('data-d'), /^Also listed on eBay \$205\.00, Poshmark \$211\.00\. /);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a result card that is a cross-posted copy gets its "Also on" line, even when drawn before or after /hunt answered', async () => {
  const p = open();
  await waitFor(() => p.$('.pk-card[data-s="etsy"]'), { timeout: 8000 });
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', POSH);
  cell.innerHTML = '<a class="sgw-card" href="#"><img alt="" src="https://x/p.jpg"><div class="sgw-t">' + T + '</div><div class="sgw-m">Poshmark</div></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  await tick(30);
  assert.equal(cell.querySelector('.sgw-also').textContent, 'Also on Etsy $190.00 · eBay $205.00 + $12.50 shipping');
  assert.equal(cell.querySelectorAll('.sgw-also').length, 1, 'once');
  assert.deepEqual(p.errors, []);
  await p.close();
});
