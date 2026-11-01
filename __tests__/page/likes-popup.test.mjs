// Page v6.94: a tap on a liked ShopGoodwill or eBay find in Den > Likes opens the listing popup, as on a result card.
// The popup and the Den are both drawers at the same level, and the Den comes later in the page, so the popup opened
// behind the Den and the tap seemed to do nothing (Matt, 2026-10-12: a Haeger pumpkin). The popup now sits above the
// Den, and closing it leaves the Den with its scrim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const SGW = { u: 'https://shopgoodwill.com/item/123456789', t: 'Haeger Gardenhouse pumpkin jack o lantern', p: '$174.95', s: 'shopgoodwill', i: 'https://shopgoodwillimages.azureedge.net/p.jpg', at: 1 };
const OUT = { u: 'https://poshmark.com/listing/Vintage-Howard-Kron-cats-65a1b2c3d4e5f6a7b8c9d0e1', t: 'Vintage Howard Kron cats', p: '$60.00', s: 'poshmark', i: '', at: 2 };   /* v8.39: Chairish has the popup now */

async function openLikes() {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.likes': [SGW, OUT] } });
  await tick(80);
  p.$('#otp-dock .db[data-m="flock"]').click();   /* v7.91: Likes is in Flock */
  await tick(40);
  p.$('#otp-flock [data-fv="likes"]').click();
  await tick(40);
  return p;
}
const z = (p, el) => Number(p.win.getComputedStyle(el).zIndex) || 0;

test('a liked ShopGoodwill find (eBay, Etsy, Salvation Army too) opens its popup above Flock', async () => {
  const p = await openLikes();
  const cards = p.$$('#otp-denLikes .lk-cell');
  assert.equal(cards.length, 2);
  const a = cards[0].querySelector('a.sgw-card');
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  await tick(40);
  const sheet = p.$('#otp-sheet'), fl = p.$('#otp-flock');
  assert.equal(ev.defaultPrevented, true, 'the popup, not a new tab');
  assert.equal(sheet.hidden, false, 'the popup is open');
  assert.ok(fl.classList.contains('as-feed'), 'over Flock, which stays open (v7.91: Likes is in Flock)');
  assert.ok(z(p, sheet) > z(p, fl), 'and above it (' + z(p, sheet) + ' over ' + z(p, fl) + ')');
  assert.match(p.$('#otp-sheetT').textContent, /ShopGoodwill/i);
  p.$('#otp-sheetClose').click();
  await tick(20);
  assert.ok(fl.classList.contains('as-feed'), 'back in Flock › Likes');
  assert.equal(p.$('#otp-denLikes').hidden, false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a liked find from a site without the popup (Poshmark here) still links straight out', async () => {
  const p = await openLikes();
  const a = p.$$('#otp-denLikes .lk-cell')[1].querySelector('a.sgw-card');
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  await tick(20);
  assert.equal(ev.defaultPrevented, false, 'the link opens the listing');
  assert.match(a.getAttribute('href'), /^https:\/\/poshmark\.com\/listing\/Vintage-Howard-Kron-cats/);
  assert.equal(p.$('#otp-sheet').hidden, true);
  await p.close();
});

test('closing the popup with nothing under it still clears the scrim', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(60);
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', SGW.u);
  cell.setAttribute('data-t', SGW.t);
  cell.innerHTML = '<a class="sgw-card" href="' + SGW.u + '"><img alt=""></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  cell.querySelector('a').click();
  await tick(30);
  assert.equal(p.$('#otp-sheet').hidden, false);
  assert.equal(p.$('#otp-sc').classList.contains('on'), true);
  p.$('#otp-sheetClose').click();
  await tick(20);
  assert.equal(p.$('#otp-sc').classList.contains('on'), false);
  await p.close();
});
