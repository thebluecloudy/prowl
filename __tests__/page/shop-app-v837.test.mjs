// Page v8.37 (Matt, 2026-11-01: add Shop, Shopify's Shop app, as a hunt marketplace): a link-out in SHOP.
// shop.app/search/results?query=<words> answers 301 to shop.com/search/results?query=<words> (checked 2026-11-01),
// so the link goes straight to shop.com. A saved marketplace set from before v8.37 gains Shop once (h837), like
// Heritage (h21), Mercari Japan (h36), Salvation Army (h42) and CTBids (h68); unticked afterwards it stays off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');

test('Shop is a SHOP marketplace: counted in the total, in the drawer, and Search All links the encoded hunt', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  assert.equal(p.$('.lede [data-t]').textContent, '30', 'the marketplace total');
  assert.equal(p.$('#otp-tb u').textContent, '10', 'BOLO count unchanged');
  p.$('#otp-shw').click();
  const row = p.$('#otp-mk input[data-m="shopapp"]');
  assert.ok(row, 'Shop is in the marketplace drawer');
  assert.equal(row.checked, true, 'on by default');
  assert.equal(row.closest('label').querySelector('em').textContent, 'Shop');
  assert.equal(row.closest('label').querySelector('.tag').textContent, 'SHOP');
  assert.equal(p.$('#otp-dc').textContent, '30 of 30 selected');

  p.$('#otp-q').value = 'Fire-King jadeite & mugs';
  p.$('#otp-sa').click();
  await tick(30);
  const a = p.$$('#otp-res a.hit').find((x) => /shop\.com/.test(x.href));
  assert.ok(a, 'Search All has a Shop row');
  assert.equal(a.getAttribute('href'), 'https://shop.com/search/results?query=Fire-King%20jadeite%20%26%20mugs');
  assert.equal(a.querySelector('.hit-icon').textContent, 'SH');
  assert.ok(!a.querySelector('.hit-icon').classList.contains('loc'), 'an online shop, not local');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a saved marketplace set from before v8.37 gains Shop once; turned off afterwards, it stays off', async () => {
  const saved = { hunts: ['a', 'b'], sel: [], lock: [], mkt: ['ebay', 'etsy'], city: '', seen: true, fbHub: 'local', one: 'shopgoodwill', h21: 1, h36: 1, h42: 1, h68: 1 };
  const saveNow = (p, term) => {
    p.$('#otp-newTerm').value = term; p.$('#otp-addTerm').click();
    return JSON.parse(p.win.localStorage.getItem('prowl.v36'));
  };
  const p = loadPage({ storage: { 'prowl.v36': saved } });
  await tick(40);
  const after = saveNow(p, 'Hull pottery');
  assert.deepEqual(after.hunts, ['a', 'b', 'Hull pottery'], 'the old hunts still load');
  assert.deepEqual(after.mkt.slice().sort(), ['ebay', 'etsy', 'shopapp']);
  assert.equal(after.h837, 1, 'the save says Shop was offered');
  await p.close();
  const p2 = loadPage({ storage: { 'prowl.v36': { ...after, mkt: ['ebay', 'etsy'] } } });
  await tick(40);
  const again = saveNow(p2, 'Fiesta pitcher');
  assert.deepEqual(again.mkt.slice().sort(), ['ebay', 'etsy'], 'unticked after v8.37 stays unticked');
  await p2.close();
});

test('a save with every marketplace on (no mkt list) gets Shop with the rest', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { hunts: ['a'], seen: true, h21: 1, h36: 1, h42: 1, h68: 1 } } });
  await tick(30);
  p.$('#otp-shw').click();
  assert.equal(p.$('#otp-mk input[data-m="shopapp"]').checked, true);
  await p.close();
});

test('Shop is named in the marketplace lists and the not-affiliated line', () => {
  const lists = PAGE.match(/Whatnot, Vinted, Shop, Bonanza/g) || [];
  assert.equal(lists.length, 2, 'the FAQ answer and its JSON-LD');
  assert.match(PAGE, /not affiliated with[^<]*\bShop App\b/);
  assert.ok(!/\b29 (vintage )?marketplaces\b/.test(PAGE), 'no count left at 29');
});
