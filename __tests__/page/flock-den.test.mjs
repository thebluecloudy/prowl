// Page v6.60: Flock follows the whole Den (every hunt, locked or not). A like goes looking for more like it straight
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

test('Flock takes in every Den hunt, locked or not', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex', 'blenko'], lock: [0] });
  await settle(p);
  const hs = new Set(cards(p).map((c) => c.getAttribute('data-h')));
  for (const h of ['panther', 'pyrex', 'blenko']) assert.ok(hs.has(h), h + ' in ' + [...hs].join(','));
  for (const h of ['panther', 'pyrex', 'blenko']) assert.ok(searched(p, h), h + ' searched');
  assert.equal(p.$('#otp-flockRow .fl-add'), null, 'Den hunts get no + Add');
  await p.close();
});

test('one hunt is enough, and none gives the friendly card', async () => {
  const p = await flock({ hunts: ['panther'] });
  assert.ok(cards(p).every((c) => c.getAttribute('data-h') === 'panther'));
  await p.close();
  const f = liveFetch();
  const q = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [] } });
  await tick(60);
  q.$('#otp-dock .db[data-m="flock"]').click();
  const empty = await waitFor(() => q.$('#otp-flockRow .fl-empty'));
  assert.match(empty.textContent, /Add a hunt in the Den and the flock takes flight/);
  await q.close();
});

test('a hunt added in the Den joins an open Flock', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  p.$('#otp-newTerm').value = 'blenko';
  p.$('#otp-addTerm').click();
  await waitFor(() => searched(p, 'blenko'), { timeout: 8000 });
  await settle(p);
  assert.ok(cards(p).some((c) => c.getAttribute('data-h') === 'blenko'));
  await p.close();
});

const qs = (p) => p.calls.map((u) => { const x = new URL(u, 'https://x.example/'); return x.searchParams.get('q') ? x.pathname + '|' + x.searchParams.get('q') : null; }).filter(Boolean);
test('a big Den is fetched in capped rounds, every hunt once before any twice', async () => {
  const hunts = Array.from({ length: 20 }, (_, i) => 'hunt' + String.fromCharCode(97 + i));
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts }, owlTwigSgwTerms: [] }, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  p.calls = f.calls;
  await tick(60);
  await settle(p);   // the home page's own search for the first hunt
  const home = new Set(qs(p).map((k) => k.split('|')[1]));
  const before = qs(p).length;
  p.$('#otp-dock .db[data-m="flock"]').click();
  await settle(p);
  const asked = qs(p).slice(before);
  assert.ok(asked.length <= 24, 'first round capped: ' + asked.length);
  const per = {};
  for (const k of asked) { const t = k.split('|')[1]; per[t] = (per[t] || 0) + 1; }
  assert.deepEqual(hunts.filter((h) => !per[h] && !home.has(h)), [], 'every hunt asked: ' + JSON.stringify(per));
  assert.ok(Object.values(per).every((n) => n <= 2), 'breadth-first: ' + JSON.stringify(per));
  await p.close();
});

test('a like searches for more like it straight away; its cards say why and offer + Add to hunts', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  await settle(p);
  assert.equal(p.$('#otp-flockRow .fl-near'), null, 'no likes, no near finds');
  const c = cards(p)[0];
  const before = p.calls.length;
  c.querySelector('.fl-lk').click();
  // the card title is "<hunt> find <site> <n>": its two strongest words that are not the hunt's
  const term = await waitFor(() => p.calls.slice(before).map((u) => new URL(u, 'https://x.example/').searchParams.get('q')).find((q) => q && !['panther', 'pyrex'].includes(q)), { timeout: 4000 });
  assert.match(term, /^find /);
  await settle(p);
  const near = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1'), { timeout: 8000 });
  assert.equal(near.querySelector('.fl-near').textContent, 'Because you liked ' + near.getAttribute('data-h'));
  const add = near.querySelector('.fl-add');
  assert.ok(add, '+ Add to hunts on a near card');
  assert.equal(add.textContent, '+ Add to hunts');
  assert.equal(add.getAttribute('aria-label'), 'Add ' + near.getAttribute('data-h') + ' to your hunts');
  await p.close();
});

test('+ Add to hunts puts the search in the Den (not locked) without starting the feed over', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'], lock: [0] });
  await settle(p);
  cards(p)[0].querySelector('.fl-lk').click();
  await settle(p);
  const near = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1'), { timeout: 8000 });
  const t = near.getAttribute('data-h');
  const order = cards(p).map((c) => c.getAttribute('data-u'));
  near.querySelector('.fl-add').click();
  const d = den(p);
  assert.deepEqual(d.hunts, ['panther', 'pyrex', t]);
  assert.deepEqual(d.lock, [0], 'added, not locked');
  const b = near.querySelector('.fl-add');
  assert.equal(b.textContent, '✓ In your hunts'); assert.equal(b.disabled, true);
  assert.match(p.$('#otp-toast').textContent, new RegExp('Added ' + t + ' to your hunts in the Den'));
  await tick(1200);
  assert.deepEqual(cards(p).map((c) => c.getAttribute('data-u')).slice(0, order.indexOf(near.getAttribute('data-u')) + 1),
    order.slice(0, order.indexOf(near.getAttribute('data-u')) + 1), 'nothing above it moved');
  assert.ok(p.$$('#otp-flockRow .fl-add').filter((x) => x.getAttribute('data-t') === t).every((x) => x.disabled), 'every card for it says so');
  // from now on it is a hunt like the others: Shuffle shows its finds as hunt finds, with no + Add
  p.$('#otp-flockShuf').click();
  await settle(p);
  const own = await waitFor(() => cards(p).find((c) => c.getAttribute('data-h') === t), { timeout: 8000 });
  assert.equal(own.getAttribute('data-near'), null);
  assert.equal(own.querySelector('.fl-add'), null);
  assert.equal(own.querySelector('.fl-for').textContent, 'for ' + t);
  await p.close();
});

test('a panel term that is not in the Den also offers + Add to hunts', async () => {
  const p = await flock({ hunts: ['panther'] }, { owlTwigSgwTerms: ['haeger'] });
  await settle(p);
  const c = cards(p).find((x) => x.getAttribute('data-h') === 'haeger');
  assert.ok(c);
  assert.equal(c.querySelector('.fl-nd').textContent, 'Not in your hunts yet');
  assert.ok(c.querySelector('.fl-add'));
  assert.equal(c.querySelector('.fl-near'), null);
  await p.close();
});

const searches = (p, q) => p.calls.filter((u) => new URL(u, 'https://x.example/').searchParams.get('q') === q).length;
test('swipe-aways look elsewhere, and a near search swiped away twice is dropped', async () => {
  const p = await flock({ hunts: ['panther', 'pyrex'] });
  await settle(p);
  cards(p)[0].querySelector('.fl-lk').click();
  await settle(p);
  const first = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1'), { timeout: 8000 });
  const t = first.getAttribute('data-h');
  const n = p.calls.length;
  first.querySelector('.fl-x').click();
  await waitFor(() => p.calls.length > n, { timeout: 4000 });   // it asks more marketplaces
  await settle(p);
  const second = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1' && x.getAttribute('data-h') === t), { timeout: 8000 });
  second.querySelector('.fl-x').click();
  await settle(p);
  const had = searches(p, t);
  p.$('#otp-flockShuf').click();
  await settle(p);
  assert.ok(!cards(p).some((x) => x.getAttribute('data-h') === t), 'its finds leave the feed');
  assert.equal(searches(p, t), had, 'and it is not searched again');
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
  for (let i = 0; i < 2; i++) {
    const c = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1' && x.getAttribute('data-h') === t && !x.querySelector('.fl-lk.on')), { timeout: 8000 });
    c.querySelector('.fl-x').click();
    await settle(p);
  }
  p.$('#otp-flockShuf').click();
  await settle(p);
  assert.ok(await waitFor(() => cards(p).some((x) => x.getAttribute('data-near') === '1' && x.getAttribute('data-h') === t), { timeout: 8000 }), 'still searched');
  await p.close();
});
