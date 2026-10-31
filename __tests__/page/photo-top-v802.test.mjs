// Page v8.02 (Matt: "What is the black button after I run a search. I don't see check with Google Lens"). Hunt it on
// Prowl and Check with Google Lens sit right under the answer, above the look-alikes; the Field Guides link stays
// below the results. Check again keeps its colour after a tap (a phone holds the hover state, and the hover meant for
// the old card-style button turned it near black in the Classic look).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))), text: () => Promise.resolve(JSON.stringify(j)) });
const ANSWER = { item: 'Royal Haeger 616 orange winking Egyptian cat', fair: '$90-140', basis: 'sold', sure: 'MEDIUM',   /* v8.03: a sure answer has no loose web row */ search: 'Royal Haeger 616 cat',
  looks: [{ url: 'https://www.ebay.com/itm/999', title: 'TWO MOSELLAND REISLING HAPPY CATS BOTTLES', price: '$14', image: 'https://i.ebayimg.com/x.jpg' }],
  web: { seen: ['Royal Haeger'], alike: ['https://example.org/a.jpg'] } };
function setup() {
  const fetchImpl = (u) => {
    const url = String(u);
    if (/\/appraise$/.test(url)) return J(ANSWER);
    if (/\/search\/suggest\.json/.test(url)) return J({ resources: { results: { articles: [{ url: '/blogs/guides/royal-haeger', title: 'Royal Haeger, a field guide' }] } } });
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
  await waitFor(() => p.$('#otp-aprGuide'), { timeout: 5000 });
  await tick(30);
}
const kids = (p) => [...p.$('#otp-aprOut').children];

test('the buttons and the Lens hint come right after the answer, before the look-alikes', async () => {
  const p = setup();
  await check(p);
  const k = kids(p);
  assert.ok(k[0].classList.contains('apr-card'), 'the answer first');
  assert.ok(k[1].classList.contains('apr-links'), 'then the buttons');
  assert.equal(k[1].children[0].textContent, 'Hunt this on Prowl');
  assert.deepEqual([...k[1].children[1].children].map((b) => b.textContent), ['Save', 'Share'], 'v8.29: Save and Share under it');
  assert.equal(k[1].children[2].textContent, 'Check with Google Lens');
  assert.ok(k[2].classList.contains('apr-lensn'), 'then how to use what Lens says');
  const looks = k.findIndex((e) => e.classList.contains('apr-looks') && !e.classList.contains('apr-web'));
  const web = k.findIndex((e) => e.classList.contains('apr-web'));
  assert.ok(looks > 2 && web > looks, 'eBay look-alikes, then the web, below the buttons');
  assert.equal(p.$$('#otp-aprOut .apr-links').length, 1);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the Field Guides link sits after the results and before the notes, not between the answer and the buttons', async () => {
  const p = setup();
  await check(p);
  const k = kids(p), g = k.indexOf(p.$('#otp-aprGuide'));
  const last = Math.max(...k.map((e, i) => (e.classList.contains('apr-looks') || e.classList.contains('apr-links') ? i : -1)));
  assert.ok(g > last, 'below the result rows');
  assert.ok(k[g + 1] && k[g + 1].classList.contains('apr-note'), 'right before the notes');
  await p.close();
});

test('Check again keeps its main-button colour when hovered (a phone keeps hover after a tap)', () => {
  const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.ok(!/\.scout-app-wrapper \.apr-go:hover\{/.test(html), 'no bare .apr-go:hover: it beat .b.p in the Classic look');
  assert.match(html, /\.scout-app-wrapper \.apr-go:not\(\.b\):hover\{background:var\(--hover\)\}/);
  assert.match(html, /<button class="b p apr-go" id="otp-aprRun"/, 'Check again is a .b button, so the hover skips it');
});
