// Page v6.90: Near me takes Facebook USA's spot under the search box (Hunt · Search All · Near me). It does what the
// dock's LOCAL does; Facebook USA is still on the results, as "Facebook Marketplace · search X in N cities".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const hosts = (p) => p.$$('#otp-res a.hit').map((a) => new URL(a.href).hostname.replace(/^www\./, ''));

test('the row under the search box is Hunt and Near me (v7.03: Search All folded into Hunt)', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  assert.deepEqual(p.$$('#otp-sf > button.b').filter((b) => !b.hidden).map((b) => b.textContent.replace(/[^A-Za-z ]/g, '').trim()), ['Hunt', 'Near me']);
  assert.equal(p.$('#otp-fb'), null, 'Facebook USA left the row');
  assert.ok(p.$('#otp-localBtn'), 'the dock keeps LOCAL');
  assert.doesNotMatch(PAGE, /\.b\.fb[{:]/, 'its styles went with it');
  await p.close();
});

test('Near me with a hunt searches only the city-aware sites', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  p.$('#otp-q').value = 'Pyrex Butterprint';
  p.$('#otp-near').click();
  await tick(30);
  const h = hosts(p);
  assert.ok(h.length >= 4, 'rows: ' + h.join(', '));
  for (const x of h) assert.match(x, /facebook|craigslist|offerup|estatesales|ctbids/, x);
  assert.ok(p.$('#otp-localBtn').classList.contains('on'), "the dock's LOCAL lights up for its run");
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Near me with no hunt opens Den > Local', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  p.$('#otp-near').click();
  await tick(30);
  assert.equal(p.$('#otp-den').hidden, false);
  assert.equal(p.$('#otp-denLocal').hidden, false);
  assert.equal(p.$('#otp-res a.hit'), null, 'no run');
  assert.deepEqual(p.errors, []);
  await p.close();
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
