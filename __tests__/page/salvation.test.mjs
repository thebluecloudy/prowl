import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

test('Salvation Army is a marketplace and the counts follow (29 since CTBids, page v6.68)', async () => {
  const p = loadPage();
  await tick(40);
  const all = p.$('#otp-dock .db[data-m="all"] [data-t]');
  assert.equal(all.textContent, '29');
  assert.ok(p.doc.body.innerHTML.includes('https://shopthesalvationarmy.com/Browse?FullTextQuery='), 'link-out exists');
  assert.ok(/search 29 marketplaces/.test(p.doc.body.innerHTML));
  assert.ok(!/\b2[78] marketplaces\b/.test(p.doc.body.innerHTML));
  await p.close();
});

test('a saved marketplace set from before v6.42 gains Salvation Army once', async () => {
  const saved = { hunts: ['a', 'b'], sel: [], lock: [], mkt: ['ebay', 'etsy'], city: '', seen: true, fbHub: 'local', one: 'shopgoodwill', h21: 1, h36: 1 };
  // adding a hunt saves, so the stored set shows what the page loaded
  const saveNow = (p) => { p.$('#otp-newTerm').value = 'Hull pottery'; p.$('#otp-addTerm').click(); return JSON.parse(p.win.localStorage.getItem('prowl.v36')); };
  const p = loadPage({ storage: { 'prowl.v36': saved } });
  await tick(40);
  const after = saveNow(p);
  assert.deepEqual(after.mkt.sort(), ['ctbids', 'ebay', 'etsy', 'salvation'], 'a save from before v6.42 is also from before CTBids (v6.68)');
  assert.equal(after.h42, 1);
  await p.close();
  const p2 = loadPage({ storage: { 'prowl.v36': { ...saved, mkt: ['ebay'], h42: 1, h68: 1 } } });
  await tick(40);
  assert.deepEqual(saveNow(p2).mkt, ['ebay'], 'turned off stays off');
  await p2.close();
});

test('live Salvation Army results render with the auction details', async () => {
  const calls = [];
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    calls.push(u.pathname);
    const items = u.pathname === '/salvation' ? [{ title: 'Pink Panther plush 1983', price: '$12.00', url: 'https://shopthesalvationarmy.com/Listing/Details/588855451/x', image: 'https://shopsalvationarmyblob.blob.core.windows.net/assets/media/a_fullsize.jpg', src: 'salvation', bids: 3, time_left: '2d 4h' }] : [];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl });
  p.win.confirm = () => true;
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  const card = await waitFor(() => p.$('#otp-flockRow .fl-card[data-u*="shopthesalvationarmy.com"]'), { timeout: 6000 });
  assert.match(card.querySelector('.fl-auc').textContent, /2d 4h · 3 bids/);
  assert.equal(card.querySelector('a').getAttribute('href'), 'https://shopthesalvationarmy.com/Listing/Details/588855451/x', 'clean link, no affiliate wrapping');
  assert.ok(calls.includes('/salvation'));
  await p.close();
});
