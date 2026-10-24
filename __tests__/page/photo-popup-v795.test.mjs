// Page v7.95 (Matt, on Photo check's "Looks like these on eBay" and "Sold on Poshmark" cards: "When I ... click it goes
// straight to eBay. Can we have the pop-up come up and let me save and like as well. As when I search for this on prowl
// it doesn't show up"). A tap on one of those cards opens the listing popup (the full one for eBay, the light one for
// Poshmark), where Save and a new Like button sit side by side. The Like button also un-likes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };   /* signed in: Save asks a visitor to sign in first */
const EB = 'https://www.ebay.com/itm/226512345678';
const PM = 'https://poshmark.com/listing/Royal-Haeger-Black-Panther-65a1b2c3d4e5f6a7b8c9d0e1';
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });

function setup() {
  const items = [];
  const fetchImpl = (u) => {
    const url = String(u);
    if (/\/appraise$/.test(url)) return J({ item: 'Royal Haeger sitting panther', fair: '$55-115', basis: 'asking', sure: 'HIGH', search: 'Royal Haeger panther',
      looks: [{ url: EB, title: 'Rare ROYAL HAEGER Art Deco SITTING SPOTTED Panther', price: '$139.99', image: 'https://i.ebayimg.com/images/g/abc/s-l500.jpg' }] });
    if (/\/poshsold\?/.test(url)) return J({ items: [{ url: PM, title: 'Vintage Royal Haeger black panther', price: '$45', image: 'https://di2ponv0v5otw.cloudfront.net/posts/a.jpg', sold: '2026-10-03' }] });
    if (/\/item\?url=/.test(url)) { items.push(decodeURIComponent(url.split('url=')[1])); return J({ title: 'Rare ROYAL HAEGER Art Deco SITTING SPOTTED Panther', price: '$139.99', images: ['https://i.ebayimg.com/images/g/abc/s-l1600.jpg'], url: EB }); }
    return J({ items: [] });
  };
  const beforeLoad = (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/1';
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  return { p: loadPage({ storage: DEN, fetchImpl, beforeLoad }), items };
}
async function check(p) {
  await tick(30);
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'piece.jpg', { type: 'image/jpeg' }));
  await tick(40);
  p.$('#otp-aprRun').click();
  await tick(150);
}
const sheet = (p) => p.$('#otp-sheet');
const card = (p, u) => p.$$('#otp-aprOut a.apr-lk').find((a) => a.getAttribute('data-u') === u);

test('an eBay look-alike opens the listing popup, not eBay; Save keeps it for the photo\'s search', async () => {
  const { p, items } = setup();
  await check(p);
  const a = card(p, EB);
  assert.ok(a, 'the look-alike card');
  assert.equal(a.getAttribute('data-s'), 'ebay');
  assert.equal(a.getAttribute('data-h'), 'Royal Haeger panther');
  assert.match(a.getAttribute('href'), /^https:\/\/www\.ebay\.com\/itm\/226512345678/, 'still a link for a long-press or a new tab');
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  a.querySelector('img').dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'the tap stays in Prowl');
  await tick(60);
  assert.equal(sheet(p).hidden, false);
  assert.ok(sheet(p).classList.contains('pop'));
  assert.deepEqual(items, [EB], 'the popup reads the listing');
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Rare ROYAL HAEGER Art Deco SITTING SPOTTED Panther');
  assert.equal(p.$('#otp-sheetB .pp-p').textContent, '$139.99');
  p.$('#otp-sheetB .pp-sv .sgw-sv').click();
  await tick(20);
  const f = (ls(p, 'prowl.finds') || []).find((x) => x.url === EB);
  assert.ok(f, 'saved');
  assert.equal(f.hunt, 'Royal Haeger panther');
  assert.equal(f.src, 'ebay');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the popup\'s Like button likes and un-likes; a double-tap like turns it on too', async () => {
  const { p } = setup();
  await check(p);
  card(p, EB).click();
  await tick(60);
  let b = p.$('#otp-sheetB [data-pplike]');
  assert.equal(b.textContent, '♡ Like');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  b.click();
  await tick(10);
  b = p.$('#otp-sheetB [data-pplike]');
  assert.equal(b.textContent, '♥ Liked');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.ok(b.classList.contains('on'));
  assert.equal((ls(p, 'prowl.likes') || [])[0].u, EB);
  b.click();
  await tick(10);
  assert.equal(p.$('#otp-sheetB [data-pplike]').textContent, '♡ Like');
  assert.equal((ls(p, 'prowl.likes') || []).filter((l) => l.u === EB).length, 0, 'un-liked');
  await p.close();
});

test('a Poshmark sale opens the light popup with when it sold; it can be saved and liked', async () => {
  const { p, items } = setup();
  await check(p);
  const a = card(p, PM);
  assert.ok(a, 'the Poshmark card');
  assert.equal(a.getAttribute('data-m'), 'Sold on Poshmark Oct 3, 2026');
  a.click();
  await tick(40);
  assert.equal(sheet(p).hidden, false);
  assert.deepEqual(items, [], 'Poshmark is not read: the card has what the popup shows');
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, 'Vintage Royal Haeger black panther');
  assert.equal(p.$('#otp-sheetB .pp-p').textContent, '$45');
  assert.equal(p.$('#otp-sheetB .pp-m').textContent, 'Sold on Poshmark Oct 3, 2026');
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /View on Poshmark/);
  p.$('#otp-sheetB .pp-sv .sgw-sv').click();
  p.$('#otp-sheetB [data-pplike]').click();
  await tick(10);
  assert.ok((ls(p, 'prowl.finds') || []).some((x) => x.url === PM && x.src === 'poshmark'));
  assert.ok((ls(p, 'prowl.likes') || []).some((l) => l.u === PM));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a click with a modifier key still opens the marketplace', async () => {
  const { p } = setup();
  await check(p);
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  card(p, EB).dispatchEvent(ev);
  await tick(20);
  assert.ok(sheet(p).hidden !== false || !sheet(p).classList.contains('pop'), 'no popup');
  await p.close();
});
