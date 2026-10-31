// Page v8.26 (worker v200, Matt 2026-10-31: Facebook finds through Apify, for Pro members): the Facebook strip is back
// under the Goodwill block for a signed-in Pro member (and the owner key), from GET /fb-finds with the member's
// sign-in. The worker decides Pro: a 401 or 403 shows nothing. A Pro member without a ZIP is told to add one. Plain
// Facebook links; photos only from fbcdn. Den > Settings says the ZIP is used once Facebook finds are live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const today = new Date(); today.setHours(8, 5, 0, 0);
const DAY = today.toISOString().slice(0, 10);
const PRO = { 'prowl.alertPro': '1', 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'pro@example.com' };
const FOUND = {
  term: 'ceramic panther', live: true, updated: today.toISOString(),
  items: [
    { id: '1234567890', title: 'Black ceramic panther TV lamp', price: '$150', url: 'https://www.facebook.com/marketplace/item/1234567890/', image: 'https://scontent.xx.fbcdn.net/v/p.jpg', location: 'Novi, MI', found: DAY },
    { id: '2222222', title: 'Panther planter', price: '$40', url: 'https://www.facebook.com/marketplace/item/2222222/', image: 'https://evil.example/x.jpg', location: 'Walled Lake, MI', found: DAY },
    { id: '3', title: 'Not a listing', price: '$1', url: 'https://evil.example/marketplace/item/3/' },
  ],
};
function fbFetch(answer, extra = {}) {
  const base = liveFetch({}), asked = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/fb-finds') {
      asked.push({ term: u.searchParams.get('term'), h: opts.headers || {} });
      if (typeof answer === 'number') return Promise.resolve({ ok: false, status: answer, json: () => Promise.resolve({ error: 'no' }) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(answer) });
    }
    if (u.pathname === '/alerts/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on: true, pro: true, hunts: ['ceramic panther'], prefs: { zip: '48375', radius: 50 }, fb: true, ...extra }) });
    return base.impl(url, opts);
  };
  return { impl, asked };
}
async function home(f, storage = {}) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther'], lock: [0] }, owlTwigSgwTerms: [], ...storage } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  return p;
}
const strip = (p) => p.$$('#otp-sgw .sgw-sub').find((s) => /Facebook Marketplace/.test(s.textContent));

test('a Pro member: the strip sits under Goodwill, asked with their sign-in, plain Facebook links, the town', async () => {
  const f = fbFetch(FOUND);
  const p = await home(f, PRO);
  await waitFor(() => strip(p));
  assert.equal(f.asked[0].term, 'ceramic panther');
  assert.equal(f.asked[0].h['X-Prowl-Email'], 'pro@example.com');
  assert.equal(f.asked[0].h['X-Prowl-Tok'], 'T'.repeat(24));
  const head = strip(p);
  assert.match(head.textContent, /Updated this morning/);
  assert.ok(head.querySelector('.sgw-fbh'));
  assert.ok(head.previousElementSibling && head.previousElementSibling.classList.contains('sgw-grid'), 'right after the Goodwill cards');
  const cards = [...head.nextElementSibling.querySelectorAll('.sgw-cell')];
  assert.equal(cards.length, 2, 'the listing that is not on facebook.com is dropped');
  assert.equal(cards[0].querySelector('a.sgw-card').getAttribute('href'), 'https://www.facebook.com/marketplace/item/1234567890/', 'plain, no affiliate tag');
  assert.match(cards[0].querySelector('.sgw-m').textContent, /Facebook · Novi, MI/);
  assert.equal(cards[1].querySelector('img').getAttribute('src'), null, 'a photo from outside Facebook is not shown');
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('the owner key gets the strip too', async () => {
  const f = fbFetch(FOUND);
  const p = await home(f, { 'prowl.owner': 'owner-key-123456' });
  await waitFor(() => strip(p));
  assert.equal(f.asked[0].h['X-Prowl-Owner'], 'owner-key-123456');
  await p.close();
});

test('the worker says not Pro (403) or signed out (401): nothing shows', async () => {
  for (const st of [401, 403]) {
    const f = fbFetch(st);
    const p = await home(f, PRO);
    await waitFor(() => f.asked.length > 0);
    await tick(200);
    assert.equal(strip(p), undefined, String(st));
    assert.equal(p.$('.sgw-fbh'), null);
    await p.close();
  }
});

test('not Pro on this device: /fb-finds is never asked', async () => {
  /* the status answer says not Pro too: on a slow runner a Pro answer could land first and rightly switch the strip on */
  let statusDone = false;
  const f0 = fbFetch(FOUND, { pro: false }), f = { asked: f0.asked, impl: (u, o) => { const r = f0.impl(u, o); if (/\/alerts\/status/.test(String(u))) r.then(() => { statusDone = true; }); return r; } };
  const p = await home(f, { 'prowl.alertTok': 'F'.repeat(24), 'prowl.alertEmail': 'free@example.com' });
  await waitFor(() => statusDone, { timeout: 8000 });
  await tick(400);
  assert.equal(f.asked.length, 0);
  assert.equal(strip(p), undefined);
  await p.close();
});

test('a Pro member without a ZIP is told to add one (only once Facebook finds are live)', async () => {
  let f = fbFetch({ term: 'ceramic panther', live: true, nozip: true, items: [] });
  let p = await home(f, PRO);
  await waitFor(() => strip(p));
  assert.match(strip(p).nextElementSibling.textContent, /Add your local-pickup ZIP/);
  await p.close();
  f = fbFetch({ term: 'ceramic panther', live: false, nozip: true, items: [] });
  p = await home(f, PRO);
  await waitFor(() => f.asked.length > 0);
  await tick(200);
  assert.equal(strip(p), undefined);
  await p.close();
});

test('Den > Settings: one line says Facebook finds use the local-pickup ZIP, only when status says fb', async () => {
  for (const fb of [true, false]) {
    const f = fbFetch(FOUND, { fb });
    const p = await home(f, PRO);
    await tick(300);
    await waitFor(() => p.$('#otp-prefZip'));
    if (fb) await waitFor(() => p.$('#otp-fbZip')); else await tick(400);
    const line = p.$('#otp-fbZip');
    if (fb) assert.match(line.textContent, /Facebook Marketplace finds on your hunts use this ZIP too/);
    else assert.equal(line, null);
    await p.close();
  }
});

test('review fix: a Pro member whose status says fb:false (FB_LIVE off) never asks /fb-finds', async () => {
  const f = fbFetch(FOUND, { fb: false });
  const p = await home(f, PRO);
  await tick(800);
  assert.equal(f.asked.length, 0);
  assert.equal(strip(p), undefined);
  await p.close();
});

test('review fix: a hunt over 60 characters asks for the key the worker wrote (cut at a whole word, as fbTerm)', async () => {
  const long = 'mid century modern teak sideboard credenza danish vintage walnut cabinet';
  const f = fbFetch({ ...FOUND, term: 'x' }, { hunts: [long] });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [long], lock: [0] }, owlTwigSgwTerms: [], ...PRO } });
  await waitFor(() => f.asked.length > 0, { timeout: 8000 });
  assert.equal(f.asked[0].term, 'mid century modern teak sideboard credenza danish vintage');
  await p.close();
});
