// Page v8.39 / worker v211 (Matt: "add a check for chairish images in the popup, i only see one image"): a Chairish
// card opens the full popup, which asks /item for the listing and shows every photo the worker sends (the JSON-LD
// gallery), with thumbnails. Poshmark and other sites without a reader still open as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const CH = 'https://www.chairish.com/product/20217247/mid-century-lucite-lamp';
const finds = [
  { title: 'Mid-Century Lucite Lamp', price: '$745.00', url: CH, image: 'https://chairish-prod.freetls.fastly.net/image/product/sized/1e54f962-cd79-4cee-8224-04e84f0dcca5/x?aspect=fit&width=320&height=320', src: 'chairish', hunt: 'lucite lamp', at: 1 },
  { title: 'Poshmark lamp', price: '$80.00', url: 'https://poshmark.com/listing/lamp-65a1b2c3d4e5f6a7b8c9d0e1', image: 'https://img.example/d.jpg', src: 'poshmark', hunt: 'lamp', at: 0 },
];
const photo = (i) => 'https://chairish-prod.freetls.fastly.net/image/product/sized/0000000' + i + '-0000-4000-8000-000000000000/mid-century-lucite-lamp-' + i + '?aspect=fit&width=1600&height=1600';
const ITEM = { src: 'chairish', id: '20217247', title: 'Mid-Century Lucite Lamp', price: '$745.00', images: [1, 2, 3, 4, 5, 6, 7, 8].map(photo),
  description: 'A fabulous geometric mid-century modern lucite lamp.', condition: 'Used', aspects: [{ n: 'Materials', v: 'Lucite/Metal' }], url: CH };

function setup() {
  const calls = [];
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/item') { calls.push(u.searchParams.get('url')); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ITEM) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.finds': finds, 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' } });
  p.calls = calls;
  return p;
}
const card = (p, host) => p.$(`#otp-flockRow .fl-card[data-u*="${host}"]`);
function tapBody(p, c) { const e = new p.win.MouseEvent('click', { bubbles: true, cancelable: true }); c.querySelector('.sgw-card img').dispatchEvent(e); return e; }

test('a Chairish card opens the full popup with every photo of the listing', async () => {
  const p = setup();
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  const e = tapBody(p, card(p, 'chairish.com'));
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.$('#otp-sheetT').textContent, 'Chairish');
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 8);
  assert.equal(p.$$('#otp-sheetB .pp-thumbs button').length, 8);
  assert.equal(p.$('#otp-sheetB .pp-gal img').getAttribute('src'), photo(1));
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /View on Chairish/);
  assert.deepEqual(p.calls, [CH]);
  assert.equal(tapBody(p, card(p, 'poshmark.com')).defaultPrevented, false, 'Poshmark (no reader) opens the listing as before');
  assert.deepEqual(p.calls, [CH]);
  await p.close();
});
