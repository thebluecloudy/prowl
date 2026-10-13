// Page v6.98: Share in Flock sends the find's photo too (Matt, 2026-10-13: "can it send a picture too?"). The worker
// hands the photo over (/img); the link rides in the text. No photo, a phone that cannot share files, or a slow photo:
// the link alone, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const IMG = 'https://i.ebayimg.com/images/g/abc/s-l1600.jpg';
const FIND = { title: 'Royal Haeger panther 26 inch', price: '$450.00', url: 'https://www.ebay.com/itm/960012796319', image: IMG, src: 'ebay', hunt: 'panther', at: 1 };

async function openSaved(img) {
  const f = liveFetch(), H = { calls: [], img };
  const impl = (url) => {
    const s = String(url);
    if (/\/img\?u=/.test(s)) {
      H.calls.push(s);
      if (H.img === 'fail') return Promise.resolve({ ok: false, status: 415, blob: () => Promise.reject(new Error('no')) });
      return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new H.win.Blob(['jpegbytes'], { type: 'image/jpeg' })) });
    }
    return f.impl(url);
  };
  const p = loadPage({ fetchImpl: impl, storage: { 'prowl.finds': [FIND] } });
  H.win = p.win;
  await tick(50);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  await tick(20);
  return { p, H };
}
function phone(p, canFiles) {
  const got = [];
  Object.defineProperty(p.win.navigator, 'share', { value: (d) => { got.push(d); return Promise.resolve(); }, configurable: true });
  Object.defineProperty(p.win.navigator, 'canShare', { value: (d) => !!(canFiles && d && d.files && d.files.length), configurable: true });
  return got;
}

test('Share sends the photo, with the site, title, price, link and one plain line about Prowl', async () => {
  const { p, H } = await openSaved();
  const got = phone(p, true);
  p.$('#otp-flockRow .fl-card .fl-sh').click();
  await tick(40);
  assert.equal(H.calls.length, 1);
  assert.equal(H.calls[0], 'https://prowl.thebluecloud.workers.dev/img?u=' + encodeURIComponent(IMG));
  assert.equal(got.length, 1);
  assert.equal(got[0].files.length, 1);
  assert.equal(got[0].files[0].name, 'prowl-find.jpg');
  assert.equal(got[0].files[0].type, 'image/jpeg');
  assert.equal(got[0].text, 'Found this on eBay: Royal Haeger panther 26 inch · $450.00\nhttps://www.ebay.com/itm/960012796319\n\nFound with Prowl, a vintage search tool from Owl & Twig Vintage');
  assert.doesNotMatch(got[0].text, /via Prowl/, 'v6.98: reads like a person passing on a find, not an ad');
  /* a second share of the same find does not fetch the photo again */
  p.$('#otp-flockRow .fl-card .fl-sh').click();
  await tick(20);
  assert.equal(H.calls.length, 1);
  assert.equal(got.length, 2);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a phone that cannot share files gets the link, as before', async () => {
  const { p } = await openSaved();
  const got = phone(p, false);
  p.$('#otp-flockRow .fl-card .fl-sh').click();
  await tick(40);
  assert.equal(got.length, 1);
  assert.equal(got[0].files, undefined);
  assert.equal(got[0].url, FIND.url);
  assert.equal(got[0].text, 'Found this on eBay: Royal Haeger panther 26 inch · $450.00\n\nFound with Prowl, a vintage search tool from Owl & Twig Vintage');
  await p.close();
});

test('no photo to be had: the link alone', async () => {
  const { p } = await openSaved('fail');
  const got = phone(p, true);
  p.$('#otp-flockRow .fl-card .fl-sh').click();
  await tick(40);
  assert.equal(got.length, 1);
  assert.equal(got[0].url, FIND.url);
  assert.equal(got[0].files, undefined);
  await p.close();
});

test('the listing popup (hunts, Likes, any card that opens it) has Share this find, with the photo', async () => {
  const H = { calls: [] };
  const fetchImpl = (url) => {
    const s = String(url);
    if (/\/img\?u=/.test(s)) { H.calls.push(s); return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(new H.win.Blob(['x'], { type: 'image/jpeg' })) }); }
    if (/\/item\?url=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ title: 'Vintage Thermos Garfield Yellow Lunch Box', price: '$12.99', images: ['https://shopgoodwillimages.azureedge.net/g1.jpg'] }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  H.win = p.win;
  await tick(60);
  const got = phone(p, true);
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', 'https://shopgoodwill.com/item/246810');
  cell.innerHTML = '<a class="sgw-card" href="#"><img alt=""></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  cell.querySelector('a').click();
  await tick(60);
  const btn = p.$('#otp-sheetB [data-ppshare]');
  assert.ok(btn, 'Share this find is in the popup');
  assert.equal(btn.textContent, 'Share this find');
  btn.click();
  await tick(40);
  assert.equal(H.calls[0], 'https://prowl.thebluecloud.workers.dev/img?u=' + encodeURIComponent('https://shopgoodwillimages.azureedge.net/g1.jpg'));
  assert.equal(got.length, 1);
  assert.equal(got[0].files.length, 1);
  assert.equal(got[0].text, 'Found this on ShopGoodwill: Vintage Thermos Garfield Yellow Lunch Box · $12.99\nhttps://shopgoodwill.com/item/246810\n\nFound with Prowl, a vintage search tool from Owl & Twig Vintage');
  assert.deepEqual(p.errors, []);
  await p.close();
});
