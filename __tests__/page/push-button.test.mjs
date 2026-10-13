// Page v6.97 (worker v114): Prowl's own notifications. In Den > Settings > Pounce, "Alert this phone" registers Prowl's
// service worker at the shop's /apps/prowl/sw.js, asks for permission (on that tap only, never on load), subscribes
// and tells the worker. ntfy stays, under it. iPhone: from the Home Screen app only. The browser parts are stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const HUNT = 'Royal Haeger panther';
const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'matt.partsch@icloud.com' };
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

function storage(extra) { return Object.assign({ 'prowl.v36': { seen: true, hunts: [HUNT] }, owlTwigSgwTerms: [{ t: HUNT }] }, SIGNED, extra || {}); }
function worker(calls, over) {
  return (u, o) => {
    const url = String(u), body = (o && o.body) || '';
    calls.push({ url, body });
    if (/alerts\/status/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign({ on: true, email: 'matt.partsch@icloud.com', hunts: [HUNT], pro: true, quarries: {}, quarryMax: 5, quarryMatches: [], push: null, phone: '', wpush: { key: KEY, n: 0 } }, over || {})) });
    if (/push\/subscribe/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, n: 1, test: true }) });
    if (/push\/(unsubscribe|test)/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, sent: 1, n: 0 }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
}
/* a browser with push: Notification, PushManager and a service worker container that records what it is asked */
function browser(B, opts) {
  opts = opts || {};
  return (win) => {
    B.perm = 0; B.reg = []; B.sub = null; B.unsub = 0;
    const sub = { endpoint: ENDPOINT, toJSON() { return { endpoint: ENDPOINT, keys: { p256dh: KEY, auth: 'BTBZMqHH6r4Tts7J_aSIgg' } }; }, unsubscribe() { B.unsub++; return Promise.resolve(true); } };
    const reg = { active: {}, pushManager: { getSubscription: () => Promise.resolve(B.sub ? sub : null), subscribe: (o) => { B.sub = o; return Promise.resolve(sub); } } };
    if (opts.ua) Object.defineProperty(win.navigator, 'userAgent', { value: opts.ua, configurable: true });
    if (opts.noPush) return;
    win.Notification = { permission: opts.permission || 'default', requestPermission: () => { B.perm++; return Promise.resolve(opts.answer || 'granted'); } };
    win.PushManager = function () {};
    Object.defineProperty(win.navigator, 'serviceWorker', { value: { register: (u, o) => { B.reg.push([u, o]); return Promise.resolve(reg); }, getRegistration: () => Promise.resolve(reg) }, configurable: true });
  };
}
async function settings(p) {
  await tick(1500);
  p.$('#otp-acct').click();
  await tick(80);
  const sec = p.$('#otp-denSettings .pnc');
  assert.ok(sec, 'the Pounce section');
  return sec;
}

test('Alert this phone is offered, ntfy sits under it, and nothing asks for permission on load', async () => {
  const B = {}, calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls), beforeLoad: browser(B) });
  const sec = await settings(p);
  assert.match(sec.querySelector('[data-pnc="wpon"]').textContent, /Alert this phone/);
  assert.ok(sec.querySelector('[data-pnc="wpon"]').classList.contains('p'), 'the main button');
  assert.match(sec.textContent, /Or use the free ntfy app/);
  assert.equal(B.perm, 0, 'no permission prompt on load');
  assert.equal(B.reg.length, 0, 'no service worker until the tap');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the tap: permission, the service worker at /apps/prowl/, a subscription with the key, and the worker told', async () => {
  const B = {}, calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls), beforeLoad: browser(B) });
  const sec = await settings(p);
  sec.querySelector('[data-pnc="wpon"]').click();
  assert.equal(B.perm, 1, 'asked inside the tap');
  await tick(80);
  assert.equal(B.reg.length, 1);
  assert.equal(B.reg[0][0], '/apps/prowl/sw.js');
  assert.equal(B.reg[0][1].scope, '/apps/prowl/');
  assert.equal(B.sub.userVisibleOnly, true);
  assert.equal(B.sub.applicationServerKey.length, 65, "the worker's public key, as bytes");
  const sent = calls.filter((c) => /push\/subscribe/.test(c.url));
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].body);
  assert.equal(body.sub.endpoint, ENDPOINT);
  assert.equal(body.sub.keys.p256dh, KEY);
  assert.equal(body.tok, SIGNED['prowl.alertTok']);
  assert.match(p.$('#otp-denSettings .pnc').textContent, /Alerts on this phone ✓/);
  assert.match(p.$('#otp-denSettings .pnc').textContent, /A test is on its way/);
  assert.equal(p.win.localStorage.getItem('prowl.wpushOn'), '1');
  /* Send test and Turn off */
  p.$('#otp-denSettings [data-pnc="wptest"]').click();
  await tick(40);
  assert.equal(calls.filter((c) => /push\/test/.test(c.url)).length, 1);
  assert.match(p.$('#otp-denSettings .pnc').textContent, /Test sent/);
  p.$('#otp-denSettings [data-pnc="wpoff"]').click();
  await tick(60);
  assert.equal(B.unsub, 1);
  assert.equal(JSON.parse(calls.filter((c) => /push\/unsubscribe/.test(c.url))[0].body).endpoint, ENDPOINT);
  assert.equal(p.win.localStorage.getItem('prowl.wpushOn'), null);
  assert.ok(p.$('#otp-denSettings [data-pnc="wpon"]'), 'offered again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a no to the permission prompt changes nothing and says so', async () => {
  const B = {}, calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls), beforeLoad: browser(B, { answer: 'default' }) });
  const sec = await settings(p);
  sec.querySelector('[data-pnc="wpon"]').click();
  await tick(60);
  assert.equal(B.reg.length, 0);
  assert.equal(calls.filter((c) => /push\/subscribe/.test(c.url)).length, 0);
  assert.match(p.$('#otp-denSettings .pnc-msg').textContent, /Alerts stay off/);
  await p.close();
});

test('blocked in the browser settings: it says where to change it, and offers no button that cannot work', async () => {
  const B = {}, calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls), beforeLoad: browser(B, { permission: 'denied' }) });
  const sec = await settings(p);
  assert.match(sec.textContent, /blocked in your browser settings/);
  assert.equal(sec.querySelector('[data-pnc="wpon"]'), null);
  assert.match(sec.textContent, /Or use the free ntfy app/, 'ntfy still works');
  await p.close();
});

test('iPhone in Safari: add Prowl to the Home Screen first', async () => {
  const B = {}, calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls), beforeLoad: browser(B, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', noPush: true }) });
  const sec = await settings(p);
  assert.match(sec.textContent, /On iPhone, add Prowl to your Home Screen first/);
  assert.equal(sec.querySelector('[data-pnc="wpon"]'), null);
  assert.match(sec.textContent, /Or use the free ntfy app/);
  await p.close();
});

test('no push in this browser, or the worker not set up yet: no button, ntfy as before', async () => {
  for (const [name, over, opts] of [['no push here', {}, { noPush: true }], ['worker not set up', { wpush: null }, {}]]) {
    const B = {}, calls = [];
    const p = loadPage({ storage: storage(), fetchImpl: worker(calls, over), beforeLoad: browser(B, opts) });
    const sec = await settings(p);
    assert.equal(sec.querySelector('[data-pnc="wpon"]'), null, name);
    assert.match(sec.querySelector('[data-pnc="pushon"]').textContent, /Tap my phone when it.s found/, name + ': ntfy is the main button');
    await p.close();
  }
});
