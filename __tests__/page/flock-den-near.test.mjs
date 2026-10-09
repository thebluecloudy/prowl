// Page v6.61 (part 2): Flock follows the whole Den (every hunt, locked or not). A like goes looking for more like it straight
// away, a swipe-away steers off and looks elsewhere, and a card whose search is not in the Den has + Add to hunts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const cards = (p) => p.$$('#otp-flockRow .fl-card');
const den = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36') || '{}');
const searched = (p, q) => p.calls.some((u) => new URL(u, 'https://x.example/').searchParams.get('q') === q);
async function flock(denState, storage = {}) {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, ...denState }, owlTwigSgwTerms: [], ...storage }, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  p.calls = f.calls;
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => cards(p).length >= 2, { timeout: 8000 });
  return p;
}
// searches go out 250ms apart: settled once none has gone out for a while, and the feed has redrawn (FL_IDLE_MS)
async function settle(p) {
  let n = -1;
  for (let i = 0; i < 60 && p.calls.length !== n; i++) { n = p.calls.length; await tick(700); }
  await tick(1100);
}

const qs = (p) => p.calls.map((u) => { const x = new URL(u, 'https://x.example/'); return x.searchParams.get('q') ? x.pathname + '|' + x.searchParams.get('q') : null; }).filter(Boolean);
// scroll to the last card, so the feed adds its next batch
function toEnd(p) {
  const cs = cards(p);
  cs.forEach((c, k) => { Object.defineProperty(c, 'offsetTop', { value: k * 100, configurable: true }); Object.defineProperty(c, 'offsetHeight', { value: 100, configurable: true }); });
  const r = p.$('#otp-flockRow');
  r.scrollTop = (cs.length - 1) * 100;
  r.dispatchEvent(new p.win.Event('scroll'));
}
const searches = (p, q) => p.calls.filter((u) => new URL(u, 'https://x.example/').searchParams.get('q') === q).length;
const searchCalls = (p) => p.calls.filter((u) => new URL(u, 'https://x.example/').searchParams.get('q'));

test('a like fetches only its new search, on a few marketplaces', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  await settle(p);
  const n = searchCalls(p).length;
  cards(p)[0].querySelector('.fl-lk').click();
  await settle(p);
  const after = searchCalls(p).slice(n).map((u) => new URL(u, 'https://x.example/').searchParams.get('q'));
  assert.ok(after.length >= 1 && after.length <= 6, 'a few: ' + after.join(','));
  assert.ok(after.every((q) => /^find /.test(q)), 'only the new near search: ' + after.join(','));
  await p.close();
});

test('a swipe-away with plenty in hand fetches nothing more', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  await settle(p);
  const n = searchCalls(p).length;
  cards(p)[0].querySelector('.fl-x').click();
  await settle(p);
  assert.equal(searchCalls(p).length, n, 'plenty left: no new searches');
  await p.close();
});

test('a near search swiped away twice is dropped and its finds leave the feed; Undo takes the swipe back', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  await settle(p);
  cards(p)[0].querySelector('.fl-lk').click();
  await settle(p);
  const nears = () => cards(p).filter((x) => x.getAttribute('data-near') === '1');
  const first = await waitFor(() => nears()[0], { timeout: 8000 });
  const t = first.getAttribute('data-h');
  first.querySelector('.fl-x').click();
  await settle(p);
  const second = await waitFor(() => nears().find((x) => x.getAttribute('data-h') === t), { timeout: 8000 });
  second.querySelector('.fl-x').click();
  await settle(p);
  assert.ok(!nears().some((x) => x.getAttribute('data-h') === t), 'its finds leave the feed without a Shuffle');
  // Undo the second swipe-away: the search is back
  p.$('#otp-undis').click();
  await settle(p);
  assert.ok(nears().some((x) => x.getAttribute('data-h') === t), 'Undo brings the search back');
  const had = searches(p, t);
  p.$('#otp-flockShuf').click();
  await settle(p);
  assert.ok(searches(p, t) >= had);
  await p.close();
});

test('a near search with a liked find is kept even after two swipe-aways', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  await settle(p);
  cards(p)[0].querySelector('.fl-lk').click();
  await settle(p);
  const n1 = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1'), { timeout: 8000 });
  const t = n1.getAttribute('data-h');
  n1.querySelector('.fl-lk').click();   // liked one of its own finds
  await settle(p);
  const pick = () => cards(p).find((x) => x.getAttribute('data-near') === '1' && x.getAttribute('data-h') === t && !x.querySelector('.fl-lk.on'));
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 4 && !pick(); k++) { toEnd(p); await settle(p); }   // the next batch, as you scroll
    pick().querySelector('.fl-x').click();
    await settle(p);
  }
  for (let k = 0; k < 4 && !pick(); k++) { toEnd(p); await settle(p); }
  assert.ok(pick(), 'its finds still come');
  await p.close();
});

test('near searches: strongest words first, listing filler never, one search whatever the word order', async () => {
  const L = (u, t) => ({ u: 'https://www.ebay.com/itm/' + u, t, p: '$20.00', s: 'ebay', i: '', h: 'pyrex', at: 1 });
  const p = await flock({ hunts: ['pyrex'] }, { 'prowl.likes': [L(1, 'VTG Pyrex green haeger bowl'), L(2, 'Pyrex haeger green dish')] });
  await settle(p);
  const qs = [...new Set(searchCalls(p).map((u) => new URL(u, 'https://x.example/').searchParams.get('q')))];
  assert.ok(!qs.some((q) => /\bvtg\b/.test(q)), 'no filler: ' + qs.join(','));
  const near = qs.filter((q) => q !== 'pyrex');
  const keys = near.map((q) => q.split(' ').sort().join(' '));
  assert.equal(new Set(keys).size, keys.length, 'one search per set of words: ' + near.join(','));
  assert.ok(near.includes('green haeger'), 'the words in both likes lead: ' + near.join(','));
  await p.close();
});

test('once a like\'s search is a hunt, its leftover words start no new search', async () => {
  const L = (u, t) => ({ u: 'https://www.ebay.com/itm/' + u, t, p: '$20.00', s: 'ebay', i: '', h: 'pyrex', at: 1 });
  const p = await flock({ hunts: ['pyrex'] }, { 'prowl.likes': [L(1, 'Pyrex Butterprint Rose Mixing Bowl')] });
  await settle(p);
  const near = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1'), { timeout: 8000 });
  assert.equal(near.getAttribute('data-h'), 'butterprint rose');
  near.querySelector('.fl-add').click();
  const n = searchCalls(p).length;
  p.$('#otp-flockShuf').click();
  await settle(p);
  const after = searchCalls(p).slice(n).map((u) => new URL(u, 'https://x.example/').searchParams.get('q'));
  assert.ok(!after.some((q) => /mixing|bowl/.test(q)), 'no junk search: ' + after.join(','));
  await p.close();
});

test('locked hunts, panel terms and the newest hunts count first past 40 Den hunts', async () => {
  const hunts = Array.from({ length: 42 }, (_, i) => 'old' + i);
  const p = await flock({ hunts, lock: [0] }, { owlTwigSgwTerms: ['haeger'] });
  await settle(p);
  for (const q of ['old0', 'haeger', 'old41']) assert.ok(searches(p, q) > 0, q + ' searched');
  p.$('#otp-newTerm').value = 'blenko';
  p.$('#otp-addTerm').click();
  await waitFor(() => searches(p, 'blenko') > 0, { timeout: 8000 });
  await p.close();
});

test('first visit: a sample hunt removed from the Den leaves Flock', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  p.calls = f.calls;
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => cards(p).some((c) => c.getAttribute('data-h') === 'Roseville jardiniere'), { timeout: 10000 });
  // remove it in the Den (its ✕ there)
  const x = p.$$('button.rm[data-r]').find((b) => /Roseville jardiniere/.test((b.closest('li') || b.parentNode).textContent));
  assert.ok(x, 'the Den has a remove button for it');
  p.win.confirm = () => true;
  x.click();
  await settle(p);
  assert.ok(!cards(p).some((c) => c.getAttribute('data-h') === 'Roseville jardiniere'), 'gone from Flock');
  await p.close();
});

test('keyboard: + Add to hunts keeps focus in the feed', async () => {
  const p = await flock({ hunts: ['panther'] }, { owlTwigSgwTerms: ['haeger'] });
  await settle(p);
  const b = cards(p).find((x) => x.getAttribute('data-h') === 'haeger').querySelector('.fl-add');
  b.focus();
  b.click();
  assert.equal(p.doc.activeElement, p.$('#otp-flockRow'));
  await p.close();
});
