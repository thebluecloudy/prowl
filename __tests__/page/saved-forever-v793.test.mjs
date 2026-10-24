// Page v7.93 (Matt: "Let's build the forever save but a prowl perk and let's trim it to a year"; worker v168). A Prowl
// Pro member's saved finds sync with POST /alerts/saved: the page sends its saved finds and what it removed, and takes
// back the account's list with a link to the kept photo and the day each leaves. Saved says what Pro does; a free
// member is told once, on the same line, and nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const W = 'https://prowl.thebluecloud.workers.dev/';
const find = (n, at) => ({ title: 'Rookwood vase ' + n, price: '$' + n, url: 'https://www.ebay.com/itm/' + n, image: 'https://i.ebayimg.com/' + n + '.jpg', src: 'ebay', hunt: 'rookwood vase', at });
const MEMBER = (pro) => ({ 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co', 'prowl.alertPro': pro ? '1' : '', 'prowl.v36': { seen: true, hunts: ['rookwood vase'], lock: [0] } });

function memberFetch(reply, pro) {
  const sent = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    let body = { items: [] }, status = 200;
    if (u.pathname.endsWith('/alerts/status')) body = { on: true, pro: !!pro, hunts: [] };
    else if (u.pathname.endsWith('/alerts/likes')) body = { ok: true, likes: [], gone: [], mute: [], muteAt: 0 };
    else if (u.pathname.endsWith('/alerts/saved')) { const b = JSON.parse(opts.body); sent.push(b); const r = reply(b); body = r.body; status = r.status || 200; }
    else if (u.pathname.startsWith('/apps/prowl/')) body = null;
    const txt = body == null ? '' : JSON.stringify(body);
    return Promise.resolve({ ok: body != null && status < 400, status: body != null ? status : 404, json: () => Promise.resolve(body), text: () => Promise.resolve(txt) });
  };
  return { impl, sent };
}
async function openSaved(p) { p.$('#otp-dock .db[data-m="flock"]').click(); await tick(60); p.$('#otp-flock [data-fv="saved"]').click(); await tick(40); }

test('Pro: after sign-in the saved finds go to the account and come back with the kept photo and the day they leave', async () => {
  const f = memberFetch((b) => ({ body: { ok: true, pro: true, saved: b.saved.concat([find(2, 50)]).map((x) => ({ ...x, until: '2027-10-24', ph: '/saved/0123456789abcdef/fedcba9876543210.jpg?e=9&s=' + 'a'.repeat(32) })), gone: [] } }), true);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER(true), 'prowl.finds': [find(1, 100)] } });
  await waitFor(() => f.sent.length);
  assert.deepEqual(f.sent[0].saved.map((x) => x.url), [find(1).url]);
  assert.deepEqual(f.sent[0].gone, []);
  await waitFor(() => (ls(p, 'prowl.finds') || []).length === 2);
  const kept = ls(p, 'prowl.finds');
  assert.equal(kept[0].ph, W + 'saved/0123456789abcdef/fedcba9876543210.jpg?e=9&s=' + 'a'.repeat(32), 'the link is the worker\'s');
  assert.equal(kept[0].until, '2027-10-24');
  await openSaved(p);
  assert.match(p.$('#otp-flSvn').textContent, /^Kept for a year with their photos, on every device you sign in on\. Prowl Pro\.$/);
  const card = p.$$('#otp-flockRow .fl-card').find((c) => c.getAttribute('data-u') === find(1).url);
  assert.equal(card.querySelector('img').getAttribute('src'), kept[0].ph, 'the kept photo, not the marketplace\'s');
  assert.equal(card.querySelector('.fl-kept').textContent, 'Kept until Oct 24, 2027');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Pro: removing a saved find is remembered and sent, so another device drops it too', async () => {
  const f = memberFetch((b) => ({ body: { ok: true, pro: true, saved: b.saved, gone: b.gone } }), true);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER(true), 'prowl.finds': [find(1, 100), find(2, 90)] } });
  await waitFor(() => f.sent.length === 1);
  await openSaved(p);
  const c = p.$$('#otp-flockRow .fl-card').find((x) => x.getAttribute('data-u') === find(2).url);
  const t0 = Date.now();
  c.querySelector('.fl-x').click();
  const gone = ls(p, 'prowl.findsGone');
  assert.equal(gone[0].u, find(2).url);
  assert.ok(gone[0].at >= t0);
  await waitFor(() => f.sent.length === 2, { timeout: 5000 });
  assert.deepEqual(f.sent[1].gone.map((g) => g.u), [find(2).url]);
  assert.deepEqual(f.sent[1].saved.map((x) => x.url), [find(1).url]);
  /* Undo puts it back, newer than the removal */
  p.$('#otp-undis').click(); await tick(10);
  assert.deepEqual(ls(p, 'prowl.findsGone'), []);
  assert.ok(ls(p, 'prowl.finds').find((x) => x.url === find(2).url).at >= t0);
  await p.close();
});

test('not Pro: nothing is sent, the finds stay on this device, and Saved says what Pro would do', async () => {
  const f = memberFetch(() => ({ body: { ok: true } }), false);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER(false), 'prowl.finds': [find(1, 100)] } });
  await tick(200);
  await openSaved(p);
  await new Promise((r) => setTimeout(r, 2800));
  assert.equal(f.sent.length, 0);
  const n = p.$('#otp-flSvn');
  assert.match(n.textContent, /^Saved finds stay on this device\. Prowl Pro keeps them a year, photos and all, on every device, even after the listing is gone\.$/);
  assert.equal(n.querySelector('a').getAttribute('href'), '/products/prowl-pro');
  assert.equal(p.$('#otp-flockRow .fl-kept'), null);
  await p.close();
});

test('Pro on this device but not on the account (402): the free line, and the finds stay as they were', async () => {
  const f = memberFetch(() => ({ status: 402, body: { error: 'Keeping saved finds for a year is part of Prowl Pro.', pro: false } }), true);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER(true), 'prowl.finds': [find(1, 100)] } });
  await waitFor(() => f.sent.length);
  await tick(40);
  await openSaved(p);
  assert.match(p.$('#otp-flSvn').textContent, /^Saved finds stay on this device\./);
  assert.deepEqual(ls(p, 'prowl.finds').map((x) => x.url), [find(1).url]);
  await p.close();
});

test('a photo link that is not the worker\'s is never kept', async () => {
  const f = memberFetch((b) => ({ body: { ok: true, pro: true, saved: b.saved.map((x) => ({ ...x, ph: 'https://evil.example/x.jpg' })), gone: [] } }), true);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER(true), 'prowl.finds': [find(1, 100)] } });
  await waitFor(() => f.sent.length);
  await tick(40);
  assert.equal(ls(p, 'prowl.finds')[0].ph, undefined, 'not stored at all');
  await p.close();
});
