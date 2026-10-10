// Page v6.72: live results put exact matches first. Exact means every word of the hunt is in the listing's title
// (Fire-King and "fire king" alike, a plural aside); the rest follow under "Close matches" in the marketplace's own
// order. The count says how many are exact only when there are both kinds. Idea from the Gem teardown (2026-10-09),
// whose "fire king jadeite" opened on Jay King jadeite jewelry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const src = [/^function exWords\(v\)\{.*\}$/m, /^function exSort\(items,t\)\{[\s\S]*?\n\}$/m].map((re) => re.exec(PAGE)[0]).join('\n');
const { exWords, exSort } = new Function(src + '\nreturn {exWords, exSort};')();
const titles = (a) => a.map((x) => x.title);

test('a title is exact when it holds every word of the hunt', () => {
  const items = ['Jay King Jadeite Ring', 'Fire-King Jadeite Restaurant Mug', 'FIRE KING jadeite bowls', 'Fire King Peach Lustre', 'Anchor Hocking Fire King jade-ite']
    .map((title) => ({ title }));
  const g = exSort(items, 'fire king jadeite');
  assert.deepEqual(titles(g.ex), ['Fire-King Jadeite Restaurant Mug', 'FIRE KING jadeite bowls']);
  assert.deepEqual(titles(g.near), ['Jay King Jadeite Ring', 'Fire King Peach Lustre', 'Anchor Hocking Fire King jade-ite'], 'close ones keep their order');
});

test('plurals, case, punctuation and apostrophes do not split a match; a word inside another word does not count', () => {
  const ex = (t, title) => exSort([{ title }], t).ex.length === 1;
  assert.ok(ex('pyrex bowls', 'Vintage Pyrex Bowl Butterprint'));
  assert.ok(ex('pyrex bowl', 'PYREX mixing bowls, set of 4'));
  assert.ok(ex('corningware dishes', 'Corningware dish w/ lid'));
  assert.ok(ex("pfaltzgraff's yorktowne", 'Pfaltzgraff’s Yorktowne plate'));
  assert.ok(ex('1/2 pint creamer', 'Fire King 1/2 pint creamer'));
  assert.ok(!ex('hull', 'Hullabaloo poster'), 'whole words only');
  assert.ok(!ex('mccoy pottery', 'McCoy planter'));
  assert.deepEqual(exWords('  Fire-King   JADEITE '), ['fir', 'king', 'jadeit']);
  /* v6.74: a plural meets its word, also when the word ends in e or ss */
  for (const [a, b] of [['vase', 'Vases'], ['plate', 'plates'], ['dish', 'dishes'], ['glass', 'glasses'], ['dress', 'dresses'], ['figurine', 'figurines'], ['box', 'boxes'], ['candle', 'candles']]) {
    assert.ok(ex(a, 'Fenton ' + b + ' lot'), a + ' / ' + b);
    assert.ok(ex(b, 'Fenton ' + a), b + ' / ' + a);
  }
});

/* eBay answers with the four titles below; every other marketplace with nothing */
function ebayOnly(list) {
  return (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    const srcId = u.pathname.replace(/\//g, '');
    const items = srcId === 'ebay' ? list.map((title, i) => ({ title, price: '$5.00', url: 'https://www.ebay.com/itm/' + (100 + i), image: '', src: 'ebay' })) : [];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
  };
}
async function open(list) {
  const p = loadPage({ fetchImpl: ebayOnly(list), storage: { 'prowl.v36': { seen: true, hunts: ['fire king jadeite'], lock: [0] }, 'prowl.lastHunt': 'fire king jadeite' } });
  await waitFor(() => /Live on eBay/.test(p.$('#otp-sgw').textContent) && p.$$('#otp-sgw a').some((a) => /ebay\.com/.test(a.href)));
  const blk = p.$$('#otp-sgw .sgw-sub').find((b) => /Live on eBay/.test(b.textContent));
  return { p, blk, grid: blk.nextElementSibling };
}

test('the eBay block shows exact matches first, then "Close matches", and counts the exact ones', async () => {
  const { p, blk, grid } = await open(['Jay King Jadeite Ring', 'Fire-King Jadeite Mug', 'Jadeite Fire King Bowl', 'Fire King Peach Lustre']);
  const kids = [...grid.children];
  const line = kids.findIndex((x) => x.classList.contains('sgw-close'));
  assert.equal(line, 2, 'the line comes after the two exact ones');
  assert.equal(kids[line].textContent, 'Close matches');
  assert.match(kids[0].textContent + kids[1].textContent, /Fire-King Jadeite Mug[\s\S]*Jadeite Fire King Bowl/);
  assert.match(kids[3].textContent, /Jay King/);
  assert.equal(blk.querySelector('.sgw-upd').textContent, '2 exact · 4 live now');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('all exact or none exact: no line and the plain count', async () => {
  for (const list of [['Fire King Jadeite Mug', 'Fire-King jadeite bowl'], ['Jay King Jadeite Ring', 'Jadeite pendant']]) {
    const { p, blk, grid } = await open(list);
    assert.equal(grid.querySelector('.sgw-close'), null);
    assert.equal(blk.querySelector('.sgw-upd').textContent, '2 live now');
    assert.equal(grid.children.length, 2);
    await p.close();
  }
});
