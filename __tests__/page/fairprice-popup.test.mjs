// Page v6.50: Fair price from the listing popup sends what the popup knows (bids, time left, details, description),
// so the worker prices an auction as one. A ShopGoodwill Super Madballs at a $142 bid after 9 bids came back "$16-35".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const U = 'https://shopgoodwill.com/item/278987071';
const finds = [{ title: 'Super Madballs Touchdown Terror Football', price: '$142.00', url: U, image: 'https://img.example/b.jpg', src: '', hunt: 'madballs', at: 2 }];
const ITEM = { src: 'shopgoodwill', id: '278987071', title: 'Super Madballs Touchdown Terror Football Monster Rubber Ball Toy', price: '$142.00',
  images: ['https://img.example/1.jpg'], bids: 9, time_left: '21h 1m', condition: 'Used',
  aspects: [{ n: 'Brand', v: 'AmToy' }], description: '<p>This is a <b>Super Madballs</b> Touchdown Terror Football, 1986.</p>', url: U };

function setup() {
  const sent = [];
  const fetchImpl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/item') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ITEM) });
    if (u.pathname === '/verdict') { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ basis: 'sold', verdict: 'FAIR', item: 'AmToy Super Madballs', fair: '$150-250', why: 'Sold at $180.' }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.finds': finds } });
  p.sent = sent;
  return p;
}

test('Fair price in the popup sends the bids, time left, details and description', async () => {
  const p = setup();
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  p.$('#otp-flockRow .fl-card .sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB .pp-asp'));
  p.$('#otp-sheetB .pp-fp .sgw-fp').click();
  await waitFor(() => p.sent.length);
  const b = p.sent[0];
  assert.equal(b.price, '$142.00');
  assert.match(b.details, /^21h 1m left · 9 bids · Used\. /);
  assert.match(b.details, /Brand: AmToy/);
  assert.match(b.details, /Description: This is a Super Madballs Touchdown Terror Football, 1986\./);
  assert.doesNotMatch(b.details, /</, 'no markup');
  await waitFor(() => p.$('#otp-sheetB .sgw-fpr'));
  assert.match(p.$('#otp-sheetB .sgw-fpr').textContent, /\$150-250/);
  await p.close();
});
