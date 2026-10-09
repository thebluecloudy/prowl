// Page v6.64: the store sign-in, end to end on the page.
// - A customer with no first name (most passwordless sign-ups) still gets "Signed in" and Log out.
// - A visitor the store says is signed out gets a quiet Log in in the header (not for an email-only member).
// - In the installed app the store sign-in opens in a browser panel and the app never reloads: a star held for the
//   sign-in is saved when the app comes back to the front, and a "not yet" answer does not drop it for 20 minutes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const hi = (p) => p.$('#otp-hi');
const HELD = { title: 'Held lamp', price: '$4', url: 'https://shopgoodwill.com/item/held', src: '' };

test('a store customer with no first name: "Signed in", Log out, and the Den row names the email', async () => {
  const f = liveFetch({ me: { in: true, id: '7', e: 'nameless@b.co', first: null, ts: 1, sig: 'x' } });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await waitFor(() => !hi(p).hidden);
  assert.match(hi(p).textContent, /Signed in/);
  assert.doesNotMatch(hi(p).textContent, /Hi, |null/);
  assert.ok(hi(p).querySelector('[data-hi="out"]'), 'Log out');
  const den = p.$('#otp-hiDen');
  assert.equal(den.hidden, false);
  assert.match(den.textContent, /Signed in to Owl & Twig as nameless@b\.co\./);
  await p.close();
});

test('signed out of the store: a quiet Log in that remembers the tap, so the app notices the return', async () => {
  const f = liveFetch({ me: { in: false } });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertNoAuto': '1' } });
  await waitFor(() => !hi(p).hidden);
  const a = hi(p).querySelector('a[data-hi="in"]');
  assert.ok(a, 'Log in');
  assert.equal(a.textContent, 'Log in');
  assert.match(a.getAttribute('href'), /^\/customer_authentication\/login\?return_to=%2Fpages%2Fprowl%3Flogin%3D1/);
  assert.equal(p.$('#otp-hiDen').hidden, true, 'phones sign in from the Prowl Alerts box');
  a.click();
  assert.equal(p.win.localStorage.getItem('prowl.alertNoAuto'), null);
  assert.ok(Number(p.win.localStorage.getItem('prowl.alertLoginAt')) > 0);
  await p.close();
});

test('an email-only member gets no store Log in, and a failed check shows nothing', async () => {
  let f = liveFetch({ me: { in: false } });
  let p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' } });
  await waitFor(() => f.calls.some((u) => /apps\/prowl\/me/.test(u)));
  await tick(60);
  assert.equal(hi(p).hidden, true);
  await p.close();
  f = liveFetch({ me: null });
  p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await waitFor(() => f.calls.some((u) => /apps\/prowl\/me/.test(u)));
  await tick(60);
  assert.equal(hi(p).hidden, true, 'no answer: no Log in, no greeting');
  await p.close();
});

test('installed app: the held star is saved when the app comes back signed in, without a reload', async () => {
  const me = { in: false };
  const f = liveFetch({ me });
  const p = loadPage({
    fetchImpl: f.impl,
    storage: { 'prowl.v36': { seen: true, hunts: [] } },
    beforeLoad: (win) => win.sessionStorage.setItem('prowl.pendStar', JSON.stringify({ ...HELD, at: Date.now() })),
  });
  await waitFor(() => f.calls.filter((u) => /apps\/prowl\/me/.test(u)).length >= 2);
  await tick(60);
  assert.equal(ls(p, 'prowl.finds'), null, 'not signed in yet');
  assert.ok(p.win.sessionStorage.getItem('prowl.pendStar'), 'held, not dropped: the sign-in may still be going on');
  /* the sign-in finishes in the browser panel; the app comes back to the front */
  Object.assign(me, { in: true, id: '1', e: 'a@b.co', first: 'Ann', ts: 1, sig: 'x' });
  await tick(4100);   /* past the 4s guard against focus, pageshow and visibilitychange arriving together */
  p.doc.dispatchEvent(new p.win.Event('visibilitychange'));
  await waitFor(() => ls(p, 'prowl.finds'));
  assert.equal(ls(p, 'prowl.finds')[0].url, HELD.url);
  assert.equal(p.win.sessionStorage.getItem('prowl.pendStar'), null);
  await waitFor(() => /Saved/.test(p.$('#otp-toast').textContent));
  assert.equal(p.$('#otp-den').hidden, true, 'no Prowl Alerts settings opened over the feed');
  assert.match(hi(p).textContent, /Hi, Ann/);
  await p.close();
});

test('a held star older than 20 minutes is dropped when the store still says signed out', async () => {
  const f = liveFetch({ me: { in: false } });
  const p = loadPage({
    fetchImpl: f.impl,
    storage: { 'prowl.v36': { seen: true, hunts: [] } },
    beforeLoad: (win) => win.sessionStorage.setItem('prowl.pendStar', JSON.stringify({ ...HELD, at: Date.now() - 21 * 60000 })),
  });
  await waitFor(() => p.win.sessionStorage.getItem('prowl.pendStar') === null);
  assert.equal(ls(p, 'prowl.finds'), null);
  await p.close();
});
