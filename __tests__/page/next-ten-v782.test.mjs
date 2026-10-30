// Page v7.82 (Matt's next 10: "all are good, daily does similar to 10 already, should do that in hunt as well. i just
// wanted each marketplace organized a bit."). The heart on the photo's corner; the photo check's answer with one main
// button and the rest under More, its tips folded once a photo is in; Near me without the gap over More ways to look;
// no second Alerts line in the favorites card; an empty hunt offers Or try first; Daily without its toast and with a
// small x; Recent searches under the box (a new key, prowl.recentQ); sentence case for the dock and the tabs; a hunt's
// marketplaces with listings a tap away, the empty ones in one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const BASE = 'https://www.owlandtwigvintage.com';
/* eBay, ShopGoodwill and the rest answer with two listings; Etsy, Vinted and Grailed with none */
function fx(opt) {
  opt = opt || {};
  return (u, o) => {
    const url = new URL(String(u), BASE);
    if (/\/appraise$/.test(url.pathname)) return J({ item: 'Haeger console bowl', fair: '$30-50', basis: 'sold', sure: 'HIGH', search: 'Haeger bowl' });
    if (url.pathname === '/hunt') return J({ rows: [], picks: [] });
    const q = url.searchParams.get('q');
    if (opt.asked && q) opt.asked.push(q);
    const empty = opt.none || /etsy|vinted|grailed/i.test(url.pathname);
    if (q && !empty) return J({ items: [1, 2].map((i) => ({ title: q + ' ' + i, url: 'https://www.ebay.com/itm/' + url.pathname.replace(/\W/g, '') + i + q.length, price: '$' + (10 * i), image: '' })) });
    return J({ items: [] });
  };
}
const DEN = (o) => Object.assign({ 'prowl.v36': { seen: true, hunts: ['rookwood vase', 'catalin bracelet'], lock: [0, 1] } }, o || {});
async function pick(p) { p.$$('.sgw-chip[data-sgw="pick"]')[0].click(); await tick(150); }
async function settled(p) { return waitFor(() => p.$('#otp-sgw .lv-rest .lv-none') && !p.$('#otp-sgw .lv-rest .lv-look') && p.$('#otp-sgw .lv-rest'), { timeout: 12000 }); }

test('a hunt\'s marketplaces: a row of the ones with listings and how many, their blocks in that order, the empty ones in one line', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx() });
  await tick(60); await pick(p);
  const rest = await settled(p);
  const row = p.$('#otp-sgw .lv-jump');
  assert.ok(row, 'the row');
  assert.equal(row.getAttribute('aria-label'), 'Jump to a marketplace');
  const chips = p.$$('#otp-sgw .lv-j');
  assert.ok(chips.length >= 2);
  for (const c of chips) assert.match(c.textContent, /^[A-Za-z .]+ 2$/, 'a name and its count');
  assert.ok(!chips.some((c) => /Etsy|Vinted|Grailed/.test(c.textContent)), 'only marketplaces with listings');
  const heads = p.$$('#otp-sgw .sgw-sub[data-lvb]').map((h) => h.querySelector('.sgw-live').textContent.replace('Live on ', ''));
  assert.deepEqual(heads, chips.map((c) => c.textContent.replace(/ 2$/, '')), 'the blocks follow the row');
  assert.ok(!p.$$('#otp-sgw .sgw-sub').some((h) => /Etsy|Vinted|Grailed/.test(h.textContent)), 'no heading for an empty marketplace');
  assert.equal(rest.querySelector('.lv-none').textContent, 'Nothing live for rookwood vase on Etsy, Vinted and Grailed right now. The full hunt below still searches everywhere else.');
  let to = null;
  const el = p.$('#otp-sgw .sgw-sub[data-lvb="1"]');
  el.scrollIntoView = (o) => { to = o; };
  chips[1].click();
  assert.equal(JSON.stringify(to), '{"behavior":"smooth","block":"start"}', 'a tap scrolls to its listings');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('still asking: one "Looking on" line for every marketplace not back yet, not a heading each', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: (u) => /[?&]q=/.test(String(u)) ? new Promise(() => {}) : fx()(u) });
  await tick(60); await pick(p);
  const look = await waitFor(() => p.$('#otp-sgw .lv-rest .lv-look'), { timeout: 8000 });
  assert.match(look.textContent, /^Looking on [A-Za-z, ]+ and [A-Za-z ]+…$/);
  assert.ok(look.querySelector('.paws'), 'the swallows');
  assert.equal(p.$$('#otp-sgw .sgw-sub').filter((h) => /Looking on/.test(h.nextElementSibling ? h.nextElementSibling.textContent : '')).length, 0);
  await p.close();
});

test('the heart sits on the photo\'s corner of a live card', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx() });
  await tick(60); await pick(p);
  await settled(p);
  const cell = p.$('#otp-sgw .sgw-cell');
  assert.equal(cell.children[1].className, 'sgw-cbar');
  assert.ok(cell.children[1].querySelector('.sgw-lk'));
  assert.ok(PAGE.includes('.scout-app-wrapper .sgw-cell>.sgw-cbar{position:absolute;top:6px;right:6px;z-index:2}'));
  await p.close();
});

test('the favorites card has no second Alerts line; an empty hunt offers Or try before the email', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx({ none: 1 }) });
  await tick(60); await pick(p);
  assert.equal(p.$('#otp-sgw .sgw-mail'), null);
  assert.equal(p.$('#otp-sgw .sgw-mh'), null);
  const empty = await waitFor(() => p.$('#otp-sgw .sgw-empty'), { timeout: 8000 });
  const kids = [...empty.children].map((e) => e.className || e.tagName);
  const orTry = kids.indexOf('sgw-rel-h'), mail = kids.indexOf('b');
  assert.ok(orTry > -1 && mail > orTry, 'Or try, then Email me when it shows up');
  await p.close();
});

test('Daily: no toast, and a small x in the corner closes it', async () => {
  const p = loadPage({ storage: DEN(), fetchImpl: fx() });
  await tick(60);
  p.$('.db[data-m="daily"]').click(); await tick(100);
  assert.doesNotMatch(p.$('#otp-toast') ? p.$('#otp-toast').textContent : '', /daily prowl/i);
  const x = p.$('#otp-cr');
  assert.equal(x.textContent, '✕');
  assert.equal(x.getAttribute('aria-label'), 'Close Daily');
  assert.ok(x.classList.contains('dg-x'));
  x.click(); await tick(60);
  assert.equal(p.$('#otp-res .dg-rh'), null, 'closed');
  assert.ok(!PAGE.includes("toast('Your daily prowl:"));
  await p.close();
});

test('Recent searches: a search not kept as a hunt is one tap away under the box, newest first; Clear empties it', async () => {
  const asked = [];
  const p = loadPage({ storage: DEN({ 'prowl.recentQ': ['mid century lamp'] }), fetchImpl: fx({ asked }) });
  await tick(60);
  const row = p.$('#otp-rq');
  assert.equal(row.hidden, false, 'kept from an earlier visit');
  assert.deepEqual(p.$$('#otp-rq [data-bolo]').map((b) => b.textContent), ['mid century lamp']);
  assert.equal(row.querySelector('.rq-l').textContent, 'Recent');
  for (const t of ['roseville pottery', 'rookwood vase', 'Fiestaware pitcher']) {
    p.$('#otp-q').value = t;
    p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
    await tick(40);
  }
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.recentQ')), ['Fiestaware pitcher', 'rookwood vase', 'roseville pottery', 'mid century lamp']);
  assert.deepEqual(p.$$('#otp-rq [data-bolo]').map((b) => b.textContent), ['Fiestaware pitcher', 'roseville pottery', 'mid century lamp'], 'a kept hunt is left out; three at most');
  asked.length = 0;
  p.$('#otp-rq [data-bolo="mid century lamp"]').click(); await tick(60);
  assert.equal(p.$('#otp-q').value, 'mid century lamp');
  assert.ok(asked.includes('mid century lamp'), 'one tap runs it');
  p.$('#otp-rq [data-rq="clear"]').click();
  assert.equal(row.hidden, true);
  assert.equal(p.win.localStorage.getItem('prowl.recentQ'), '[]');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Recent searches: a search is text, never markup; a broken key is ignored', async () => {
  const p = loadPage({ storage: DEN({ 'prowl.recentQ': ['<img src=x onerror=alert(1)>'] }) });
  await tick(60);
  const c = p.$('#otp-rq [data-bolo]');
  assert.equal(c.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(p.$('#otp-rq img'), null);
  await p.close();
  const q = loadPage({ storage: DEN({ 'prowl.recentQ': { not: 'a list' } }) });
  await tick(60);
  assert.equal(q.$('#otp-rq').hidden, true);
  assert.deepEqual(q.errors, []);
  await q.close();
});

test('sentence case: the dock and every tab', async () => {
  const p = loadPage({ storage: DEN() });
  await tick(60);
  assert.deepEqual(p.$$('#otp-dock .db span').map((s) => s.textContent), ['Hunt', 'Daily', 'Store', 'Flock', 'Near me', 'Den']);
  assert.deepEqual(p.$$('#otp-den .tab').map((b) => b.textContent), ['All hunts', 'About', 'Stats', 'Settings']);
  assert.match(p.$('#otp-ts').textContent, /^Shop/);
  await p.close();
});

/* the photo check, as photo-tray-v776 drives it */
function photo() {
  let n = 0;
  const beforeLoad = (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/' + (++n);
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  return loadPage({ storage: DEN(), fetchImpl: fx(), beforeLoad });
}

test('photo check: the tips and the free-check note fold once a photo is in; Start over brings them back', async () => {
  const p = photo();
  await tick(30);
  const sec = p.$('#otp-apr');
  assert.ok(!sec.classList.contains('apr-has'));
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'a.jpg', { type: 'image/jpeg' })); await tick(40);
  assert.ok(sec.classList.contains('apr-has'));
  assert.ok(PAGE.includes('.scout-app-wrapper .apr.apr-has .apr-tips,.scout-app-wrapper .apr.apr-has .apr-left{display:none}'));
  p.$('#otp-aprTray .apr-clr').click();
  assert.ok(!sec.classList.contains('apr-has'));
  await p.close();
});

test('photo check: the answer has one main button, Hunt it on Prowl, and the rest under More', async () => {
  const p = photo();
  await tick(30);
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'a.jpg', { type: 'image/jpeg' })); await tick(40);
  p.$('#otp-aprRun').click();
  const L = await waitFor(() => p.$('#otp-aprOut .apr-links'), { timeout: 8000 });
  const top = [...L.children];
  assert.equal(top.length, 3, 'the main buttons and More');   /* v8.01: Check with Google Lens is a main button too (Matt) */
  assert.equal(top[0].textContent, 'Hunt it on Prowl');
  assert.ok(top[0].classList.contains('p'));
  assert.equal(top[1].textContent, 'Check with Google Lens');
  assert.ok(top[1].classList.contains('p'));
  assert.equal(top[2].tagName, 'DETAILS');
  assert.equal(top[2].querySelector('summary').textContent, 'More');
  assert.equal(top[2].open, false, 'closed until tapped');
  const more = [...top[2].querySelectorAll('.apr-moreb>*')].map((b) => b.textContent);
  for (const t of ['★ Add to favorites', 'Share this find', 'Google Images']) assert.ok(more.includes(t), t);
  await p.close();
});

test('Near me: no gap with two lines over More ways to look', () => {
  assert.ok(PAGE.includes('.scout-app-wrapper #otp-nrAround .nr-live:not(:empty){margin-bottom:0;border-bottom:0}'));
});
