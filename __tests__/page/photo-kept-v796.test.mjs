// Page v7.96 (Matt: "Yes do 4 5"). 4: Research this piece's "Sold before" cards open the listing popup, where an
// ended eBay, Etsy or Poshmark sale can still be saved and liked; a sale on another site still opens that site.
// 5: each photo check's answer is kept on the phone (new key prowl.photoChecks, newest 5, with a small copy of the
// photo), so a reload at a sale does not lose it; "Your last photo checks" opens one again without a new check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const BASE = { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };
const EBS = 'https://www.ebay.com/itm/335511223344';
const WP = 'https://www.worthpoint.com/worthopedia/royal-haeger-panther-123';
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))), text: () => Promise.resolve(JSON.stringify(j)) });   /* a fresh object each time, as from the network */
const ANSWER = { item: 'Royal Haeger sitting panther', fair: '$55-115', basis: 'sold', sure: 'HIGH', verdict: 'BUY', search: 'Royal Haeger panther', why: 'Sold at $60 and $95.' };

function setup(storage, answer) {
  const calls = { appraise: 0, items: [] };
  const fetchImpl = (u) => {
    const url = String(u);
    if (/\/appraise$/.test(url)) { calls.appraise++; return J(answer || ANSWER); }
    if (/\/research$/.test(url)) return J({ item: 'Royal Haeger panther', maker: 'Royal Haeger', solds: [{ url: EBS, title: 'Royal Haeger black panther 1950s', price: '$85', date: 'Sep 12, 2026', where: 'eBay' }, { url: WP, title: 'Haeger panther TV lamp', price: '$40', date: 'Aug 2, 2026', where: 'WorthPoint' }] });
    if (/\/item\?url=/.test(url)) { calls.items.push(decodeURIComponent(url.split('url=')[1])); return J({ title: 'Royal Haeger black panther 1950s', price: '$85', images: ['https://i.ebayimg.com/images/g/x/s-l1600.jpg'], url: EBS, gone: true }); }
    return J({ items: [] });
  };
  const beforeLoad = (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/thumb';
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  return { p: loadPage({ storage: { ...BASE, ...storage }, fetchImpl, beforeLoad }), calls };
}
async function check(p) {
  await tick(30);
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'piece.jpg', { type: 'image/jpeg' }));
  await waitFor(() => p.$('#otp-aprTray .apr-th'));
  p.$('#otp-aprRun').click();
  /* the answer drawn, the check done and Poshmark's sales looked up: a slow CI machine takes longer than a fixed wait */
  await waitFor(() => p.$('#otp-aprOut .apr-card') && !p.$('#otp-aprRun').disabled && !/Checking Poshmark/.test(p.$('#otp-aprOut').textContent), { timeout: 10000 });
  await tick(60);
}
const kept = (at, item) => ({ at, r: { ...ANSWER, item, looks: [] }, th: 'data:image/jpeg;base64,/9j/' + at });

test('each answer is kept on the phone and listed under Your last photo checks', async () => {
  const { p } = setup({});
  assert.equal(p.$('#otp-aprRecent').hidden, true, 'nothing kept yet');
  await check(p);
  const a = ls(p, 'prowl.photoChecks');
  assert.equal(a.length, 1);
  assert.equal(a[0].r.item, 'Royal Haeger sitting panther');
  assert.equal(a[0].r.fair, '$55-115');
  assert.equal(a[0].th, 'data:image/jpeg;base64,/9j/thumb', 'a small copy of the photo');
  assert.ok(a[0].at > 0);
  const r = p.$('#otp-aprRecent');
  assert.equal(r.hidden, false);
  assert.equal(r.querySelector('.apr-lkh').textContent, 'Your last photo checks');
  const c = r.querySelector('.apr-rc');
  assert.equal(c.querySelector('.apr-lkt').textContent, 'Royal Haeger sitting panther');
  assert.equal(c.querySelector('.apr-lkp').textContent, '$55-115');
  assert.match(c.querySelector('.apr-lkd').textContent, /^Today \d{1,2}:\d\d (AM|PM)$/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('after a reload, a kept check opens again without using another check', async () => {
  const { p, calls } = setup({ 'prowl.photoChecks': [kept(Date.now() - 60000, 'Haeger (maker you entered), Royal Haeger panther'), kept(Date.now() - 86400000 * 3, 'McCoy owl cookie jar')] });
  await tick(30);
  const cards = p.$$('#otp-aprRecent .apr-rc');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].querySelector('.apr-lkt').textContent, 'Haeger, Royal Haeger panther', 'no worker marker');
  assert.match(cards[1].querySelector('.apr-lkd').textContent, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d\d (AM|PM)$/, 'an older one has its day');
  cards[1].click();
  await tick(40);
  assert.match(p.$('#otp-aprOut').textContent, /McCoy owl cookie jar/);
  assert.equal(p.$('#otp-aprOut .apr-card img').getAttribute('src'), 'data:image/jpeg;base64,/9j/' + ls(p, 'prowl.photoChecks')[1].at);
  assert.equal(calls.appraise, 0, 'no new check');
  assert.equal(ls(p, 'prowl.photoChecks').length, 2, 'opening one does not keep it twice');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the newest 5 are kept; Clear these empties the list; a broken entry is skipped', async () => {
  const old = [1, 2, 3, 4, 5].map((n) => kept(Date.now() - n * 3600000, 'Piece ' + n));
  const { p } = setup({ 'prowl.photoChecks': [{ at: 1, r: null, th: 'x' }].concat(old) });
  await tick(30);
  assert.equal(p.$$('#otp-aprRecent .apr-rc').length, 5, 'the broken one is not drawn');
  await check(p);
  const a = ls(p, 'prowl.photoChecks');
  assert.equal(a.length, 5);
  assert.equal(a[0].r.item, 'Royal Haeger sitting panther', 'newest first');
  assert.equal(a[4].r.item, 'Piece 4', 'the oldest went');
  p.$('#otp-aprRecent .apr-rcx').click();
  assert.equal(p.win.localStorage.getItem('prowl.photoChecks'), null);
  assert.equal(p.$('#otp-aprRecent').hidden, true);
  await p.close();
});

test('Research\'s Sold before: an eBay sale opens the popup and can be saved though it has ended; another site still links out', async () => {
  const { p, calls } = setup({});
  await check(p);
  const rb = p.$$('#otp-aprOut button').find((b) => b.textContent === 'Research this piece');
  assert.ok(rb, 'Research this piece');
  rb.click();
  await tick(80);
  const cards = p.$$('#otp-aprSold a.apr-lk');
  assert.equal(cards.length, 2);
  const eb = cards.find((a) => a.getAttribute('data-u') === EBS);
  assert.ok(eb, 'the eBay sale carries what the popup reads');
  assert.equal(eb.getAttribute('data-sold'), '1');
  assert.equal(eb.getAttribute('data-p'), '$85');
  assert.equal(eb.getAttribute('data-h'), 'Royal Haeger panther');
  const wp = cards.find((a) => /worthpoint/.test(a.getAttribute('href')));
  assert.equal(wp.getAttribute('data-u'), null, 'another site stays a plain link');
  eb.click();
  await tick(60);
  assert.deepEqual(calls.items, [EBS]);
  assert.match(p.$('#otp-sheetB').textContent, /This one got away/, 'the popup knows it has ended');
  const sv = p.$('#otp-sheetB .pp-sv .sgw-sv');
  assert.ok(sv, 'Save is there for a sale');
  assert.ok(p.$('#otp-sheetB [data-pplike]'), 'and Like');
  sv.click();
  await tick(10);
  const f = (ls(p, 'prowl.finds') || []).find((x) => x.url === EBS);
  assert.ok(f, 'saved');
  assert.equal(f.hunt, 'Royal Haeger panther');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an ended listing opened from a hunt still has no Save (only a known sale does)', async () => {
  const { p } = setup({});
  await check(p);
  const a = p.doc.createElement('div');
  a.className = 'pk-card'; a.setAttribute('data-u', EBS); a.setAttribute('data-t', 'Royal Haeger black panther'); a.setAttribute('data-s', 'ebay');
  p.$('#otp-aprOut').appendChild(a);
  a.click();
  await tick(60);
  assert.match(p.$('#otp-sheetB').textContent, /This one got away/);
  assert.equal(p.$('#otp-sheetB .pp-sv'), null);
  await p.close();
});
