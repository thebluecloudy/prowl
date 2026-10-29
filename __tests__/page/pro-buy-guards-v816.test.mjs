// Page v8.16 (Matt's buy test, 2026-10-29): a Pro member's Upgrade went straight to a second checkout, and a cart that
// already carried another discount code lost the free month without a word (PROWLMONTH combines with nothing).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const opened = [];
after(async () => { for (const p of opened) await p.close(); });
function rig(cart, pro) {
  const calls = [];
  const fetchImpl = (u, o) => {
    const url = String(u), body = o && o.body ? JSON.parse(o.body) : null;
    calls.push({ url, body });
    const j = /cart\.js$/.test(url) ? cart : /alerts\/status/.test(url) ? { on: true, email: 'a@b.co', pro, hadPro: false } : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
  };
  return { calls, fetchImpl };
}
async function upgrade(r, pro) {
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'] }, 'prowl.alertEmail': 'a@b.co', 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertPro': pro ? '1' : '' } });
  opened.push(p);
  await tick(80);
  const link = p.doc.createElement('a'); link.href = '/products/prowl-pro'; p.$('.scout-app-wrapper').appendChild(link);
  link.click();
  await tick(80);
  return p;
}
const adds = (r) => r.calls.filter((c) => /cart\/add\.js$/.test(c.url));
const DECANTER = { items: [{ key: 'k1', variant_id: 111, line_level_discount_allocations: [{ amount: 4372 }] }], cart_level_discount_applications: [] };

test('a Pro member is told they already have Pro, and no checkout starts', async () => {
  const r = rig({ items: [] }, true);
  const p = await upgrade(r, true);
  assert.equal(r.calls.filter((c) => /\/cart/.test(c.url)).length, 0);
  assert.match(p.$('#otp-denSettings .otp-mail').textContent, /You already have Prowl Pro on a@b\.co/);
});

test('another discount code in the cart: a banner explains, nothing is added until Continue anyway', async () => {
  const r = rig(DECANTER, false);
  const p = await upgrade(r, false);
  const ban = p.$('#otp-proBan');
  assert.equal(ban.hidden, false);
  assert.match(ban.textContent, /Your free month needs its own checkout/);
  assert.ok(ban.querySelector('a[href="/cart"]'));
  assert.equal(adds(r).length, 0);
  ban.querySelector('[data-pro="trialgo"]').click();
  await tick(80);
  assert.equal(adds(r).length, 1);
  assert.equal(adds(r)[0].body.items[0].selling_plan, 7674560766);
});

test('a cart with no other code goes straight to checkout as before', async () => {
  const r = rig({ items: [{ key: 'k1', variant_id: 111, line_level_discount_allocations: [] }] }, false);
  const p = await upgrade(r, false);
  assert.equal(adds(r).length, 1);
  assert.ok(p.$('#otp-proBan').hidden || !/own checkout/.test(p.$('#otp-proBan').textContent));
});
