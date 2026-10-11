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

test('signed out of the store: no store Log in in the header any more; the account chip is the one sign-in (v6.86)', async () => {
  const f = liveFetch({ me: { in: false } });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertNoAuto': '1' } });
  await waitFor(() => f.calls.some((u) => /apps\/prowl\/me/.test(u)));
  await tick(50);
  assert.equal(p.$('a[data-hi="in"]'), null);
  assert.equal(p.$('#otp-acct').getAttribute('aria-label'), 'Sign in');
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
  const nme = () => f.calls.filter((u) => /apps\/prowl\/me/.test(u)).length;
  /* every load-time check has answered "signed out": the greeting's, the held star's, and shopCheck's at 900 ms */
  await waitFor(() => nme() >= 3, { timeout: 4000 });
  await tick(60);
  assert.equal(ls(p, 'prowl.finds'), null, 'not signed in yet');
  assert.ok(p.win.sessionStorage.getItem('prowl.pendStar'), 'held, not dropped: the sign-in may still be going on');
  /* the sign-in finishes in the browser panel, and the app comes back to the front */
  Object.assign(me, { in: true, id: '1', e: 'a@b.co', first: 'Ann', ts: 1, sig: 'x' });
  await tick(3300);   /* clears the 4 s guard set by the load-time try */
  const n0 = nme();
  p.doc.dispatchEvent(new p.win.Event('visibilitychange'));
  p.win.dispatchEvent(new p.win.Event('focus'));
  p.win.dispatchEvent(new p.win.Event('pageshow'));
  assert.equal(nme(), n0 + 1, 'one store check for the three wake events');
  await waitFor(() => ls(p, 'prowl.finds'));
  assert.equal(ls(p, 'prowl.finds')[0].url, HELD.url);
  assert.equal(p.win.sessionStorage.getItem('prowl.pendStar'), null);
  await waitFor(() => /Saved/.test(p.$('#otp-toast').textContent));
  assert.equal(p.$('#otp-den').hidden, true, 'no Prowl Alerts settings opened over the feed');
  assert.match(hi(p).textContent, /Hi, Ann/);
  await p.close();
});

test('signing out of Prowl only says the store account stays signed in when it is', async () => {
  const f = liveFetch({ me: { in: false } });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' } });
  await waitFor(() => f.calls.some((u) => /apps\/prowl\/me/.test(u)));
  await tick(1200);
  const out = p.$('.otp-mail [data-mail="signout"]');
  assert.ok(out, 'the Prowl Alerts box offers Sign out');
  out.click();
  await tick(30);
  assert.doesNotMatch(p.$('.otp-mail').textContent, /stays signed in/, 'an email-only member has no store sign-in to keep');
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
