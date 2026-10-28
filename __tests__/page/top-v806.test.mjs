// Page v8.06 (Matt: "too many things at the top of the screen. We have the panther, the cave, the description and then
// the search area"). The search comes sooner: the curtain lifts sooner, the panther is smaller on phones and sits inside
// the night scene in Uranium and Cockpit (one strip), and the description shows on a first visit only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('the curtain lifts sooner: 600 ms at least (was 1600), and is gone once its lift is done', () => {
  const m = /var MIN_MS=(\d+),MAX_MS=(\d+),EASE=\d+,FLIP_MS=(\d+),FLIP_DELAY=(\d+),[^;]*FINISH_AT=(\d+);/.exec(PAGE);
  const [min, max, flip, delay, fin] = m.slice(1).map(Number);
  assert.equal(min, 600);
  assert.equal(max, 5000, 'a slow page still has its 5 seconds');
  assert.ok(fin >= flip + delay, 'removed only after the word has landed: ' + fin + ' >= ' + (flip + delay));
  assert.ok(flip + delay <= 900);
});

test('the description is hidden for a returning user and shown on a first visit, in both looks', async () => {
  const css = PAGE;
  assert.match(css, /\.scout-app-wrapper\.scout-app-wrapper p\.lede\{display:none\}/);
  assert.match(css, /\.scout-app-wrapper\.is-new\.k2 p\.lede\.k2-only,\.scout-app-wrapper\.is-new:not\(\.k2\) p\.lede\.k2-hide\{display:block\}/);
  let p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['Royal Haeger panther'] } } });
  await tick(30);
  assert.equal(p.$('.scout-app-wrapper').classList.contains('is-new'), false, 'a hunt kept: returning');
  await p.close();
  p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  assert.equal(p.$('.scout-app-wrapper').classList.contains('is-new'), true, 'nothing kept: a first visit');
  await p.close();
});

test('a smaller panther on phones; in Uranium and Cockpit it sits in the scene, one 120px strip', () => {
  assert.match(PAGE, /@media\(max-width:480px\)\{\.scout-app-wrapper \.pmark\{margin-top:8px\}\.scout-app-wrapper \.pmark img\{max-height:96px\}\}/);
  assert.match(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper \.pmark\{position:relative;z-index:2;height:120px;margin:8px 0 -120px;align-items:center\}/, 'the panther box overlaps the strip');
  assert.match(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper \.heromark\{aspect-ratio:auto;height:120px;margin-top:0\}/, 'the same height, from the same top');
  assert.match(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper \.heromark \.hm-mark\{display:none\}/, 'the panther is the art there, not the small mushroom');
  assert.match(PAGE, /\[data-theme=uranium\] \.scout-app-wrapper \.heromark \.hm-scene\{object-fit:cover\}/);
  /* the panther, then the scene, with nothing between them; the owner's version line and the Pro banner after */
  const i = PAGE.indexOf('<div class="pmark" id="otp-pan">'), j = PAGE.indexOf('<div class="heromark">'), k = PAGE.indexOf('<p class="eb" id="otp-verEb">'), l = PAGE.indexOf('id="otp-proBan"');
  assert.ok(i > 0 && i < j && j < k && k < l, [i, j, k, l].join(' '));
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('</div>', i), j), /<p |<div class="proban"/, 'nothing between the panther and the scene');
});
