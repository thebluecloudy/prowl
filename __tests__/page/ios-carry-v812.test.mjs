// Page v8.12 (the security and trust plan, 2026-10-28: the prowl_c1 cookie held the email, the permanent token and a
// 30-day session for 7 days). The app page in Safari keeps only a one-time code from POST /alerts/handoff in prowl_c3,
// for the code's life; the installed app trades it once at POST /alerts/handoff/take and signs in through pxTake, and
// never replaces a sign-in it already has.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const APP = 'https://www.owlandtwigvintage.com/pages/prowl-app';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SESS = Buffer.from('123.' + (Math.floor(Date.now() / 1000) + 86400) + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SIGNED = { 'prowl.alertEmail': 'hunter@example.com', 'prowl.alertTok': 'abcdef0123456789abcdef', 'prowl.alertPro': '1', 'prowl.session': SESS };
const HUNTS = { seen: true, hunts: ['pyrex'] };
const CODE = '9e'.repeat(18);
const res = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const iphone = (w) => Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: IPHONE });
const standalone = (w) => Object.defineProperty(w.navigator, 'standalone', { configurable: true, value: true });
const cookies = (w) => String(w.document.cookie);
const opened = [];
const open = (o) => { const p = loadPage(o); opened.push(p); return p; };
after(async () => { for (const p of opened) await p.close(); });
// answers /alerts/handoff and /alerts/handoff/take as the worker would; everything else gets {}
function worker(take) {
  const calls = [];
  const fetchImpl = (u, o) => {
    u = String(u);
    if (/alerts\/handoff\/take$/.test(u)) { calls.push(['take', JSON.parse(o.body)]); return typeof take === 'function' ? take() : res(take || {}); }
    if (/alerts\/handoff$/.test(u)) { calls.push(['mint', JSON.parse(o.body)]); return res({ ok: true, code: CODE, ttl: 900 }); }
    return res({});
  };
  return { calls, fetchImpl };
}

test('signed in on the app page in Safari: one code in prowl_c3, no email, token or session in any cookie', async () => {
  const w = worker();
  const p = open({ url: APP, storage: Object.assign({ 'prowl.v36': HUNTS }, SIGNED), fetchImpl: w.fetchImpl, beforeLoad: iphone });
  await tick(30);
  const c = cookies(p.win);
  assert.match(c, new RegExp('prowl_c3=' + CODE));
  assert.doesNotMatch(c, /prowl_c1=/);
  for (const secret of ['hunter', 'example.com', 'abcdef0123456789abcdef', SESS]) assert.equal(c.indexOf(secret), -1, secret + ' is not in a cookie');
  assert.deepEqual(w.calls.filter((x) => x[0] === 'mint').length, 1);
});

test('a code with time left is kept: coming back to the page or the Install tap does not mint another; leaving never mints', async () => {
  const w = worker();
  const p = open({ url: APP, storage: Object.assign({ 'prowl.v36': HUNTS }, SIGNED), fetchImpl: w.fetchImpl, beforeLoad: iphone });
  await tick(30);
  p.win.dispatchEvent(new p.win.Event('pagehide'));
  p.win.document.dispatchEvent(new p.win.Event('visibilitychange'));
  await tick(20);
  assert.equal(w.calls.filter((x) => x[0] === 'mint').length, 1);
});

test('signed out on the app page in Safari: no code is asked for, and a stale one is cleared', async () => {
  const w = worker();
  const p = open({ url: APP, storage: { 'prowl.v36': HUNTS }, fetchImpl: w.fetchImpl, beforeLoad: (win) => {
    iphone(win);
    win.document.cookie = 'prowl_c3=' + CODE + '; Path=/pages/prowl-app';
  } });
  await tick(30);
  assert.equal(w.calls.length, 0);
  assert.doesNotMatch(cookies(p.win), /prowl_c3=/);
  assert.match(cookies(p.win), /prowl_c2=/);
});

test('the installed app trades the code once and signs in with the answer, then drops the cookies', async () => {
  const w = worker({ ok: true, member: true, email: 'Hunter@Example.com', tok: 'abcdef0123456789abcdef', pro: true, free: 1, hunts: ['pyrex'], active: 1, session: SESS });
  const p = open({ url: APP, storage: {}, fetchImpl: w.fetchImpl, beforeLoad: (win) => {
    iphone(win); standalone(win);
    win.document.cookie = 'prowl_c3=' + CODE + '; Path=/pages/prowl-app';
    win.document.cookie = 'prowl_c2=' + encodeURIComponent(JSON.stringify(HUNTS)) + '; Path=/pages/prowl-app';
  } });
  await tick(40);
  const ls = p.win.localStorage;
  assert.deepEqual(w.calls.filter((x) => x[0] === 'take'), [['take', { code: CODE }]]);
  assert.equal(ls.getItem('prowl.alertTok'), 'abcdef0123456789abcdef');
  assert.equal(String(ls.getItem('prowl.alertEmail')).toLowerCase(), 'hunter@example.com');
  assert.equal(ls.getItem('prowl.alertPro'), '1');
  assert.equal(ls.getItem('prowl.session'), SESS);
  assert.deepEqual(JSON.parse(ls.getItem('prowl.v36')).hunts, ['pyrex']);
  assert.doesNotMatch(cookies(p.win), /prowl_c/);
  assert.equal(w.calls.filter((x) => x[0] === 'mint').length, 0, 'the installed app never mints');
});

test('a run-out code leaves the app signed out with the 6-digit code message', async () => {
  const w = worker({ error: 'That sign-in has run out. Sign in with a code from your email.', expired: true });
  const p = open({ url: APP, storage: {}, fetchImpl: w.fetchImpl, beforeLoad: (win) => {
    standalone(win);
    win.document.cookie = 'prowl_c3=' + CODE + '; Path=/pages/prowl-app';
  } });
  await tick(40);
  assert.equal(p.win.localStorage.getItem('prowl.alertTok'), null);
  assert.match(p.win.document.body.textContent, /Email me a code and type it in to sign in/);
  assert.doesNotMatch(cookies(p.win), /prowl_c3=/);
});

test('never overwrites a sign-in: one that lands while the trade is on its way stays, and a malformed code is not sent', async () => {
  let win = null;
  const w = worker(() => {
    win.localStorage.setItem('prowl.alertEmail', 'other@example.com');
    win.localStorage.setItem('prowl.alertTok', 'ffffffffffffffffffff');
    return res({ ok: true, email: 'hunter@example.com', tok: 'abcdef0123456789abcdef', session: SESS });
  });
  const p = open({ url: APP, storage: {}, fetchImpl: w.fetchImpl, beforeLoad: (x) => {
    win = x; standalone(x);
    x.document.cookie = 'prowl_c3=' + CODE + '; Path=/pages/prowl-app';
  } });
  await tick(40);
  assert.equal(p.win.localStorage.getItem('prowl.alertTok'), 'ffffffffffffffffffff');
  assert.equal(p.win.localStorage.getItem('prowl.alertEmail'), 'other@example.com');
  const w2 = worker({ ok: true, email: 'x@y.co', tok: 'abcdef0123456789abcdef' });
  const q = open({ url: APP, storage: {}, fetchImpl: w2.fetchImpl, beforeLoad: (x) => {
    standalone(x);
    x.document.cookie = 'prowl_c3=' + encodeURIComponent('<script>') + '; Path=/pages/prowl-app';
  } });
  await tick(30);
  assert.equal(w2.calls.length, 0);
  assert.equal(q.win.localStorage.getItem('prowl.alertTok'), null);
});
