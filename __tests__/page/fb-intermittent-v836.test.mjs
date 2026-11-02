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
/* review fix: the page keeps what the worker's fbMerge keeps, found after the cut (7 UTC dates, today's included) */
const inWeek = (r) => r.items.filter((x) => x.found > dayOf(Date.now() - 7 * D)).length;
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
    /* the Shopify strip is off here: its timed retry (SHP_RETRY + 100, the same 120100 ms as FB_RETRY + 100) ran on the
       same fast clock, so each of its 5 retries moved the page clock 2 minutes on and redrew, expiring Facebook's
       failed answer at moments set by real-timer load and asking /fb-finds again (8, 9, 11 asks instead of 6) */
    if (u.pathname === '/shop-live') return ok({ off: true });
    return base.impl(url, opts);
  };
  return { impl, asked, st, searches };
}
/* review fix: the retry timers (FB_RETRY + 100 ms, and the status's 20 s, 1 min, 3 min) run in 30 ms, the page's clock
   moved on by their delay, so a test sees what a member who stays on the hunt for minutes sees */
const LONG = [120100, 20000, 60000, 180000];
function fastRetry(win) {
  const st = win.setTimeout.bind(win), now = win.Date.now.bind(win.Date);
  let off = 0;
  win.setTimeout = (fn, ms, ...a) => (LONG.indexOf(ms) !== -1 ? st(() => { off += ms; fn(...a); }, 30) : st(fn, ms, ...a));
  win.Date.now = () => now() + off;
}
async function home(f, hunts = ['MC Escher', 'Rookwood'], fast = false) {
  const p = loadPage({ beforeLoad: fast ? fastRetry : undefined, fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts, lock: hunts.map((_, i) => i) }, owlTwigSgwTerms: [], 'prowl.lastHunt': 'mc escher', ...PRO } });
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
    const r = rec(days * D + 2 * H), f = rig({ finds: r }), n = inWeek(r);   /* at 6 days the two found before that search are past the week, and the search day's two too just after midnight UTC */
    const p = await home(f);
    await waitFor(() => strip(p) && fbCards(p).length >= n, { timeout: 5000 });
    assert.equal(fbCards(p).length, n);
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
      const r = rec(6 * D + 22 * H);
      p = await home(rig({ finds: r }));
      await waitFor(() => strip(p) && fbCards(p).length === inWeek(r), { timeout: 5000 });   /* the search day's two (none in the first 22 hours of a UTC day, as the worker would keep them); the ones found before it are past the week */
      assert.ok(inWeek(r) <= 2);
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
    /* review fix: with why.ship only the shared ships search has run, not the hunt's own All USA search: it says that is to come */
    assert.match(stripText(p), why ? /Nothing that ships yet\. Facebook checks this hunt across the USA soon\./ : /Nothing on Facebook for this hunt across the USA right now\./, JSON.stringify(why));
    if (why) assert.doesNotMatch(stripText(p), /across the USA right now/);
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

/* ---- review fix: the retries come to a member who stays on the one hunt ---- */
test('review fix: /fb-finds failing (a 502, a 403 or offline) is asked again on a timer for the hunt that stays open, no other hunt tapped', async () => {
  for (const bad of [502, 403, 'reject']) {
    const f = rig({ finds: (n) => (n === 1 ? bad : rec(H)) });
    if (bad === 'reject') { const i0 = f.impl; f.impl = (url, o) => (/fb-finds\?term/.test(String(url)) && f.asked.length === 0 ? (f.asked.push('mc escher'), Promise.reject(new TypeError('offline'))) : i0(url, o)); }
    const p = await home(f, ['MC Escher'], true);
    await waitFor(() => fbCards(p).length === 4, { timeout: 6000 });
    assert.equal(f.asked.filter((t) => t === 'mc escher').length, 2, String(bad));
    assert.deepEqual(p.errors, []);
    await p.close();
  }
});

test('review fix: the timed /fb-finds retry is bounded (5 in a row) and a good answer stops it', async () => {
  const f = rig({ finds: () => 503 });
  const p = await home(f, ['MC Escher'], true);
  await waitFor(() => f.asked.length >= 6, { timeout: 6000 });
  await tick(400);
  assert.equal(f.asked.length, 6, 'the first ask and 5 retries');
  await p.close();
  const g = rig({ finds: (n) => (n === 1 ? 503 : rec(H)) });
  const q = await home(g, ['MC Escher'], true);
  await waitFor(() => fbCards(q).length === 4, { timeout: 6000 });
  await tick(400);
  assert.equal(g.asked.length, 2, 'no more once it answered');
  await q.close();
});

test('review fix: /alerts/status failing at boot and on the 20 s retry is asked again on its own (1 min), so a member with one hunt gets Facebook finds', async () => {
  const f = rig({ finds: rec(H), status: (n) => (n <= 2 ? 502 : null) });
  const p = await home(f, ['MC Escher'], true);
  await waitFor(() => fbCards(p).length === 4, { timeout: 6000 });
  assert.equal(f.st.length, 3);
  await p.close();
  const g = rig({ finds: rec(H), status: () => 503 });
  const q = await home(g, ['MC Escher'], true);
  await waitFor(() => g.st.length >= 4, { timeout: 6000 });
  await tick(400);
  assert.equal(g.st.length, 4, 'three more at most');
  assert.equal(g.asked.length, 0);
  await q.close();
});

test('review fix: the Store shows a hunt the hunt page’s way: the week’s finds, newest found first; an empty All USA hunt says so', async () => {
  const r = rec(2 * H);
  r.items.push(it('100000009', 'MC Escher old print', Date.now() - 9 * D, 5));   /* the nearest, past the week */
  const f = rig({ finds: r, all: () => ({ live: true, left: 5, hunts: [{ term: 'mc escher', updated: r.updated, pending: false, usa: false, why: r.why, items: r.items },
    { term: 'rookwood', updated: iso(Date.now() - H), pending: false, usa: true, why: null, items: [] }] }) });
  const p = await home(f, ['MC Escher', 'Rookwood']);
  await waitFor(() => fbCards(p).length === 4, { timeout: 5000 });
  const page = fbCards(p).map((a) => a.getAttribute('href'));
  await toStore(p);
  await waitFor(() => p.$$('#otp-fbAll h3').length === 1, { timeout: 4000 });
  const store = p.$$('#otp-fbAll a.sgw-card').map((a) => a.getAttribute('href'));
  assert.deepEqual(store, page, 'the same finds in the same order');
  assert.ok(!store.some((h) => /100000009/.test(h)));
  assert.match(p.$('#otp-fbAll').textContent, /Nothing on Facebook for this hunt across the USA right now\./);
  await p.close();
});
