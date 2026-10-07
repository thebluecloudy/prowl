import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('page loads without script errors', async () => {
  const p = loadPage();
  await tick(50);
  assert.deepEqual(p.errors.map((e) => String(e.message || e)), []);
  assert.ok(p.$('#otp-dock'));
  await p.close();
});

test('prowlEpn tags eBay links and blocks non-https', async () => {
  const p = loadPage();
  const u = p.win.prowlEpn('https://www.ebay.com/itm/123', 'x');
  assert.match(u, /campid=5339216838/);
  assert.match(u, /customid=x/);
  assert.equal(p.win.prowlEpn('javascript:alert(1)'), '#');
  assert.equal(p.win.prowlEpn('https://www.etsy.com/listing/1'), 'https://www.etsy.com/listing/1');
  await p.close();
});
