// Page v8.38 (worker v210): live Shopify listings in the hunt, from GET /shop-live (Shopify's Global Catalog through the
// worker). A "Live from Shopify stores" strip of the usual cards: photo (Shopify's CDN only), title, price, the shop's
// name, a link that opens the product on its store in a new tab (rel noopener), as the worker gave it. Only the hunt is
// sent (no sign-in headers). Hidden for the visit when the worker says { off: true }; nothing on a failed ask; an empty
// answer says why. For everyone (no Pro). The new script is ES5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const HTML = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const LIVE = {
  on: true, term: 'ceramic panther',
  items: [
    { title: 'Black Ceramic Panther TV Lamp', price: 59, currency: 'USD', img: 'https://cdn.shopify.com/s/files/1/0001/lamp.jpg', shop: 'Debra Hall Lifestyle', url: 'https://debrahalllifestyle.com/products/panther?variant=1&_gsid=x', secondhand: true },
    { title: 'Ceramic panther planter', price: 1250.5, currency: 'USD', img: 'https://evil.example/x.jpg', shop: 'Mod Shop', url: 'https://modshop.example/products/planter' },
    { title: 'Not a link', price: 5, currency: 'USD', url: 'javascript:alert(1)' },
    { title: 'Ceramic panther, ours', price: 80, currency: 'USD', url: 'https://www.owlandtwigvintage.com/products/panther' },
  ],
};
function shopFetch(answer) {
  const base = liveFetch({}), asked = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/shop-live') {
      asked.push({ term: u.searchParams.get('term'), max: u.searchParams.get('max'), h: opts.headers || {} });
      const a = typeof answer === 'function' ? answer(asked.length) : answer;
      if (typeof a === 'number') return Promise.resolve({ ok: false, status: a, json: () => Promise.resolve({ on: true, error: 'x', items: [] }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) });
    }
    return base.impl(url, opts);
  };
  return { impl, asked };
}
const SIGNED = { 'prowl.alertPro': '1', 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'pro@example.com' };
async function home(f, storage = {}, hunts = ['ceramic panther'], lock = [0]) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts, lock }, owlTwigSgwTerms: [], ...storage } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  return p;
}
const strip = (p) => p.$$('#otp-sgw .sgw-sub').find((s) => /Live from Shopify stores/.test(s.textContent));

test('the strip: Shopify cards with photo, title, price, shop name and a new-tab noopener link to the product', async () => {
  const f = shopFetch(LIVE);
  const p = await home(f, SIGNED);
  await waitFor(() => strip(p));
  assert.equal(f.asked[0].term, 'ceramic panther');
  assert.equal(f.asked[0].max, '12');
  assert.deepEqual(Object.keys(f.asked[0].h), [], 'no sign-in or member headers go with it');
  const head = strip(p);
  assert.match(head.textContent, /2 live now/);
  const cards = [...head.nextElementSibling.querySelectorAll('.sgw-cell')];
  assert.equal(cards.length, 2, 'the javascript: link and Owl & Twig’s own product are dropped');
  const a = cards[0].querySelector('a.sgw-card');
  assert.equal(a.getAttribute('href'), 'https://debrahalllifestyle.com/products/panther?variant=1&_gsid=x', 'the product link as Shopify gave it');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.match(a.getAttribute('rel'), /\bnoopener\b/);
  assert.equal(cards[0].querySelector('img').getAttribute('src'), 'https://cdn.shopify.com/s/files/1/0001/lamp.jpg');
  assert.equal(cards[0].querySelector('.sgw-t').textContent, 'Black Ceramic Panther TV Lamp');
  assert.equal(cards[0].querySelector('.sgw-p').textContent, '$59');
  assert.match(cards[0].querySelector('.sgw-m').textContent, /^Shopify · Debra Hall Lifestyle/);
  assert.equal(cards[0].getAttribute('data-s'), 'shopify');
  assert.equal(cards[1].querySelector('.sgw-p').textContent, '$1,250.50');
  assert.equal(cards[1].querySelector('img').getAttribute('src'), null, 'a photo off Shopify’s CDN is not shown');
  const jump = p.$$('#otp-sgw .lv-j').map((b) => b.textContent);
  assert.ok(jump.indexOf('Shopify 2') !== -1, jump.join('|'));
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('for everyone: a visitor who is not signed in gets the strip too', async () => {
  const f = shopFetch(LIVE);
  const p = await home(f);
  await waitFor(() => strip(p));
  assert.equal(f.asked.length, 1);
  await p.close();
});

test('the worker says off: no strip, and it is not asked again this visit', async () => {
  const f = shopFetch({ off: true });
  const p = await home(f, {}, ['ceramic panther', 'fire king'], [0, 1]);
  await waitFor(() => f.asked.length > 0);
  await tick(300);
  assert.equal(strip(p), undefined);
  assert.equal(p.$('.sgw-shp'), null);
  const chip = p.$$('#otp-sgw .sgw-chip, #otp-sgw [data-sgwt]').find((b) => /fire king/i.test(b.textContent));
  assert.ok(chip, 'the second hunt’s chip');
  chip.click();
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').some((c) => /fire king/i.test(c.getAttribute('data-t') || '')), { timeout: 8000 });
  await tick(300);
  assert.equal(f.asked.length, 1, 'off holds for the visit');
  await p.close();
});

test('a failed ask (500, 429, unreadable) shows nothing but a busy note for 429; an empty answer says why', async () => {
  for (const [st, want] of [[500, null], [429, /busy right now/]]) {
    const f = shopFetch(st);
    const p = await home(f);
    await waitFor(() => f.asked.length > 0);
    await tick(300);
    if (want) { await waitFor(() => strip(p)); assert.match(strip(p).parentNode.textContent, want); }
    else assert.equal(strip(p), undefined, String(st));
    await p.close();
  }
  const e1 = shopFetch({ on: true, term: 'ceramic panther', items: [], why: { raw: 7, words: 0, own: 0 } });
  const p1 = await home(e1);
  await waitFor(() => strip(p1));
  assert.match(strip(p1).nextElementSibling.textContent, /Shopify stores had 7 for this hunt, none with all your words\. Try fewer words\./);
  await p1.close();
  const e2 = shopFetch({ on: true, term: 'ceramic panther', items: [], why: { raw: 0, words: 0, own: 0 } });
  const p2 = await home(e2);
  await waitFor(() => strip(p2));
  assert.match(strip(p2).nextElementSibling.textContent, /Nothing on Shopify stores for this hunt right now\./);
  await p2.close();
});

test('an answer without on: true (an older worker) shows nothing', async () => {
  const f = shopFetch({ items: LIVE.items });
  const p = await home(f);
  await waitFor(() => f.asked.length > 0);
  await tick(300);
  assert.equal(strip(p), undefined);
  await p.close();
});

test('the new script is ES5 and has no Liquid openers', () => {
  const i = HTML.indexOf('var SHP={cache:'), j = HTML.indexOf('/* v8.27 (worker v203): a Pro member picks', i);
  assert.ok(i > 0 && j > i);
  const src = HTML.slice(i, j);
  assert.doesNotMatch(src, /\b(let|const|class)\s|=>|`|\?\.|\basync\b|\bawait\b/);
  assert.doesNotMatch(src, /\{%|\{\{/);
  assert.match(HTML, /var PROWL_VERSION='v8\.38';/);
});
