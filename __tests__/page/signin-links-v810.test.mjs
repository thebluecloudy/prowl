// Page v8.10 (the security and trust plan, 2026-10-28): the page never stores a token straight from the URL. An email
// link (#e=&k=<ticket>, or an old #e=&t=) asks "Sign in as ... on this device?" first; a ticket from a worker button just
// tapped (g=1) signs in at once; either way POST /alerts/redeem answers with the sign-in. Already signed in as that
// address: the link is dropped and the token kept. Another address: asked, as before. A used or run-out link opens the
// code box with the address filled in. Den > Settings has "Sign out every other device".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const K = '1793478895.' + 'c'.repeat(64), OLD_T = 'f'.repeat(36);
const BASE = 'https://www.owlandtwigvintage.com/pages/prowl';
function rig(answers) {
  const calls = [];
  const fetchImpl = (u, o) => {
    const url = String(u), body = o && o.body ? JSON.parse(o.body) : null;
    calls.push({ url, body });
    for (const k of Object.keys(answers)) if (url.endsWith(k)) { const a = answers[k](body); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { calls, fetchImpl };
}
const MEMBER = { ok: true, member: true, email: 'a@b.co', tok: 'tok-from-worker-0123456789', pro: false, free: 3, hunts: ['pyrex'], active: 1, session: '' };
const ok = () => ({ 'alerts/redeem': () => MEMBER, 'alerts/status': () => ({ on: true, email: 'a@b.co', pro: false, hunts: ['pyrex'] }) });
async function open(url, r, storage = {}, answer = true) {
  const asked = [];
  const p = loadPage({ url, fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'] }, ...storage },
    beforeLoad(win) { win.confirm = (m) => { asked.push(m); return answer; }; } });
  await tick(80);
  return Object.assign(p, { asked });
}
const redeems = (r) => r.calls.filter((c) => /alerts\/redeem$/.test(c.url)).map((c) => c.body);
const ls = (p, k) => p.win.localStorage.getItem('prowl.' + k);
const IN = { 'prowl.alertEmail': 'a@b.co', 'prowl.alertTok': 'tok-on-this-device-000000' };

test('a ticket from a worker button just tapped (g=1) signs a signed-out device in at once, through the worker', async () => {
  const r = rig(ok());
  const p = await open(BASE + '?alerts=on#e=a%40b.co&k=' + K + '&g=1', r);
  assert.deepEqual(redeems(r), [{ email: 'a@b.co', k: K, g: 1 }]);
  assert.deepEqual(p.asked, [], 'no question');
  assert.equal(ls(p, 'alertTok'), MEMBER.tok, 'the token the worker answered with');
  assert.equal(ls(p, 'alertEmail'), 'a@b.co');
  assert.equal(p.win.location.hash, '', 'the link leaves the address bar');
  assert.doesNotMatch(p.win.location.search, /alerts=/);
  assert.match(p.$('#otp-denSettings .otp-mail').textContent, /Prowl Alerts is on\. Your first email comes tomorrow morning\./);
  await p.close();
});

test('an email link on a signed-out device asks first, stores nothing until the tap, then redeems', async () => {
  const r = rig(ok());
  const p = await open(BASE + '?alerts=in#e=a%40b.co&k=' + K, r);
  assert.deepEqual(redeems(r), [], 'nothing sent before the tap');
  assert.ok(!ls(p, 'alertTok'));
  const box = p.$('#otp-denSettings .otp-mail');
  assert.match(box.textContent, /Sign in as a@b\.co on this device\?/);
  assert.equal(p.win.location.hash, '', 'the ticket is not left in the address bar');
  box.querySelector('[data-mail=linkgo]').click();
  await tick(40);
  assert.deepEqual(redeems(r), [{ email: 'a@b.co', k: K, g: 0 }]);
  assert.equal(ls(p, 'alertTok'), MEMBER.tok);
  assert.match(p.$('#otp-denSettings .otp-mail').textContent, /Signed in as a@b\.co\./);
  await p.close();
});

test('Not now leaves the device signed out; nothing is sent', async () => {
  const r = rig(ok());
  const p = await open(BASE + '?alerts=in#e=a%40b.co&k=' + K, r);
  p.$('#otp-denSettings .otp-mail [data-mail=linkno]').click();
  await tick(20);
  assert.doesNotMatch(p.$('#otp-denSettings .otp-mail').textContent, /Sign in as a@b\.co/);
  assert.deepEqual(redeems(r), []); assert.ok(!ls(p, 'alertTok'));
  await p.close();
});

test('an old #e=&t= link is checked by the worker before anything is stored', async () => {
  const r = rig({ 'alerts/redeem': (b) => (b.t === OLD_T ? { ...MEMBER, tok: OLD_T } : { error: 'That link has run out.', expired: true }), 'alerts/status': () => ({ on: true }) });
  const p = await open(BASE + '?alerts=in#e=a%40b.co&t=' + OLD_T, r);
  assert.ok(!ls(p, 'alertTok'), 'not stored from the URL');
  p.$('#otp-denSettings .otp-mail [data-mail=linkgo]').click();
  await tick(40);
  assert.deepEqual(redeems(r), [{ email: 'a@b.co', t: OLD_T }]);
  assert.equal(ls(p, 'alertTok'), OLD_T, 'stored only once the worker said it is theirs');
  await p.close();
});

test('a used or run-out link opens the code box with the address filled in', async () => {
  const r = rig({ 'alerts/redeem': () => ({ error: 'That link was already used.', expired: true, used: true }) });
  const p = await open(BASE + '?alerts=on#e=a%40b.co&k=' + K + '&g=1', r);
  assert.equal(redeems(r).length, 1);
  assert.ok(!ls(p, 'alertTok'));
  const box = p.$('#otp-denSettings .otp-mail');
  assert.match(box.textContent, /That link was already used\. Tap Email me a code and type it in to sign in\./);
  assert.equal(box.querySelector('input[data-k=code]').value, 'a@b.co');
  await p.close();
});

test('signed in as the same address: the link is dropped and the token on this device is never overwritten', async () => {
  const r = rig({ 'alerts/status': () => ({ on: true, email: 'a@b.co' }) });
  const p = await open(BASE + '?alerts=in#e=a%40b.co&t=' + OLD_T, r, IN);
  assert.deepEqual(redeems(r), []); assert.deepEqual(p.asked, []);
  assert.equal(ls(p, 'alertTok'), IN['prowl.alertTok']);
  assert.equal(p.win.location.hash, '');
  const p2 = await open(BASE + '?alerts=on#e=a%40b.co&k=' + K + '&g=1', r, IN);
  assert.deepEqual(redeems(r), []); assert.equal(ls(p2, 'alertTok'), IN['prowl.alertTok']);
  await p.close(); await p2.close();
});

test('signed in as another address: asked first; no keeps this account, yes redeems and switches', async () => {
  const r = rig(ok());
  const other = { 'prowl.alertEmail': 'z@y.co', 'prowl.alertTok': 'tok-other-account-0000000' };
  const p = await open(BASE + '?alerts=in#e=a%40b.co&k=' + K, r, other, false);
  assert.equal(p.asked.length, 1); assert.match(p.asked[0], /as a@b\.co\. You are signed in as z@y\.co\. Switch\?/);
  assert.deepEqual(redeems(r), []);
  assert.deepEqual([ls(p, 'alertEmail'), ls(p, 'alertTok')], ['z@y.co', 'tok-other-account-0000000']);
  assert.equal(p.win.location.hash, '');
  const p2 = await open(BASE + '?alerts=in#e=a%40b.co&k=' + K, r, other, true);
  assert.deepEqual(redeems(r), [{ email: 'a@b.co', k: K, g: 0 }], 'the yes is the tap');
  assert.deepEqual([ls(p2, 'alertEmail'), ls(p2, 'alertTok')], ['a@b.co', MEMBER.tok]);
  await p.close(); await p2.close();
});

test('?upgrade=1 starts the checkout once the link has signed in', async () => {
  const r = rig(ok());
  const p = await open(BASE + '?alerts=in&upgrade=1#e=a%40b.co&k=' + K + '&g=1', r);
  assert.doesNotMatch(p.win.location.search, /upgrade=1/);
  await tick(1600);
  assert.ok(r.calls.some((c) => /\/cart\.js$/.test(c.url)), 'the Pro checkout started');
  await p.close();
});

test('Den > Settings: Sign out every other device asks, then keeps this device in with the new token', async () => {
  const r = rig({ 'alerts/status': () => ({ on: true, email: 'a@b.co', hunts: ['pyrex'] }), 'alerts/signout-others': (b) => ({ ok: true, tok: 'tok-brand-new-0000000000', moved: false, session: '' }) });
  const p = await open(BASE, r, IN, false);
  p.$('#otp-acct').click();
  await tick(40);
  const btn = () => p.$('#otp-denSettings .otp-mail [data-mail=others]');
  assert.ok(btn(), 'the button is there when signed in');
  assert.equal(btn().textContent, 'Sign out every other device');
  btn().click();
  await tick(20);
  assert.equal(p.asked.length, 1); assert.match(p.asked[0], /This one stays signed in\./);
  assert.ok(!r.calls.some((c) => /signout-others$/.test(c.url)), 'a no sends nothing');
  p.win.confirm = () => true;
  btn().click();
  await tick(40);
  assert.deepEqual(r.calls.find((c) => /signout-others$/.test(c.url)).body, { email: 'a@b.co', tok: IN['prowl.alertTok'] });
  assert.equal(ls(p, 'alertTok'), 'tok-brand-new-0000000000');
  assert.equal(ls(p, 'alertEmail'), 'a@b.co');
  assert.match(p.$('#otp-denSettings .otp-mail').textContent, /Signed out on every other phone and computer\. This one stays signed in\./);
  await p.close();
});

test('signed out, there is no Sign out every other device', async () => {
  const r = rig({});
  const p = await open(BASE, r);
  p.$('#otp-acct').click();
  await tick(40);
  assert.equal(p.$('#otp-denSettings .otp-mail [data-mail=others]'), null);
  await p.close();
});

// v8.11: Prowl cannot end a store login, so a device signed out by Sign out every other device must not sign itself
// straight back in through the store (/apps/prowl/login hands back the new token): its status check sets alertNoAuto,
// as Sign out does. The confirm and done text say what the button cannot do.
function storeRig(status) {
  const calls = [];
  const fetchImpl = (u, o) => {
    const url = String(u), path = new URL(url, 'https://www.owlandtwigvintage.com/').pathname;
    calls.push({ url, body: o && o.body ? JSON.parse(o.body) : null });
    const body = path === '/apps/prowl/me' ? { in: true, id: '123', e: 'a@b.co', first: 'Ann', ts: 1, sig: 'x' }
      : path === '/apps/prowl/login' ? { ok: true, member: true, email: 'a@b.co', tok: 'tok-brand-new-0000000000', session: '' }
      : path.endsWith('/alerts/status') ? (typeof status === 'function' ? status() : status) : { items: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
  };
  return { calls, fetchImpl };
}
const logins = (r) => r.calls.filter((c) => /apps\/prowl\/login$/.test(c.url)).length;

test('v8.11: a device signed out elsewhere stays out: no store auto sign-in on the next load', async () => {
  let r = storeRig({ on: false });
  let p = await open(BASE + '?alerts=on', r, IN);
  await tick(1600);   // the first status check waits 1.2 s after load
  assert.ok(!ls(p, 'alertTok'), 'the old token goes');
  assert.equal(ls(p, 'alertNoAuto'), '1', 'as Sign out does');
  assert.ok(!ls(p, 'session'), 'no store session for a token signed out elsewhere (the shop answered with the new one)');
  const kept = {};
  for (let i = 0; i < p.win.localStorage.length; i++) { const k = p.win.localStorage.key(i); kept[k] = p.win.localStorage.getItem(k); }
  await p.close();
  // the next load, still logged in to the shop: no /apps/prowl/login, so no new token
  r = storeRig({ on: false });
  p = loadPage({ url: BASE + '?alerts=on', fetchImpl: r.fetchImpl, storage: kept });   // strings go in as they are
  await tick(1600);
  assert.ok(r.calls.some((c) => /apps\/prowl\/me$/.test(c.url)) || ls(p, 'alertNoAuto') === '1', 'the shop says still logged in');
  assert.equal(logins(r), 0, 'not signed straight back in');
  assert.ok(!ls(p, 'alertTok'));
  await p.close();
});

test('v8.11: a membership that moved still follows the move, and leaves store sign-in alone', async () => {
  let n = 0;
  const r = storeRig(() => (n++ ? { on: true, email: 'new@b.co', hunts: ['pyrex'] } : { on: false, moved: 'new@b.co' }));
  const p = await open(BASE + '?alerts=on', r, IN);
  await tick(1600);
  assert.equal(ls(p, 'alertEmail'), 'new@b.co');
  assert.equal(ls(p, 'alertTok'), IN['prowl.alertTok'], 'the hop keeps the token');
  assert.ok(n >= 2, 'and checks again at the new address');
  assert.notEqual(ls(p, 'alertNoAuto'), '1', 'a move is not a sign-out');
  await p.close();
});

test('v8.11: Sign out every other device says the shop login is not ended, before and after', async () => {
  const r = rig({ 'alerts/status': () => ({ on: true, email: 'a@b.co', hunts: ['pyrex'] }), 'alerts/signout-others': () => ({ ok: true, tok: 'tok-brand-new-0000000000', moved: false, session: '' }) });
  const p = await open(BASE, r, IN);
  p.$('#otp-acct').click();
  await tick(40);
  p.$('#otp-denSettings .otp-mail [data-mail=others]').click();
  await tick(40);
  assert.match(p.asked[0], /cannot log a device out of the Owl & Twig shop/);
  assert.match(p.$('#otp-denSettings .otp-mail').textContent, /still logged in to the Owl & Twig shop can sign back in there, so log out of the shop on it or change your store password/);
  await p.close();
});
