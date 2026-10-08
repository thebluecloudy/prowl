// Page v6.54: the like heart is on every main search result too, not only in Flock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const homeCells = (p) => p.$$('.sgw-cell').filter((c) => !c.closest('#otp-flock') && !c.closest('#otp-sheet') && c.getAttribute('data-u'));
async function home() {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { hunts: [] }, owlTwigSgwTerms: ['panther', 'pyrex'] }, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  await waitFor(() => homeCells(p).length >= 3);
  return p;
}

test('every result card has a heart; tapping it likes the find without opening anything', async () => {
  const p = await home();
  const cells = homeCells(p);
  assert.ok(cells.every((c) => c.querySelectorAll('.sgw-lk').length === 1), 'one heart per result');
  const c = cells.find((x) => x.getAttribute('data-p')), b = c.querySelector('.sgw-lk');
  assert.equal(b.textContent, '♡'); assert.equal(b.getAttribute('aria-pressed'), 'false');
  const e = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  b.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true, 'the listing does not open');
  assert.ok(p.$('#otp-sheet').hidden, 'no popup either');
  const L = ls(p, 'prowl.likes');
  assert.equal(L.length, 1);
  assert.equal(L[0].u, c.getAttribute('data-u'));
  assert.equal(L[0].t, c.getAttribute('data-t'));
  assert.equal(L[0].p, c.getAttribute('data-p'));
  assert.ok(['panther', 'pyrex'].includes(L[0].h), 'it remembers the hunt: ' + L[0].h);
  assert.equal(b.textContent, '♥'); assert.equal(b.getAttribute('aria-pressed'), 'true');
  b.click();
  assert.deepEqual(ls(p, 'prowl.likes'), [], 'tap again to unlike');
  assert.equal(b.textContent, '♡');
  await p.close();
});

test('a like on a result shows on the same find in Flock, which keeps its one heart', async () => {
  const p = await home();
  const c = homeCells(p)[0], u = c.getAttribute('data-u');
  c.querySelector('.sgw-lk').click();
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length >= 4);
  for (const card of p.$$('#otp-flockRow .fl-card')) {
    assert.equal(card.querySelectorAll('.sgw-lk').length, 0, 'no second heart on Flock cards');
    assert.equal(card.querySelectorAll('.fl-lk').length, 1);
    assert.equal((card.outerHTML.match(/ data-h="/g) || []).length, 1, 'data-h once');
  }
  const same = p.$$('#otp-flockRow .fl-card').find((x) => x.getAttribute('data-u') === u);
  if (same) assert.equal(same.querySelector('.fl-lk').textContent, '♥');
  await p.close();
});

test('a find liked earlier shows a filled heart in the results', async () => {
  const f = liveFetch();
  const like = { u: 'https://www.ebay.com/itm/panther-0', t: 'panther find ebay 0', p: '$10.00', s: 'ebay', i: '', h: 'panther', at: 1 };
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { hunts: [] }, owlTwigSgwTerms: ['panther', 'pyrex'], 'prowl.likes': [like] } });
  await tick(50);
  const c = await waitFor(() => homeCells(p).find((x) => x.getAttribute('data-u') === like.u), { timeout: 6000 });
  assert.equal(c.querySelector('.sgw-lk').textContent, '♥');
  assert.equal(c.querySelector('.sgw-lk').getAttribute('aria-pressed'), 'true');
  assert.ok(homeCells(p).filter((x) => x !== c).every((x) => x.querySelector('.sgw-lk').textContent === '♡'));
  await p.close();
});
