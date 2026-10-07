// Page v6.44: the store session (prowl.session) from /apps/prowl/login, sent as
// Authorization: Bearer, and the "Hi, name" greeting with Log out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const tok = (cid = '123', days = 30) => Buffer.from(cid + '.' + (Math.floor(Date.now() / 1000) + days * 86400) + '.sig').toString('base64url');
const ls = (p, k) => p.win.localStorage.getItem(k);

// /apps/prowl/me and /login answer as given; everything else is an empty search. Records each call with its headers.
function storeFetch({ me = null, login = null, status = { on: true, hunts: [] } } = {}) {
  const calls = [];
  const impl = (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    let body = { items: [] };
    if (u.pathname === '/apps/prowl/me') body = me;
    else if (u.pathname === '/apps/prowl/login') body = login;
    else if (u.pathname.endsWith('/alerts/status')) body = status;
    const txt = body == null ? '' : JSON.stringify(body);
    return Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(body), text: () => Promise.resolve(txt) });
  };
  return { impl, calls };
}
const hi = (p) => p.$('#otp-hi');

test('prowlSess keeps a good token and drops an expired or malformed one', async () => {
  const good = tok();
  const p = loadPage({ storage: { 'prowl.session': good } });
  assert.equal(p.win.prowlSess(), good);
  assert.equal(p.win.prowlAuth({ a: '1' }).Authorization, 'Bearer ' + good);
  p.win.localStorage.setItem('prowl.session', tok('123', -1));
  assert.equal(p.win.prowlSess(), '');
  assert.equal(ls(p, 'prowl.session'), null, 'an expired token is removed');
  p.win.localStorage.setItem('prowl.session', 'not a token!');
  assert.equal(p.win.prowlSess(), '');
  assert.equal(p.win.prowlAuth({}).Authorization, undefined);
  await p.close();
});

test('a store sign-in without Prowl Alerts keeps the session and says hi', async () => {
  const s = tok();
  const f = storeFetch({ me: { in: true, id: '123', e: 'a@b.co', first: 'Matt', ts: 1, sig: 'x' }, login: { ok: true, member: false, email: 'a@b.co', session: s } });
  const p = loadPage({ fetchImpl: f.impl });
  await waitFor(() => ls(p, 'prowl.session'));
  assert.equal(ls(p, 'prowl.session'), s);
  await waitFor(() => !hi(p).hidden);
  assert.match(hi(p).textContent, /Hi, Matt/);
  assert.ok(hi(p).querySelector('[data-hi="out"]'), 'Log out is there');
  await p.close();
});

test('a member sign-in stores the session and sends it to the Worker', async () => {
  const s = tok();
  const f = storeFetch({
    me: { in: true, id: '123', e: 'a@b.co', first: 'Matt', ts: 1, sig: 'x' },
    login: { ok: true, member: true, email: 'a@b.co', tok: 'T'.repeat(24), pro: true, session: s, hunts: [] },
  });
  const p = loadPage({ fetchImpl: f.impl });
  await waitFor(() => f.calls.some((c) => /alerts\/status/.test(c.url)));
  assert.equal(ls(p, 'prowl.session'), s);
  assert.equal(ls(p, 'prowl.alertTok'), 'T'.repeat(24));
  const st = f.calls.find((c) => /alerts\/status/.test(c.url));
  assert.equal(st.opts.headers.Authorization, 'Bearer ' + s);
  await p.close();
});

test('a member already signed in gets a session once, only for their own account', async () => {
  const s = tok();
  const me = { in: true, id: '123', e: 'a@b.co', first: 'Ann', ts: 1, sig: 'x' };
  const storage = { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };
  let f = storeFetch({ me, login: { ok: true, member: true, email: 'a@b.co', tok: 'T'.repeat(24), session: s } });
  let p = loadPage({ fetchImpl: f.impl, storage });
  await waitFor(() => ls(p, 'prowl.session'));
  assert.equal(ls(p, 'prowl.session'), s);
  await waitFor(() => !hi(p).hidden);
  assert.match(hi(p).textContent, /Hi, Ann/);
  await p.close();

  // the store is signed in as someone else: no session for this device's member
  f = storeFetch({ me, login: { ok: true, member: true, email: 'other@b.co', tok: 'U'.repeat(24), session: s } });
  p = loadPage({ fetchImpl: f.impl, storage });
  await waitFor(() => f.calls.some((c) => /apps\/prowl\/login/.test(c.url)));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ls(p, 'prowl.session'), null);
  await p.close();

  // a session already held: no login call at all
  f = storeFetch({ me, login: { ok: true, member: true, email: 'a@b.co', session: tok() } });
  p = loadPage({ fetchImpl: f.impl, storage: { ...storage, 'prowl.session': s } });
  await waitFor(() => !hi(p).hidden);
  assert.ok(!f.calls.some((c) => /apps\/prowl\/login/.test(c.url)));
  await p.close();
});

test('signed out of the store elsewhere: the session goes and the greeting hides', async () => {
  const f = storeFetch({ me: { in: false } });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co', 'prowl.session': tok() } });
  await waitFor(() => !ls(p, 'prowl.session'));
  assert.ok(hi(p).hidden);
  assert.equal(ls(p, 'prowl.alertTok'), 'T'.repeat(24), 'Prowl Alerts sign-in stays');
  await p.close();
});

test('a failed store check changes nothing', async () => {
  const s = tok();
  const f = storeFetch({ me: null });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co', 'prowl.session': s } });
  await waitFor(() => f.calls.some((c) => /apps\/prowl\/me/.test(c.url)));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(ls(p, 'prowl.session'), s);
  await p.close();
});

test('Log out clears the session and the alert token, then leaves for the store logout', async () => {
  const s = tok();
  const f = storeFetch({ me: { in: true, id: '123', e: 'a@b.co', first: 'Matt', ts: 1, sig: 'x' } });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co', 'prowl.session': s } });
  await waitFor(() => !hi(p).hidden);
  hi(p).querySelector('[data-hi="out"]').click();
  assert.equal(ls(p, 'prowl.session'), null);
  assert.equal(ls(p, 'prowl.alertTok'), null);
  assert.equal(ls(p, 'prowl.alertNoAuto'), '1', 'no silent sign-in on the way back');
  assert.ok(hi(p).hidden);
  assert.ok(p.errors.some((e) => /navigation/i.test(String(e.message || e))), 'it navigates to the store logout');
  assert.match(PAGE, /'\/customer_authentication\/logout\?return_to='\+encodeURIComponent\('\/pages\/prowl'\)/);
  await p.close();
});

test('wired in: AI calls send Bearer, the backup leaves the session out', () => {
  assert.match(PAGE, /return window\.prowlAuth\?window\.prowlAuth\(h\):h;/, 'photo and research checks (OH)');
  assert.match(PAGE, /fetch\(FP_API,\{method:'POST',headers:\(function\(\)\{[^]*?return window\.prowlAuth\(h\);\}\)\(\)/, 'Fair price');
  assert.match(PAGE, /headers:window\.prowlAuth\(\{'Content-Type':'application\/json'\}\),body:JSON\.stringify\(body\)\};/, 'guides');
  const exp = /function exportData\(\)\{[^]*?\n\}/.exec(PAGE)[0];
  assert.doesNotMatch(exp, /session/);
  assert.match(PAGE, /var PROWL_VERSION='v6\.44';/);
});
