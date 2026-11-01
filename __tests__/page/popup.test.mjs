import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const finds = [
  { title: 'Haeger panther', price: '$45.00', url: 'https://www.ebay.com/itm/123456789012', image: 'https://i.ebayimg.com/a.jpg', src: 'ebay', hunt: 'panther', at: 3 },
  { title: 'Madballs lot', price: '$12.50', url: 'https://shopgoodwill.com/item/278987071', image: 'https://img.example/b.jpg', src: '', hunt: 'madballs', at: 2 },
  { title: 'Etsy hen', price: '$30.00', url: 'https://www.etsy.com/listing/1234567890/hen', image: 'https://img.example/c.jpg', src: 'etsy', hunt: 'hen', at: 1 },
  { title: 'Poshmark lamp', price: '$80.00', url: 'https://poshmark.com/listing/lamp-65a1b2c3d4e5f6a7b8c9d0e1', image: 'https://img.example/d.jpg', src: 'poshmark', hunt: 'lamp', at: 0 },   /* v8.39: Chairish has the popup now */
];
const EBAY_ITEM = { src: 'ebay', id: '123456789012', title: 'Haeger Black Panther TV Lamp', price: '$45.00', images: ['https://i.ebayimg.com/1.jpg', 'https://i.ebayimg.com/2.jpg', 'https://i.ebayimg.com/3.jpg'],
  description: '<p>Glossy <b>black</b> glaze</p><script>window.__pwned=1</script><img src=x onerror="window.__pwned=2"><p>No chips</p>',
  condition: 'Used', aspects: [{ n: 'Brand', v: 'Haeger' }], url: 'https://www.ebay.com/itm/123456789012', affUrl: 'https://www.ebay.com/itm/123456789012?mkevt=1&campid=5339216838&toolid=10049' };

function setup({ item = EBAY_ITEM, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/item') { calls.push(u.searchParams.get('url')); return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(status === 200 ? item : { error: 'upstream 500' }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.finds': finds, 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' } });
  p.calls = calls;
  return p;
}
async function openSaved(p) {
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
}
const card = (p, host) => p.$(`#otp-flockRow .fl-card[data-u*="${host}"]`);
function tapBody(p, c, init = {}) {
  const e = new p.win.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  c.querySelector('.sgw-card img').dispatchEvent(e);
  return e;
}

test('tapping an eBay card opens the popup at once, then fills in photos, details and description', async () => {
  const p = setup();
  await openSaved(p);
  const e = tapBody(p, card(p, 'ebay.com'));
  assert.equal(e.defaultPrevented, true, 'the listing does not open');
  assert.ok(p.$('#otp-sheet').classList.contains('on') || !p.$('#otp-sheet').hidden);
  assert.equal(p.$('#otp-sheetT').textContent, 'eBay');
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Haeger panther', 'the card title shows straight away');
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 3);
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Haeger Black Panther TV Lamp');
  assert.equal(p.$$('#otp-sheetB .pp-thumbs button').length, 3);
  assert.equal(p.$('#otp-sheetB .pp-asp dd').textContent, 'Haeger');
  const go = p.$('#otp-sheetB .pp-go');
  assert.equal(go.getAttribute('href'), EBAY_ITEM.affUrl, 'View on eBay uses the affiliate URL eBay returned');
  assert.equal(go.textContent, 'View on eBay ↗');
  assert.equal(go.getAttribute('target'), '_blank');
  assert.ok(p.$('#otp-sheetB .pp-fp .sgw-fp'), 'Fair price? is in the popup');
  assert.deepEqual(p.calls, ['https://www.ebay.com/itm/123456789012']);
  await p.close();
});

test('the description is rebuilt from text and a few tags; nothing in it runs', async () => {
  const p = setup();
  await openSaved(p);
  tapBody(p, card(p, 'ebay.com'));
  const d = await waitFor(() => p.$('#otp-ppd'));
  await tick(30);
  assert.equal(p.win.__pwned, undefined);
  assert.equal(d.querySelector('script, img, [onerror]'), null);
  assert.equal(d.querySelector('b').textContent, 'black');
  assert.match(d.textContent, /Glossy black glaze\s*No chips/);
  await p.close();
});

test('the same listing a second time comes from memory', async () => {
  const p = setup();
  await openSaved(p);
  tapBody(p, card(p, 'ebay.com'));
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 3);
  p.$('#otp-sheetClose').click();
  await tick(350);
  tapBody(p, card(p, 'ebay.com'));
  assert.equal(p.$$('#otp-sheetB .pp-gal img').length, 3, 'filled at once');
  assert.equal(p.calls.length, 1);
  await p.close();
});

test('ShopGoodwill opens the popup with a clean outbound link', async () => {
  const p = setup({ item: { src: 'shopgoodwill', id: '278987071', title: 'Madballs lot', price: '$12.50', bids: 7, time_left: '2d 4h', images: ['https://img.example/1.jpg'], description: '', aspects: [], url: 'https://shopgoodwill.com/item/278987071' } });
  await openSaved(p);
  tapBody(p, card(p, 'shopgoodwill.com'));
  await waitFor(() => /2d 4h left/.test((p.$('#otp-sheetB .pp-m') || {}).textContent || ''));
  assert.equal(p.$('#otp-sheetB .pp-m').textContent, '2d 4h left · 7 bids');
  assert.equal(p.$('#otp-sheetB .pp-go').getAttribute('href'), 'https://shopgoodwill.com/item/278987071');
  assert.equal(p.$('#otp-sheetB .pp-thumbs'), null, 'no strip for one photo');
  await p.close();
});

test('an ended listing says so, offers to watch for the next one, and keeps its photos', async () => {
  const p = setup({ item: { ...EBAY_ITEM, gone: true } });
  await openSaved(p);
  tapBody(p, card(p, 'ebay.com'));
  await waitFor(() => p.$('#otp-sheetB .pp-end'));
  assert.match(p.$('#otp-sheetB .pp-end').textContent, /This one got away\.Prowl can watch for the next one\.Watch for the next one/);   // v7.19
  assert.equal(p.$('#otp-sheetB .pp-fp'), null, 'no price check on an ended listing');
  assert.equal(p.$$('#otp-sheetB .pp-gal img').length, 3);
  await p.close();
});

test('if the details cannot load, the card photo and the way out stay', async () => {
  const p = setup({ status: 500 });
  await openSaved(p);
  tapBody(p, card(p, 'ebay.com'));
  await tick(60);
  assert.equal(p.$$('#otp-sheetB .pp-gal img').length, 1);
  assert.match(p.$('#otp-sheetB .pp-go').getAttribute('href'), /^https:\/\/www\.ebay\.com\/itm\/123456789012\?.*campid=5339216838/);
  await p.close();
});

test('v6.53: an Etsy card opens the popup with every photo and View on Etsy', async () => {
  const ETSY = { src: 'etsy', id: '1234567890', title: 'Etsy hen, chalkware', price: '$30.00', images: ['https://i.etsystatic.com/1.jpg', 'https://i.etsystatic.com/2.jpg'],
    description: 'Hand painted.<br>No chips.', condition: '', aspects: [{ n: 'Shop', v: 'OwlFinds' }, { n: 'Made', v: '1950s' }], url: 'https://www.etsy.com/listing/1234567890' };
  const p = setup({ item: ETSY });
  await openSaved(p);
  assert.equal(tapBody(p, card(p, 'etsy.com')).defaultPrevented, true, 'the listing does not open');
  assert.equal(p.$('#otp-sheetT').textContent, 'Etsy');
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 2);
  assert.equal(p.$('#otp-sheetB .pp-asp dd').textContent, 'OwlFinds');
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /View on Etsy/);
  assert.deepEqual(p.calls, ['https://www.etsy.com/listing/1234567890/hen']);
  await p.close();
});

test('other marketplaces and modified clicks open the listing as before', async () => {
  const p = setup();
  await openSaved(p);
  assert.equal(tapBody(p, card(p, 'poshmark.com')).defaultPrevented, false);
  assert.equal(tapBody(p, card(p, 'ebay.com'), { metaKey: true }).defaultPrevented, false);
  assert.equal(p.calls.length, 0);
  await p.close();
});

test('star, discard, share and the price pill keep their own jobs', async () => {
  const p = setup();
  await openSaved(p);
  const c = card(p, 'ebay.com');
  c.querySelector('.sgw-p').click();
  await tick(30);
  assert.equal(p.$('#otp-sheetT').textContent, 'What you’d clear');
  assert.equal(p.calls.length, 0);
  await p.close();
});

test('Escape closes the popup and leaves Flock open', async () => {
  const p = setup();
  await openSaved(p);
  tapBody(p, card(p, 'ebay.com'));
  await tick(30);
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false);
  assert.ok(p.$('#otp-flock').classList.contains('as-feed'));
  await p.close();
});
