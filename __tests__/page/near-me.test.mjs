// Page v6.90: Near me takes Facebook USA's spot under the search box (Hunt · Search All · Near me). It does what the
// dock's LOCAL does; Facebook USA is still on the results, as "Facebook Marketplace · search X in N cities".
// v7.09: both open Den > Local's Maps links (stores near you) instead of a marketplace run.
// v7.30: Near me is the dock tab (NEAR ME) and its own screen; the chip under the search box is Just ShopGoodwill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const hosts = (p) => p.$$('#otp-res a.hit').map((a) => new URL(a.href).hostname.replace(/^www\./, ''));

test('the row under the search box is Hunt and Just ShopGoodwill (v7.30: Near me moved to the dock)', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  assert.deepEqual(p.$$('#otp-sf > button.b').filter((b) => !b.hidden).map((b) => b.textContent.replace(/[^A-Za-z ]/g, '').trim()), ['Hunt', 'Just ShopGoodwill']);
  assert.equal(p.$('#otp-fb'), null, 'Facebook USA left the row');
  assert.equal(p.$('#otp-localBtn span').textContent, 'NEAR ME', 'the dock\'s Near me');
  assert.doesNotMatch(PAGE, /\.b\.fb[{:]/, 'its styles went with it');
  await p.close();
});

test('v7.09: the dock\'s Near me opens the Maps links for stores near you, with or without a hunt', async () => {
  for (const [typed, btn] of [['Pyrex Butterprint', '#otp-localBtn'], ['', '#otp-localBtn']]) {
    const p = loadPage({ storage: DEN });
    await tick(30);
    p.$('#otp-q').value = typed;
    p.$(btn).click();
    await tick(120);
    assert.equal(p.$('#otp-near').hidden, false, btn + ' ' + typed);   /* v7.36: Near me's own screen */
    assert.equal(p.$('#otp-den').hidden, true, 'not through the Den');
    assert.equal(p.$('#otp-denLocal').hidden, false);
    const links = p.$$('#otp-nearGrid a.nearc');
    assert.ok(links.length >= 8, 'store types: ' + links.length);
    for (const a of links) assert.match(a.href, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=.+near%20me$/, a.href);
    assert.equal(p.$('#otp-res a.hit'), null, 'no marketplace run');
    assert.deepEqual(p.errors, []);
    await p.close();
  }
});

test('Facebook USA is still one tap away on the results', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  p.$('#otp-q').value = 'Blenko decanter';
  p.$('#otp-sa').click();
  await tick(30);
  const fb = p.$('#otp-fbAll');
  assert.ok(fb, 'the results offer Facebook in every city');
  fb.click();
  await tick(30);
  const h = hosts(p);
  assert.ok(h.length > 5, 'many cities: ' + h.length);
  for (const x of h) assert.match(x, /facebook/, x);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the page says v6.90 or later', () => {
  const m = /var PROWL_VERSION='v(\d+)\.(\d+)';/.exec(PAGE), v = m && [m[0], Number(m[1]) * 100 + Number(m[2]) - 600];   // v7.00 reads as 100, so v6.xx floors still hold
  assert.ok(v && Number(v[1]) >= 90);
});
