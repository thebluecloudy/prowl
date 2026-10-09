// Page v6.47: likes. The heart on a Flock card, the feed that learns from likes, the Den's LIKES tab, backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const LIKES = 'prowl.likes';
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');

// two hunts; eBay answers five listings per hunt, all with photos; one per hunt says "jadeite"
const TITLES = { panther: ['black glaze lamp', 'ceramic planter', 'jadeite glaze figure', 'tv lamp base', 'wall plaque'],
  pyrex: ['butterprint bowl', 'gooseberry dish', 'jadeite mixing bowl', 'snowflake casserole', 'spring blossom mug'] };
function liveFetch() {
  const calls = [];
  const impl = (url) => {
    calls.push(String(url));
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    const q = (u.searchParams.get('q') || '').toLowerCase();
    let items = [];
    // every live marketplace answers the same five titles (Flock asks a random few of them per hunt)
    const src = u.pathname.replace(/\//g, '');
    if (TITLES[q] && u.pathname !== '/item') items = TITLES[q].map((t, i) => ({ title: q + ' ' + t, price: '$' + (20 + i) + '.00', url: 'https://www.ebay.com/itm/' + (q === 'panther' ? '11' : '22') + (src.length + 10) + '0000' + i, image: 'https://i.ebayimg.com/' + q + src + i + '.jpg', src: src || '' }));
    if (u.pathname === '/item') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ src: 'ebay', title: 'x', images: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
  };
  return { impl, calls };
}
const like = (t, h, extra = {}) => ({ u: 'https://www.ebay.com/itm/9' + Math.abs(t.length * 7919) + '1', t, p: '$25.00', s: 'ebay', i: 'https://i.ebayimg.com/l.jpg', h, at: 1, ...extra });
async function flock(storage = {}, rand = 0.5) {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { hunts: [] }, owlTwigSgwTerms: ['panther', 'pyrex'], ...storage }, beforeLoad: (win) => { if (rand != null) win.Math.random = () => rand; } });
  p.win.confirm = () => true;
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  // v6.52: wait until both hunts are in and the background fetching has settled (as long as the settling: CI runs four
  // test files at once, and this test loads the page twice)
  await waitFor(() => p.$('#otp-flockRow .fl-card[data-h="panther"]') && p.$('#otp-flockRow .fl-card[data-h="pyrex"]'), { timeout: 8000 });
  await waitFor(() => p.$('#otp-flockRow').getAttribute('aria-busy') === 'false', { timeout: 8000 });
  await tick(300);
  return p;
}
const cards = (p) => p.$$('#otp-flockRow .fl-card');
const titleOf = (c) => c.getAttribute('aria-label');

test('every Flock card has a heart; tapping it likes and unlikes, and never opens the listing', async () => {
  const p = await flock();
  const c = cards(p)[0], b = c.querySelector('.fl-lk');
  assert.ok(b, 'heart button on the card');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(b.textContent, '♡');
  const e = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  b.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true, 'no listing opens');
  assert.ok(p.$('#otp-sheet').hidden, 'no popup either');
  const L = ls(p, LIKES);
  assert.equal(L.length, 1);
  assert.equal(L[0].u, c.getAttribute('data-u'));
  assert.equal(L[0].t, titleOf(c));
  assert.equal(L[0].h, c.getAttribute('data-h'));
  assert.ok(L[0].h === 'panther' || L[0].h === 'pyrex', 'remembers which hunt it came from');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(b.textContent, '♥');
  assert.match(p.$('#otp-toast').textContent, /Flock will show you more like this/);
  b.click();
  assert.deepEqual(ls(p, LIKES), [], 'tap again to unlike');
  assert.equal(b.textContent, '♡');
  await p.close();
});

test('likes push look-alike finds to the top of each hunt', async () => {
  const p = await flock({ [LIKES]: [like('Fire-King jadeite mug', 'pyrex'), like('jadeite salt shaker', 'pyrex')] }, 0.99);
  const first = {};
  for (const c of cards(p)) { const h = c.getAttribute('data-h'); if (!first[h]) first[h] = titleOf(c); }
  assert.match(first.panther, /jadeite/, 'panther: the jadeite find leads');
  assert.match(first.pyrex, /jadeite/, 'pyrex: the jadeite find leads');
  await p.close();
});

test('about 1 pick in 4 stays random, so the feed still surprises', async () => {
  const likes = { [LIKES]: [like('Fire-King jadeite mug', 'pyrex'), like('jadeite salt shaker', 'pyrex')] };
  // Math.random 0.24 is under the explore rate: the slot takes a random find instead of the best match
  const firstPanther = async (r) => { const p = await flock(likes, r); const c = cards(p).find((x) => x.getAttribute('data-h') === 'panther'); const t = titleOf(c); await p.close(); return t; };
  const best = await firstPanther(0.3), explored = await firstPanther(0.24);
  assert.match(best, /jadeite/, 'above the explore rate: the best match');
  assert.doesNotMatch(explored, /jadeite/, 'under it: a random find');
});

// v6.52: the feed is endless; per round the most-liked hunt gives two cards, the others one. Count the first batch.
const win = (p, h) => cards(p).slice(0, 10).filter((c) => c.getAttribute('data-h') === h).length;
test('the hunt you like most gets twice the cards', async () => {
  const p = await flock({ [LIKES]: [like('panther lamp', 'panther'), like('panther planter', 'panther')] }, 0.99);
  assert.ok(cards(p).length >= 10);
  assert.ok(win(p, 'panther') >= win(p, 'pyrex') + 3, win(p, 'panther') + ' vs ' + win(p, 'pyrex'));
  await p.close();
});

test('with no likes the hunts take turns', async () => {
  const p = await flock({}, 0.99);
  assert.ok(cards(p).length >= 10, 'more than the old 2 per hunt');
  assert.ok(Math.abs(win(p, 'panther') - win(p, 'pyrex')) <= 1, win(p, 'panther') + ' vs ' + win(p, 'pyrex'));
  await p.close();
});

test('a swipe-away drops the like and is remembered against its words; Undo brings both back', async () => {
  const p = await flock();
  const c = cards(p)[0], u = c.getAttribute('data-u');
  c.querySelector('.fl-lk').click();
  assert.equal(ls(p, LIKES).length, 1);
  c.querySelector('.fl-x').click();
  assert.deepEqual(ls(p, LIKES), []);
  assert.equal(ls(p, 'prowl.disTitles').at(-1).u, u);
  const gone = ls(p, 'prowl.likesGone');
  assert.equal(gone[0].u, u, 'v6.48: remembered as unliked, with its time');
  p.$('#otp-undis').click();
  assert.equal(ls(p, LIKES)[0].u, u);
  assert.ok(ls(p, LIKES)[0].at >= gone[0].at, 'the like brought back is newer than the unlike, so a sync keeps it');
  assert.deepEqual(ls(p, 'prowl.likesGone'), [], 'a like again clears the unlike');
  assert.equal((ls(p, 'prowl.disTitles') || []).filter((x) => x.u === u).length, 0);
  await p.close();
});

test('Den > LIKES lists likes, shows what Prowl learned, and lets you mute a word or unlike', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { [LIKES]: [like('Haeger panther lamp', 'pyrex'), like('Haeger planter', 'pyrex', { u: 'https://www.ebay.com/itm/5550001' })] } });
  p.win.confirm = () => true;
  await tick(40);
  p.$('#otp-denBtn').click();
  const tab = p.$('#otp-denT5');
  assert.equal(tab.textContent, 'LIKES 2');
  tab.click();
  const pane = p.$('#otp-denLikes');
  assert.equal(pane.hidden, false);
  assert.equal(pane.querySelectorAll('.lk-cell').length, 2);
  const chips = [...pane.querySelectorAll('.lk-chip')].map((x) => x.firstChild.textContent);
  assert.equal(chips[0], 'haeger', 'the word in both likes comes first');
  assert.ok(!chips.includes('pyrex'), 'hunt words are left out');
  pane.querySelector('[data-lkmute="haeger"]').click();
  assert.deepEqual(ls(p, 'prowl.likeMute'), ['haeger']);
  assert.ok(![...pane.querySelectorAll('.lk-chip')].some((x) => x.firstChild.textContent === 'haeger'), 'muted word leaves the chips');
  assert.match(pane.textContent, /Ignoring: haeger/);
  pane.querySelector('[data-unlike="https://www.ebay.com/itm/5550001"]').click();
  assert.equal(ls(p, LIKES).length, 1);
  assert.equal(p.$('#otp-denT5').textContent, 'LIKES 1');
  pane.querySelector('[data-lkclear]').click();
  assert.deepEqual(ls(p, LIKES), []);
  assert.match(p.$('#otp-denLikes').textContent, /Tap ♡ on a Flock card/);
  await p.close();
});

test('backup carries likes (v8) and a restore brings them back', async () => {
  assert.match(PAGE, /var BACKUP_V=8,/);
  assert.match(PAGE, /likes:likesGet\(\),likeMute:muteGet\(\),/);
  const p = loadPage();
  p.win.confirm = () => true;
  await tick(30);
  p.$('#otp-impText').value = JSON.stringify({ app: 'prowl', v: 8, hunts: ['pyrex'], likes: [like('jadeite mug', 'pyrex'), { u: 'javascript:alert(1)', t: 'bad' }], likeMute: ['mug', 'Bad Word!'] });
  p.$('#otp-impTextBtn').click();
  const L = ls(p, LIKES);
  assert.equal(L.length, 1, 'a bad link is dropped');
  assert.equal(L[0].t, 'jadeite mug');
  assert.deepEqual(ls(p, 'prowl.likeMute'), ['mug']);
  await p.close();
});
