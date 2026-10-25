// Page v7.99 (worker v171; Matt: "When Google does an image search it isn't using text it uses similar images can we
// tap into that"). Photo check shows Seen on the web: the best guess and the pages with the same picture. An eBay,
// Etsy or Poshmark page opens the listing popup (Save, Like); any other site opens itself. Kept with the photo check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };
const EB = 'https://www.ebay.com/itm/226512345678', WP = 'https://www.worthpoint.com/worthopedia/haeger-panther-1';
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))), text: () => Promise.resolve(JSON.stringify(j)) });
const WEB = { guess: 'royal haeger panther', pages: [{ url: EB, title: 'Rare ROYAL HAEGER Panther', image: 'https://i.ebayimg.com/a.jpg', host: 'ebay.com' }, { url: WP, title: 'Haeger panther | WorthPoint', image: '', host: 'worthpoint.com' }, { url: 'javascript:alert(1)', title: 'never', host: 'x' }] };
function setup(web, sure) {
  const items = [];
  const fetchImpl = (u) => {
    const url = String(u);
    if (/\/appraise$/.test(url)) return J(Object.assign({ item: 'Royal Haeger sitting panther', fair: '$55-115', basis: 'sold', sure: sure || 'HIGH', search: 'Royal Haeger panther', looks: [] }, web === undefined ? { web: WEB } : web ? { web } : {}));
    if (/\/item\?url=/.test(url)) { items.push(url); return J({ title: 'Rare ROYAL HAEGER Panther', price: '$139.99', images: ['https://i.ebayimg.com/a.jpg'], url: EB }); }
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
  await waitFor(() => p.$('#otp-aprTray .apr-th'));
  p.$('#otp-aprRun').click();
  await waitFor(() => p.$('#otp-aprOut .apr-card') && !p.$('#otp-aprRun').disabled && !/Checking Poshmark/.test(p.$('#otp-aprOut').textContent), { timeout: 10000 });
  await tick(60);
}

test('Seen on the web: the best guess and the pages; an eBay page opens the popup, another site links out', async () => {
  const { p, items } = setup();
  await check(p);
  const box = p.$('#otp-aprOut .apr-web');
  assert.ok(box, 'the row');
  assert.equal(box.querySelector('.apr-lkh').textContent, 'Seen on the web');
  assert.equal(box.querySelector('.apr-wguess').textContent, 'Best guess on the web: royal haeger panther');
  const cards = [...box.querySelectorAll('a.apr-lk')];
  assert.equal(cards.length, 2, 'https pages only');
  assert.equal(cards[0].getAttribute('data-u'), EB); assert.equal(cards[0].getAttribute('data-s'), 'ebay'); assert.equal(cards[0].getAttribute('data-h'), 'Royal Haeger panther');
  assert.equal(cards[0].querySelector('.apr-lkd').textContent, 'ebay.com');
  assert.equal(cards[1].getAttribute('data-u'), null, 'WorthPoint opens itself');
  assert.equal(cards[1].getAttribute('href'), WP);
  assert.equal(cards[1].querySelector('img'), null, 'no picture: none drawn');
  cards[0].click(); await tick(60);
  assert.equal(p.$('#otp-sheet').hidden, false);
  assert.deepEqual(items.length, 1, 'the popup reads the listing');
  assert.ok(p.$('#otp-sheetB .pp-sv .sgw-sv') && p.$('#otp-sheetB [data-pplike]'), 'Save and Like');
  const kept = JSON.parse(p.win.localStorage.getItem('prowl.photoChecks'));
  assert.deepEqual(kept[0].r.web.pages.map((x) => x.url), [EB, WP], 'kept with the photo check');
  assert.equal(kept[0].r.web.guess, 'royal haeger panther');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no web answer (no key, the cap, nothing found): no row', async () => {
  const { p } = setup(null);
  await check(p);
  assert.equal(p.$('#otp-aprOut .apr-web'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

// v8.00 (Matt's orange Haeger cat: no pages, best guess "carving"): what the web sees and look-alike pictures; a guess alone shows nothing
test('no pages: Seen as and pictures that look like it, no one-word guess', async () => {
  const { p } = setup({ guess: 'carving', pages: [], seen: ['Haeger Potteries', 'Cat', 'Ceramic'], alike: ['https://i.etsystatic.com/a.jpg', 'http://bad.example.com/b.jpg', 'https://img.example.org/c.jpg']  }, 'MEDIUM');   /* v8.03: a sure answer leaves these out */
  await check(p);
  const box = p.$('#otp-aprOut .apr-web');
  assert.ok(box);
  assert.equal(box.querySelector('.apr-wguess').textContent, 'Seen as: Haeger Potteries · Cat · Ceramic');
  assert.ok(!/carving/.test(box.textContent), 'the one-word guess is left out without pages');
  assert.equal(box.querySelector('.apr-wsub').textContent, 'Pictures that look like it');
  assert.deepEqual([...box.querySelectorAll('.apr-alike a')].map((a) => a.getAttribute('href')), ['https://i.etsystatic.com/a.jpg', 'https://img.example.org/c.jpg']);
  assert.equal(box.querySelector('.apr-note').textContent, 'Machine labels and look-alike pictures from the web: a hint, not an answer.');
  const kept = JSON.parse(p.win.localStorage.getItem('prowl.photoChecks'));
  assert.deepEqual(kept[0].r.web.seen, ['Haeger Potteries', 'Cat', 'Ceramic']);
  assert.equal(kept[0].r.web.alike.length, 2);
  await p.close();
});

test('a one-word guess alone: no row', async () => {
  const { p } = setup({ guess: 'carving', pages: [], seen: [], alike: [] });
  await check(p);
  assert.equal(p.$('#otp-aprOut .apr-web'), null);
  await p.close();
});
