// Page v6.69: motion. Matthew's curtain when the app opens, and Hark's "Prowl magic" (cards rise in, listings new since
// your last look glow, starting a hunt sparkles). Both stay out of the way: once a launch, once a listing, a tap skips
// the curtain, and nothing at all under reduced motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test("the header's Prowl is a span the curtain lands on", () => {
  assert.match(PAGE, /<span class="brand">[\s\S]*?<span class="brand-wm">Prowl<\/span><span class="probadge"/);
  assert.match(PAGE, /querySelector\('\.scout-app-wrapper \.bar \.brand-wm'\)/);
});

/* ---------- Prowl magic ---------- */

/* results come back over the network, after the page (and the magic) has started: here 120ms later */
async function results(opts = {}) {
  const f = liveFetch();
  const slow = (u) => new Promise((r) => setTimeout(() => r(f.impl(u)), 120));
  const p = loadPage({ fetchImpl: slow, ...opts, storage: { ...DEN, owlTwigSgwTerms: ['pyrex'], 'prowl.lastHunt': 'pyrex', ...(opts.storage || {}) } });
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
    got.push({ k: n.className, u: cell && cell.getAttribute('data-u'), fresh: !!(cell && cell.hasAttribute('data-fresh')), hidden: n.getAttribute('aria-hidden') });
  } }).observe(p.doc.body, { childList: true, subtree: true });
  return got;
}

test('listings new since the last look glow, and the first of them gets the unicorn', async () => {
  const f = liveFetch();
  const slow = (u) => new Promise((r) => setTimeout(() => r(f.impl(u)), 120));
  const p = loadPage({ fetchImpl: slow, storage: { ...DEN, owlTwigSgwTerms: ['pyrex'], 'prowl.lastHunt': 'pyrex', 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } } });
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

test('starting a hunt sparkles at the button, the panther pounces and walks across; all of it is cleared away', async () => {
  const p = await results();
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.$$('body > .pm-spark').length, 12, 'on body, outside the text-size zoom');
  assert.equal(p.$$('body > .pm-walk').length, 1);
  assert.ok(p.$('#otp-pan').classList.contains('pm-pounce'));
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.$$('body > .pm-walk').length, 1, 'one panther at a time');
  await tick(1250);
  assert.equal(p.$$('.pm-spark').length, 0);
  assert.equal(p.$('#otp-pan').classList.contains('pm-pounce'), false);
  await tick(2200);
  assert.equal(p.$$('.pm-walk').length, 0);
  await p.close();
});

test('reduced motion: no rising cards, no glow, no sparks, no panther walk', async () => {
  const p = await results({ reducedMotion: true, storage: { 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } } });
  await tick(300);
  assert.equal(p.$$('.pm-in,.pm-halo,.pm-uni').length, 0);
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.$$('.pm-spark,.pm-walk').length, 0);
  assert.equal(p.$('#otp-pan').classList.contains('pm-pounce'), false);
  await p.close();
});

test('every motion style is inside prefers-reduced-motion: no-preference, and cards rise with fill backwards', () => {
  const block = /<!-- v6\.68 Prowl magic[\s\S]*?<style>([\s\S]*?)<\/style>/.exec(PAGE)[1].trim();
  assert.match(block, /^@media \(prefers-reduced-motion:no-preference\)\{[\s\S]*\}$/);
  assert.match(block, /\.pm-in\{animation:pmIn [^}]*backwards\}/, 'not both: a card keeps its own hover lift afterwards');
});

/* ---------- copy ---------- */

test("the photo check limits in the copy are the worker's", () => {
  const free = Number(/const PHOTO_FREE_PER_DAY = (\d+);/.exec(WORKER)[1]), pro = Number(/const PHOTO_PRO_PER_DAY = (\d+);/.exec(WORKER)[1]);
  const words = ['zero', 'One', 'Two', 'Three'];
  assert.ok(PAGE.includes('Free: ' + free + ' photo check' + (free === 1 ? '' : 's') + ' a day. Prowl Pro: ' + pro + ' a day.'));
  assert.ok(PAGE.includes(words[free] + ' free check' + (free === 1 ? '' : 's') + ' a day, ' + pro + ' with Prowl Pro.'));
  assert.doesNotMatch(PAGE, /Two free checks a day|Free: 2 photo checks|15 with Prowl Pro/);
});
