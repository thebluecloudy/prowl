// Page v7.20 (Matt, 2026-10-18: "is there a way to show ebay aging? how many times it has been listed"): the listing
// popup says when an eBay listing went up and, when eBay made this listing later, that it was relisted (worker v123).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const U = 'https://www.ebay.com/itm/123456789012';
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
function open(item) {
  const fetchImpl = (u) => /\/item\?/.test(String(u))
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign({ src: 'ebay', title: 'Haeger panther', price: '$45.00', images: ['https://i.ebayimg.com/1.jpg'], url: U }, item)) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  return loadPage({ fetchImpl, storage: { 'prowl.finds': [{ title: 'Haeger panther', price: '$45.00', url: U, image: 'https://i.ebayimg.com/1.jpg', src: 'ebay', hunt: 'panther', at: 1 }], 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' } });
}
async function popup(p) {
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  await waitFor(() => p.$('#otp-flockRow .fl-card .sgw-card img'));
  p.$('#otp-flockRow .fl-card .sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB .pp-asp, #otp-sheetB .pp-m'));
  await tick(40);
  return (p.$('#otp-sheetB .pp-m') || {}).textContent || '';
}

test('a recent listing: days ago', async () => {
  const p = open({ listed: day(12), condition: 'Used' });
  assert.match(await popup(p), /Used · Listed 12 days ago/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an old, relisted listing: the first date, how long ago, and the relist', async () => {
  const p = open({ listed: day(200), relisted: day(10) });
  const m = await popup(p);
  assert.match(m, /Listed \w+ \d+ \(7 months ago\), relisted \w+ \d+/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no dates (other sites, or eBay said nothing): no line', async () => {
  const p = open({ condition: 'Used' });
  const m = await popup(p);
  assert.equal(m, 'Used');
  assert.deepEqual(p.errors, []);
  await p.close();
});
