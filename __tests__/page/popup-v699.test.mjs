import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

/* v6.99: Search this on Prowl, double-tap to like, entities decoded once, a way out in large text */
const finds = [
  { title: 'Haeger pumpkin', price: '$168.95', url: 'https://www.etsy.com/listing/1234567890/pumpkin', image: 'https://img.example/p.jpg', src: 'etsy', hunt: 'haeger', at: 2 },
  { title: 'Keane prints', price: '$800.00', url: 'https://www.ebay.com/itm/123456789012', image: 'https://i.ebayimg.com/k.jpg', src: 'ebay', hunt: 'keane', at: 1 },
];
const ETSY = { src: 'etsy', title: 'Haeger Pumpkin Jack O Lantern Pottery Label Rare Halloween Gardenhouse', price: '$168.95',
  images: ['https://img.example/1.jpg', 'https://img.example/2.jpg'],
  description: '<p>Jack O Lantern retains it&amp;#39;s original foil Label.</p>', aspects: [{ n: 'Shop', v: 'Brightdaisydays' }, { n: 'Made', v: 'before 2007' }],
  url: 'https://www.etsy.com/listing/1234567890/pumpkin' };
const KEANE_T = 'Big Eyes 1962 "No Dogs Allowed" & "The Stray" Margaret Keane MCM Original Prints';
const EBAY = { src: 'ebay', title: KEANE_T, price: '$800.00', images: ['https://i.ebayimg.com/1.jpg'], condition: 'Used',
  description: '<p>Big Eyes 1962 &quot;No Dogs Allowed&quot; &amp; &quot;The Stray&quot; Margaret Keane MCM Original Prints</p>',
  aspects: [{ n: 'Artist', v: 'Margaret Keane' }, { n: 'Year of Production', v: '1962' }], url: 'https://www.ebay.com/itm/123456789012' };

function setup(extra = {}) {
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/item') {
      const it = /etsy/.test(u.searchParams.get('url')) ? ETSY : EBAY;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(it) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return loadPage({ fetchImpl, storage: { 'prowl.finds': finds, 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co', ...extra } });
}
async function openPop(p, host) {
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  const c = p.$(`#otp-flockRow .fl-card[data-u*="${host}"]`);
  c.querySelector('.sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB .pp-close') && p.$('#otp-sheetB .pp-t').textContent.length > 20);
}

test('the pill sits under the price and holds a cleaned title', async () => {
  const p = setup();
  await openPop(p, 'etsy.com');
  const b = p.$('#otp-sheetB .pp-hunt');
  assert.ok(b, 'Search this on Prowl is in the popup');
  assert.match(b.textContent, /Search this on Prowl/);
  const kids = [...p.$('#otp-sheetB').children];
  assert.ok(kids.indexOf(b) > kids.indexOf(p.$('#otp-sheetB .pp-p')), 'below the price');
  assert.ok(kids.indexOf(b) < kids.indexOf(p.$('#otp-sheetB .pp-asp')), 'above the details');
  assert.equal(b.getAttribute('aria-label'), 'Search this on Prowl: Haeger Pumpkin Jack O Lantern Pottery Halloween');
  await p.close();
});

test('the maker from the details goes first; years, quotes and sales words go', async () => {
  const p = setup();
  await openPop(p, 'ebay.com');
  assert.equal(p.$('#otp-sheetB .pp-hunt').getAttribute('aria-label'), 'Search this on Prowl: Margaret Keane Big Eyes No Dogs Allowed');
  await p.close();
});

test('tapping the pill closes the popup and runs the search with the cleaned title', async () => {
  const p = setup();
  await openPop(p, 'etsy.com');
  let ran = '';
  p.$('#otp-sa').addEventListener('click', () => { ran = p.$('#otp-q').value; });
  p.$('#otp-sheetB .pp-hunt').click();
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false, 'popup closed');
  await tick(400);
  assert.equal(ran, 'Haeger Pumpkin Jack O Lantern Pottery Halloween');
  assert.match(p.$('#otp-toast').textContent, /Searching Haeger Pumpkin/);
  await p.close();
});

test('entities left over from the seller are decoded once and stay text', async () => {
  const p = setup();
  await openPop(p, 'etsy.com');
  const d = await waitFor(() => p.$('#otp-ppd'));
  assert.match(d.textContent, /retains it's original/);
  assert.doesNotMatch(d.textContent, /&#39;|&amp;/);
  await p.close();
});

test('a description that only repeats the title is left out', async () => {
  const p = setup();
  await openPop(p, 'ebay.com');
  assert.equal(p.$('#otp-ppd'), null);
  assert.equal(p.$('#otp-sheetB [data-ppmore]'), null);
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, KEANE_T);
  await p.close();
});

test('double-tapping the photo likes the listing once; a single tap does not', async () => {
  const p = setup();
  await openPop(p, 'etsy.com');
  const g = p.$('#otp-sheetB .pp-gal img');
  const tap = () => g.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
  tap();
  await tick(400);
  tap();
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]').length, 0, 'two slow taps are not a like');
  tap(); tap();
  let likes = JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]');
  assert.equal(likes.length, 1);
  assert.equal(likes[0].u, ETSY.url);
  assert.match(p.$('#otp-toast').textContent, /Liked/);
  await tick(400);
  tap(); tap();
  likes = JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]');
  assert.equal(likes.length, 1, 'a second double-tap never un-likes');
  assert.match(p.$('#otp-toast').textContent, /Already liked/);
  await p.close();
});

test('a Close button at the bottom closes the popup', async () => {
  const p = setup();
  await openPop(p, 'ebay.com');
  const kids = [...p.$('#otp-sheetB').children];
  assert.equal(kids[kids.length - 1].className.includes('pp-close'), true, 'last thing in the popup');
  p.$('#otp-sheetB .pp-close').click();
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false);
  await p.close();
});

test('large text tells the CSS its zoom, and the popup height divides by it', async () => {
  const p = setup({ 'prowl.textSize': '2' });
  await tick(40);
  const w = p.$('.scout-app-wrapper');
  assert.equal(w.style.getPropertyValue('--tz'), '1.25');
  const css = p.doc.getElementById('prowl-css').textContent;
  assert.match(css, /\.otp-sheet\.pop\{[^}]*calc\(94dvh \/ var\(--tz,1\)\)/);
  assert.match(css, /\.otp-sheet\{[^}]*calc\(88dvh \/ var\(--tz,1\)\)/);
  assert.match(css, /\.scout-app-wrapper\.tz \.pp-asp\{grid-template-columns:1fr/);
  await p.close();
});
