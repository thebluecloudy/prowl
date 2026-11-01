// Page v8.40 (worker v212): the Shopify strip shows off-Shopify offers too (Matt: "i was interested in what is off of
// shopify too"). The strip reads "Live from Shopify and other stores"; an offShopify card says "Other store", every card
// names the shop and its domain; photos from any https host (never http or javascript:). Owl & Twig stays hidden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const LIVE = {
  on: true, term: 'ceramic panther', mode: 'keyless',
  items: [
    { title: 'Ceramic panther planter', price: 45, currency: 'USD', img: 'https://cdn.shopify.com/s/files/1/0001/a.jpg', shop: 'Main Street Estate Sales', domain: 'mainstreetestatesales.com', url: 'https://mainstreetestatesales.com/products/panther', secondhand: true },
    { title: 'Ceramic panther lamp', price: 80, currency: 'USD', img: 'https://img.othershop.example/p.jpg', shop: 'othershop.example', domain: 'othershop.example', url: 'https://othershop.example/listing/panther', secondhand: true, offShopify: true },
    { title: 'Ceramic panther, plain http photo', price: 20, currency: 'USD', img: 'http://insecure.example/p.jpg', shop: 'Insecure', domain: 'insecure.example', url: 'https://insecure.example/p', offShopify: true },
    { title: 'Ceramic panther, ours', price: 80, currency: 'USD', img: 'https://cdn.shopify.com/s/files/1/0001/o.jpg', shop: 'Owl & Twig', domain: 'owlandtwigvintage.com', url: 'https://owlandtwigvintage.com/products/panther' },
  ],
};
function shopFetch(answer) {
  const base = liveFetch({ perSource: 3 });
  return { impl: (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/shop-live') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    return base.impl(url, opts);
  } };
}

test('off-Shopify offers: "Other store", the shop and its domain, any https photo; Owl & Twig hidden', async () => {
  const f = shopFetch(LIVE);
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther'], lock: [0] }, owlTwigSgwTerms: [] } });
  await waitFor(() => p.$$('#otp-sgw .sgw-sub').some((s) => /Live from Shopify and other stores/.test(s.textContent)), { timeout: 8000 });
  const head = p.$$('#otp-sgw .sgw-sub').find((s) => /Live from Shopify and other stores/.test(s.textContent));
  const cards = [...head.nextElementSibling.querySelectorAll('.sgw-cell')];
  assert.equal(cards.length, 3, 'Owl & Twig’s own offer is dropped');
  const meta = cards.map((c) => c.querySelector('.sgw-m').textContent);
  assert.match(meta[0], /^Shopify · Main Street Estate Sales · mainstreetestatesales\.com/);
  assert.match(meta[1], /^Other store · othershop\.example(?! · othershop)/, 'the domain once when it is the shop name');
  assert.equal(cards[1].querySelector('img').getAttribute('src'), 'https://img.othershop.example/p.jpg');
  assert.equal(cards[2].querySelector('img').getAttribute('src'), null, 'no http photo');
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});
