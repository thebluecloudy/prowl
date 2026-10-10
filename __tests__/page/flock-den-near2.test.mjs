// Page v6.61 (part 3): near searches keep one spelling for the same words, a like whose search became a hunt starts no
// leftover search, and past FLOCK_NEAR_KEEP the newest near searches are the ones that stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const cards = (p) => p.$$('#otp-flockRow .fl-card');
const qOf = (u) => new URL(u, 'https://x.example/').searchParams.get('q');
const terms = (calls) => [...new Set(calls.map(qOf).filter(Boolean))];
const nkey = (q) => q.split(' ').sort().join(' ');
async function settle(p) {
  let n = -1;
  for (let i = 0; i < 60 && p.calls.length !== n; i++) { n = p.calls.length; await tick(700); }
  await tick(1100);
}
/* a fetch stub whose listing titles come from `title(q, src, i)` */
function titled(title) {
  const calls = [];
  const impl = (url) => {
    calls.push(String(url));
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname.startsWith('/apps/prowl/')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
    const q = u.searchParams.get('q') || 'x', src = u.pathname.replace(/\//g, '') || 'shopgoodwill';
    const host = src === 'shopgoodwill' ? 'shopgoodwill.com/item' : src === 'ebay' ? 'www.ebay.com/itm' : `www.${src}.com/listing`;
    const items = [];
    for (let i = 0; i < 3; i++) items.push({ title: title(q, src, i), price: `$${10 + i}.00`, url: `https://${host}/${encodeURIComponent(q)}-${i}`, image: `https://img.example.com/${src}/${i}.jpg`, src: src === 'shopgoodwill' ? '' : src });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
  };
  return { impl, calls };
}
async function flock(f, storage, { wide = false } = {}) {
  const p = loadPage({ fetchImpl: f.impl, storage: { owlTwigSgwTerms: [], ...storage }, beforeLoad: (w) => {
    w.Math.random = () => 0.5;
    if (wide) { const mm = w.matchMedia; w.matchMedia = (q) => (/min-width:\s*1024px/.test(q) ? { ...mm(q), matches: true } : mm(q)); }
  } });
  p.calls = f.calls;
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => cards(p).length >= 2, { timeout: 8000 });
  await settle(p);
  return p;
}

test('a new like that reorders a near search\'s words keeps its spelling: the same words are never searched twice', async () => {
  const f = titled((q, src, i) => (q === 'pyrex' ? `Green glass vase ${src} ${i}` : `${q} piece ${src} ${i}`));
  const like = { u: 'https://www.ebay.com/itm/111111', t: 'Haeger green bowl', p: '$20.00', s: 'ebay', i: '', h: 'pyrex', at: 1 };
  const p = await flock(f, { 'prowl.v36': { seen: true, hunts: ['pyrex'] }, 'prowl.likes': [like] });
  assert.ok(terms(p.calls).includes('haeger green'), 'the like\'s near search: ' + terms(p.calls).join(' | '));
  /* like a pyrex card: "green" is now in two likes, so the old like's words would rank "green haeger" */
  cards(p).find((c) => c.getAttribute('data-h') === 'pyrex').querySelector('.fl-lk').click();
  await settle(p);
  const after = terms(p.calls).filter((q) => q !== 'pyrex');
  assert.equal(new Set(after.map(nkey)).size, after.length, 'one search per set of words: ' + after.join(' | '));
  const near = [...new Set(cards(p).filter((c) => c.getAttribute('data-near') === '1').map((c) => c.getAttribute('data-h')))];
  assert.ok(near.includes('haeger green'), 'the near search already in the feed keeps its cards: ' + near.join(' | '));
  assert.ok(!near.includes('green haeger'));
  await p.close();
});

test('a like whose near search became a hunt starts no leftover search, even with another hunt\'s word in its title', async () => {
  const f = liveFetch();
  const like = { u: 'https://www.ebay.com/itm/1', t: 'Pyrex Butterprint Rose Mixing Bowl Lid', p: '$20.00', s: 'ebay', i: '', h: 'pyrex', at: 1 };
  const p = await flock(f, { 'prowl.v36': { seen: true, hunts: ['pyrex', 'rose'] }, 'prowl.likes': [like] });
  const near = await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1'), { timeout: 8000 });
  assert.equal(near.getAttribute('data-h'), 'butterprint mixing', 'the spark leaves out both hunts\' words');
  near.querySelector('.fl-add').click();
  const n = p.calls.length;
  p.$('#otp-flockShuf').click();
  await settle(p);
  const after = terms(p.calls.slice(n));
  assert.ok(!after.some((q) => /\blid\b/.test(q)), 'no leftover search ("bowl lid"): ' + after.join(' | '));
  assert.ok(after.includes('butterprint mixing'), 'it is searched as a hunt now');
  const kept = {};
  for (let i = 0; i < p.win.localStorage.length; i++) { const k = p.win.localStorage.key(i); kept[k] = p.win.localStorage.getItem(k); }
  await p.close();

  /* after a reload, with a newer like that shares a word (the word ranking shifts), it is still spent */
  const newer = { u: 'https://www.ebay.com/itm/9', t: 'Blue Mixing Bowl', p: '$9.00', s: 'ebay', i: '', h: 'pyrex', at: 2 };
  const f2 = liveFetch();
  const p2 = await flock(f2, { ...kept, 'prowl.likes': [newer, like] });
  const t2 = terms(p2.calls);
  assert.ok(!t2.some((q) => /\blid\b/.test(q)), 'no leftover search after a reload: ' + t2.join(' | '));
  await p2.close();

  /* take that hunt out of the Den and the like searches again */
  const den = JSON.parse(kept['prowl.v36']);
  den.hunts = den.hunts.filter((h) => h.toLowerCase() !== 'butterprint mixing');
  den.lock = [];
  const f3 = liveFetch();
  const p3 = await flock(f3, { ...kept, 'prowl.v36': JSON.stringify(den), 'prowl.likes': [like] });
  assert.ok(terms(p3.calls).includes('butterprint mixing'), 'searched near the like again: ' + terms(p3.calls).join(' | '));
  await p3.close();
});

test('another two-word hunt at the start of a liked title does not stop that like\'s near search', async () => {
  const f = liveFetch();
  const like = { u: 'https://www.ebay.com/itm/3', t: 'Fire King Jadeite Restaurant Mug Lamp', p: '$30.00', s: 'ebay', i: '', h: 'lamp', at: 1 };
  const p = await flock(f, { 'prowl.v36': { seen: true, hunts: ['lamp', 'fire king'] }, 'prowl.likes': [like] });
  assert.ok(terms(p.calls).includes('jadeite restaurant'), 'its near search runs: ' + terms(p.calls).join(' | '));
  await p.close();
});

test('a like of a many-word hunt whose title starts with that hunt still starts its near search', async () => {
  const f = liveFetch();
  const like = { u: 'https://www.ebay.com/itm/2', t: 'Pyrex Butterprint Turquoise Mixing Bowl', p: '$20.00', s: 'ebay', i: '', h: 'Pyrex Butterprint', at: 1 };
  const p = await flock(f, { 'prowl.v36': { seen: true, hunts: ['Pyrex Butterprint', 'Blenko glass'] }, 'prowl.likes': [like] });
  assert.ok(terms(p.calls).includes('turquoise mixing'), 'its own hunt does not count as its spark: ' + terms(p.calls).join(' | '));
  await waitFor(() => cards(p).find((x) => x.getAttribute('data-near') === '1' && x.getAttribute('data-h') === 'turquoise mixing'), { timeout: 8000 });
  await p.close();
});

test('past FLOCK_NEAR_KEEP near searches, the newest stay in the feed and the oldest give way', async () => {
  let ctr = 0;
  const W = ['alder', 'birch', 'cedar', 'dogwood', 'elm', 'fir', 'ginkgo', 'hazel', 'ironwood', 'juniper', 'kapok', 'larch', 'maple', 'nutmeg', 'oak', 'pine', 'quince', 'rowan', 'spruce', 'teak', 'ulmus', 'viburnum', 'walnut', 'xylem', 'yew', 'zelkova'];
  const word = () => { const a = W[ctr % W.length], d = Math.floor(ctr / W.length); ctr++; return a + 'q'.repeat(d); };
  const f = titled(() => `${word()} ${word()}`);
  const p = await flock(f, { 'prowl.v36': { seen: true, hunts: ['pyrex'] } }, { wide: true });
  const nearNow = () => new Set(cards(p).filter((c) => c.getAttribute('data-near') === '1').map((c) => c.getAttribute('data-h')));
  const order = [];   // near searches in the order they first showed up
  const lost = [], drawn = new Set(), gone = [];
  for (let k = 0; k < 11; k++) {
    for (const u of drawn) if (!cards(p).some((x) => x.getAttribute('data-u') === u)) gone.push(u);
    cards(p).forEach((x) => drawn.add(x.getAttribute('data-u')));
    const c = cards(p).find((x) => !x.querySelector('.fl-lk.on'));
    if (!c) break;
    c.querySelector('.fl-lk').click();
    await settle(p);
    const now = nearNow();
    for (const t of now) if (!order.includes(t)) order.push(t);
    const newest = order.slice(-4);
    for (const t of newest) if (!now.has(t)) lost.push({ like: k + 1, t });
  }
  assert.ok(order.length > 8, 'more near searches than the feed keeps: ' + order.length);
  assert.deepEqual(lost, [], 'the most recent near searches keep their cards');
  /* v6.73: on a computer the grid never takes a card away under the mouse; an older near search that gives way
     keeps the cards already drawn and only stops adding new ones */
  assert.deepEqual(gone, [], 'no card on a computer\'s grid disappears');
  await p.close();
});
