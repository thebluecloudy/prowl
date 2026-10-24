// Page v7.81: the owner's 10 ideas from the design brief ("i love them all"). On the Hunt card: one orange button
// (Continue the full hunt), one live status line at the top, quiet card headers; the Alerts card as one line until
// it is wanted; Daily's badge counts what is new; Best picks drawn like the v7.26 result cards; one loading look
// (swallows, Near me's flock for Best picks); the line under the title; one style for the small labels. Idea 10
// (text size reaches everything) was already true: the setting zooms the whole app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
/* every live marketplace answers with two listings of its own; /hunt (Best picks) waits when hold is set */
function fx(opt) {
  opt = opt || {};
  return (u) => {
    const url = new URL(String(u));
    if (opt.asked) opt.asked.push(url.searchParams.get('q') || '');
    if (url.pathname === '/hunt') return opt.hold ? new Promise(() => {}) : J({ rows: [], picks: [] });
    const q = url.searchParams.get('q');
    if (q && !opt.none) return J({ items: [1, 2].map((i) => ({ title: q + ' ' + i, url: 'https://www.ebay.com/itm/' + url.pathname.slice(1) + i + q.length, price: '$' + (10 * i), image: '' })) });
    return J({ items: [] });
  };
}
const DEN = (o) => ({ 'prowl.v36': Object.assign({ seen: true, hunts: ['rookwood vase', 'catalin bracelet'], lock: [0, 1] }, o || {}) });
async function pick(p) { p.$$('.sgw-chip[data-sgw="pick"]')[0].click(); await tick(150); }

test('one status line at the top says what is live and when the full hunt last ran; no "Not run yet" at the foot', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx() });
  await tick(60); await pick(p);
  const st = p.$('.sgw-body .sgw-status');
  assert.ok(st, 'the line');
  assert.equal(st.getAttribute('role'), 'status');
  assert.match(st.textContent, /^Live now · \d+ listings · full hunt not run yet$/);
  assert.ok(st.classList.contains('sgw-st-on'));
  assert.equal(p.$('.sgw-body').firstElementChild, st, 'first in the card body');
  assert.equal(p.$('.sgw-ago'), null);
  assert.doesNotMatch(p.$('.sgw-body').textContent, /Not run yet/);
  assert.deepEqual(p.errors, []);
  await p.close();
  const n = loadPage({ storage: DEN(), fetchImpl: fx({ none: 1 }) });
  await tick(60); await pick(n);
  assert.match(n.$('.sgw-body .sgw-status').textContent, /^Nothing live right now · full hunt not run yet$/);
  assert.ok(n.$('.sgw-body .sgw-status').classList.contains('sgw-st-off'));
  await n.close();
});

test('one orange button in the hunt card: Email me is outlined, the Swipe switch is ink', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx({ none: 1 }) });
  await tick(60); await pick(p);
  const w = p.$('[data-empty="watch"]');
  assert.ok(w);
  assert.equal(w.className, 'b');
  assert.ok(p.$('.sgw-hunt.b.p'), 'Continue the full hunt keeps the orange');
  assert.match(PAGE, /\.view-sw button\[aria-pressed="true"\]\{background:var\(--ink\);color:var\(--bg\)\}/);
  await p.close();
});

test('the Alerts card is one line until it is wanted; a link to it opens it', async () => {
  const p = loadPage({ storage: DEN() });
  await tick(60);
  const sec = p.$('#otp-alerts'), mini = p.$('#otp-alertsMini');
  assert.ok(sec.classList.contains('is-mini'));
  assert.equal(mini.getAttribute('aria-expanded'), 'false');
  assert.equal(mini.textContent, '✉New finds by emailFree for 3 hunts' + 'Set up →');
  mini.click();
  assert.ok(!sec.classList.contains('is-mini'), 'the full card');
  assert.equal(mini.getAttribute('aria-expanded'), 'true');
  assert.ok(p.$('#otp-alertsF'), 'the newsletter form is still in it');
  await p.close();
  assert.match(PAGE, /\.alrt\.is-mini>:not\(\.alrt-mini\),\.scout-app-wrapper \.alrt:not\(\.is-mini\)>\.alrt-mini\{display:none!important\}/);
  assert.match(PAGE, /if\(\/\^#otp-alerts\\b\/\.test\(String\(location\.hash\|\|''\)\)\)alertsOpen\(\);/);
  assert.match(PAGE, /if\(box\)box\.classList\.remove\('is-mini'\);/, 'the thank-you after joining the list shows');
});

test('Daily\'s badge is what is new across the hunts, not how many hunts; hidden when nothing is', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx({ none: 1 }) });
  await tick(80);
  const b = p.$('#otp-ds');
  assert.equal(b.hidden, true, '2 hunts, nothing new: no badge (it said 2 before)');
  await p.close();
  /* catalin bracelet was looked at before (one old listing seen); Daily loads every hunt's live listings, a few at a time */
  const asked = [];
  const q = loadPage({ storage: Object.assign(DEN(), { 'prowl.seenUrls': { 'catalin bracelet': ['https://www.ebay.com/itm/old'] } }), fetchImpl: fx({ asked }) });
  await tick(80);
  q.$('.db[data-m="daily"]').click();
  await waitFor(() => asked.filter((x) => x === 'catalin bracelet').length >= 8, { timeout: 15000 });
  await tick(100);
  q.$('.db[data-m="prowl"]').click(); await tick(200);
  const pill = q.$$('.sgw-chip').find((c) => /catalin bracelet/.test(c.textContent));
  assert.equal(pill.querySelector('.sgw-new').getAttribute('aria-label'), '16 new', 'eight marketplaces, two each, none seen');
  assert.equal(pill.querySelector('.sgw-new').textContent, '9+ new', 'the pill caps what it shows');
  const badge = q.$('#otp-ds');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '16 new', 'the badge adds up the real counts');
  assert.match(badge.getAttribute('aria-label'), /^\d+ new in your hunts$/);
  await q.close();
});

test('one loading look: swallows where paw prints were, and Near me\'s flock while Best picks are found', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx({ hold: 1 }) });
  await tick(60); await pick(p);
  const fl = p.$('.pk-wait .nr-flock');
  assert.ok(fl, 'the flock card');
  assert.equal(fl.querySelector('.nr-flockt').textContent, 'Finding the best picks across every marketplace…');
  assert.equal(fl.querySelectorAll('.nr-fb use').length, 5);
  await p.close();
  assert.ok(!PAGE.includes('<i>🐾</i>') && !PAGE.includes('\\ud83d\\udc3e</i>'), 'no paw prints left');
  assert.match(PAGE, /pe=document\.createElement\('i'\),sv=document\.createElementNS\('http:\/\/www\.w3\.org\/2000\/svg','svg'\)/, 'the photo check too');
});

test('the line under the title, Best picks cards, quiet headers and one label style', () => {
  assert.ok(PAGE.includes('<p class="lede k2-only"><span data-t>29</span> vintage marketplaces, one search. Free.</p>'));
  assert.match(PAGE, /\.scout-app-wrapper \.lede\{[^}]*text-wrap:balance\}/);
  assert.match(PAGE, /\.scout-app-wrapper \.pk-card\{text-align:center;/);
  assert.match(PAGE, /\.scout-app-wrapper \.pk-card b\{order:3;font-size:17px;font-weight:600;color:var\(--ink\)\}/);
  assert.match(PAGE, /\.k2 \.gd>h2,\.scout-app-wrapper\.k2 \.alrt>h2\{background:none;border-bottom:1px solid var\(--ln\)\}/);
  const lab = PAGE.indexOf('.scout-app-wrapper .comps-h,.scout-app-wrapper .sgw-rel-h,.scout-app-wrapper .bolo-l,.scout-app-wrapper .apr-lkh,.scout-app-wrapper .nr-optt{font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mu)}');
  assert.ok(lab > 0);
  for (const r of ['.scout-app-wrapper .apr-lkh{margin', '.scout-app-wrapper .bolo-l,.scout-app-wrapper .sgw-rel-h{', '.scout-app-wrapper .nr-optt{margin']) assert.ok(PAGE.indexOf(r) < lab, 'after ' + r);
  assert.match(PAGE, /\.scout-app-wrapper \.comps-h b\{text-transform:none;/, 'a hunt\'s name stays as typed');
});
