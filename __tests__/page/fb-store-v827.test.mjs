// Page v8.27 (worker v203): Facebook finds say how far (miles from the member's ZIP) or that the listing ships; a hunt
// Facebook has not searched yet says it is coming; a Pro member picks per hunt Near me (their local-pickup radius) or
// All USA (prefs().fbusa, saved through POST /alerts/prefs); and the Store tab offers Facebook Marketplace while fbOn(),
// with every hunt's finds from GET /fb-finds?all=1 and a live one-off search (POST /fb-search, 5 a day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const today = new Date(); today.setHours(8, 5, 0, 0);
const DAY = today.toISOString().slice(0, 10);
const PRO = { 'prowl.alertPro': '1', 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'pro@example.com' };
const OWNER = { 'prowl.owner': 'owner-key-123456' };
const item = (id, extra = {}) => ({ title: 'Panther ' + id, price: '$' + id, url: 'https://www.facebook.com/marketplace/item/' + id + '/', image: '', found: DAY, ...extra });
const FOUND = {
  term: 'ceramic panther', live: true, updated: today.toISOString(), usa: false, radius: 50, pending: false,
  items: [item('1234567', { location: 'Ferndale, MI', miles: 12.4 }), item('2345678', { ships: true }), item('3456789', { location: 'Troy, MI', ships: true, miles: 9999 })],
};
const ALL = {
  live: true, left: 4,
  hunts: [
    { term: 'ceramic panther', updated: today.toISOString(), pending: false, usa: false, items: [item('1111111', { location: 'Novi, MI', miles: 8 })] },
    { term: 'fire king jadeite', updated: '', pending: true, usa: true, items: [] },
  ],
};

function rig({ finds = FOUND, all = ALL, search = null, status = {} } = {}) {
  const base = liveFetch({}), asked = [], prefs = [], searches = [];
  const ok = (j, s = 200) => Promise.resolve({ ok: s < 400, status: s, json: () => Promise.resolve(j) });
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/fb-finds') {
      asked.push({ term: u.searchParams.get('term'), all: u.searchParams.get('all'), h: opts.headers || {} });
      return ok(u.searchParams.get('all') ? all : finds);
    }
    if (u.pathname === '/fb-search') {
      searches.push({ body: JSON.parse(opts.body), h: opts.headers || {} });
      const s = search ? search(searches.length) : { s: 200, j: { ok: true, items: [item('9999999', { location: 'Royal Oak, MI', miles: 5 })], left: 5 - searches.length } };
      return ok(s.j, s.s);
    }
    if (u.pathname === '/alerts/prefs') { const b = JSON.parse(opts.body); prefs.push(b.prefs); return ok({ ok: true, prefs: b.prefs }); }
    if (u.pathname === '/alerts/status') return ok({ on: true, pro: true, hunts: ['ceramic panther', 'fire king jadeite'], prefs: { zip: '48375', radius: 50 }, fb: true, ...status });
    return base.impl(url, opts);
  };
  return { impl, asked, prefs, searches };
}
async function home(f, storage = {}) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther', 'fire king jadeite'], lock: [0, 1] }, owlTwigSgwTerms: [], ...storage } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  return p;
}
const strip = (p) => p.$$('#otp-sgw .sgw-sub').find((s) => /Facebook Marketplace/.test(s.textContent));
const tab = (p) => p.$('#otp-dock .db[data-m="store"]');
const pick = (p, v) => { const s = p.$('#otp-stSel'); s.value = v; s.dispatchEvent(new p.win.Event('change', { bubbles: true })); };
const fbCards = (p) => [...strip(p).parentNode.querySelectorAll('.sgw-cell[data-s="facebook"]')];

test('v8.27: a card says how far it is or that it ships; miles outside 0-3000 are dropped', async () => {
  const p = await home(rig(), PRO);
  await waitFor(() => strip(p));
  const m = fbCards(p).map((c) => c.querySelector('.sgw-m').textContent);
  assert.equal(m[0], 'Facebook · Ferndale, MI · 12 mi');
  assert.equal(m[1], 'Facebook · Ships');
  assert.equal(m[2], 'Facebook · Ships · Troy, MI');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.27: a hunt Facebook has not searched yet says it checks soon', async () => {
  const p = await home(rig({ finds: { term: 'ceramic panther', live: true, updated: '', pending: true, items: [] } }), PRO);
  await waitFor(() => strip(p));
  assert.match(strip(p).parentNode.textContent, /Facebook checks this hunt soon\. Each day Prowl searches Facebook for up to 10 of your hunts, in turn\./);
  await p.close();
});

test('v8.27: Near me / All USA toggles the hunt in prefs().fbusa and saves through /alerts/prefs, no refetch', async () => {
  const f = rig();
  const p = await home(f, PRO);
  await waitFor(() => strip(p) && strip(p).querySelector('[data-fbm]'));
  const btn = (v) => strip(p).querySelector('[data-fbm="' + v + '"]');
  assert.equal(btn('near').textContent, 'Near me · 50 mi');
  assert.equal(btn('near').getAttribute('aria-pressed'), 'true');
  assert.equal(btn('usa').getAttribute('aria-pressed'), 'false');
  const n0 = f.asked.length;
  btn('usa').click();
  await waitFor(() => f.prefs.length === 1, { timeout: 3000 });
  assert.deepEqual(f.prefs[0].fbusa, ['ceramic panther']);
  assert.equal(btn('usa').getAttribute('aria-pressed'), 'true');
  assert.match(p.$('#otp-sgw').textContent, /Saved\. Facebook searches this hunt that way from its next turn\./);
  assert.equal(f.asked.length, n0, 'not fetched again');
  btn('near').click();
  await waitFor(() => f.prefs.length === 2, { timeout: 3000 });
  assert.deepEqual(f.prefs[1].fbusa, []);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.27: the owner key without a member sign-in gets the strip but no Near me / All USA control', async () => {
  const p = await home(rig(), OWNER);
  await waitFor(() => strip(p));
  assert.equal(strip(p).querySelector('[data-fbm]'), null);
  await p.close();
});

test('v8.27: Store lists Facebook Marketplace under LIVE only when fbOn()', async () => {
  let p = await home(rig({ status: { pro: false, fb: false } }), {});
  tab(p).click();
  await tick(50);
  assert.ok(!p.$$('#otp-stSel option').some((o) => o.value === 'facebook'));
  await p.close();
  p = await home(rig(), OWNER);
  tab(p).click();
  await tick(50);
  const live = [...p.$$('#otp-stSel optgroup')[0].querySelectorAll('option')];
  const fb = live.find((o) => o.value === 'facebook');
  assert.ok(fb, 'in the LIVE group');
  assert.equal(fb.textContent, 'Facebook Marketplace · LIVE');
  await p.close();
});

test('v8.27: the Facebook store screen shows each hunt from fb-finds?all=1, then switching back runs the normal store', async () => {
  const f = rig();
  const p = await home(f, PRO);
  await waitFor(() => strip(p));
  tab(p).click();
  await tick(50);
  pick(p, 'facebook');
  await waitFor(() => p.$$('#otp-fbAll h3').length === 2);
  assert.equal(f.asked.filter((a) => a.all === '1').length, 1);
  assert.equal(f.asked.find((a) => a.all === '1').h['X-Prowl-Tok'], 'T'.repeat(24));
  assert.equal(p.$('#otp-res h2').textContent, 'Your hunts on Facebook Marketplace');
  assert.equal(p.$('#otp-stSel').value, 'facebook');
  const subs = p.$$('#otp-fbAll .sgw-sub');
  assert.equal(subs[0].querySelector('h3').textContent, 'ceramic panther');
  assert.equal(subs[0].querySelector('.sgw-upd').textContent, 'Updated this morning');
  assert.match(subs[0].nextElementSibling.querySelector('.sgw-m').textContent, /Facebook · Novi, MI · 8 mi/);
  assert.equal(subs[1].querySelector('.sgw-upd').textContent, 'Checks soon');
  assert.match(p.$('#otp-fbOne').textContent, /4 searches left today/);
  assert.equal(p.$('#otp-stF'), null, 'no per-site search form');
  pick(p, 'shopgoodwill');
  await waitFor(() => /hunts on ShopGoodwill/.test(p.$('#otp-res h2').textContent), { timeout: 4000 });
  assert.equal(p.$('#otp-fbAll'), null);
  assert.ok(p.$('#otp-stF'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.27: a nozip answer on the Facebook store screen says to add the ZIP', async () => {
  const p = await home(rig({ all: { live: true, nozip: true, hunts: [], left: 5 } }), PRO);
  await waitFor(() => strip(p));
  tab(p).click();
  await tick(50);
  pick(p, 'facebook');
  await waitFor(() => /Add your local-pickup ZIP in Den/.test((p.$('#otp-fbAll') || {}).textContent || ''));
  await p.close();
});

test('v8.27: Search Facebook for one thing posts fb-search, shows the cards and how many are left, then the 429 line', async () => {
  const f = rig({ search: (n) => (n < 2 ? { s: 200, j: { ok: true, items: [item('9999999', { location: 'Royal Oak, MI', miles: 5 })], left: 3 } } : { s: 429, j: { error: 'limit', left: 0 } }) });
  const p = await home(f, PRO);
  await waitFor(() => strip(p));
  tab(p).click();
  await tick(50);
  pick(p, 'facebook');
  await waitFor(() => p.$$('#otp-fbAll h3').length === 2);
  const go = (q) => { p.$('#otp-fbQ').value = q; p.$('#otp-fbF').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true })); };
  go('  teak   bench ');
  await waitFor(() => p.$('#otp-fbOne .sgw-cell'));
  assert.deepEqual(f.searches[0].body, { q: 'teak bench' });
  assert.equal(f.searches[0].h['Content-Type'], 'application/json');
  assert.equal(f.searches[0].h['X-Prowl-Email'], 'pro@example.com');
  assert.match(p.$('#otp-fbOne .sgw-m').textContent, /Facebook · Royal Oak, MI · 5 mi/);
  assert.equal(p.$('#otp-fbOne a.sgw-card').getAttribute('href'), 'https://www.facebook.com/marketplace/item/9999999/');
  assert.match(p.$('#otp-fbOne').textContent, /3 searches left today/);
  go('teak chair');
  await waitFor(() => /That’s today’s 5 Facebook searches\. More tomorrow\./.test(p.$('#otp-fbOne').textContent));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.27: a saved Facebook store pick falls back to the normal store when Facebook is not on', async () => {
  const p = await home(rig({ status: { pro: false, fb: false } }), { 'prowl.v36': { seen: true, hunts: ['ceramic panther'], lock: [0], store: 'facebook' } });
  tab(p).click();
  await tick(400);
  assert.equal(p.$('#otp-fbAll'), null);
  assert.match(p.$('#otp-res h2').textContent, /ShopGoodwill/);
  await p.close();
});
