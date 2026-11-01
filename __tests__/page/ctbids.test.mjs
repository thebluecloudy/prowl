// CTBids (page v6.68, worker v96): Caring Transitions' online estate sale auctions, a link-out in BOLO with the
// other estate sales and auctions. CTBids has no ?q= search: its results page is /view-more-items/<words>, and that
// one route also shows CTBids' own lists for four words (trending-now, ending-soon, featured, cool-and-unique).
// The app reads the path with decodeURI, so characters that stay encoded (/ ? # & + ...) would reach its search as
// "%2F" and the like; they become spaces instead. The page and the worker (alert emails) build the same link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const read = (f) => readFileSync(fileURLToPath(new URL('../../' + f, import.meta.url)), 'utf8');
const PAGE = read('page/prowl.html');
const WORKER = read('worker/index.js');

function lift(src, name) {
  const m = new RegExp('^function ' + name + '\\(q\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm').exec(src);
  assert.ok(m, name + ' is found');
  return new Function('E', m[0] + '\nreturn ' + name + ';')(encodeURIComponent);
}
const pageUrl = lift(PAGE, 'ctbUrl');
const workerUrl = lift(WORKER, 'ctbUrl');
/* the alert emails' "Also search" links, as the worker builds them (with its ctbUrl and DEPOP_URL) */
const AL_ALSO = new Function(
  /^const DEPOP_URL = [^\n]*;/m.exec(WORKER)[0] + '\n' + /^function ctbUrl\(q\)\s*\{[\s\S]*?\n\}/m.exec(WORKER)[0] + '\n' +
  'const AL_ALSO = ' + /^const AL_ALSO = (\[[\s\S]*?\n\]);/m.exec(WORKER)[1] + ';\nreturn AL_ALSO;')();

const CASES = [
  ['pyrex', 'https://ctbids.com/view-more-items/pyrex'],
  ['Pyrex Butterprint', 'https://ctbids.com/view-more-items/Pyrex%20Butterprint'],
  ['  fire-king   jadeite ', 'https://ctbids.com/view-more-items/fire-king%20jadeite'],
  ['1/2 pint creamer', 'https://ctbids.com/view-more-items/1%202%20pint%20creamer'],
  ['salt & pepper shakers', 'https://ctbids.com/view-more-items/salt%20pepper%20shakers'],
  ['corningware #a-1-b?', 'https://ctbids.com/view-more-items/corningware%20a-1-b'],
  ['50% off+sale', 'https://ctbids.com/view-more-items/50%20off%20sale'],
  ["Pfaltzgraff's yorktowne", "https://ctbids.com/view-more-items/Pfaltzgraff's%20yorktowne"],
  ['Noritake 日本', 'https://ctbids.com/view-more-items/Noritake%20%E6%97%A5%E6%9C%AC'],
  ['featured', 'https://ctbids.com/view-more-items/featured%20'],
  ['Trending-Now', 'https://ctbids.com/view-more-items/Trending-Now%20'],
  ['ending-soon', 'https://ctbids.com/view-more-items/ending-soon%20'],
  ['cool-and-unique', 'https://ctbids.com/view-more-items/cool-and-unique%20'],
  ['featured lamp', 'https://ctbids.com/view-more-items/featured%20lamp'],
  ['', 'https://ctbids.com/'],
  [' / ? ', 'https://ctbids.com/'],
];

test('the CTBids link puts the words in /view-more-items/, which the app decodes back to the same words', () => {
  for (const [q, want] of CASES) {
    const u = pageUrl(q);
    assert.equal(u, want, JSON.stringify(q));
    if (u === 'https://ctbids.com/') continue;
    const seg = decodeURI(u.slice('https://ctbids.com/view-more-items/'.length));
    assert.doesNotMatch(seg, /%[0-9A-F]{2}/i, 'nothing stays encoded after decodeURI: ' + JSON.stringify(q));
    assert.ok(!/^(trending-now|ending-soon|featured|cool-and-unique)$/.test(seg), 'never one of its own lists: ' + JSON.stringify(q));
  }
});

test('the worker builds the same CTBids link as the page (alert emails)', () => {
  for (const [q] of CASES) assert.equal(workerUrl(q), pageUrl(q), JSON.stringify(q));
  const also = AL_ALSO.find((a) => a[0] === 'CTBids');
  assert.ok(also, 'in the emails\' "Also search" links');
  for (const [q] of CASES) assert.equal(also[1](q), pageUrl(q), 'email link ' + JSON.stringify(q));
  assert.match(WORKER, /\n {2}ctbids: "CTBids: [^"]+",/, 'in "where to look", with the page id');
});

test('CTBids is a BOLO marketplace: in the drawer, the count and Search All, grouped with the local sales and auctions', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  assert.equal(p.$('.lede [data-t]').textContent, '30');
  assert.equal(p.$('#otp-tb u').textContent, '10', 'BOLO count');
  p.$('#otp-shw').click();
  const row = p.$('#otp-mk input[data-m="ctbids"]');
  assert.ok(row, 'CTBids is in the marketplace drawer');
  assert.equal(row.checked, true, 'on by default, like every marketplace');
  assert.equal(row.closest('label').querySelector('em').textContent, 'CTBids');
  assert.equal(row.closest('label').querySelector('.tag').textContent, 'BOLO');

  p.$('#otp-q').value = 'Pyrex Butterprint';
  p.$('#otp-sa').click();   // v6.88: Search All under the search box (the dock's ALL is now LOCAL)
  await tick(30);
  const a = p.$$('#otp-res a.hit').find((x) => /ctbids\.com/.test(x.href));
  assert.ok(a, 'Search All has a CTBids row');
  assert.equal(a.getAttribute('href'), 'https://ctbids.com/view-more-items/Pyrex%20Butterprint');
  assert.equal(a.querySelector('.hit-icon').textContent, 'CT');
  assert.ok(a.querySelector('.hit-icon').classList.contains('loc'), 'marked local');
  let li = a.closest('li'), grp = null;
  while ((li = li.previousElementSibling)) if (li.classList.contains('grp')) { grp = li; break; }
  assert.ok(grp && /^Local & auctions/.test(grp.textContent), 'under Local & auctions, not Online shops');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a saved marketplace set from before v6.68 gains CTBids once; turned off afterwards, it stays off', async () => {
  const saved = { hunts: ['a', 'b'], sel: [], lock: [], mkt: ['ebay', 'salvation'], city: '', seen: true, fbHub: 'local', one: 'shopgoodwill', h21: 1, h36: 1, h42: 1 };
  // adding a new hunt saves; a hunt already in the list is refused and saves nothing, so each add uses a fresh term
  const saveNow = (p, term) => {
    const before = p.win.localStorage.getItem('prowl.v36');
    p.$('#otp-newTerm').value = term; p.$('#otp-addTerm').click();
    const raw = p.win.localStorage.getItem('prowl.v36');
    assert.notEqual(raw, before, 'adding "' + term + '" saved');
    return JSON.parse(raw);
  };
  const p = loadPage({ storage: { 'prowl.v36': saved } });
  await tick(40);
  const after = saveNow(p, 'Hull pottery');
  assert.deepEqual(after.mkt.slice().sort(), ['ctbids', 'ebay', 'salvation', 'shopapp'], 'a save from before v6.68 is also from before Shop (v8.37)');
  assert.equal(after.h68, 1, 'the save says CTBids was offered');
  await p.close();
  const p2 = loadPage({ storage: { 'prowl.v36': { ...after, mkt: ['ebay', 'salvation'] } } });
  await tick(40);
  const again = saveNow(p2, 'Fiesta pitcher');
  assert.deepEqual(again.hunts.slice(-2), ['Hull pottery', 'Fiesta pitcher'], 'the second visit saved');
  assert.deepEqual(again.mkt.slice().sort(), ['ebay', 'salvation'], 'unticked after v6.68 stays unticked');
  await p2.close();
});

test('CTBids is named with the other estate sales and auction houses, and in the not-affiliated line', () => {
  const text = PAGE.replace(/<[^>]+>/g, ' ');
  assert.match(text, /EstateSales\.net, HiBid, LiveAuctioneers, CTBids and Invaluable, one tap each/);
  const lists = PAGE.match(/EstateSales\.net, HiBid, LiveAuctioneers, CTBids, Heritage Auctions, Invaluable, Craigslist and eBay Sold/g) || [];
  assert.equal(lists.length, 2, 'the FAQ answer and its JSON-LD say the same');
  assert.match(PAGE, /not affiliated with[^<]*\bCTBids, Caring Transitions\b/);
});
