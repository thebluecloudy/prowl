// Page v6.85: an account chip in the header on every screen, the installed app included (it has no store header to
// show who is signed in). It shows the first letter of the Prowl Alerts email, rings green for Pro, and opens
// Den > Settings, whose Prowl Alerts box now says the plan. A sign-in finished in a browser tab (shared storage) is
// picked up when the app comes back. The "Still looking for your order" card lets go after a day, names the email it
// is looking under, and asks the shop afresh only a few times a round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'matt.partsch@icloud.com' };
const base = { 'prowl.v36': { seen: true, hunts: [] } };
function statusFetch(pro, calls) {
  return (u, o) => {
    calls && calls.push(String(u) + ' ' + ((o && o.body) || ''));
    if (/alerts\/status/.test(String(u))) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on: true, email: 'matt.partsch@icloud.com', pro, plan: pro ? { via: 'order', trial: true, renews: '2026-11-11T12:00:00Z' } : null }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
}

test('signed out: a person and "Sign in"; signed in: the first letter, and Pro says so', async () => {
  const p = loadPage({ storage: base });
  await tick(60);
  const b = p.$('#otp-acct');
  assert.equal(b.getAttribute('aria-label'), 'Sign in');
  assert.equal(b.textContent, '👤');
  await p.close();
  const q = loadPage({ storage: { ...base, ...SIGNED, 'prowl.alertPro': '1' }, fetchImpl: statusFetch(true) });
  await tick(60);
  assert.equal(q.$('#otp-acct').textContent, 'm');
  assert.equal(q.$('#otp-acct').getAttribute('aria-label'), 'Account: matt.partsch@icloud.com, Prowl Pro');
  assert.ok(q.$('.scout-app-wrapper').classList.contains('is-pro'));
  await q.close();
});

test('the chip opens Den > Settings, where the Prowl Alerts box shows the email and the plan', async () => {
  const p = loadPage({ storage: { ...base, ...SIGNED, 'prowl.alertPro': '1' }, fetchImpl: statusFetch(true) });
  await tick(1500);
  p.$('#otp-acct').click();
  await tick(60);
  assert.equal(p.$('#otp-denSettings').hidden, false);
  const box = p.$('#otp-denSettings').textContent;
  assert.match(box, /Prowl Alerts go to\s*matt\.partsch@icloud\.com/);
  assert.match(box, /Plan\s*Prowl Pro, free month until/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a sign-in finished in a browser tab shows when the app comes back to the front', async () => {
  const p = loadPage({ storage: base });
  await tick(60);
  assert.equal(p.$('#otp-acct').getAttribute('aria-label'), 'Sign in');
  p.win.localStorage.setItem('prowl.alertTok', 'tok-0123456789abcdef');
  p.win.localStorage.setItem('prowl.alertEmail', 'matt.partsch@icloud.com');
  p.win.dispatchEvent(new p.win.Event('pageshow'));
  await tick(20);
  assert.equal(p.$('#otp-acct').textContent, 'm');
  await p.close();
});

test('an order card from before today\'s fix (no time kept) or over a day old is let go, with no card', async () => {
  for (const extra of [{ 'prowl.alertProWait': '1' }, { 'prowl.alertProWait': '1', 'prowl.alertProWaitAt': String(Date.now() - 2 * 864e5) }]) {
    const p = loadPage({ storage: { ...base, ...SIGNED, ...extra }, fetchImpl: statusFetch(false) });
    await tick(800);
    assert.equal(p.$('#otp-proBan').hidden, true);
    assert.ok(!p.win.localStorage.getItem('prowl.alertProWait'));
    await p.close();
  }
});

test('stuck: the card names the email it looks under and offers to switch; only every 5th look is a fresh one', async () => {
  const calls = [];
  /* the 6 s between looks, made 5 ms */
  const fast = (w) => { const st = w.setTimeout.bind(w); w.setTimeout = (fn, ms, ...a) => st(fn, ms === 6000 ? 5 : ms, ...a); };
  const p = loadPage({ storage: { ...base, ...SIGNED, 'prowl.alertProWait': '1', 'prowl.alertProWaitAt': String(Date.now()) }, fetchImpl: statusFetch(false, calls), beforeLoad: fast });
  for (let i = 0; i < 60 && !/Still looking/.test(p.$('#otp-proBan').textContent); i++) await tick(100);
  const ban = p.$('#otp-proBan');
  assert.equal(ban.hidden, false);
  assert.match(ban.textContent, /Still looking for your order/);
  assert.match(ban.textContent, /a Prowl Pro order for matt\.partsch@icloud\.com\. Paid with a different Prowl Alerts email\? Switch to it/);
  const st = calls.filter((u) => /alerts\/status/.test(u));
  assert.ok(st.length >= 15, 'it polled ' + st.length);
  assert.ok(st.filter((u) => /"fresh":"1"/.test(u)).length <= 4, 'fresh looks: ' + st.filter((u) => /"fresh":"1"/.test(u)).length);
  await p.close();
});
