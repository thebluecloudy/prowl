// Page v6.65: Facebook Marketplace finds from the morning sweep (worker v94 GET /fb-finds), under the Goodwill block.
// Only on the owner's devices (the ?owner= key) unless PROWL_FB_PUBLIC is on. A hunt that was not swept shows nothing;
// one swept with nothing new says so in plain words. Links are plain Facebook listing links; photos only from fbcdn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const OWNER = 'owner-key-123456';
const today = new Date(); today.setHours(8, 5, 0, 0);

function fbFetch(answer, live = {}) {
  const base = liveFetch(live), asked = [], ctl = { answer };
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/fb-finds') {
      asked.push({ term: u.searchParams.get('term'), owner: (opts.headers || {})['X-Prowl-Owner'] || null });
      const a = ctl.answer;
      if (a === 'reject') return Promise.reject(new Error('offline'));
      if (a === 503) return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
      if (a === 404) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not swept' }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) });
    }
    return base.impl(url, opts);
  };
  return { impl, asked, ctl };
}
const DAY = today.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
const SWEPT = {
  term: 'ceramic panther', updated: today.toISOString(),
  items: [
    { id: '1234567890', title: 'Black ceramic panther TV lamp', price: '$150', url: 'https://www.facebook.com/marketplace/item/1234567890/', image: 'https://scontent.xx.fbcdn.net/v/p.jpg', location: 'Detroit, MI', found: DAY },
    { id: '2222222', title: 'Panther planter', price: '$40', url: 'https://www.facebook.com/marketplace/item/2222222/', image: 'https://evil.example/x.jpg', location: 'Toledo, OH', found: DAY },
    { id: '3', title: 'Not a listing', price: '$1', url: 'https://evil.example/marketplace/item/3/' },
  ],
};
async function home(f, storage = {}, cells = 3) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther'], lock: [0] }, owlTwigSgwTerms: [], ...storage } });
  if (cells) await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= cells, { timeout: 8000 });
  return p;
}
const strip = (p) => p.$$('#otp-sgw .sgw-sub').find((s) => /Facebook Marketplace/.test(s.textContent));

test('on the owner device: the strip sits under Goodwill, with plain Facebook links, where it is and when it was swept', async () => {
  const f = fbFetch(SWEPT);
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => strip(p));
  assert.deepEqual(f.asked[0], { term: 'ceramic panther', owner: OWNER });
  const head = strip(p);
  assert.match(head.textContent, /Updated this morning/);
  assert.equal(head.querySelector('.sgw-live'), null, 'not live: no pulse');
  const prev = head.previousElementSibling;
  assert.ok(prev && prev.classList.contains('sgw-grid'), 'right after the Goodwill cards');
  const grid = head.nextElementSibling;
  const cards = [...grid.querySelectorAll('.sgw-cell')];
  assert.equal(cards.length, 2, 'the listing that is not on facebook.com is dropped');
  const a = cards[0].querySelector('a.sgw-card');
  assert.equal(a.getAttribute('href'), 'https://www.facebook.com/marketplace/item/1234567890/', 'plain, no affiliate tag');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.match(cards[0].querySelector('.sgw-m').textContent, /Facebook · Detroit, MI/);
  assert.equal(cards[1].querySelector('img').getAttribute('src'), null, 'a photo from outside Facebook is not shown');
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('swept with nothing new: a plain sentence, not a blank hole', async () => {
  const f = fbFetch({ term: 'ceramic panther', updated: today.toISOString(), items: [] });
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => strip(p));
  assert.equal(strip(p).nextElementSibling.textContent, 'Nothing new on Facebook for this hunt today.');
  await p.close();
});

test('before this morning\'s sweep: yesterday\'s empty sweep is not called "today"', async () => {
  const f = fbFetch({ term: 'ceramic panther', updated: daysAgo(1).toISOString(), items: [] });
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => strip(p));
  assert.match(strip(p).textContent, /Updated yesterday/);
  assert.equal(strip(p).nextElementSibling.textContent, 'Nothing new on Facebook for this hunt yesterday.');
  await p.close();
});

test('nothing new this morning: said once, with the week\'s earlier finds under it', async () => {
  const y = daysAgo(2).toISOString().slice(0, 10);
  const f = fbFetch({ ...SWEPT, items: SWEPT.items.map((x) => ({ ...x, found: y })) });
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => strip(p));
  const note = strip(p).nextElementSibling;
  assert.equal(note.textContent, 'Nothing new on Facebook for this hunt today. Earlier this week:');
  assert.ok(note.nextElementSibling.classList.contains('sgw-grid'));
  assert.equal(note.nextElementSibling.querySelectorAll('.sgw-cell').length, 2);
  await p.close();
});

test('a sweep that stopped more than 2 days ago is not shown as if fresh', async () => {
  const f = fbFetch({ ...SWEPT, updated: daysAgo(3).toISOString() });
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => f.asked.length);
  await tick(80);
  assert.equal(strip(p), undefined);
  await p.close();
});

test('a failed refresh keeps the finds on screen', async () => {
  const f = fbFetch(SWEPT);
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => strip(p));
  const n0 = f.asked.length, real = p.win.Date.now.bind(p.win.Date);
  p.win.Date.now = () => real() + 31 * 60000;   /* past the 30-minute refresh */
  for (const a of ['reject', 503]) {
    f.ctl.answer = a;
    p.$$('.sgw-chip[data-sgw="pick"]')[0].click();   /* a redraw asks again */
    await waitFor(() => f.asked.length > n0);
    await tick(60);
    p.$$('.sgw-chip[data-sgw="pick"]')[0].click();
    await tick(60);
    assert.ok(strip(p), 'still there after a ' + a);
    assert.equal(strip(p).nextElementSibling.querySelectorAll('.sgw-cell').length, 2);
    p.win.Date.now = () => real() + 2 * 31 * 60000;
  }
  await p.close();
});

test('nothing live but Facebook finds: the finds come first, and the card does not call Facebook link-only', async () => {
  const f = fbFetch(SWEPT, { perSource: 0 });
  const p = await home(f, { 'prowl.owner': OWNER }, 0);
  await waitFor(() => p.$('#otp-sgw .sgw-empty') && strip(p), { timeout: 8000 });
  const body = p.$('#otp-sgw .sgw-body') || p.$('#otp-sgw');
  const html = body.innerHTML;
  assert.ok(html.indexOf('Facebook Marketplace') < html.indexOf('sgw-empty'), 'the strip first');
  const empty = p.$('#otp-sgw .sgw-empty');
  assert.doesNotMatch(empty.textContent, /Nothing live yet/);
  assert.match(empty.textContent, /Nothing on Goodwill or the other live sites yet for/);
  assert.equal(empty.querySelector('a[href*="facebook.com"]'), null, 'Facebook is not in the link-only list');
  await p.close();
});

test('a hunt that was not swept shows no Facebook line at all', async () => {
  const f = fbFetch(404);
  const p = await home(f, { 'prowl.owner': OWNER });
  await waitFor(() => f.asked.length);
  await tick(80);
  assert.equal(strip(p), undefined);
  assert.doesNotMatch(p.$('#otp-sgw').textContent, /Nothing new on Facebook/);
  await p.close();
});

test('everyone else: no request and no strip (FB_FINDS is owner-only by default)', async () => {
  const f = fbFetch(SWEPT);
  const p = await home(f);
  await tick(150);
  assert.equal(f.asked.length, 0, 'visitors without the owner key never ask');
  assert.equal(strip(p), undefined);
  await p.close();
});

test('wired in: Facebook is a label, never a live source; public needs a deliberate switch', () => {
  assert.match(PAGE, /var PROWL_FB_PUBLIC=false,/);
  const live = /var LIVE_SRC=\[[\s\S]*?\];/.exec(PAGE);
  assert.ok(live, 'LIVE_SRC');
  assert.doesNotMatch(live[0], /facebook/i, 'no live search of Facebook: the worker cannot reach it');
  const v = /var PROWL_VERSION='v6\.(\d+)';/.exec(PAGE);
  assert.ok(v && Number(v[1]) >= 65, 'the page says v6.65 or later');
  assert.match(PAGE, /\.scout-app-wrapper \.sgw-sub \.sgw-live,\.scout-app-wrapper \.sgw-sub \.sgw-fbh\{font-family:var\(--display\);font-size:20px;/, 'a section heading like the others');
});
