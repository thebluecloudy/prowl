// Page v8.01 (worker v173; Matt: "Do 1 and 2, and trial 3 ... I need something free"). Google Lens named his orange
// cat (Royal Haeger 616) where the other searches could not. Check with Google Lens is a main button; Google Lens's
// own matches (through SerpApi's free plan) show first, eBay, Etsy and Poshmark ones opening the popup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };
const EB = 'https://www.ebay.com/itm/1234567890', GV = 'https://grandviewshop.example.com/cat';
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))), text: () => Promise.resolve(JSON.stringify(j)) });
const LENS = [{ title: 'Vintage Royal Haeger Orange Winking Egyptian Cat 616', url: EB, image: 'https://serpapi.com/t1.jpg', source: 'eBay', price: '$125.00' }, { title: 'Mid Century Royal Haeger cat', url: GV, image: '', source: 'Grandview', price: '' }];
function setup(lens) {
  const fetchImpl = (u) => {
    const url = String(u);
    if (/\/appraise$/.test(url)) return J(Object.assign({ item: 'Royal Haeger 616 orange winking Egyptian cat', fair: '$90-140', basis: 'sold', sure: 'HIGH', search: 'Royal Haeger 616 cat', looks: [{ url: 'https://www.ebay.com/itm/999', title: 'Royal Haeger cat 616', price: '$99', image: 'https://i.ebayimg.com/x.jpg' }] }, lens ? { lens } : {}));
    if (/\/item\?url=/.test(url)) return J({ title: LENS[0].title, price: '$125.00', images: ['https://i.ebayimg.com/a.jpg'], url: EB });
    return J({ items: [] });
  };
  const beforeLoad = (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/1';
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  return loadPage({ storage: DEN, fetchImpl, beforeLoad });
}
async function check(p) {
  await tick(30);
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'piece.jpg', { type: 'image/jpeg' }));
  await waitFor(() => p.$('#otp-aprTray .apr-th'));
  p.$('#otp-aprRun').click();
  await waitFor(() => p.$('#otp-aprOut .apr-card') && !p.$('#otp-aprRun').disabled && !/Checking Poshmark/.test(p.$('#otp-aprOut').textContent), { timeout: 10000 });
  await tick(60);
}

test('Google Lens found: first of the results; an eBay match opens the popup, another shop links out; kept with the check', async () => {
  const p = setup(LENS);
  await check(p);
  const rows = [...p.$$('#otp-aprOut .apr-looks')];
  assert.ok(rows[0].classList.contains('apr-lens'), 'before eBay\'s look-alikes');
  assert.equal(rows[0].querySelector('.apr-lkh').textContent, 'Google Lens found');
  const cards = [...rows[0].querySelectorAll('a.apr-lk')];
  assert.equal(cards.length, 2);
  assert.equal(cards[0].getAttribute('data-u'), EB); assert.equal(cards[0].getAttribute('data-p'), '$125.00'); assert.equal(cards[0].getAttribute('data-m'), 'Found by Google Lens');
  assert.equal(cards[0].querySelector('.apr-lkp').textContent, '$125.00'); assert.equal(cards[0].querySelector('.apr-lkd').textContent, 'eBay');
  assert.equal(cards[1].getAttribute('data-u'), null); assert.equal(cards[1].getAttribute('href'), GV);
  assert.match(rows[0].querySelector('.apr-note').textContent, /prices are asking, not sold/);
  cards[0].click(); await tick(60);
  assert.equal(p.$('#otp-sheet').hidden, false, 'the popup, with Save and Like');
  const kept = JSON.parse(p.win.localStorage.getItem('prowl.photoChecks'));
  assert.deepEqual(kept[0].r.lens.map((x) => x.url), [EB, GV]);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Check with Google Lens is a main button next to Hunt it on Prowl, with how to use what Lens says', async () => {
  const p = setup(null);
  await check(p);
  assert.equal(p.$('#otp-aprOut .apr-lens'), null, 'no Lens matches: no row');
  const links = p.$('#otp-aprOut .apr-links');
  const lb = links.querySelector('.apr-lensb');
  assert.ok(lb, 'the button');
  assert.equal(lb.textContent, 'Check with Google Lens');
  assert.ok(/(^|\s)p(\s|$)/.test(lb.className), 'a main button');
  assert.ok(!lb.closest('details'), 'not under More');
  assert.equal(links.children[0].textContent, 'Hunt it on Prowl');
  assert.equal(links.children[1], lb, 'right after it');
  assert.equal(p.$('#otp-aprOut .apr-lensn').textContent, 'Lens names it? Type that in Maker or words and tap Check again: the same photos are checked again free for 30 minutes.');
  await p.close();
});
