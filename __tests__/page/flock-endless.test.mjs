// Page v6.52: Flock is endless. It takes turns across hunts, adds the next batch as you near the end without moving
// you, shows unseen finds first, mixes in finds "near" your likes, and never brings back a swiped-away find.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const cards = (p) => p.$$('#otp-flockRow .fl-card');
async function flock(storage = {}, opts = {}) {
  const f = liveFetch(opts);
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { hunts: [] }, owlTwigSgwTerms: ['panther', 'pyrex'], ...storage }, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  p.calls = f.calls;
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$('#otp-flockRow .fl-card[data-h="panther"]') && p.$('#otp-flockRow .fl-card[data-h="pyrex"]'));
  await waitFor(() => p.$('#otp-flockRow').getAttribute('aria-busy') === 'false', { timeout: 8000 });
  await tick(300);
  return p;
}
function scrollTo(p, i) {
  cards(p).forEach((c, k) => { Object.defineProperty(c, 'offsetTop', { value: k * 100, configurable: true }); Object.defineProperty(c, 'offsetHeight', { value: 100, configurable: true }); });
  const r = p.$('#otp-flockRow');
  r.scrollTop = i * 100;
  r.dispatchEvent(new p.win.Event('scroll'));
}
let likeN = 0;
const like = (t) => ({ u: 'https://www.ebay.com/itm/7000' + (++likeN), t, p: '$30.00', s: 'ebay', i: '', h: 'panther', at: 1 });

test('more than the old 10 cards, taking turns across hunts', async () => {
  const p = await flock();
  assert.equal(cards(p).length, 10, 'a first batch of 10');
  const hs = cards(p).map((c) => c.getAttribute('data-h'));
  for (let i = 2; i < hs.length; i++) assert.ok(!(hs[i] === hs[i - 1] && hs[i] === hs[i - 2]), 'never three in a row from one hunt: ' + hs.join(','));
  await p.close();
});

test('nearing the end adds the next batch below, without moving you', async () => {
  const p = await flock();
  const first = cards(p).map((c) => c.getAttribute('data-u'));
  scrollTo(p, 8);
  await waitFor(() => cards(p).length === 20);
  assert.equal(p.$('#otp-flockRow').scrollTop, 800, 'still on the same card');
  assert.deepEqual(cards(p).slice(0, 10).map((c) => c.getAttribute('data-u')), first, 'nothing above moved');
  const all = cards(p).map((c) => c.getAttribute('data-u'));
  assert.equal(new Set(all).size, all.length, 'no repeats');
  assert.match(p.$('#otp-flockRow .fl-end').textContent, /Looking for more/);
  await p.close();
});

test('finds you have not seen come before ones you have', async () => {
  // every panther find from ShopGoodwill and eBay was seen on an earlier visit
  const seen = [];
  for (const host of ['shopgoodwill.com/item', 'www.ebay.com/itm']) for (let i = 0; i < 3; i++) seen.push(`https://${host}/panther-${i}`);
  const p = await flock({ 'prowl.flockSeen': seen });
  const pan = cards(p).filter((c) => c.getAttribute('data-h') === 'panther').map((c) => c.getAttribute('data-u'));
  assert.ok(!seen.includes(pan[0]), 'the first panther card is new');
  assert.ok(pan.slice(0, 3).every((u) => !seen.includes(u)), 'new ones lead: ' + pan.join(' '));
  await p.close();
});

test('finds near your likes are mixed in, tagged "Because you liked"', async () => {
  const p = await flock({ 'prowl.likes': [like('Haeger panther lamp'), like('Haeger planter vase')] });
  await waitFor(() => p.$('#otp-flockRow .fl-near'), { timeout: 8000 });
  const near = p.$$('#otp-flockRow .fl-card').filter((c) => c.querySelector('.fl-near'));
  // v6.60: the newest like searches straight away (its two strongest words), then the word liked twice
  assert.equal(near[0].querySelector('.fl-near').textContent, 'Because you liked ' + near[0].getAttribute('data-h'));
  assert.ok(['haeger lamp', 'haeger'].includes(near[0].getAttribute('data-h')), near[0].getAttribute('data-h'));
  assert.ok(p.calls.some((u) => /[?&]q=haeger(&|$)/.test(u)), 'it searched the liked word');
  assert.ok(p.calls.some((u) => /[?&]q=haeger(\+|%20)lamp(&|$)/.test(u)), 'and the newest like');
  const idx = cards(p).findIndex((c) => c.querySelector('.fl-near'));
  assert.equal((idx + 1) % 4, 0, 'every 4th card');
  assert.ok(!JSON.parse(p.win.localStorage.getItem('owlTwigSgwTerms')).includes('haeger'), 'it never becomes a hunt');
  await p.close();
});

test('no likes, no near finds and no extra searches', async () => {
  const p = await flock();
  assert.equal(p.$('#otp-flockRow .fl-near'), null);
  assert.ok(p.calls.every((u) => !/[?&]q=/.test(u) || /[?&]q=(panther|pyrex)(&|$)/.test(u)), 'only the hunts are searched');
  await p.close();
});

test('a swiped-away find never comes back, even in later batches', async () => {
  const gone = 'https://shopgoodwill.com/item/pyrex-0';
  const p = await flock({ 'prowl.discarded': [gone] });
  scrollTo(p, 8);
  await waitFor(() => cards(p).length === 20);
  assert.ok(cards(p).every((c) => c.getAttribute('data-u') !== gone));
  await p.close();
});
