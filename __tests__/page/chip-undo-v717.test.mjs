// Page v7.17 (Matt, 2026-10-17, from the UI/UX check): the × on a favorite hunt chip can be undone. v7.12 made it a
// 44px tap, and a favorite that was not a Den hunt went with no word and no way back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const chips = (p) => p.$$('.sgw-chip[data-sgw="pick"]').map((c) => c.textContent.replace(/[◉×]/g, '').replace(/\d+\+? new/, '').trim());
const xOf = (p, name) => p.$$('.sgw-chip[data-sgw="pick"]').find((c) => c.textContent.includes(name)).querySelector('.sgw-x');
const saved = (p) => JSON.parse(p.win.localStorage.getItem('owlTwigSgwTerms') || 'null');
const lockOf = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36')).lock;

async function home(storage) {
  const p = loadPage({ storage });
  await tick(60);
  return p;
}

test('a favorite of your own: removed with a toast, and Undo puts it back in its place', async () => {
  const p = await home({ 'prowl.v36': { seen: true, hunts: ['catalin bracelet'] }, owlTwigSgwTerms: ['fiesta pitcher', 'hull pottery', 'pyrex'] });
  assert.deepEqual(chips(p), ['fiesta pitcher', 'hull pottery', 'pyrex']);
  xOf(p, 'hull pottery').click();
  assert.deepEqual(saved(p), ['fiesta pitcher', 'pyrex']);
  assert.match(p.$('#otp-toast').textContent, /hull pottery removed from your favorites\. Undo/);
  p.$('#otp-unchip').click();
  assert.deepEqual(saved(p), ['fiesta pitcher', 'hull pottery', 'pyrex']);
  assert.deepEqual(chips(p), ['fiesta pitcher', 'hull pottery', 'pyrex']);
  assert.ok(!p.$('#otp-toast').classList.contains('on'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a locked Den hunt: moved back to the Den, and Undo locks it again', async () => {
  const p = await home({ 'prowl.v36': { seen: true, hunts: ['catalin bracelet', 'rookwood vase'], lock: [1] }, owlTwigSgwTerms: [] });
  assert.ok(chips(p).includes('rookwood vase'));
  xOf(p, 'rookwood vase').click();
  assert.deepEqual(lockOf(p), []);
  assert.ok(!chips(p).includes('rookwood vase'));
  assert.match(p.$('#otp-toast').textContent, /rookwood vase moved back to your Den\. Undo/);
  p.$('#otp-unchip').click();
  assert.deepEqual(lockOf(p), [1]);
  assert.ok(chips(p).includes('rookwood vase'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('first-visit sample chips: cleared, and Undo brings them back without saving them', async () => {
  const p = await home({ 'prowl.v36': { seen: true, hunts: ['catalin bracelet', 'rookwood vase', 'pyrex snowflake'] } });
  const before = chips(p);
  assert.ok(before.length > 0, 'samples shown');
  xOf(p, before[0]).click();
  assert.deepEqual(chips(p), []);
  assert.match(p.$('#otp-toast').textContent, /Sample hunts cleared\. Undo/);
  p.$('#otp-unchip').click();
  assert.deepEqual(chips(p), before);
  assert.equal(saved(p), null, 'samples are still not saved as favorites');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a second tap on Undo does nothing', async () => {
  const p = await home({ 'prowl.v36': { seen: true, hunts: ['catalin bracelet'] }, owlTwigSgwTerms: ['fiesta pitcher', 'pyrex'] });
  xOf(p, 'pyrex').click();
  const undo = p.$('#otp-unchip');
  undo.click();
  undo.click();
  assert.deepEqual(saved(p), ['fiesta pitcher', 'pyrex']);
  assert.deepEqual(p.errors, []);
  await p.close();
});
