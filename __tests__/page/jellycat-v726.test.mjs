// Page v7.26 (Matt, 2026-10-18, from Jellycat's shop): calm result cards, outlined tags with a Best pick tag on
// results that are one of a hunt's Best picks, the seller's stars under the price (worker v126: eBay feedback, Etsy
// shop reviews, never the seller's name), and the popup's item details and price check under + / − headings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const HTML = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const U = 'https://www.ebay.com/itm/123456789012';
const U2 = 'https://www.ebay.com/itm/223456789012';
const PICKS = { term: 'haeger panther', ms: 900, median: '$120.00', dupes: [], rows: [{ source: 'ebay', kept: 1 }],
  picks: [{ title: 'Royal Haeger panther 26 inch', price: '$85.00', url: U, image: 'https://i.ebayimg.com/p.jpg', src: 'ebay' }] };
const LIVE = [
  { title: 'Royal Haeger panther 26 inch', price: '$85.00', url: U, image: 'https://i.ebayimg.com/p.jpg', src: 'ebay', seller: { pct: 99.8, n: 12345 } },
  { title: 'Haeger panther planter', price: '$40.00', url: U2, image: 'https://i.ebayimg.com/q.jpg', src: 'ebay' },
];
const ITEM = { title: 'Royal Haeger panther 26 inch', price: '$85.00', images: ['https://i.ebayimg.com/1.jpg'], description: 'Glossy black glaze, no chips.',
  condition: 'Used', aspects: [{ n: 'Brand', v: 'Royal Haeger' }], url: U, seller: { pct: 99.8, n: 12345 } };

function open(item, gate) {
  const fetchImpl = (u) => {
    const s = String(u);
    if (/\/hunt\?q=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PICKS) });
    if (/\/item\?url=/.test(s)) return (gate || Promise.resolve()).then(() => ({ ok: true, status: 200, json: () => Promise.resolve(item || ITEM) }));
    if (/\/ebay\?/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: LIVE }), text: () => Promise.resolve('') });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['haeger panther'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } } });
}
const cell = (p, u) => p.$(`.sgw-cell:not(.fl-card)[data-u="${u}"]`);
async function popup(p, item) {
  const c = await waitFor(() => cell(p, U), { timeout: 8000 });
  c.querySelector('.sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB .pp-sec'));
  await tick(40);
}

test('a result that is one of the Best picks says so; the others do not', async () => {
  const p = open();
  const pick = await waitFor(() => { const c = cell(p, U); return c && c.classList.contains('is-pick') && c; }, { timeout: 8000 });
  assert.ok(pick);
  assert.equal(cell(p, U2).classList.contains('is-pick'), false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('eBay feedback shows under the price: one star, the percentage and the count, no seller name', async () => {
  const p = open();
  const c = await waitFor(() => cell(p, U), { timeout: 8000 });
  const r = c.querySelector('.sgw-card .sgw-r');
  assert.ok(r, 'the stars line');
  assert.equal(r.textContent, '\u2605 99.8% (12k)');
  assert.equal(r.getAttribute('aria-label'), 'Seller 99.8% positive from 12345 ratings');
  assert.ok(r.previousElementSibling.classList.contains('sgw-p'), 'right under the price');
  assert.equal(cell(p, U2).querySelector('.sgw-r'), null, 'no feedback, no line');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the popup: stars under the price, Item details open, Price check closed, and the details arriving keep what was opened', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = open(null, gate);
  const c = await waitFor(() => cell(p, U), { timeout: 8000 });
  c.querySelector('.sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const b = p.$('#otp-sheetB');
  const first = await waitFor(() => b.querySelector('details.pp-sec[data-sec="price"]'));
  assert.equal(first.open, false, 'Price check starts closed');
  assert.equal(b.querySelector('.pp-r').textContent, '\u2605 99.8% (12k)', 'the card\'s stars before the details arrive');
  first.open = true;
  release();
  await waitFor(() => b.querySelector('details.pp-sec[data-sec="det"]'));
  await tick(40);
  const secs = [...b.querySelectorAll('details.pp-sec')];
  assert.deepEqual(secs.map((d) => d.querySelector('summary').textContent), ['Item details', 'Price check']);
  assert.equal(secs[0].open, true, 'Item details start open');
  assert.ok(secs[0].querySelector('.pp-asp') && secs[0].querySelector('#otp-ppd'), 'specifics and description inside');
  assert.equal(secs[1].open, true, 'Price check stays open across the repaint');
  assert.ok(secs[1].querySelector('.pp-sold'), 'What it sold for inside');
  assert.equal(b.querySelector('.pp-r').textContent, '\u2605 99.8% (12k)');
  assert.ok(b.querySelector('.pp-dock .pp-go'), 'View on eBay stays pinned outside the sections');
  assert.equal(b.querySelector('.pp-dock').closest('details'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Etsy shop reviews: five stars filled to the average, with the count', async () => {
  const p = open({ ...ITEM, seller: { stars: 4.9, n: 312 } });
  await popup(p);
  const r = p.$('#otp-sheetB .pp-r');
  assert.equal(r.getAttribute('aria-label'), 'Shop rated 4.9 out of 5 from 312 reviews');
  assert.equal(r.querySelector('.slr-s i').style.width, '98%');
  assert.equal(r.querySelector('.slr-n').textContent, '(312)');
  assert.deepEqual(p.errors, []);
  await p.close();
});

function pageFns(names) {
  const src = names.map((n) => { const i = HTML.indexOf('function ' + n + '('); return HTML.slice(i, HTML.indexOf('\n}', i) + 2); }).join('\n');
  return new Function(src + '\nreturn {' + names.join(',') + '};')();
}

test('slrHtml and slrClean: counts read short, bad numbers show nothing', () => {
  const { slrN, slrHtml, slrClean } = pageFns(['slrN', 'slrHtml', 'slrClean']);
  assert.equal(slrN(999), '999');
  assert.equal(slrN(1234), '1.2k');
  assert.equal(slrN(45678), '46k');
  assert.equal(slrN(2345678), '2.3m');
  assert.equal(slrHtml(null, 'x'), '');
  assert.equal(slrHtml({ pct: 'abc' }, 'x'), '');
  assert.equal(slrHtml({ pct: 120 }, 'x'), '');
  assert.equal(slrHtml({ stars: 9, n: 3 }, 'x'), '');
  assert.match(slrHtml({ pct: 100, n: 0 }, 'x'), /100%<\/div>$/, 'no count, no brackets');
  assert.deepEqual(slrClean({ pct: 99.8, n: 12345, name: 'panther_lady' }), { pct: 99.8, n: 12345 }, 'numbers only');
  assert.deepEqual(slrClean({ stars: 4.9, n: '312' }), { stars: 4.9, n: 312 });
  assert.equal(slrClean({ pct: '<b>' }), undefined);
  assert.equal(slrClean('99%'), undefined);
  assert.equal(slrClean(null), undefined);
});

test('the look: calm card titles, outlined tags, Best pick and the sections are styled in the main stylesheet', () => {
  const css = HTML.slice(HTML.indexOf('<style id="prowl-css">'), HTML.indexOf('</style>', HTML.indexOf('<style id="prowl-css">')));
  assert.match(css, /\.sgw-cell:not\(\.lk-cell\)>\.sgw-card \.sgw-t\{[^}]*text-transform:none/);
  assert.match(css, /\.sgw-cell:not\(\.lk-cell\)>\.sgw-card\{[^}]*text-align:center/);
  assert.match(css, /\.fl-newb,[^{]*\.sale-off\{background:transparent;border:1\.5px solid var\(--ac\)/);
  assert.match(css, /\.is-pick:not\(\.fl-card\):not\(\.lk-cell\)::before\{content:'Best pick'/);
  assert.match(css, /\.pp-sec\[open\]>summary::after\{content:'\\2212'\}/);
  assert.match(HTML, /var PROWL_VERSION='v7\.26';/);
});
