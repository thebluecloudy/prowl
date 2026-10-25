// Page v8.03 (Matt's Royal Haeger 616, named for sure, then "weird stuff": "Seen as: Cat · Animal figurine · Reptiles ·
// Safari · Birds" and orange toys). A sure answer leaves out Google's loose labels and look-alike pictures; pages with
// the very same picture still show. (Worker v175 sends only those pages.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))), text: () => Promise.resolve(JSON.stringify(j)) });
const EB = 'https://www.ebay.com/itm/226512345678';
const LOOSE = { seen: ['Cat', 'Animal figurine', 'Reptiles', 'Safari', 'Birds'], alike: ['https://img.example.org/toy1.jpg', 'https://img.example.org/toy2.jpg'] };
function setup(sure, web) {
  const fetchImpl = (u) => /\/appraise$/.test(String(u))
    ? J({ item: 'Royal Haeger 616 Egyptian Orange Winking Cat 1950s', fair: '$140-190', basis: 'listed', sure, search: 'Royal Haeger 616 cat', looks: [], web })
    : J({ items: [] });
  const beforeLoad = (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/1';
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  return loadPage({ storage: DEN, fetchImpl, beforeLoad });
}
async function check(p) {
  await waitFor(() => p.win.prowlPhotoFile);
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'piece.jpg', { type: 'image/jpeg' }));
  await waitFor(() => p.$('#otp-aprTray .apr-th'));
  p.$('#otp-aprRun').click();
  await waitFor(() => p.$('#otp-aprOut .apr-card') && !p.$('#otp-aprRun').disabled, { timeout: 10000 });
}

test('a sure answer with only loose labels and look-alikes: no Seen on the web row', async () => {
  const p = setup('HIGH', LOOSE);
  await check(p);
  assert.equal(p.$('#otp-aprOut .apr-web'), null);
  assert.ok(!/Reptiles|Safari/.test(p.$('#otp-aprOut').textContent));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a sure answer still shows pages with the same picture, without the labels or look-alikes', async () => {
  const p = setup('HIGH', Object.assign({ pages: [{ url: EB, title: 'Royal Haeger Orange Cat 1950s', image: 'https://i.ebayimg.com/a.jpg', host: 'ebay.com' }] }, LOOSE));
  await check(p);
  const box = p.$('#otp-aprOut .apr-web');
  assert.ok(box);
  assert.equal(box.querySelectorAll('.apr-lkg a.apr-lk').length, 1);
  assert.equal(box.querySelector('.apr-wguess'), null, 'no Seen as');
  assert.equal(box.querySelector('.apr-alike'), null, 'no look-alike pictures');
  await p.close();
});

test('an unsure answer keeps them as a hint', async () => {
  const p = setup('MEDIUM', LOOSE);
  await check(p);
  const box = p.$('#otp-aprOut .apr-web');
  assert.ok(box);
  assert.match(box.querySelector('.apr-wguess').textContent, /^Seen as: Cat/);
  assert.equal(box.querySelectorAll('.apr-alike a').length, 2);
  await p.close();
});
