// Page v8.36 (worker v209, Matt 2026-11-01: his "mc escher" Facebook finds "sometimes show and sometimes don't"):
// the hunt page shows the week's finds (FB_DAYS, as the worker keeps them) with "Updated N days ago", newest first, and
// says when the hunt has not been searched lately instead of dropping the strip after 2 days; the window is by the clock,
// so it never ends a day early in a device's evening; an empty All USA strip says why; a failed /alerts/status or a
// refused /fb-finds is asked again (on the next hunt opened) instead of leaving the strip off for the visit; a Store
// search or a newer Store answer refreshes the hunt page's copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PRO = { 'prowl.alertPro': '1', 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'pro@example.com' };
const H = 3600000, D = 24 * H;
const iso = (ms) => new Date(ms).toISOString();
const dayOf = (ms) => iso(ms).slice(0, 10);
const it = (id, title, foundMs, miles) => ({ id, title, price: '$' + id.slice(-2), url: 'https://www.facebook.com/marketplace/item/' + id + '/', image: '', location: 'Saline, MI', found: dayOf(foundMs), miles });
/* Matt's four, the newest found last in the worker's order (nearest first) */
function rec(ageMs, extra = {}) {
  const at = Date.now() - ageMs;
  return { term: 'mc escher', live: true, updated: iso(at), usa: false, radius: 50, pending: false, why: { raw: 24, far: 3, words: 17, mi: 50 },
    items: [it('100000004', 'Mc Escher wall hangings', at - 2 * D, 21), it('100000001', 'MC Escher Framed lithograph', at, 23), it('100000003', 'MC Escher collection', at - D, 24), it('100000002', 'M.C. Escher Mosaic II', at, 30)], ...extra };
}
function rig({ finds, status, all } = {}) {
  const base = liveFetch({}), asked = [], st = [], searches = [];
  const ok = (j, s = 200) => Promise.resolve({ ok: s < 400, status: s, json: () => Promise.resolve(j) });
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/fb-finds') {
      if (u.searchParams.get('all')) return ok(all ? all() : { live: true, left: 5, hunts: [] });
      asked.push(u.searchParams.get('term'));
      const a = typeof finds === 'function' ? finds(asked.length, u.searchParams.get('term')) : finds;
      return typeof a === 'number' ? ok({ error: 'no' }, a) : ok(a || { term: u.searchParams.get('term'), live: true, updated: '', pending: true, items: [] });
    }
    if (u.pathname === '/fb-search') { searches.push(JSON.parse(opts.body)); return ok({ ok: true, items: [], left: 4 }); }
    if (u.pathname === '/alerts/prefs') { const b = JSON.parse(opts.body); return ok({ ok: true, prefs: b.prefs }); }
    if (u.pathname === '/alerts/status') {
      st.push(1);
      const s = status ? status(st.length) : null;
      if (s === 'reject') return Promise.reject(new TypeError('offline'));
      if (typeof s === 'number') return ok({ error: 'busy' }, s);
      return ok({ on: true, pro: true, hunts: ['MC Escher', 'Rookwood'], prefs: { zip: '48117', radius: 40 }, fb: true });
    }
    return base.impl(url, opts);
  };
  return { impl, asked, st, searches };
}
async function home(f, hunts = ['MC Escher', 'Rookwood']) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts, lock: hunts.map((_, i) => i) }, owlTwigSgwTerms: [], 'prowl.lastHunt': 'mc escher', ...PRO } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  return p;
}
const strip = (p) => p.$$('#otp-sgw .sgw-sub').find((s) => /Facebook Marketplace/.test(s.textContent));
const fbCards = (p) => p.$$('#otp-sgw a.sgw-card').filter((a) => /facebook\.com\/marketplace\/item/.test(a.getAttribute('href') || ''));
const chip = (p, name) => p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]').find((c) => c.textContent.indexOf(name) !== -1);
const stripText = (p) => { const s = strip(p); let t = s ? s.textContent : '', n = s && s.nextElementSibling; while (n && !n.classList.contains('sgw-sub')) { t += ' ' + n.textContent; n = n.nextElementSibling; } return t; };

/* ---- 2. the week's finds ---- */
test('v8.36: finds 3, 4 and 6 days old still show (the worker keeps the week), "Updated N days ago", newest found first, and a note that the hunt has not been searched lately', async () => {
  for (const days of [3, 4, 6]) {
    const f = rig({ finds: rec(days * D + 2 * H) }), n = days === 6 ? 2 : 4;   /* at 6 days the two found before that search are about a week old: at least the search day's two */
    const p = await home(f);
    await waitFor(() => fbCards(p).length >= n, { timeout: 5000 });
    assert.match(strip(p).textContent, new RegExp('Updated ' + '(' + days + '|' + (days + 1) + ') days ago'), days + ' days');
    const ids = fbCards(p).map((a) => a.getAttribute('href').match(/item\/(\d+)/)[1]);
    assert.deepEqual(ids, ['100000001', '100000002', '100000003', '100000004'].slice(0, ids.length), 'the search day’s finds first (nearest first within a day), then older');
    assert.match(stripText(p), /Facebook last searched this hunt \d+ days ago\. Prowl searches up to 10 of your hunts a day, in turn, so its next turn is coming\./);
    assert.deepEqual(p.errors, []);
    await p.close();
  }
});

test('v8.36: a fresh search shows no "not searched lately" note; finds older than the week, or a record past the week, show no cards', async () => {
  let p = await home(rig({ finds: rec(3 * H) }));
  await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
  assert.doesNotMatch(stripText(p), /last searched/);
  await p.close();
  const old = rec(2 * H); old.items.push(it('100000009', 'MC Escher old print', Date.now() - 9 * D, 5));
  p = await home(rig({ finds: old }));
  await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
  assert.ok(!fbCards(p).some((a) => /100000009/.test(a.getAttribute('href'))), 'a find from 9 days ago is past the week');
  await p.close();
  p = await home(rig({ finds: rec(7 * D + 3 * H) }));
  await waitFor(() => strip(p), { timeout: 5000 });
  assert.equal(fbCards(p).length, 0);
  assert.match(stripText(p), /Facebook last searched this hunt \d+ days ago/, 'says so instead of vanishing');
  await p.close();
});

/* ---- 3. the window is by the clock, whatever the device's time zone or hour ---- */
test('v8.36: the same search age gives the same strip in every time zone (the worker’s days are UTC; a device calendar count flipped in the evening)', async () => {
  const tz0 = process.env.TZ;
  try {
    for (const tz of ['America/Detroit', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      /* 2 days and 1 hour: the hunt has not been searched for 2 days, so the note shows, on any calendar */
      let p = await home(rig({ finds: rec(2 * D + H) }));
      await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
      assert.match(stripText(p), /Facebook last searched this hunt/, tz + ': more than 2 days, by the clock');
      await p.close();
      /* 7 days and 2 hours: past the week, by the clock, on any calendar */
      p = await home(rig({ finds: rec(7 * D + 2 * H) }));
      await waitFor(() => strip(p), { timeout: 5000 });
      assert.equal(fbCards(p).length, 0, tz + ': past the week');
      await p.close();
      /* 6 days and 22 hours: still inside the week */
      p = await home(rig({ finds: rec(6 * D + 22 * H) }));
      await waitFor(() => fbCards(p).length === 2, { timeout: 5000 });   /* the search day's two; the ones found before it are past the week */
      await p.close();
    }
  } finally { if (tz0 === undefined) delete process.env.TZ; else process.env.TZ = tz0; }
});

/* ---- 4. an empty All USA strip says why ---- */
test('v8.36: an empty All USA hunt says why (worker why.ship, or no counts at all), no ships-only wording', async () => {
  const usa = (why) => ({ term: 'mc escher', live: true, updated: iso(Date.now() - H), usa: true, radius: 50, pending: false, why, items: [] });
  for (const why of [{ raw: 0, far: 0, words: 0, mi: 500, ship: true }, null, { raw: 5, far: 0, words: 0, mi: 500, ship: true }]) {
    const p = await home(rig({ finds: usa(why) }));
    await waitFor(() => strip(p), { timeout: 5000 });
    assert.match(stripText(p), /Nothing on Facebook for this hunt across the USA right now\./, JSON.stringify(why));
    assert.doesNotMatch(stripText(p), /Nothing new on Facebook for this hunt today|ships for this hunt/);
    await p.close();
  }
  const p = await home(rig({ finds: usa({ raw: 9, far: 0, words: 9, mi: 500, ship: true }) }));
  await waitFor(() => strip(p), { timeout: 5000 });
  assert.match(stripText(p), /Facebook had 9, none with all your words\. Try fewer words\./);
  await p.close();
});

/* ---- 5. a failed status or a refused /fb-finds is asked again ---- */
test('v8.36: /alerts/status failing once (a 502, or offline) does not leave Facebook off for the visit: the next hunt opened asks again', async () => {
  for (const bad of [502, 'reject']) {
    const f = rig({ finds: rec(H), status: (n) => (n === 1 ? bad : null) });
    const p = await home(f);
    await waitFor(() => f.st.length === 1, { timeout: 5000 });
    await tick(300);
    assert.equal(f.asked.length, 0, 'no Facebook yet: the status did not say so');
    chip(p, 'Rookwood').click();
    await tick(50);
    chip(p, 'MC Escher').click();
    await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
    assert.equal(f.st.length, 2, 'asked once more');
    assert.deepEqual(p.errors, []);
    await p.close();
  }
});

test('v8.36: the re-asking is bounded: three more at most in a visit', async () => {
  const f = rig({ finds: rec(H), status: () => 503 });
  const p = await home(f);
  await waitFor(() => f.st.length === 1, { timeout: 5000 });
  for (let i = 0; i < 6; i++) { chip(p, i % 2 ? 'MC Escher' : 'Rookwood').click(); await tick(60); }
  assert.equal(f.st.length, 4);
  await p.close();
});

test('v8.36: a 403 (or 401) from /fb-finds is not kept as "nothing" for half an hour: the hunt opened again asks again', async () => {
  for (const code of [403, 401]) {
    const f = rig({ finds: (n) => (n === 1 ? code : rec(H)) });
    const p = await home(f);
    await waitFor(() => f.asked.length === 1, { timeout: 5000 });
    await tick(100);
    assert.equal(fbCards(p).length, 0);
    chip(p, 'Rookwood').click();
    await tick(50);
    chip(p, 'MC Escher').click();
    await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
    assert.deepEqual(f.asked.filter((t) => t === 'mc escher').length, 2);
    await p.close();
  }
});

test('v8.36: a good answer stays cached: reopening the hunt does not ask again', async () => {
  const f = rig({ finds: rec(H) });
  const p = await home(f);
  await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
  chip(p, 'Rookwood').click(); await tick(50);
  chip(p, 'MC Escher').click(); await tick(100);
  assert.equal(f.asked.filter((t) => t === 'mc escher').length, 1);
  await p.close();
});

/* ---- 6. the Store and the hunt page agree ---- */
async function toStore(p) {
  p.$('#otp-dock .db[data-m="store"]').click();
  await tick(50);
  const s = p.$('#otp-stSel'); s.value = 'facebook'; s.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await waitFor(() => p.$('#otp-fbF'), { timeout: 4000 });
}
async function back(p) { p.$('#otp-dock .db[data-m="prowl"]').click(); await tick(50); chip(p, 'Rookwood').click(); await tick(30); chip(p, 'MC Escher').click(); }

test('v8.36: a Store search for the hunt refreshes the hunt page’s copy (it was cached 30 minutes)', async () => {
  const f = rig({ finds: (n) => (n === 1 ? { term: 'mc escher', live: true, updated: iso(Date.now() - 2 * H), usa: false, pending: false, why: { raw: 0, far: 0, words: 0, mi: 50 }, items: [] } : rec(0)) });
  const p = await home(f);
  await waitFor(() => strip(p), { timeout: 5000 });
  assert.equal(fbCards(p).length, 0);
  await toStore(p);
  p.$('#otp-fbQ').value = 'MC Escher'; p.$('#otp-fbF').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => f.searches.length === 1 && /on Facebook/.test(p.$('#otp-fbOne').textContent), { timeout: 4000 });
  await back(p);
  await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
  await p.close();
});

test('v8.36: a Store answer newer than the hunt page’s copy refreshes it; an older one does not', async () => {
  let fresh = iso(Date.now());
  const f = rig({ finds: (n) => (n === 1 ? { term: 'mc escher', live: true, updated: iso(Date.now() - 5 * H), usa: false, pending: false, why: { raw: 0, far: 0, words: 0, mi: 50 }, items: [] } : rec(0)),
    all: () => ({ live: true, left: 5, hunts: [{ term: 'mc escher', updated: fresh, pending: false, usa: false, why: null, items: rec(0).items }] }) });
  const p = await home(f);
  await waitFor(() => strip(p), { timeout: 5000 });
  await toStore(p);
  await waitFor(() => p.$$('#otp-fbAll h3').length === 1, { timeout: 4000 });
  await back(p);
  await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
  assert.equal(f.asked.filter((t) => t === 'mc escher').length, 2);
  fresh = iso(Date.now() - 10 * D);   /* older than what the hunt page has now */
  await toStore(p);
  await tick(200);
  await back(p);
  await tick(200);
  assert.equal(f.asked.filter((t) => t === 'mc escher').length, 2, 'not asked again');
  await p.close();
});
