// Page v8.43 / worker v214 (Matt: "when i open a shopify shop, is it possible to do the pop up like the others? it
// currently goes directly to the shop."): a card in the "Live from Shopify and other stores" strip opens the listing
// popup. A Shopify find with its catalog id asks /item?shop=<gid>&url=<card link> (get_product) on every open (Shopify:
// no caching) and shows the photos, the options and an "Open at <shop>" button to the card's own link; an off-Shopify
// card on a site Prowl reads (Etsy) uses that site's reader; any other card opens the light popup from what it knows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const GID = 'gid://shopify/p/3RDkVlpRCyfhbF73HTnfuu';
const SHOP_URL = 'https://mainstreetestatesales.com/products/panther?variant=1&_gsid=abc&utm_source=shopify';
const ETSY = 'https://www.etsy.com/listing/1234567890/ceramic-panther-vase';
const LIVE = {
  on: true, term: 'ceramic panther', mode: 'keyless',
  items: [
    { title: 'Ceramic panther planter', price: 45, currency: 'USD', img: 'https://cdn.shopify.com/s/files/1/0001/a.jpg', shop: 'Main Street Estate Sales', domain: 'mainstreetestatesales.com', url: SHOP_URL, secondhand: true, pid: GID },
    { title: 'Ceramic panther vase', price: 60, currency: 'USD', img: 'https://i.etsystatic.com/x/p.jpg', shop: 'etsy.com', domain: 'etsy.com', url: ETSY, offShopify: true, pid: 'gid://shopify/p/Etsy0000000001' },
    { title: 'Ceramic panther figurine', price: 30, currency: 'USD', img: 'https://di2ponv0v5otw.cloudfront.net/posts/p.jpg', shop: 'poshmark.com', domain: 'poshmark.com', url: 'https://poshmark.com/listing/panther-65a1b2c3d4e5f6a7b8c9d0e1', offShopify: true, pid: 'gid://shopify/p/Posh0000000001' },
    { title: 'Ceramic panther bank, no id', price: 25, currency: 'USD', img: 'https://cdn.shopify.com/s/files/1/0001/b.jpg', shop: 'Corner Shop', domain: 'cornershop.example', url: 'https://cornershop.example/products/bank', pid: 'javascript:alert(1)' },
  ],
};
const photo = (i) => 'https://cdn.shopify.com/s/files/1/0001/panther-' + i + '.jpg';
const ITEM = { src: 'shopify', id: GID, mode: 'keyless', title: 'Ceramic panther planter, 1950s', price: '$45', images: [1, 2, 3, 4, 5].map(photo),
  description: '<p>Glossy black glaze.</p>', condition: 'Used', shop: 'Main Street Estate Sales', domain: 'mainstreetestatesales.com',
  aspects: [{ n: 'Color', v: 'Black, Green (White sold out)' }, { n: 'Shop', v: 'Main Street Estate Sales' }, { n: 'Website', v: 'mainstreetestatesales.com' }] };

function setup(item) {
  const base = liveFetch({ perSource: 3 }), calls = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/shop-live') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(LIVE) });
    if (u.pathname === '/item') {
      calls.push({ shop: u.searchParams.get('shop'), url: u.searchParams.get('url'), cache: opts.cache });
      const j = u.searchParams.get('shop') ? item : { src: 'etsy', title: 'Ceramic panther vase', price: '$60.00', images: ['https://i.etsystatic.com/x/1.jpg', 'https://i.etsystatic.com/x/2.jpg'] };
      return Promise.resolve({ ok: !j.error, status: j.error ? 502 : 200, json: () => Promise.resolve(j) });
    }
    return base.impl(url, opts);
  };
  const p = loadPage({ fetchImpl: impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther'], lock: [0] }, owlTwigSgwTerms: [] } });
  p.calls = calls;
  return p;
}
async function strip(p) {
  await waitFor(() => p.$$('#otp-sgw .sgw-sub').some((s) => /Live from Shopify and other stores/.test(s.textContent)), { timeout: 8000 });
  const head = p.$$('#otp-sgw .sgw-sub').find((s) => /Live from Shopify and other stores/.test(s.textContent));
  return [...head.nextElementSibling.querySelectorAll('.sgw-cell')];
}
function tap(p, cell) { const e = new p.win.MouseEvent('click', { bubbles: true, cancelable: true }); cell.querySelector('.sgw-card img').dispatchEvent(e); return e; }
const closeSheet = (p) => { const b = p.$('#otp-sheetB [data-ppclose]'); if (b) b.click(); };

test('a Shopify find opens the full popup from get_product, with Open at <shop> to the card link', async () => {
  const p = setup(ITEM);
  const cells = await strip(p);
  assert.equal(cells[0].getAttribute('data-gid'), GID);
  assert.equal(cells[3].getAttribute('data-gid'), null, 'a malformed id is dropped');
  const e = tap(p, cells[0]);
  assert.equal(e.defaultPrevented, true, 'no longer straight to the shop');
  assert.equal(p.$('#otp-sheetT').textContent, 'Main Street Estate Sales');
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 5);
  assert.deepEqual(p.calls[0], { shop: GID, url: SHOP_URL, cache: 'no-store' });
  assert.equal(p.$$('#otp-sheetB .pp-thumbs button').length, 5);
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Ceramic panther planter, 1950s');
  assert.equal(p.$('#otp-sheetB .pp-p').textContent, '$45');
  assert.match(p.$('#otp-sheetB .pp-m').textContent, /Used/);
  assert.match(p.$('#otp-sheetB .pp-asp').textContent, /Color.*Black, Green \(White sold out\).*Shop.*Main Street Estate Sales.*Website.*mainstreetestatesales\.com/);
  assert.match(p.$('#otp-sheetB .pp-d').textContent, /Glossy black glaze/);
  const go = p.$('#otp-sheetB .pp-go');
  assert.match(go.textContent, /^Open at Main Street Estate Sales/);
  assert.equal(go.getAttribute('href'), SHOP_URL, 'the link is the card’s, unchanged');
  assert.equal(go.getAttribute('target'), '_blank');
  assert.match(go.getAttribute('rel'), /noopener/);
  closeSheet(p);
  tap(p, cells[0]);
  await waitFor(() => p.calls.length === 2);
  assert.equal(p.calls[1].shop, GID, 'asked again on the next open: nothing is kept (Shopify: no caching)');
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('off-Shopify on Etsy uses the Etsy reader; Poshmark and a card with no id open the light popup; a failed answer keeps the card', async () => {
  const p = setup({ error: 'shopify 503' });
  const cells = await strip(p);
  tap(p, cells[1]);
  await waitFor(() => p.$$('#otp-sheetB .pp-gal img').length === 2);
  assert.deepEqual(p.calls.map((c) => [c.shop, c.url]), [[null, ETSY]], 'the Etsy reader, not get_product');
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /View on Etsy/);
  closeSheet(p);
  const e = tap(p, cells[2]);
  assert.equal(e.defaultPrevented, true, 'Poshmark from the strip: the light popup');
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /^Open at poshmark\.com/);
  assert.equal(p.$('#otp-sheetB .pp-go').getAttribute('href'), LIVE.items[2].url);
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Ceramic panther figurine');
  closeSheet(p);
  tap(p, cells[3]);
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /^Open at Corner Shop/);
  assert.equal(p.$('#otp-sheetB .pp-p').textContent, '$25');
  closeSheet(p);
  tap(p, cells[0]);
  await waitFor(() => p.calls.length === 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Ceramic panther planter', 'a failed get_product leaves the card’s own data');
  assert.equal(p.$('#otp-sheetB .pp-go').getAttribute('href'), SHOP_URL);
  assert.equal(p.calls.length, 2, 'Poshmark and the no-id card never asked /item');
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});
