// Page v7.58 (the owner, setting up a new phone: "the sample hunts are there but I couldn't delete them. I added one
// hunt and samples went away", picked "label them"; and "the letters are spilling out in the den"). The first-visit
// chips are labeled as ideas that are not saved, and a hunt name wraps inside its Den row (long words break, and at
// Large / Extra large text the side columns slim down so the name has room).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('first visit: the starter chips say they are ideas, not saved hunts', async () => {
  const p = loadPage({ storage: {} });
  await tick(30);
  const start = p.$('#otp-start');
  assert.equal(start.hidden, false);
  assert.equal(start.querySelector('.bolo-l').textContent, 'Ideas to try');
  assert.match(start.querySelector('.start-note').textContent, /not saved/);
  assert.ok(start.querySelectorAll('#otp-startTry .bolo-c').length > 0);
});

test('Den hunt names wrap long words instead of spilling into the next column', () => {
  assert.match(html, /\.scout-app-wrapper \.tt\{[^}]*overflow-wrap:anywhere/);
});

test('large text slims the Den row side columns on a phone', () => {
  assert.match(html, /@media \(max-width:480px\)\{\.scout-app-wrapper\.tz \.term \.ck\{/);
  assert.match(html, /\.scout-app-wrapper\.tz \.term \.sb b\{display:none\}/);
});
