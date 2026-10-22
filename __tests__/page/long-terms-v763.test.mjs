// Page v7.63 (Matt, 2026-10-22: "This description finds the item in Best picks but it doesn't show it live on eBay").
// A run's live rows cut the term at 60 characters mid-word ("...Texans Incorp"), and eBay, which wants every word,
// found nothing, while Best picks sent the whole title to /hunt and found six. Now a long term is cut at the last whole
// word, the live rows search up to the worker's own 80 characters (the same words as Best picks), and a kept hunt
// (60 characters) ends on a whole word too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const line = (name) => { const i = PAGE.indexOf('function ' + name + '('); assert.ok(i > -1, name); return PAGE.slice(i, PAGE.indexOf('\n', i)); };
const cutWords = new Function(line('cutWords') + '\nreturn cutWords;')();
const TITLE = 'Pedlar of Dreams: The Story of Howard Kron and Texans Incorporated';   // 66 characters
const LONG = 'Vintage Siamese cat pair ceramic figurine Texans Incorporated Howard Kron mid century';   // 85 characters

test('cutWords: a long term ends on a whole word, never part of one', () => {
  assert.equal(TITLE.length, 66);
  assert.equal(cutWords(TITLE, 60), 'Pedlar of Dreams: The Story of Howard Kron and Texans', 'was "...Texans Incorp"');
  assert.equal(cutWords(TITLE, 80), TITLE, 'short enough: unchanged');
  assert.equal(cutWords('  rookwood   vase ', 60), 'rookwood vase', 'spaces collapse and trim');
  assert.equal(cutWords('x'.repeat(70), 60), 'x'.repeat(60), 'one word longer than the limit is cut at the limit');
  assert.equal(cutWords('abc def', 3), 'abc', 'a word ending exactly at the limit stays whole');
  assert.equal(cutWords('a'.repeat(59) + '\u{1F408}', 60), 'a'.repeat(59), 'never half an emoji');
});

async function search(term) {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(40);
  const before = f.calls.length;
  p.$('#otp-q').value = term;
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(80);
  const q = (path) => f.calls.slice(before).map((u) => new URL(u, 'https://x/')).filter((u) => u.pathname.replace(/\/+$/, '').endsWith(path)).map((u) => u.searchParams.get('q'));
  return { p, q };
}

test('a 66-character title: the live eBay row searches the same words as Best picks, Incorporated included', async () => {
  const { p, q } = await search(TITLE);
  assert.deepEqual([...new Set(q('/ebay'))], [TITLE], 'live on eBay');
  assert.deepEqual([...new Set(q('/hunt'))], [TITLE], 'Best picks');
  assert.match(p.$('#otp-res .rc').textContent, /Texans Incorporated/);
  assert.doesNotMatch(p.$('#otp-res .rc').textContent, /Incorp(?!orated)/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an 85-character search reaches the worker cut at the last whole word within 80', async () => {
  const { p, q } = await search(LONG);
  const want = 'Vintage Siamese cat pair ceramic figurine Texans Incorporated Howard Kron mid';
  assert.ok(want.length <= 80);
  assert.deepEqual([...new Set(q('/ebay'))], [want]);
  assert.deepEqual([...new Set(q('/hunt'))], [want]);
  await p.close();
});

test('Keep this hunt on the long title saves it ending on a whole word', async () => {
  const { p } = await search(TITLE);
  p.$('#otp-keep').click();
  await tick(40);
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts;
  assert.ok(saved.includes('Pedlar of Dreams: The Story of Howard Kron and Texans'), JSON.stringify(saved));
  assert.ok(!saved.some((h) => /Incorp$/.test(h)), 'no half word');
  assert.deepEqual(p.errors, []);
  await p.close();
});
