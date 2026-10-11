// Page v6.86: one sign-in, all inside Prowl. The account chip opens the box; type your email, Prowl emails a 6-digit
// code, type it (the 6th digit sends it) and you are signed in: no store login, no link that opens the browser. The
// address waits in prowl.alertWait, so the app can be closed to read the email. A held Flock star is saved after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

function rig(answers) {
  const calls = [];
  const fetchImpl = (u, o) => {
    const url = String(u), body = o && o.body ? JSON.parse(o.body) : null;
    calls.push({ url, body });
    for (const k of Object.keys(answers)) if (url.endsWith(k)) { const a = answers[k](body); return Promise.resolve({ ok: a.status !== 'x', status: 200, json: () => Promise.resolve(a) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { calls, fetchImpl };
}
async function signedOut(r, extra = {}) {
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'] }, ...extra } });
  await tick(60);
  p.$('#otp-acct').click();
  await tick(40);
  return p;
}
const box = (p) => p.$('#otp-denSettings .otp-mail');

test('email, then the code: signed in, the chip shows who, no store login and no browser trip', async () => {
  const r = rig({
    'alerts/code': () => ({ ok: true, sent: true }),
    'alerts/verify': (b) => (b.code === '482913' ? { ok: true, member: true, email: 'a@b.co', tok: 'tok-0123456789abcdef', pro: false, free: 1, hunts: ['pyrex'] } : { error: 'That code is not right.', left: 4 }),
    'alerts/status': () => ({ on: true, email: 'a@b.co', pro: false }),
  });
  const p = await signedOut(r);
  assert.match(box(p).textContent, /Sign in with your email\. No password: we email you a 6-digit code/);
  assert.equal(p.$('a[href*="customer_authentication"]'), null, 'no store sign-in link anywhere');
  const em = box(p).querySelector('input[data-k=code]');
  em.value = 'A@B.co ';
  box(p).querySelector('[data-mail=code]').click();
  await tick(30);
  assert.deepEqual(r.calls.find((c) => /alerts\/code$/.test(c.url)).body, { email: 'a@b.co' });
  assert.equal(p.win.localStorage.getItem('prowl.alertWait'), 'a@b.co');
  assert.match(box(p).textContent, /Enter the 6-digit code we sent to a@b\.co/);
  const ci = box(p).querySelector('input[data-k=verify]');
  assert.equal(ci.getAttribute('autocomplete'), 'one-time-code');
  ci.value = '111 111';
  ci.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  await tick(30);
  assert.match(box(p).textContent, /That code is not right\./);
  const ci2 = box(p).querySelector('input[data-k=verify]');
  ci2.value = '482913';
  ci2.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  await tick(40);
  const v = r.calls.filter((c) => /alerts\/verify$/.test(c.url)).pop().body;
  assert.deepEqual(v, { email: 'a@b.co', code: '482913', hunts: ['pyrex'] }, 'the 6th digit sends it, with this device\'s hunts');
  assert.equal(p.win.localStorage.getItem('prowl.alertTok'), 'tok-0123456789abcdef');
  assert.equal(p.win.localStorage.getItem('prowl.alertEmail'), 'a@b.co');
  assert.ok(!p.win.localStorage.getItem('prowl.alertWait'));
  assert.equal(p.$('#otp-acct').textContent, 'a');
  assert.ok(!p.errors.some((e) => /navigation/i.test(String(e.message || e))));
  await p.close();
});

test('closing the app while the code is out: it opens on the code box; a new code or a different email from there', async () => {
  const r = rig({ 'alerts/code': () => ({ ok: true, sent: true }) });
  const p = await signedOut(r, { 'prowl.alertWait': 'a@b.co', 'prowl.alertCodeAt': String(Date.now()) });
  assert.match(box(p).textContent, /Enter the 6-digit code we sent to a@b\.co/);
  assert.equal(p.win.document.activeElement, box(p).querySelector('input[data-k=verify]'), 'the chip puts you in the code box');
  box(p).querySelector('[data-mail=code]').click();
  await tick(30);
  assert.deepEqual(r.calls.find((c) => /alerts\/code$/.test(c.url)).body, { email: 'a@b.co' }, 'Send a new code');
  box(p).querySelector('[data-mail=again]').click();
  await tick(20);
  assert.ok(box(p).querySelector('input[data-k=code]'), 'Use a different email');
  await p.close();
});

test('an expired code or a limit says why', async () => {
  const r = rig({ 'alerts/verify': () => ({ error: 'That code has expired. Ask for a new one.', expired: true }), 'alerts/code': () => ({ error: 'We already sent codes today. Use the newest one, or check spam.' }) });
  const p = await signedOut(r, { 'prowl.alertWait': 'a@b.co', 'prowl.alertCodeAt': String(Date.now()) });
  const ci = box(p).querySelector('input[data-k=verify]');
  ci.value = '123456'; ci.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  await tick(30);
  assert.match(box(p).textContent, /That code has expired\. Ask for a new one\./);
  box(p).querySelector('[data-mail=code]').click();
  await tick(30);
  assert.match(box(p).textContent, /We already sent codes today/);
  await p.close();
});

test('Upgrade while signed out asks for the sign-in first, then carries on to checkout after the code', async () => {
  const r = rig({
    'alerts/verify': () => ({ ok: true, member: true, email: 'a@b.co', tok: 'tok-0123456789abcdef', pro: false }),
    'alerts/status': () => ({ on: true, email: 'a@b.co', pro: false }),
    'cart.js': () => ({ items: [] }), 'cart/add.js': () => ({}),
  });
  const p = await signedOut(r, { 'prowl.alertWait': 'a@b.co', 'prowl.alertCodeAt': String(Date.now()) });
  const link = p.doc.createElement('a'); link.href = '/products/prowl-pro'; p.$('.scout-app-wrapper').appendChild(link);
  link.click();
  await tick(20);
  assert.match(box(p).textContent, /Sign in with your email first, so Pro knows whose it is\./);
  assert.equal(r.calls.filter((c) => /cart/.test(c.url)).length, 0, 'no checkout before the sign-in');
  const ci = box(p).querySelector('input[data-k=verify]');
  ci.value = '482913'; ci.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  await tick(60);
  assert.ok(r.calls.some((c) => /cart\/add\.js$/.test(c.url)), 'then on to checkout');
  const add = r.calls.find((c) => /cart\/add\.js$/.test(c.url)).body;
  assert.equal(add.items[0].properties['Prowl Alerts email'], 'a@b.co');
  await p.close();
});

test('a wait left from an old confirm link (no code out) shows the email box, filled in, not a code box for a code never sent', async () => {
  const r = rig({});
  const p = await signedOut(r, { 'prowl.alertWait': 'old@b.co' });
  assert.equal(box(p).querySelector('input[data-k=verify]'), null);
  assert.equal(box(p).querySelector('input[data-k=code]').value, 'old@b.co');
  await p.close();
});

test('an Upgrade given up on does not send a later sign-in (from a Flock star or the chip) to checkout', async () => {
  const r = rig({
    'alerts/code': () => ({ ok: true, sent: true }),
    'alerts/verify': () => ({ ok: true, member: true, email: 'a@b.co', tok: 'tok-0123456789abcdef', pro: false }),
    'alerts/status': () => ({ on: true, email: 'a@b.co', pro: false }),
  });
  const p = await signedOut(r, { 'prowl.alertWait': 'a@b.co', 'prowl.alertCodeAt': String(Date.now()) });
  const link = p.doc.createElement('a'); link.href = '/products/prowl-pro'; p.$('.scout-app-wrapper').appendChild(link);
  link.click();
  await tick(20);
  p.$('#otp-acct').click();   /* a fresh start: the upgrade is dropped */
  await tick(20);
  const ci = box(p).querySelector('input[data-k=verify]');
  ci.value = '482913'; ci.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  await tick(60);
  assert.equal(p.win.localStorage.getItem('prowl.alertTok'), 'tok-0123456789abcdef');
  assert.equal(r.calls.filter((c) => /cart/.test(c.url)).length, 0, 'no checkout');
  await p.close();
});
