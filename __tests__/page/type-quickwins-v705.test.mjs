// Page v7.05: bigger type floor, paw prints while loading, photo tips, an empty Den that says what to do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const CSS = PAGE.match(/<style id="prowl-css">([\s\S]*?)<\/style>/)[1];

test('no text in the main stylesheet is smaller than 12.5px', () => {
  const sizes = [...CSS.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => +m[1]);
  const tiny = sizes.filter((v) => v < 12.5);
  assert.deepEqual(tiny, []);
});

test('live results and the photo check show paw prints while they load, and they stop for reduced motion', () => {
  assert.match(PAGE, /class="sgw-note"><span class="paws"/);
  assert.match(PAGE, /pw\.className='paws'/);
  assert.match(CSS, /prefers-reduced-motion:no-preference\)\{\.scout-app-wrapper \.paws i\{animation/);
});

test('the photo screen lists three photo tips', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(60);
  const tips = [...p.doc.querySelectorAll('#otp-apr .apr-tips li')].map((li) => li.textContent);
  assert.deepEqual(tips, ['One piece', 'Good light', 'Show the mark']);
  await p.close();
});

test('an empty Den says what to do, and its button puts the cursor in the Add box', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(60);
  p.$('#otp-denBtn').click();
  await tick(120);
  const empty = p.$('#otp-denList .den-empty');
  assert.ok(empty, 'the empty card renders');
  assert.match(empty.textContent, /No hunts saved yet/);
  p.$('#otp-denStart').click();
  assert.equal(p.doc.activeElement && p.doc.activeElement.id, 'otp-newTerm');
  await p.close();
});
