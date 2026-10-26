// Page v6.95: in Uranium, the band at the top of the Den, the listing popup and the other pop-up screens is a deep green
// gradient from Matt's shades of #3cff49 (#1e7f24 to #0c330e) instead of the bright #39ff14, with a pale title that
// reads on both ends. The screens under the band stay black. Other themes keep their bands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { resolveU } from '../helpers/uranium.mjs';

const RAW = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const PAGE = resolveU(RAW);   /* v8.04: Uranium's colours are variables now */
function lum(h) {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(1).slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('Uranium pop-up bands: a deep green gradient with a pale title that reads on both ends', () => {
  const band = /\[data-theme=uranium\] \.scout-app-wrapper\.k2 \.dh\{background:linear-gradient\(180deg,(#[0-9a-f]{6}) 0,(#[0-9a-f]{6}) 100%\)\}/.exec(PAGE);
  assert.ok(band, 'the band rule is in the page');
  assert.deepEqual([band[1], band[2]], ['#1e7f24', '#0c330e']);
  const title = /\[data-theme=uranium\] \.scout-app-wrapper\.k2 \.dh h2\{color:(#[0-9a-f]{6})!important\}/.exec(PAGE)[1];
  for (const bg of [band[1], band[2]]) assert.ok(contrast(title, bg) >= 4.5, title + ' on ' + bg + ': ' + contrast(title, bg).toFixed(1));
});

test('the popup\'s View on button matches the band, with a pale label and a bright edge', () => {
  const m = /\[data-theme=uranium\] \.scout-app-wrapper\.k2 \.otp-sheet a\.b\.p\.pp-go\{background:linear-gradient\(180deg,(#[0-9a-f]{6}) 0,(#[0-9a-f]{6}) 100%\);color:(#[0-9a-f]{6});border-color:#3cff49/.exec(PAGE);
  assert.ok(m, 'the button rule is in the page');
  assert.deepEqual([m[1], m[2]], ['#1e7f24', '#0c330e']);
  for (const bg of [m[1], m[2]]) assert.ok(contrast(m[3], bg) >= 4.5, m[3] + ' on ' + bg);
});

test('the screens under the band are not recoloured, and other themes keep their bands', () => {
  assert.doesNotMatch(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper \.drawer\.otp-sheet,/, 'no green body on the popup');
  assert.match(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper \.drawer\{background:#0a0a1e\}/);
  assert.match(PAGE, /\.scout-app-wrapper\.k2 \.dh\{background:var\(--k2-band\);/);
  assert.match(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper\.k2\{[^}]*--k2-band:#39ff14/, 'the home section bands keep the bright green');
});

test('the Den and the popup open in Uranium with no errors', async () => {
  const p = loadPage({ storage: { 'prowl.theme': 'uranium', 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(60);
  assert.equal(p.doc.documentElement.getAttribute('data-theme'), 'uranium');
  p.$('#otp-denBtn').click();
  await tick(30);
  assert.equal(p.$('#otp-den').hidden, false);
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', 'https://shopgoodwill.com/item/123456789');
  cell.innerHTML = '<a class="sgw-card" href="#"><img alt=""></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  cell.querySelector('a').click();
  await tick(30);
  assert.equal(p.$('#otp-sheet').hidden, false);
  assert.deepEqual(p.errors, []);
  await p.close();
});
