// Page v6.69: motion. Matthew's curtain when the app opens, and Hark's "Prowl magic" (cards rise in, listings new since
// your last look glow, starting a hunt sparkles). Both stay out of the way: once a launch, once a listing, a tap skips
// the curtain, and nothing at all under reduced motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveU } from '../helpers/uranium.mjs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const ROOT = new URL('../../', import.meta.url);
const PAGE = readFileSync(fileURLToPath(new URL('page/prowl.html', ROOT)), 'utf8');
const WORKER = readFileSync(fileURLToPath(new URL('worker/index.js', ROOT)), 'utf8');
const SHOP = 'https://www.owlandtwigvintage.com/pages/prowl';
const APP = 'https://www.owlandtwigvintage.com/pages/prowl-app';
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const curtain = (p) => p.$('.pc-loader');

/* ---------- the curtain ---------- */

test('the app opens with the curtain: PROWL, six columns, over the app; then it goes by itself', async () => {
  const p = loadPage({ url: APP, storage: DEN });
  const L = curtain(p);
  assert.ok(L, 'on the app page');
  assert.equal(L.getAttribute('aria-hidden'), 'true', 'a picture: screen readers go straight to the app');
  assert.equal(L.querySelectorAll('.pc-panels > i').length, 6);
  assert.equal([...L.querySelectorAll('.pc-mark span')].map((s) => s.textContent).join(''), 'PROWL');
  assert.equal(L.parentNode, p.doc.body, 'outside the app, so the text-size zoom does not move it');
  assert.ok(p.$('#otp-sgw'), 'the app is there underneath');
  assert.equal(p.win.sessionStorage.getItem('prowl.curtain'), '1');
  await waitFor(() => /is-ready/.test(L.className), { timeout: 5000 });
  await waitFor(() => /is-out/.test(L.className), { timeout: 15000 });
  assert.equal(L.querySelector('.pc-pct > span').textContent, '100');
  await waitFor(() => !curtain(p), { timeout: 8000 });
  await p.close();
});

test('a tap or a key skips it, and the tap stays on the curtain', async () => {
  let p = loadPage({ url: APP, storage: DEN });
  await tick(50);
  let L = curtain(p);
  L.click();
  assert.match(L.className, /is-out/, 'the columns lift at once');
  await waitFor(() => !curtain(p), { timeout: 8000 });
  await p.close();
  p = loadPage({ url: APP, storage: DEN });
  await tick(50);
  L = curtain(p);
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.match(L.className, /is-out/);
  await p.close();
});

test('not on the shop page, not twice in a launch, not under reduced motion; ?curtain=1 and ?curtain=0 override', async () => {
  let p = loadPage({ url: SHOP, storage: DEN });
  assert.equal(curtain(p), null, 'the shop page');
  assert.equal(p.win.sessionStorage.getItem('prowl.curtain'), null);
  await p.close();
  p = loadPage({ url: APP, storage: DEN, beforeLoad: (w) => w.sessionStorage.setItem('prowl.curtain', '1') });
  assert.equal(curtain(p), null, 'once a launch');
  await p.close();
  p = loadPage({ url: APP, storage: DEN, reducedMotion: true });
  assert.equal(curtain(p), null, 'reduced motion');
  await p.close();
  p = loadPage({ url: APP + '?curtain=0', storage: DEN });
  assert.equal(curtain(p), null);
  await p.close();
  p = loadPage({ url: SHOP + '?curtain=1', storage: DEN, beforeLoad: (w) => w.sessionStorage.setItem('prowl.curtain', '1') });
  assert.ok(curtain(p), 'forced, even after one this launch');
  await p.close();
  /* the installed app reports display-mode: standalone */
  p = loadPage({ url: SHOP, storage: DEN, beforeLoad: (w) => { const m = w.matchMedia; w.matchMedia = (q) => ({ ...m(q), matches: /display-mode: standalone/.test(q) }); } });
  assert.ok(curtain(p), 'installed app');
  await p.close();
});

test('keys skip the curtain without scrolling the app beneath; typing in a box is left alone', async () => {
  const p = loadPage({ url: APP, storage: DEN });
  await tick(50);
  const key = (k, target = p.doc.body) => { const e = new p.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); target.dispatchEvent(e); return e.defaultPrevented; };
  assert.equal(key(' '), true, 'Space skips and does not scroll');
  assert.match(curtain(p).className, /is-out/);
  for (const k of ['PageDown', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'End', 'Home', 'PageUp', ' ']) assert.equal(key(k), true, k + ' during the lift');
  assert.equal(key(' ', p.$('#otp-q')), false, 'a space typed in the search box is a space');
  assert.equal(key('a'), false, "other keys are the app's");
  await waitFor(() => !curtain(p), { timeout: 8000 });
  assert.equal(key(' '), false, "with the curtain gone, Space is the page's again");
  await p.close();
});

test('the curtain keeps every tap until it is gone, so a second tap during the lift cannot press the app beneath', async () => {
  const p = loadPage({ url: APP, storage: DEN });
  await tick(50);
  const L = curtain(p);
  const takes = () => L.style.pointerEvents !== 'none' && p.win.getComputedStyle(L).pointerEvents !== 'none';
  assert.ok(takes(), 'up');
  L.click();
  assert.match(L.className, /is-out/);
  while (curtain(p)) { assert.ok(takes(), 'lifting: still taking taps'); await tick(60); }
  await p.close();
});

/* the app's palettes, read from its own stylesheet (every rule for a selector, later ones winning, as the cascade does),
   so the curtain cannot drift from them */
function vars(sel, src = resolveU(PAGE)) {   /* v8.04: Uranium's colours are variables; read them resolved */
  const o = {}, re = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g');
  for (const r of src.matchAll(re)) for (const m of r[1].matchAll(/(--[a-z0-9-]+):([^;}]+)/g)) o[m[1]] = m[2].trim();
  return o;
}
const URANIUM_TOP = /\[data-theme=uranium\] \.scout-app-wrapper\{background:linear-gradient\(180deg,(#[0-9a-f]+) 0,/i.exec(resolveU(PAGE))[1];   /* v8.04: a variable now */
const CSS = {
  root: vars(':root'),
  dark: vars('[data-theme=dark]'),
  uranium: vars('[data-theme=uranium]'),
  k2: vars('.scout-app-wrapper.k2'),
  k2blue: vars('[data-theme=dark]:not([data-dark=midnight]) .scout-app-wrapper.k2'),
  k2darkAc: vars('[data-theme=dark] .scout-app-wrapper.k2'),
  k2uraAc: vars('[data-theme=uranium] .scout-app-wrapper.k2'),
  cockpit: { ...vars('[data-theme=uranium]', resolveU(PAGE, 'cockpit')), ...vars('[data-theme=uranium][data-hud=cockpit]', resolveU(PAGE, 'cockpit')) },
  k2cockAc: vars('[data-theme=uranium] .scout-app-wrapper.k2', resolveU(PAGE, 'cockpit')),
};
const COCKPIT_TOP = /\[data-theme=uranium\] \.scout-app-wrapper\{background:linear-gradient\(180deg,(#[0-9a-f]+) 0,/i.exec(resolveU(PAGE, 'cockpit'))[1];
/* what the app paints in each theme: the base palette, then the New look's (.k2) accents, and Blue hour's own colours */
function expected(theme, k2) {
  const base = theme === 'light' ? CSS.root : theme === 'uranium' ? CSS.uranium : theme === 'cockpit' ? CSS.cockpit : CSS.dark;   /* midnight is data-theme=dark */
  let v = { ...base };
  if (theme === 'uranium') v['--bg'] = URANIUM_TOP;   /* it paints a gradient, not its --bg: the panels take its top */
  if (theme === 'cockpit') v['--bg'] = COCKPIT_TOP;   /* v8.04: Uranium's layout in red */
  if (k2) v = { ...v, ...(theme === 'light' ? CSS.k2 : theme === 'uranium' ? CSS.k2uraAc : theme === 'cockpit' ? CSS.k2cockAc : CSS.k2darkAc) };
  if (k2 && theme === 'dark') v = { ...v, ...CSS.k2blue };   /* Blue hour: not midnight */
  return ['--bg', '--ink', '--ln', '--ac', '--ac-ring'].map((k) => v[k]);
}

test('the curtain wears the theme and look the app opens in, from its first frame', async () => {
  const cases = [
    { name: 'nothing saved, device light', theme: 'light', k2: true },
    { name: 'nothing saved, device dark: Blue hour', theme: 'dark', k2: true, osDark: true },
    { name: 'Blue hour', saved: 'dark', theme: 'dark', k2: true },
    { name: 'Midnight', saved: 'midnight', theme: 'midnight', k2: true },
    { name: 'Uranium', saved: 'uranium', theme: 'uranium', k2: true },
    { name: 'Cockpit', saved: 'cockpit', theme: 'cockpit', k2: true },
    { name: 'Classic look, light', saved: 'light', theme: 'light', k2: false },
    { name: 'Classic look, dark', saved: 'dark', theme: 'dark', k2: false },
    { name: 'Classic from the address (?look=1)', theme: 'light', k2: false, qs: '?look=1' },
    { name: 'storage blocked, device dark: Blue hour, as the app falls back', theme: 'dark', k2: true, osDark: true, blocked: true },
    { name: 'storage blocked, device light', theme: 'light', k2: true, blocked: true },
    { name: 'storage blocked, ?look=1: the app stays New (its ?look=1 needs storage)', theme: 'light', k2: true, blocked: true, qs: '?look=1' },
    { name: 'storage blocked, device dark, ?look=1', theme: 'dark', k2: true, blocked: true, osDark: true, qs: '?look=1' },
  ];
  for (const c of cases) {
    const storage = { ...DEN, ...(c.saved ? { 'prowl.theme': c.saved } : {}), ...(c.k2 || c.qs ? {} : { 'prowl.look': '1' }) };
    const p = loadPage({ url: APP + (c.qs || ''), storage: c.blocked ? {} : storage, beforeLoad: (w) => {
      if (c.osDark) { const m = w.matchMedia; w.matchMedia = (q) => ({ ...m(q), matches: /prefers-color-scheme: dark/.test(q) }); }
      if (c.blocked) for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(w, k, { configurable: true, get() { throw new w.DOMException('blocked', 'SecurityError'); } });
    } });
    const L = curtain(p);
    const style = L.getAttribute('style');
    const got = ['--bg', '--ink', '--ln', '--ac', '--ac-ring'].map((k) => new RegExp(k + ':\\s*([^;]+)').exec(style)[1].trim());
    assert.deepEqual(got, expected(c.theme, c.k2), c.name);
    assert.ok(got.every(Boolean), c.name + ': every colour found in the stylesheet');
    /* and what the app itself ends up in, once its own theme and look code has run */
    await tick(20);
    const h = p.doc.documentElement, app = h.getAttribute('data-hud') === 'cockpit' ? 'cockpit' : h.getAttribute('data-dark') === 'midnight' ? 'midnight' : (h.getAttribute('data-theme') || 'light');
    assert.deepEqual([app, p.$('.scout-app-wrapper').classList.contains('k2')], [c.theme, c.k2], c.name + ': the app opens the same way');
    await p.close();
  }
});

test('the curtain never lifts before MIN_MS, lifts by MAX_MS, and the 9-second net removes it whatever happens', async () => {
  const MIN = Number(/var MIN_MS=(\d+),/.exec(PAGE)[1]);   /* v8.06: 600 (was 1600), read from the page */
  assert.ok(MIN >= 400 && MIN <= 1000, 'long enough to cover the load, short enough not to keep anyone waiting: ' + MIN);
  const frames = []; let net = null;
  const p = loadPage({ url: APP, storage: DEN, beforeLoad: (w) => {
    w.requestAnimationFrame = (f) => { frames.push(f); return frames.length; };
    const st = w.setTimeout.bind(w);
    w.setTimeout = (f, ms, ...a) => { if (ms === 9000 && !net) { net = f; return 0; } return st(f, ms, ...a); };
  } });
  const L = curtain(p);
  assert.equal(typeof net, 'function', 'the 9-second net is set when the curtain goes up');
  await waitFor(() => /is-ready/.test(L.className), { timeout: 5000 });
  let now = 1000, out = null;
  const run = (until) => { while (now < until && out === null) { now += 16; for (const f of frames.splice(0)) f(now); if (/is-out/.test(L.className)) out = now; } };
  const bar = L.querySelector('.pc-rule > i');
  const shown = () => Number((/scaleX\(([\d.]+)\)/.exec(bar.style.transform) || [0, 0])[1]);
  let t0 = null;
  while (now < 1000 + MIN - 10) {   /* the bar never runs ahead of the time since it began, over MIN_MS */
    now += 16; for (const f of frames.splice(0)) f(now);
    if (t0 === null && bar.style.transform) t0 = now;
    if (t0 !== null) assert.ok(shown() <= (now - t0) / MIN + 0.02, 'bar ' + shown() + ' at ' + (now - t0) + 'ms');
    assert.ok(!/is-out/.test(L.className), 'not before MIN_MS, however ready the app is');
  }
  run(1000 + 7000);
  assert.ok(out !== null && out - 1000 >= MIN && out - 1000 <= 6500, 'lifted at ' + (out - 1000) + 'ms');
  await p.close();
  /* the page never finishes loading: the bar holds short of full until MAX_MS, then fills and lifts */
  const frames3 = [];
  const r = loadPage({ url: APP, storage: DEN, beforeLoad: (w) => {
    w.requestAnimationFrame = (f) => { frames3.push(f); return frames3.length; };
    const st = w.setTimeout.bind(w);
    w.setTimeout = (f, ms, ...a) => (ms === 9000 || ms === 2500 ? 0 : st(f, ms, ...a));
    const add = w.addEventListener.bind(w);
    w.addEventListener = (type, ...a) => (type === 'load' ? undefined : add(type, ...a));
  } });
  const L3 = curtain(r);
  await waitFor(() => /is-ready/.test(L3.className), { timeout: 5000 });
  let n3 = 1000, out3 = null;
  while (n3 < 1000 + 9000 && out3 === null) { n3 += 16; for (const f of frames3.splice(0)) f(n3); if (/is-out/.test(L3.className)) out3 = n3 - 1000; }
  assert.ok(out3 !== null && out3 >= 5000 && out3 <= 6600, 'lifted at ' + out3 + 'ms: after MAX_MS, not before');
  await r.close();
  /* stuck: no frames at all (a background tab), so it never lifts by itself; the net takes it away */
  let net2 = null;
  const q = loadPage({ url: APP, storage: DEN, beforeLoad: (w) => {
    w.requestAnimationFrame = () => 0;
    const st = w.setTimeout.bind(w);
    w.setTimeout = (f, ms, ...a) => { if (ms === 9000 && !net2) { net2 = f; return 0; } return st(f, ms, ...a); };
  } });
  assert.ok(curtain(q));
  net2();
  assert.equal(curtain(q), null, 'gone, and the app is there');
  await q.close();
});

test("the header's Prowl is a span the curtain lands on", () => {
  assert.match(PAGE, /<span class="brand">[\s\S]*?<span class="brand-wm">Prowl<\/span><span class="probadge"/);
  assert.match(PAGE, /querySelector\('\.scout-app-wrapper \.bar \.brand-wm'\)/);
});

/* ---------- Prowl magic ---------- */

/* jsdom has no layout: a card counts as on screen unless it or a parent is hidden */
function layout(w) {
  w.Element.prototype.getClientRects = function () { for (let e = this; e; e = e.parentElement) if (e.hidden || (e.style && e.style.display === 'none')) return []; return [{ width: 1, height: 1 }]; };
}

/* results come back over the network, after the page (and the magic) has started: here 120ms later */
async function results(opts = {}) {
  const f = liveFetch();
  const slow = (u) => new Promise((r) => setTimeout(() => r(f.impl(u)), 120));
  const before = opts.beforeLoad;
  const p = loadPage({ fetchImpl: slow, ...opts, beforeLoad: (w) => { layout(w); if (before) before(w); }, storage: { ...DEN, owlTwigSgwTerms: ['pyrex'], 'prowl.lastHunt': 'pyrex', ...(opts.storage || {}) } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-u]').length >= 3, { timeout: 6000 });
  return p;
}

test('result cards rise in the first time each listing appears; a redraw mid-rise carries on, a later one does not start again', async () => {
  const p = await results();
  await waitFor(() => p.$('#otp-sgw .sgw-card.pm-in'));
  await tick(900);   /* every marketplace has answered */
  /* the page's clock, held still between steps, so what is asserted does not depend on how busy the machine is */
  let clock = p.win.Date.now();
  const realNow = p.win.Date.now;
  p.win.Date.now = () => clock;
  const grid = p.$('#otp-sgw .sgw-cell[data-u]').parentNode;
  const add = (u) => { const c = p.$('#otp-sgw .sgw-cell[data-u]').cloneNode(true); c.setAttribute('data-u', u); c.removeAttribute('data-fresh'); c.querySelector('.sgw-card').className = 'sgw-card'; c.querySelector('.sgw-card').style.animationDelay = ''; grid.appendChild(c); return c.querySelector('.sgw-card'); };
  const a = add('https://shopgoodwill.com/item/new-1');
  await waitFor(() => a.classList.contains('pm-in'), { timeout: 1000 });
  assert.equal(a.style.animationDelay, '0ms', 'a new listing rises in');
  /* the panel is redrawn 150ms into the rise: the new node carries on part-way */
  clock += 150;
  a.closest('.sgw-cell').remove();
  const b = add('https://shopgoodwill.com/item/new-1');
  await waitFor(() => b.classList.contains('pm-in'), { timeout: 1000 });
  assert.equal(b.style.animationDelay, '-150ms');
  await waitFor(() => !b.classList.contains('pm-in'), { timeout: 2000 });
  assert.equal(b.style.animationDelay, '', 'cleaned up');
  /* well after: a redraw shows it as it is */
  clock += 1000;
  b.closest('.sgw-cell').remove();
  const c = add('https://shopgoodwill.com/item/new-1');
  await tick(150);
  assert.equal(c.classList.contains('pm-in'), false, 'once a listing');
  p.win.Date.now = realNow;
  await p.close();
});

/* what the magic draws, recorded as it is added (it comes and goes on its own timers, and a busy machine runs late) */
function record(p) {
  const got = [];
  new p.win.MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && /^pm-(halo|uni)$/.test(n.className)) {
    const cell = n.closest('.sgw-cell');
    got.push({ k: n.className, u: cell && cell.getAttribute('data-u'), fresh: !!(cell && cell.hasAttribute('data-fresh')), hidden: n.getAttribute('aria-hidden'), delay: n.style.animationDelay, flock: !!n.closest('#otp-flock') });
  } }).observe(p.doc.body, { childList: true, subtree: true });
  return got;
}

test('listings new since the last look glow, and the first of them gets the unicorn', async () => {
  const f = liveFetch();
  const slow = (u) => new Promise((r) => setTimeout(() => r(f.impl(u)), 120));
  const p = loadPage({ fetchImpl: slow, beforeLoad: layout, storage: { ...DEN, owlTwigSgwTerms: ['pyrex'], 'prowl.lastHunt': 'pyrex', 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } } });
  const got = record(p);
  await waitFor(() => got.some((x) => x.k === 'pm-uni') && got.filter((x) => x.k === 'pm-halo').length >= 2, { timeout: 15000 });
  assert.ok(got.every((x) => x.fresh), 'only on listings new since the last look');
  assert.ok(got.every((x) => x.hidden === 'true'));
  assert.ok(!got.some((x) => x.u === 'https://shopgoodwill.com/item/pyrex-0'), 'seen last time: no glow');
  assert.equal(new Set(got.filter((x) => x.k === 'pm-uni').map((x) => x.u)).size, 1, 'one unicorn, on one listing (a redraw carries it on)');
  assert.equal(p.$('#otp-sgw .sgw-cell[data-u="https://shopgoodwill.com/item/pyrex-0"]').getAttribute('data-fresh'), null);
  assert.ok(p.$$('#otp-sgw .sgw-cell[data-fresh]').length >= 2);
  await p.close();
});

test('a first look marks nothing new', async () => {
  const p = await results();
  const got = record(p);
  await tick(1500);
  assert.equal(p.$$('#otp-sgw .sgw-cell[data-fresh]').length, 0);
  assert.equal(got.length, 0);
  await p.close();
});

/* a redraw, done by hand: a copy of a result cell for listing u (fresh or not), put where the panel's cells are */
function cells(p) {
  const grid = () => p.$('#otp-sgw .sgw-cell[data-u]').parentNode;
  const add = (u, fresh, into) => {
    const c = p.$('#otp-sgw .sgw-cell[data-u]').cloneNode(true);
    c.setAttribute('data-u', u);
    if (fresh) c.setAttribute('data-fresh', '1'); else c.removeAttribute('data-fresh');
    c.querySelectorAll('.pm-halo,.pm-uni').forEach((x) => x.remove());
    const card = c.querySelector('.sgw-card'); card.className = 'sgw-card'; card.style.animationDelay = '';
    (into || grid()).appendChild(c);
    return card;
  };
  const redraw = (u, fresh) => { p.$$('#otp-sgw .sgw-cell').filter((c) => c.getAttribute('data-u') === u).forEach((c) => c.remove()); return add(u, fresh); };
  return { add, redraw };
}
async function still(p) {   /* every marketplace has answered; then the page's clock is held still between steps */
  await tick(900);
  let clock = p.win.Date.now();
  p.win.Date.now = () => clock;
  return (ms) => { clock += ms; };
}

test('the glow and the unicorn carry on part-way across a redraw, do not start over, and are not redrawn once over', async () => {
  const p = await results();
  const later = await still(p);
  const got = record(p), { add, redraw } = cells(p);
  add('https://x.example/f-1', true); add('https://x.example/f-2', true);
  await waitFor(() => got.filter((x) => x.k === 'pm-halo').length === 2 && got.some((x) => x.k === 'pm-uni'), { timeout: 3000 });
  assert.deepEqual(got.map((x) => [x.k, x.u, x.delay]).sort(), [['pm-halo', 'https://x.example/f-1', '0ms'], ['pm-halo', 'https://x.example/f-2', '0ms'], ['pm-uni', 'https://x.example/f-1', '0ms']]);
  later(1000);
  got.length = 0;
  redraw('https://x.example/f-1', true); redraw('https://x.example/f-2', true);
  await waitFor(() => got.filter((x) => x.k === 'pm-halo').length === 2 && got.some((x) => x.k === 'pm-uni'), { timeout: 3000 });
  assert.deepEqual(got.map((x) => [x.k, x.u, x.delay]).sort(), [['pm-halo', 'https://x.example/f-1', '-1000ms'], ['pm-halo', 'https://x.example/f-2', '-1000ms'], ['pm-uni', 'https://x.example/f-1', '-1000ms']],
    'carried on from where they were, on the same listings');
  later(4500);   /* the glow is over (5.2s), and the unicorn (2.2s) */
  got.length = 0;
  redraw('https://x.example/f-1', true); redraw('https://x.example/f-2', true);
  await tick(400);
  assert.deepEqual(got, [], 'over is over');
  /* the unicorn is once a hunt: a new listing glows, without one; picking a hunt brings it back for the next */
  add('https://x.example/f-3', true);
  await waitFor(() => got.some((x) => x.u === 'https://x.example/f-3'), { timeout: 3000 });
  await tick(100);
  assert.deepEqual(got.map((x) => x.k), ['pm-halo']);
  p.$('#otp-sgw [data-sgw="pick"]').click();
  await tick(50);
  got.length = 0;
  add('https://x.example/f-4', true);
  await waitFor(() => got.some((x) => x.k === 'pm-uni'), { timeout: 3000 });
  assert.equal(got.find((x) => x.k === 'pm-uni').u, 'https://x.example/f-4');
  await p.close();
});

test('nothing glows in Flock', async () => {
  const p = await results();
  await still(p);
  const got = record(p), { add } = cells(p);
  const flock = p.$('#otp-flock');
  flock.hidden = false;   /* on screen, so only the rule keeps it from glowing */
  add('https://x.example/fl-1', true, flock);
  add('https://x.example/g-1', true);
  await waitFor(() => got.some((x) => x.u === 'https://x.example/g-1'), { timeout: 3000 });
  await tick(700);
  assert.equal(got.filter((x) => x.flock).length, 0);
  await p.close();
});

test('a card drawn while the tab is hidden, or under reduced motion, does not vanish and rise again on a later redraw', async () => {
  const p = await results();
  const later = await still(p);
  const { add, redraw } = cells(p);
  let hidden = true;
  Object.defineProperty(p.doc, 'hidden', { configurable: true, get: () => hidden });
  const a = add('https://x.example/h-1', false);
  await tick(150);
  assert.equal(a.classList.contains('pm-in'), false, 'nobody was watching');
  hidden = false;
  later(100);
  const a2 = redraw('https://x.example/h-1', false);
  await tick(150);
  assert.equal(a2.classList.contains('pm-in'), false, 'on screen already: it does not vanish and rise');
  const b = add('https://x.example/h-2', false);
  await waitFor(() => b.classList.contains('pm-in'), { timeout: 1000 });
  /* reduced motion switched on, a card drawn, switched off again */
  const mm = p.win.matchMedia;
  p.win.matchMedia = (q) => ({ ...mm(q), matches: /prefers-reduced-motion:\s*reduce/.test(q) });
  const r = add('https://x.example/r-1', false);
  await tick(150);
  assert.equal(r.classList.contains('pm-in'), false);
  p.win.matchMedia = mm;
  later(100);
  const r2 = redraw('https://x.example/r-1', false);
  await tick(150);
  assert.equal(r2.classList.contains('pm-in'), false, 'on screen already when motion came back');
  await p.close();
});

test('the glow waits until it can be seen: not on a hidden panel, not under the curtain', async () => {
  let p = await results();
  const later = await still(p);
  let got = record(p);
  const { add } = cells(p);
  p.$('#otp-sgw').hidden = true;   /* Daily or Flock open over it */
  add('https://x.example/w-1', true);
  await tick(800);
  assert.deepEqual(got, [], 'nothing plays where nobody can see it');
  later(6000);   /* long enough that a glow begun while hidden would be over */
  p.$('#otp-sgw').hidden = false;
  await waitFor(() => got.some((x) => x.k === 'pm-halo' && x.u === 'https://x.example/w-1'), { timeout: 2000 });
  assert.equal(got.find((x) => x.k === 'pm-halo').delay, '0ms', 'it starts when it is seen, from the beginning');
  await p.close();
  /* the app opening with the curtain up, and listings new since the last look */
  const f = liveFetch();
  p = loadPage({ url: APP, fetchImpl: (u) => Promise.resolve(f.impl(u)), beforeLoad: layout, storage: { ...DEN, owlTwigSgwTerms: ['pyrex'], 'prowl.lastHunt': 'pyrex', 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } } });
  got = record(p);
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-fresh]').length >= 2, { timeout: 6000 });
  await tick(300);
  assert.ok(curtain(p), 'the curtain is still up');
  assert.deepEqual(got, [], 'under the curtain: nothing yet');
  curtain(p).click();
  await waitFor(() => !curtain(p), { timeout: 5000 });
  await waitFor(() => got.some((x) => x.k === 'pm-uni') && got.some((x) => x.k === 'pm-halo'), { timeout: 3000 });
  await p.close();
});

test('Clear saved data forgets what was new', async () => {
  const p = await results({ storage: { 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-fresh]').length >= 2, { timeout: 6000 });
  await tick(900);
  p.win.confirm = () => true;
  p.$('#otp-clearBtn').click();
  /* the same hunt again: its listings are no longer "new since your last look" */
  p.$('#otp-sgwIn').value = 'pyrex';
  p.$('#otp-sgw [data-sgw="go"]').click();
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-u]').length >= 3, { timeout: 6000 });
  await tick(900);
  assert.equal(p.$$('#otp-sgw .sgw-cell[data-fresh]').length, 0);
  await p.close();
});

test('a listing that stays up is never forgotten, so it never glows as new on a later look', async () => {
  const p0 = await results();
  await tick(900);
  const shown = p0.$$('#otp-sgw .sgw-cell[data-u]').map((c) => c.getAttribute('data-u'));
  await p0.close();
  assert.ok(shown.length >= 10);
  /* seen before, oldest first: every listing on screen but the last, then a pile of listings gone since */
  const gone = Array.from({ length: 150 }, (_, i) => 'https://shopgoodwill.com/item/gone-' + i);
  const first = [...shown.slice(0, -1), ...gone].slice(0, 150);
  const p = await results({ storage: { 'prowl.seenUrls': { pyrex: first } } });
  await tick(900);
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.seenUrls')).pyrex;
  for (const u of shown) assert.ok(saved.includes(u), u + ' is remembered');
  assert.ok(saved.length <= Math.max(150, shown.length), 'capped');
  await p.close();
  const q = await results({ storage: { 'prowl.seenUrls': { pyrex: saved } } });
  await tick(900);
  assert.equal(q.$$('#otp-sgw .sgw-cell[data-fresh]').length, 0, 'next look: nothing new');
  await q.close();
});

test('a marketplace that fails for a visit keeps its listings, so they are not "new" when it answers again', async () => {
  const f = liveFetch();
  const p0 = await results();
  await tick(900);
  const etsy = p0.$$('#otp-sgw .sgw-cell[data-u]').map((c) => c.getAttribute('data-u')).filter((u) => /etsy\.com/.test(u));
  await p0.close();
  assert.ok(etsy.length >= 2);
  const gone = Array.from({ length: 150 }, (_, i) => 'https://shopgoodwill.com/item/gone-' + i);
  const seeded = [...etsy, ...gone].slice(0, 150);   /* Etsy's listings are the oldest entries */
  const down = (u) => new Promise((r) => setTimeout(() => r(/\/etsy(\?|$)/.test(new URL(String(u), 'https://x/').pathname + '?') ? { ok: false, status: 503, json: () => Promise.resolve({ error: 'down' }), text: () => Promise.resolve('') } : f.impl(u)), 120));
  const p = await results({ fetchImpl: down, storage: { 'prowl.seenUrls': { pyrex: seeded } } });
  await tick(1200);
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.seenUrls')).pyrex;
  for (const u of etsy) assert.ok(saved.includes(u), 'kept while Etsy is down: ' + u);
  assert.ok(saved.length <= 150);
  await p.close();
  const q = await results({ storage: { 'prowl.seenUrls': { pyrex: saved } } });
  await tick(900);
  assert.deepEqual(q.$$('#otp-sgw .sgw-cell[data-fresh]').map((c) => c.getAttribute('data-u')).filter((u) => /etsy\.com/.test(u)), [], 'Etsy back: nothing of its is new');
  await q.close();
});

test('a hunt that Flock fetched part of is not "new" on its first look', async () => {
  const f = liveFetch();
  let release, first = null, answered = 0; const gate = new Promise((r) => { release = r; });
  const fx = (u) => {   /* whichever marketplace Flock asks first about lamp answers; the rest wait for the first look */
    const x = new URL(String(u), 'https://x/'), q = (x.searchParams.get('q') || '').toLowerCase(), src = x.pathname.replace(/\//g, '') || 'shopgoodwill';
    if (q === 'lamp' && first === null) first = src;
    const now = q !== 'lamp' || src === first;
    return (now ? Promise.resolve() : gate).then(() => new Promise((r) => setTimeout(() => { if (q === 'lamp' && now) answered++; r(f.impl(u)); }, 60)));
  };
  const p = loadPage({ fetchImpl: fx, beforeLoad: layout, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex', 'lamp'] }, owlTwigSgwTerms: ['pyrex', 'lamp'], 'prowl.lastHunt': 'pyrex' } });
  p.win.confirm = () => true;
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-u]').length >= 3, { timeout: 6000 });
  await tick(500);
  p.$('#otp-dock .db[data-m="flock"]').click();   /* Flock asks one marketplace about lamp; the rest answer later */
  await waitFor(() => answered > 0, { timeout: 15000 });
  await tick(600);
  p.$('#otp-dock .db[data-m="prowl"]').click();
  await tick(100);
  p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]').find((c) => /lamp/i.test(c.textContent)).click();
  release();
  await tick(1500);
  assert.ok(p.$$('#otp-sgw .sgw-cell[data-u]').some((c) => /lamp/.test(c.getAttribute('data-u'))), 'lamp is on screen');
  assert.deepEqual(p.$$('#otp-sgw .sgw-cell[data-fresh]').map((c) => c.getAttribute('data-u')), [], 'a first look: nothing new');
  await p.close();
});

test('what is cut keeps the order listings were first seen: the oldest of the answering marketplaces first', async () => {
  const f = liveFetch();
  const slow = (u) => new Promise((r) => setTimeout(() => r(f.impl(u)), /etsy/.test(String(u)) ? 700 : 60));   /* Etsy answers last */
  const old = [...Array.from({ length: 20 }, (_, i) => 'https://www.etsy.com/listing/old-' + i), ...Array.from({ length: 130 }, (_, i) => 'https://shopgoodwill.com/item/old-' + i)];
  const p = await results({ fetchImpl: slow, storage: { 'prowl.seenUrls': { pyrex: old } } });
  await tick(1600);
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.seenUrls')).pyrex;
  const idx = (re) => saved.map((u, i) => (re.test(u) ? i : -1)).filter((i) => i > -1);
  const etsyOld = idx(/etsy\.com\/listing\/old-/), sgwOld = idx(/shopgoodwill\.com\/item\/old-/);
  assert.ok(sgwOld.length > 0);
  assert.ok(etsyOld.every((i) => i < sgwOld[0]), 'older Etsy entries stay ahead of newer ShopGoodwill ones');
  assert.ok(saved.length <= 150);
  await p.close();
});

test('the seen list is written only when what it remembers changes, and keeps more than 150 when that many are on screen', async () => {
  const p0 = await results();
  await tick(900);
  const saved0 = JSON.parse(p0.win.localStorage.getItem('prowl.seenUrls')).pyrex;
  await p0.close();
  let writes = 0;
  const p = await results({ storage: { 'prowl.seenUrls': { pyrex: saved0 } }, beforeLoad: (w) => {
    const set = w.Storage.prototype.setItem;
    w.Storage.prototype.setItem = function (k, v) { if (k === 'prowl.seenUrls') writes++; return set.call(this, k, v); };
  } });
  await tick(1200);
  assert.equal(writes, 0, 'nothing new: no write');
  await p.close();
  const many = liveFetch({ perSource: 30 });
  const r = await results({ fetchImpl: (u) => new Promise((res) => setTimeout(() => res(many.impl(u)), 60)), storage: { 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/old'] } } });
  await tick(1500);
  const all = new Set([...r.$$('#otp-sgw .sgw-cell[data-u]').map((c) => c.getAttribute('data-u'))]);
  const kept = JSON.parse(r.win.localStorage.getItem('prowl.seenUrls')).pyrex;
  assert.ok(kept.length > 150, kept.length + ' kept');
  for (const u of all) assert.ok(kept.includes(u), u);
  await r.close();
});

test('the chip sheen plays once each time the pointer comes onto a hunt, not again when the chip is redrawn under it', async () => {
  const p = await results();
  await tick(900);
  const chip = () => p.$('#otp-sgw .sgw-chip[data-sgw="pick"]');
  const over = (el, from = null) => el.dispatchEvent(new p.win.MouseEvent('mouseover', { bubbles: true, relatedTarget: from }));
  const out = (el, to) => el.dispatchEvent(new p.win.MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
  const fresh = (el) => { el.classList.remove('pm-sheen'); return el; };
  let c = chip();
  over(c);
  assert.ok(c.classList.contains('pm-sheen'), 'onto the chip');
  /* redrawn under a resting pointer, much later, its "new" badge changed: the same hover (a removed chip gets no mouseout) */
  const realNow = p.win.Date.now; p.win.Date.now = () => realNow() + 60000;
  const c2 = fresh(c.cloneNode(true));
  c2.insertAdjacentHTML('beforeend', '<em class="sgw-new">3 new</em>');
  c.replaceWith(c2);
  over(c2);
  assert.equal(c2.classList.contains('pm-sheen'), false, 'no replay');
  /* onto its own badge and back: the events a browser sends */
  const badge = c2.querySelector('.sgw-new');
  out(c2, badge); over(badge, c2);
  out(badge, c2); over(c2, badge);
  assert.equal(c2.classList.contains('pm-sheen'), false, 'still the same hover');
  out(c2, p.$('#otp-q')); over(p.$('#otp-q'), c2);   /* the pointer really leaves */
  over(c2, p.$('#otp-q'));
  assert.ok(c2.classList.contains('pm-sheen'), 'back onto it: once more');
  /* a redraw moves the chip away: the pointer is over something else, then onto the chip again */
  fresh(c2);
  const c3 = fresh(c2.cloneNode(true)); c2.replaceWith(c3);
  over(p.$('#otp-sgw .sgw-head') || p.$('#otp-sgw'));
  over(c3, p.$('#otp-sgw'));
  assert.ok(c3.classList.contains('pm-sheen'), 'a new hover after the pointer was off it');
  p.win.Date.now = realNow;
  await p.close();
});

test('starting a hunt sparkles at the button and the panther pounces; no panther walks across (v6.80); all of it is cleared away', async () => {
  const p = await results();
  p.$('#otp-q').value = 'pyrex';   /* v7.23: an empty box hunts nothing (it offers chips), so no sparkle */
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.$$('body > .pm-spark').length, 12, 'on body, outside the text-size zoom');
  assert.ok(p.$('#otp-pan').classList.contains('pm-pounce'));
  assert.equal(p.$$('.pm-walk').length, 0, 'the small logo sliding across read as an ant, so it is gone');
  await tick(1250);
  assert.equal(p.$$('.pm-spark').length, 0);
  assert.equal(p.$('#otp-pan').classList.contains('pm-pounce'), false);
  await p.close();
});

test('reduced motion: no rising cards, no glow, no sparks, no pounce', async () => {
  const p = await results({ reducedMotion: true, storage: { 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } } });
  await tick(300);
  assert.equal(p.$$('.pm-in,.pm-halo,.pm-uni').length, 0);
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.$$('.pm-spark,.pm-walk').length, 0);
  assert.equal(p.$('#otp-pan').classList.contains('pm-pounce'), false);
  await p.close();
});

test('every motion style is inside prefers-reduced-motion: no-preference, and cards rise with fill backwards', () => {
  /* v7.19: the block closes the main stylesheet (served by the worker) instead of sitting in its own <style> */
  const block = /\/\* v6\.\d+ Prowl magic[\s\S]*?\*\/([\s\S]*?)<\/style>/.exec(PAGE)[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const head = '@media (prefers-reduced-motion:no-preference){';
  assert.ok(block.startsWith(head), 'one media block');
  let depth = 0, end = -1;
  for (let i = head.length - 1; i < block.length; i++) { if (block[i] === '{') depth++; else if (block[i] === '}' && --depth === 0) { end = i; break; } }
  assert.equal(end, block.length - 1, 'nothing after the media block closes: every rule is inside it');
  for (const m of block.matchAll(/@keyframes (\w+)/g)) assert.ok(block.indexOf(m[0]) < end);
  assert.match(block, /\.pm-in\{animation:pmIn [^}]*backwards\}/, 'not both: a card keeps its own hover lift afterwards');
});

/* ---------- copy ---------- */

test("the photo check limits in the copy are the worker's, everywhere they are quoted", () => {
  /* v7.35 (Matt: "unlimited photo checks, people can use to price their stuff"): Pro is quoted as unlimited, and its
     fair-use ceiling is the worker's PHOTO_PRO_PER_DAY wherever a number is given */
  const free = Number(/const PHOTO_FREE_PER_DAY = (\d+);/.exec(WORKER)[1]), pro = Number(/const PHOTO_PRO_PER_DAY = (\d+);/.exec(WORKER)[1]);
  const words = ['zero', 'One', 'Two', 'Three'], s = (n) => (n === 1 ? '' : 's');
  const quotes = [
    'Free: ' + free + ' photo check' + s(free) + ' a day. <b>Prowl Pro:</b> unlimited.',   /* v8.29: Prowl Pro in bold (the owner's mockup) */
    words[free] + ' free check' + s(free) + ' a day, unlimited with Prowl Pro.',
    "'Prowl Pro: unlimited photo checks.'",
    "'Unlimited with Prowl Pro'",
    'Pro members get unlimited photo checks (fair use, ' + pro + ' a day)',
    "['Photo checks','" + free + " a day','Unlimited']",
    'plus unlimited photo checks',
    free + ' photo check' + s(free) + ' and 1 Fair price check a day',
  ];
  for (const q of quotes) assert.ok(PAGE.includes(q), q);
  /* and no other number next to a photo check */
  for (const m of PAGE.matchAll(/(\d+) (?:free )?photo checks? a day/g)) assert.ok([free].includes(Number(m[1])), m[0]);
  for (const m of PAGE.matchAll(/fair use, (\d+) a day/g)) assert.equal(Number(m[1]), pro, m[0]);
  assert.doesNotMatch(PAGE, /Two free checks a day|Free: 2 photo checks|2 photo checks a day|15 with Prowl Pro|25 photo checks|25 a day with Prowl Pro/);
});

