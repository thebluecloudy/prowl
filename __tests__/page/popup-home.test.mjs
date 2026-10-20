// Page v6.45: the listing popup opens from result cards outside Flock too (home hunts, Daily),
// and the phone header keeps "Hi, name" out of the way of Log out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const ITEM = { src: 'ebay', id: '1234567890', title: 'Haeger Black Panther TV Lamp', price: '$45.00',
  images: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg', 'https://i.ebayimg.com/3.jpg', 'https://i.ebayimg.com/4.jpg'],
  description: '<p>Glossy glaze</p>', url: 'https://www.ebay.com/itm/1234567890' };

// live results: eBay listings with real-looking ids, Etsy listings (no popup), nothing else
function setup(extra = {}) {
  const items = [];
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/item') { items.push(u.searchParams.get('url')); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ITEM) }); }
    const q = u.searchParams.get('q') || 'x';
    let list = [];
    if (u.pathname === '/ebay') list = [0, 1, 2].map((i) => ({ title: q + ' ebay ' + i, price: '$4' + i + '.00', url: 'https://www.ebay.com/itm/123456789' + i, image: 'https://i.ebayimg.com/t' + i + '.jpg', src: 'ebay' }));
    if (u.pathname === '/etsy') list = [0, 1].map((i) => ({ title: q + ' etsy ' + i, price: '$2' + i + '.00', url: 'https://www.etsy.com/listing/155000000' + i + '/x', image: 'https://img.example/e' + i + '.jpg', src: 'etsy' }));
    if (u.pathname === '/chairish') list = [{ title: q + ' chairish', price: '$80.00', url: 'https://www.chairish.com/product/123456/x', image: 'https://img.example/c.jpg', src: 'chairish' }];
    if (u.pathname === '/') list = [{ title: q + ' sgw', price: '$9.00', url: 'https://shopgoodwill.com/item/27898707', image: 'https://img.example/g.jpg', src: '', bids: 3, time_left: '2d 4h' }];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: list }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { hunts: [] }, owlTwigSgwTerms: ['panther', 'hull pottery'], ...extra } });
  p.items = items;
  return p;
}
const homeCell = (p, host) => p.$$('.sgw-cell').find((c) => !c.closest('.fl-card') && (c.getAttribute('data-u') || '').indexOf(host) > -1);
function tap(p, cell, init = {}) {
  const e = new p.win.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  cell.querySelector('.sgw-card img').dispatchEvent(e);
  return e;
}
const sheetOpen = (p) => !p.$('#otp-sheet').hidden;

test('tapping an eBay result on the home screen opens the popup with every photo, not the listing', async () => {
  const p = setup();
  const cell = await waitFor(() => homeCell(p, 'ebay.com/itm/'));
  const e = tap(p, cell);
  assert.equal(e.defaultPrevented, true, 'the listing does not open');
  assert.ok(sheetOpen(p));
  assert.ok(p.$('#otp-sheet').classList.contains('pop'));
  assert.equal(p.$('#otp-sheetT').textContent, 'eBay');
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 4);
  assert.equal(p.$$('#otp-sheetB .pp-thumbs button').length, 4, 'a thumbnail for every photo');
  assert.deepEqual(p.items, [cell.getAttribute('data-u')]);
  await p.close();
});

test('a ShopGoodwill result opens the popup and shows bids and time left before the details arrive', async () => {
  const p = setup();
  const cell = await waitFor(() => homeCell(p, 'shopgoodwill.com/item/'));
  assert.equal(tap(p, cell).defaultPrevented, true);
  assert.equal(p.$('#otp-sheetT').textContent, 'ShopGoodwill');
  await p.close();
});

test('v6.53: an Etsy result opens the popup too', async () => {
  const p = setup();
  const cell = await waitFor(() => homeCell(p, 'etsy.com'));
  assert.equal(tap(p, cell).defaultPrevented, true);
  assert.equal(p.$('#otp-sheetT').textContent, 'Etsy');
  await waitFor(() => p.items.length);
  assert.match(p.items[0], /^https:\/\/www\.etsy\.com\/listing\/155000000\d\/x$/);
  await p.close();
});

test('v7.31: a site the popup cannot read opens a light popup from the card; modifier clicks still go straight to the listing', async () => {
  const p = setup();
  const ch = await waitFor(() => homeCell(p, 'chairish.com'));
  assert.equal(tap(p, ch).defaultPrevented, true, 'Chairish opens the light popup');
  assert.ok(sheetOpen(p));
  const b = p.$('#otp-sheetB');
  assert.match(b.querySelector('.pp-go').textContent, /View on Chairish/);
  assert.ok(b.querySelector('.pp-sv .sgw-sv'), 'Save this find');
  assert.ok(b.querySelector('.pp-fp .sgw-fp'), 'Fair price?');
  assert.deepEqual(p.items, [], 'nothing fetched: it is drawn from the card');
  await tick(60);   /* the sheet slides in on the next frame; Close before that is a no-op */
  b.querySelector('[data-ppclose]').click();
  await waitFor(() => !sheetOpen(p));
  const eb = homeCell(p, 'ebay.com/itm/');
  assert.equal(tap(p, eb, { ctrlKey: true }).defaultPrevented, false, 'ctrl-click opens a new tab as usual');
  assert.equal(tap(p, eb, { metaKey: true }).defaultPrevented, false);
  assert.ok(!sheetOpen(p));
  assert.deepEqual(p.items, []);
  await p.close();
});

test('v7.31: the heart under a card keeps its own job; Fair price? and Save are in the popup', async () => {
  const p = setup();
  const cell = await waitFor(() => homeCell(p, 'ebay.com/itm/'));
  assert.equal(cell.querySelector('.sgw-fp'), null, 'no Fair price? on the card');
  assert.equal(cell.querySelector('.sgw-sv'), null, 'no star on the card');
  cell.querySelector('.sgw-lk').click();
  assert.ok(!p.$('#otp-sheet').classList.contains('pop'), 'the heart does not open the popup');
  await p.close();
});

test('a Flock card still opens the popup exactly once', async () => {
  // a saved eBay find, so the card is always there (the Feed picks a random mix)
  const p = setup({ 'prowl.finds': [{ title: 'Haeger panther', price: '$45.00', url: 'https://www.ebay.com/itm/1234567890', image: 'https://i.ebayimg.com/a.jpg', src: 'ebay', hunt: 'panther', at: 3 }] });
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  const fc = await waitFor(() => p.$$('#otp-flockRow .fl-card').find((c) => /ebay\.com\/itm\//.test(c.getAttribute('data-u') || '')));
  tap(p, fc);
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 4);
  assert.equal(p.items.length, 1, 'one /item call, not two');
  await p.close();
});

test('the greeting is out of the top bar on every screen (its own line under it, v6.86) and the brand never shrinks', () => {
  assert.match(PAGE, /<\/header>\n<div class="hi" id="otp-hi" hidden><\/div>/);
  assert.ok(!/<header class="bar">[\s\S]*id="otp-hi"[\s\S]*<\/header>/.test(PAGE.slice(PAGE.indexOf('<header class="bar">'), PAGE.indexOf('</header>') + 9)));
  assert.match(PAGE, /\.scout-app-wrapper \.bar \.brand\{flex-shrink:0\}/);
});

test('Den > Settings has an Account row with Log out whenever the header greeting shows', async () => {
  const s = Buffer.from('123.' + (Math.floor(Date.now() / 1000) + 86400) + '.sig').toString('base64url');
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    const body = u.pathname === '/apps/prowl/me' ? { in: true, id: '123', e: 'a@b.co', first: 'Matthew', ts: 1, sig: 'x' } : { items: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co', 'prowl.session': s } });
  const row = p.$('#otp-hiDen');
  await waitFor(() => !row.hidden);
  assert.match(row.textContent, /Signed in to Owl & Twig as Matthew/);
  row.querySelector('[data-hi="out"]').click();
  assert.equal(p.win.localStorage.getItem('prowl.session'), null);
  assert.equal(p.win.localStorage.getItem('prowl.alertTok'), null);
  assert.ok(row.hidden, 'the row goes with the sign-in');
  assert.ok(p.errors.some((e) => /navigation/i.test(String(e.message || e))), 'off to the store logout');
  await p.close();
});
