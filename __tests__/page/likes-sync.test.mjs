// Page v6.48: likes follow a signed-in member (worker v85 /alerts/likes). After sign-in the page sends its likes and
// takes the merged lists back; an unlike is remembered with its time; nothing is sent when signed out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const like = (n, at) => ({ u: 'https://www.ebay.com/itm/' + n, t: 'Haeger panther ' + n, p: '$40.00', s: 'ebay', i: 'https://i.ebayimg.com/' + n + '.jpg', h: 'panther', at });
const MEMBER = { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co' };

// /alerts/status says signed in; /alerts/likes answers what reply() returns for the body it got
function memberFetch(reply) {
  const sent = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    let body = { items: [] };
    if (u.pathname.endsWith('/alerts/status')) body = { on: true, hunts: [] };
    else if (u.pathname.endsWith('/alerts/likes')) { const b = JSON.parse(opts.body); sent.push({ b, opts }); body = reply(b); }
    else if (u.pathname.startsWith('/apps/prowl/')) body = null;
    const txt = body == null ? '' : JSON.stringify(body);
    return Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(body), text: () => Promise.resolve(txt) });
  };
  return { impl, sent };
}

test('after sign-in the page sends its likes and takes in likes from other devices', async () => {
  const f = memberFetch((b) => ({ ok: true, likes: [like(2, 200)].concat(b.likes), gone: [], mute: ['pyrex'], muteAt: 9 }));
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER, 'prowl.likes': [like(1, 100)] } });
  await waitFor(() => f.sent.length);
  const s = f.sent[0];
  assert.equal(s.b.email, 'a@b.co'); assert.equal(s.b.tok, 'T'.repeat(24));
  assert.deepEqual(s.b.likes.map((l) => l.u), [like(1).u]);
  assert.equal(s.opts.headers['Content-Type'], 'application/json');
  await waitFor(() => (ls(p, 'prowl.likes') || []).length === 2);
  assert.deepEqual(ls(p, 'prowl.likes').map((l) => l.u), [like(2).u, like(1).u]);
  assert.deepEqual(ls(p, 'prowl.likeMute'), ['pyrex']);
  assert.equal(p.win.localStorage.getItem('prowl.likeMuteAt'), '9');
  assert.equal(p.$('#otp-denT5').textContent, 'LIKES 2', 'the Den tab counts them');
  p.$('#otp-denT5').click();
  assert.match(p.$('#otp-denLikes').textContent, /your likes follow you to your other devices/);
  await p.close();
});

test('an unlike in the Den is remembered with its time and sent a moment later', async () => {
  const f = memberFetch((b) => ({ ok: true, likes: b.likes, gone: b.gone, mute: b.mute, muteAt: b.muteAt }));
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER, 'prowl.likes': [like(1, 100), like(2, 200)] } });
  await waitFor(() => f.sent.length === 1);
  await tick(20);
  p.$('#otp-denT5').click();
  const t0 = Date.now();
  p.$('#otp-denLikes [data-unlike="' + like(1).u + '"]').click();
  const gone = ls(p, 'prowl.likesGone');
  assert.equal(gone.length, 1); assert.equal(gone[0].u, like(1).u); assert.ok(gone[0].at >= t0);
  assert.deepEqual(ls(p, 'prowl.likes').map((l) => l.u), [like(2).u]);
  await waitFor(() => f.sent.length === 2, { timeout: 5000 });
  assert.deepEqual(f.sent[1].b.gone.map((g) => g.u), [like(1).u]);
  assert.deepEqual(f.sent[1].b.likes.map((l) => l.u), [like(2).u]);
  await p.close();
});

test('Stop boosting a word stamps the word list, so the newest list wins across devices', async () => {
  const p = loadPage({ storage: { 'prowl.likes': [like(1, 100), like(2, 200)] } });
  await tick(30);
  p.$('#otp-denT5').click();
  const t0 = Date.now();
  p.$('#otp-denLikes [data-lkmute]').click();
  assert.equal(ls(p, 'prowl.likeMute').length, 1);
  assert.ok(Number(p.win.localStorage.getItem('prowl.likeMuteAt')) >= t0);
  await p.close();
});

test('an answer to a sync is not applied over a change made while it was out', async () => {
  let release = null;
  const f = memberFetch(() => ({ ok: true, likes: [like(1, 100), like(2, 200)], gone: [], mute: [], muteAt: 0 }));
  const slow = (url, opts) => {
    if (!release && /alerts\/likes/.test(String(url))) return new Promise((r) => { release = () => r(f.impl(url, opts)); });
    return f.impl(url, opts);
  };
  const p = loadPage({ fetchImpl: slow, storage: { ...MEMBER, 'prowl.likes': [like(1, 100), like(2, 200)] } });
  await waitFor(() => release);
  p.$('#otp-denT5').click();
  p.$('#otp-denLikes [data-unlike="' + like(1).u + '"]').click();
  release(); await tick(40);
  assert.deepEqual(ls(p, 'prowl.likes').map((l) => l.u), [like(2).u], 'the unlike stays; the next sync sends it');
  await p.close();
});

test('signed out: likes stay on this device, nothing is sent', async () => {
  const f = memberFetch(() => ({ ok: true, likes: [], gone: [], mute: [], muteAt: 0 }));
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.likes': [like(1, 100)] } });
  await tick(40);
  p.$('#otp-denT5').click();
  p.$('#otp-denLikes [data-unlike="' + like(1).u + '"]').click();
  assert.equal(ls(p, 'prowl.likesGone')[0].u, like(1).u);
  await new Promise((r) => setTimeout(r, 2800));
  assert.equal(f.sent.length, 0);
  assert.doesNotMatch(p.$('#otp-denLikes').textContent, /follow you/);
  await p.close();
});

test('Clear all data forgets unlikes and the word-list time on this device too', async () => {
  const p = loadPage({ storage: { 'prowl.likesGone': [{ u: like(1).u, at: 1 }], 'prowl.likeMuteAt': '5' } });
  p.win.confirm = () => true;
  await tick(30);
  p.$('#otp-clearBtn').click();
  assert.equal(p.win.localStorage.getItem('prowl.likesGone'), null);
  assert.equal(p.win.localStorage.getItem('prowl.likeMuteAt'), null);
  await p.close();
});
