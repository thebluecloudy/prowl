// Page v8.31 (worker v204, Matt on Store › Facebook: most hunts "Checks soon", several "Nothing on Facebook for this
// hunt lately"): a searched hunt with no finds says why, from /fb-finds' why {raw, far, words, mi}; an older record
// without counts keeps the old sentence; the Store's Facebook screen lists hunts with finds first (newest first) and
// folds the rest into one line (a <details>) that opens to each hunt's reason or "Checks soon".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const today = new Date(); today.setHours(8, 5, 0, 0);
const DAY = today.toISOString().slice(0, 10);
const yest = new Date(today.getTime() - 86400000);
const PRO = { 'prowl.alertPro': '1', 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'pro@example.com' };
const HUNTS = ['ceramic panther', 'fire king jadeite', 'pots & pans', 'hull vase', 'rookwood', 'roseville', 'pyrex'];
const item = (id, extra = {}) => ({ title: 'Panther ' + id, price: '$' + id, url: 'https://www.facebook.com/marketplace/item/' + id + '/', image: '', found: DAY, ...extra });
const ALL = {
  live: true, left: 5,
  hunts: [
    { term: 'ceramic panther', updated: yest.toISOString(), pending: false, usa: false, why: { raw: 3, far: 0, words: 0, mi: 25 }, items: [item('1111111', { miles: 8 })] },
    { term: 'fire king jadeite', updated: today.toISOString(), pending: false, usa: false, why: { raw: 24, far: 24, words: 0, mi: 25 }, items: [] },
    { term: 'pots & pans', updated: today.toISOString(), pending: false, usa: false, why: { raw: 0, far: 0, words: 0, mi: 25 }, items: [] },
    { term: 'hull vase', updated: today.toISOString(), pending: false, usa: false, why: { raw: 9, far: 0, words: 9, mi: 25 }, items: [] },
    { term: 'rookwood', updated: today.toISOString(), pending: false, usa: false, why: null, items: [] },
    { term: 'roseville', updated: today.toISOString(), pending: false, usa: false, items: [item('2222222', { miles: 3 })] },
    { term: 'pyrex', updated: '', pending: true, usa: false, why: null, items: [] },
  ],
};

function rig({ finds = null, all = ALL } = {}) {
  const base = liveFetch({}), asked = [];
  const ok = (j, s = 200) => Promise.resolve({ ok: s < 400, status: s, json: () => Promise.resolve(j) });
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/fb-finds') { asked.push(u.search); return ok(u.searchParams.get('all') ? all : finds || { term: u.searchParams.get('term'), live: true, updated: '', pending: true, items: [] }); }
    if (u.pathname === '/alerts/prefs') { const b = JSON.parse(opts.body); return ok({ ok: true, prefs: b.prefs }); }
    if (u.pathname === '/alerts/status') return ok({ on: true, pro: true, hunts: HUNTS, prefs: { zip: '48375', radius: 25 }, fb: true });
    return base.impl(url, opts);
  };
  return { impl, asked };
}
async function home(f, hunts = HUNTS) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts, lock: hunts.map((_, i) => i) }, owlTwigSgwTerms: [], ...PRO } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  return p;
}
const pick = (p, v) => { const s = p.$('#otp-stSel'); s.value = v; s.dispatchEvent(new p.win.Event('change', { bubbles: true })); };
async function store(f) {
  const p = await home(f);
  await waitFor(() => p.$$('#otp-sgw .sgw-sub').some((x) => /Facebook Marketplace/.test(x.textContent)), { timeout: 6000 });   /* /alerts/status has said Facebook is on */
  p.$('#otp-dock .db[data-m="store"]').click();
  await tick(50);
  pick(p, 'facebook');
  await waitFor(() => p.$('#otp-fbAll .fb-rest') || (p.$('#otp-fbAll') && p.$$('#otp-fbAll h3').length), { timeout: 4000 });
  return p;
}
const rows = (p) => p.$$('#otp-fbAll .fb-rl li').map((li) => [li.querySelector('b').textContent, li.querySelector('span').textContent]);

test('v8.31: each reason sentence; All USA says 500 mi; no counts (before v204) keeps the old sentence', async () => {
  const H = (term, why, usa = false) => ({ term, updated: today.toISOString(), pending: false, usa, why, items: [] });
  const all = { live: true, left: 5, hunts: [
    H('ceramic panther', { raw: 0, far: 0, words: 0, mi: 25 }), H('a', { raw: 24, far: 24, words: 0, mi: 25 }), H('b', { raw: 12, far: 12, words: 0, mi: 500 }, true),
    H('c', { raw: 12, far: 12, words: 0, mi: 25 }, true), H('d', { raw: 9, far: 0, words: 9, mi: 25 }), H('e', { raw: 24, far: 15, words: 9, mi: 25 }),
    H('f', { raw: 24, far: 15, words: 0, mi: 25 }), H('g', { raw: 5, far: 0, words: 0, mi: 25 }), H('h', null), H('i', 'junk'), H('j', { raw: 0, far: 0, words: 0, mi: 500 }, true)] };
  const p = await store(rig({ all }));
  const r = rows(p).map((x) => x[1].replace(/Updated this morning$/, ''));
  assert.deepEqual(r, [
    'Facebook had nothing for \u201cceramic panther\u201d near you in its last search.',
    'Facebook had 24, none within 25 mi.',
    'Facebook had 12, none within 500 mi.',
    'Facebook had 12, none within 500 mi.',
    'Facebook had 9, none with all your words. Try fewer words.',
    'Facebook had 24: 15 too far, 9 without all your words.',
    'Facebook had 24: 15 too far, 9 sold or not usable.',
    'Facebook had 5, all sold or not usable.',
    'Nothing on Facebook for this hunt lately.',
    'Nothing on Facebook for this hunt lately.',
    'Facebook had nothing for \u201cj\u201d across the USA in its last search.',
  ]);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.31: Store › Facebook: hunts with finds first, newest first; the rest in one folded line with their reasons', async () => {
  const p = await store(rig());
  assert.deepEqual(p.$$('#otp-fbAll h3').map((h) => h.textContent), ['roseville', 'ceramic panther'], 'today before yesterday');
  const d = p.$('#otp-fbAll details.fb-rest');
  assert.ok(d, 'one folded line');
  assert.equal(d.open, false, 'closed while some hunts have finds');
  assert.equal(d.querySelector('summary').textContent, '4 hunts with nothing yet · 1 checking soon');
  assert.ok(p.$('#otp-fbF'), 'the search box stays at the top');
  assert.ok(p.$('#otp-fbF').compareDocumentPosition(d) & p.win.Node.DOCUMENT_POSITION_FOLLOWING);
  const r = rows(p);
  assert.deepEqual(r.map((x) => x[0]), ['fire king jadeite', 'pots & pans', 'hull vase', 'rookwood', 'pyrex']);
  assert.match(r[0][1], /^Facebook had 24, none within 25 mi\.Updated this morning$/);
  assert.match(r[1][1], /^Facebook had nothing for “pots & pans” near you in its last search\./);
  assert.match(r[2][1], /^Facebook had 9, none with all your words\. Try fewer words\./);
  assert.match(r[3][1], /^Nothing on Facebook for this hunt lately\./, 'an older record keeps the old sentence');
  assert.equal(r[4][1], 'Checks soon');
  assert.match(d.innerHTML, /pots &amp; pans/, 'escaped');
  assert.doesNotMatch(p.$('#otp-fbAll').innerHTML, /<b>pots & pans/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.31: with no finds anywhere the folded line starts open; only pending hunts say "N hunts checking soon"', async () => {
  let p = await store(rig({ all: { live: true, left: 5, hunts: [ALL.hunts[1], ALL.hunts[6]] } }));
  let d = p.$('#otp-fbAll details.fb-rest');
  assert.equal(d.open, true);
  assert.equal(d.querySelector('summary').textContent, '1 hunt with nothing yet · 1 checking soon');
  await p.close();
  p = await store(rig({ all: { live: true, left: 5, hunts: [ALL.hunts[6], Object.assign({}, ALL.hunts[6], { term: 'rookwood' })] } }));
  d = p.$('#otp-fbAll details.fb-rest');
  assert.equal(d.querySelector('summary').textContent, '2 hunts checking soon');
  assert.match(d.textContent, /up to 10 of your hunts, in turn/);
  await p.close();
});

test('v8.31: the hunt page strip says why a searched hunt is empty, or the old sentence without counts', async () => {
  let p = await home(rig({ finds: { term: 'ceramic panther', live: true, updated: today.toISOString(), usa: true, radius: 25, pending: false, why: { raw: 30, far: 30, words: 0, mi: 500 }, items: [] } }), ['ceramic panther']);
  await waitFor(() => /Facebook had 30, none within 500 mi\./.test(p.$('#otp-sgw').textContent), { timeout: 4000 });
  await p.close();
  p = await home(rig({ finds: { term: 'ceramic panther', live: true, updated: today.toISOString(), usa: false, radius: 25, pending: false, items: [] } }), ['ceramic panther']);
  await waitFor(() => /Nothing new on Facebook for this hunt today\./.test(p.$('#otp-sgw').textContent), { timeout: 4000 });
  assert.deepEqual(p.errors, []);
  await p.close();
});
