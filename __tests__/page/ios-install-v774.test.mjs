// Page v7.74 (Matt: adding Prowl on an iPhone took three tries; the first icon kept the shop's bar, and every icon
// asked him to sign in again). iOS copies Safari's cookies into a new home-screen app once, but not localStorage, so
// the app page in Safari keeps the sign-in and hunts in two cookies scoped to /pages/prowl-app, and the installed app
// takes them on its first open. The install steps say to add Prowl from the app page, with Safari or Chrome wording.
// v8.12: the cookies never hold the email, token or session: a one-time code (prowl_c3) carries the sign-in; the
// legacy prowl_c1 pickup stays for icons added before v8.12 (see ios-carry-v812.test.mjs for the code exchange).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const APP = 'https://www.owlandtwigvintage.com/pages/prowl-app';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const ok = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('{}') });
const ua = (s) => (w) => Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: s });
// a well-formed, unexpired session token: the page drops a malformed one the first time anything reads it, which on a
// busy CI runner could be before the assertion (prowlSess)
const SESS = Buffer.from('123.' + (Math.floor(Date.now() / 1000) + 86400) + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const SIGNED = { 'prowl.alertEmail': 'hunter@example.com', 'prowl.alertTok': 'abcdef0123456789abcdef', 'prowl.alertPro': '1', 'prowl.session': SESS };
const HUNTS = { seen: true, hunts: ['pyrex', 'fiesta ware'] };
const cookies = (w) => String(w.document.cookie);
// v8.12: the app page in Safari re-mints the code on a timer while it shows, so every page is closed at the end
const opened = [];
const open = (o) => { const p = loadPage(o); opened.push(p); return p; };
after(async () => { for (const p of opened) await p.close(); });

test('the app page in Safari on an iPhone keeps the hunts and a one-time code in cookies, never the email or token', async () => {
  const CODE = 'ab'.repeat(18);
  const calls = [];
  const fetchImpl = (u, o) => {
    if (/alerts\/handoff$/.test(String(u))) { calls.push(JSON.parse(o.body)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, code: CODE, ttl: 900 }) }); }
    return ok();
  };
  const p = open({ url: APP, storage: Object.assign({ 'prowl.v36': HUNTS }, SIGNED), fetchImpl, beforeLoad: (w) => {
    ua(IPHONE)(w);
    w.document.cookie = 'prowl_c1=' + encodeURIComponent(JSON.stringify({ e: 'hunter@example.com', t: 'abcdef0123456789abcdef' })) + '; Path=/pages/prowl-app';
  } });
  await tick(30);
  const c = cookies(p.win);
  assert.doesNotMatch(c, /prowl_c1=/, 'an older page\'s sign-in cookie is cleared');
  assert.match(c, /prowl_c2=/);
  assert.match(c, new RegExp('prowl_c3=' + CODE));
  assert.doesNotMatch(c, /hunter|abcdef0123456789abcdef/);
  assert.doesNotMatch(c, new RegExp(SESS));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { email: 'hunter@example.com', tok: 'abcdef0123456789abcdef' });
});

test('not on an iPhone, or not on the app page: no cookies', async () => {
  const a = open({ url: APP, storage: Object.assign({ 'prowl.v36': HUNTS }, SIGNED), fetchImpl: ok });
  await tick(20);
  assert.doesNotMatch(cookies(a.win), /prowl_c/);
  const b = open({ storage: Object.assign({ 'prowl.v36': HUNTS }, SIGNED), fetchImpl: ok, beforeLoad: ua(IPHONE) });
  await tick(20);
  assert.doesNotMatch(cookies(b.win), /prowl_c/);
});

test('legacy (icons added before v8.12): the installed app takes an old prowl_c1 sign-in and hunts on its first open, then drops the cookies', async () => {
  const c1 = encodeURIComponent(JSON.stringify({ e: 'Hunter@Example.com', t: 'abcdef0123456789abcdef', s: SESS, p: 1 }));
  const c2 = encodeURIComponent(JSON.stringify(HUNTS));
  const p = open({ url: APP, storage: {}, fetchImpl: ok, beforeLoad: (w) => {
    ua(IPHONE)(w);
    Object.defineProperty(w.navigator, 'standalone', { configurable: true, value: true });
    w.document.cookie = 'prowl_c1=' + c1 + '; Path=/pages/prowl-app';
    w.document.cookie = 'prowl_c2=' + c2 + '; Path=/pages/prowl-app';
  } });
  await tick(30);
  const ls = p.win.localStorage;
  assert.equal(ls.getItem('prowl.alertEmail'), 'hunter@example.com');
  assert.equal(ls.getItem('prowl.alertTok'), 'abcdef0123456789abcdef');
  assert.equal(ls.getItem('prowl.session'), SESS);
  assert.deepEqual(JSON.parse(ls.getItem('prowl.v36')).hunts, ['pyrex', 'fiesta ware']);
  assert.doesNotMatch(cookies(p.win), /prowl_c/);
});

test('the installed app never overwrites a sign-in or hunts it already has, and ignores a bad cookie', async () => {
  const c1 = encodeURIComponent(JSON.stringify({ e: 'other@example.com', t: 'zzzzzzzzzzzzzzzz', p: 0 }));
  const c2 = encodeURIComponent(JSON.stringify({ hunts: ['other'] }));
  const urls = [];
  const spy = (u) => { urls.push(String(u)); return ok(); };
  const p = open({ url: APP, storage: Object.assign({ 'prowl.v36': HUNTS }, SIGNED), fetchImpl: spy, beforeLoad: (w) => {
    Object.defineProperty(w.navigator, 'standalone', { configurable: true, value: true });
    w.document.cookie = 'prowl_c1=' + c1 + '; Path=/pages/prowl-app';
    w.document.cookie = 'prowl_c2=' + c2 + '; Path=/pages/prowl-app';
    w.document.cookie = 'prowl_c3=' + 'cd'.repeat(18) + '; Path=/pages/prowl-app';
  } });
  await tick(30);
  assert.equal(p.win.localStorage.getItem('prowl.alertEmail'), 'hunter@example.com');
  assert.equal(urls.filter((u) => /handoff\/take/.test(u)).length, 0, 'a signed-in app never trades the code');
  assert.doesNotMatch(cookies(p.win), /prowl_c3=/, 'the code cookie is dropped all the same');
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts, ['pyrex', 'fiesta ware']);
  const q = open({ url: APP, storage: {}, fetchImpl: ok, beforeLoad: (w) => {
    Object.defineProperty(w.navigator, 'standalone', { configurable: true, value: true });
    w.document.cookie = 'prowl_c1=' + encodeURIComponent('{"e":"x","t":"<script>"}') + '; Path=/pages/prowl-app';
  } });
  await tick(30);
  assert.equal(q.win.localStorage.getItem('prowl.alertTok'), null);
});

test('install steps: add from the app page, with Safari or Chrome wording', async () => {
  const land = open({ storage: { 'prowl.v36': HUNTS }, fetchImpl: ok, beforeLoad: ua(IPHONE) });
  await tick(30);
  const card = land.win.document.querySelector('.otp-getapp[data-mode="settings"] .ga-ios');
  assert.ok(card, 'the iPhone line is there');
  assert.match(card.textContent, /Get the app/);
  assert.match(card.textContent, /not this one/);
  const app = open({ url: APP, storage: { 'prowl.v36': HUNTS }, fetchImpl: ok, beforeLoad: ua(IPHONE) });
  await tick(30);
  assert.match(app.win.document.querySelector('.otp-getapp[data-mode="settings"] .ga-ios').textContent, /In Safari, tap Share/);
  const cr = open({ url: APP, storage: { 'prowl.v36': HUNTS }, fetchImpl: ok, beforeLoad: ua(CHROME_IOS) });
  await tick(30);
  assert.match(cr.win.document.querySelector('.otp-getapp[data-mode="settings"] .ga-ios').textContent, /In Chrome, tap Share/);
});
