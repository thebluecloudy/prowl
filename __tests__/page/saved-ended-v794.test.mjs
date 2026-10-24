// Page v7.94 (Matt: "build the sold and ended check next"; worker v169). A Pro member's saved find whose listing is
// over says so first on its card: "Sold for $61.00 · Oct 20" or "Ended · Oct 20", then the day it is kept until.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const find = (n, at) => ({ title: 'Rookwood vase ' + n, price: '$' + n, url: 'https://shopgoodwill.com/item/' + (2345670 + n), image: '', src: 'shopgoodwill', hunt: 'rookwood vase', at });
const MEMBER = { 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'a@b.co', 'prowl.alertPro': '1', 'prowl.v36': { seen: true, hunts: ['rookwood vase'], lock: [0] } };
function memberFetch(ends) {
  const sent = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    let body = { items: [] };
    if (u.pathname.endsWith('/alerts/status')) body = { on: true, pro: true, hunts: [] };
    else if (u.pathname.endsWith('/alerts/likes')) body = { ok: true, likes: [], gone: [], mute: [], muteAt: 0 };
    else if (u.pathname.endsWith('/alerts/saved')) { const b = JSON.parse(opts.body); sent.push(b); body = { ok: true, pro: true, gone: [], saved: b.saved.map((x, i) => ({ ...x, until: '2027-10-24', ...(ends[i] ? { end: ends[i] } : {}) })) }; }
    else if (u.pathname.startsWith('/apps/prowl/')) body = null;
    const txt = body == null ? '' : JSON.stringify(body);
    return Promise.resolve({ ok: body != null, status: body != null ? 200 : 404, json: () => Promise.resolve(body), text: () => Promise.resolve(txt) });
  };
  return { impl, sent };
}

test('sold with a price, ended, and still for sale, each says so on its card', async () => {
  const f = memberFetch([{ st: 'sold', at: '2026-10-20', p: '$61.00' }, { st: 'ended', at: '2026-10-21' }, null]);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER, 'prowl.finds': [find(1, 300), find(2, 200), find(3, 100)] } });
  await waitFor(() => f.sent.length);
  await waitFor(() => (ls(p, 'prowl.finds') || []).some((x) => x.end));
  assert.deepEqual(ls(p, 'prowl.finds')[0].end, { st: 'sold', at: '2026-10-20', p: '$61.00' });
  p.$('#otp-dock .db[data-m="flock"]').click(); await tick(60);
  p.$('#otp-flock [data-fv="saved"]').click(); await tick(40);
  const line = (n) => p.$$('#otp-flockRow .fl-card').find((c) => c.getAttribute('data-u') === find(n).url).querySelector('.fl-kept');
  assert.equal(line(1).textContent, 'Sold for $61.00 · Oct 20 · Kept until Oct 24, 2027');
  assert.ok(line(1).querySelector('.fl-end.fl-sold'));
  assert.equal(line(2).textContent, 'Ended · Oct 21 · Kept until Oct 24, 2027');
  assert.ok(line(2).querySelector('.fl-end.fl-ended'));
  assert.equal(line(3).textContent, 'Kept until Oct 24, 2027');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an end that is not one is not kept; an ended listing has no price', async () => {
  const f = memberFetch([{ st: 'gone', at: '2026-10-20' }, { st: 'ended', at: '2026-10-21', p: '$5' }]);
  const p = loadPage({ fetchImpl: f.impl, storage: { ...MEMBER, 'prowl.finds': [find(1, 300), find(2, 200)] } });
  await waitFor(() => f.sent.length);
  await waitFor(() => (ls(p, 'prowl.finds') || []).some((x) => x.end));
  const L = ls(p, 'prowl.finds');
  assert.equal(L[0].end, undefined);
  assert.deepEqual(L[1].end, { st: 'ended', at: '2026-10-21', p: '' });
  await p.close();
});
