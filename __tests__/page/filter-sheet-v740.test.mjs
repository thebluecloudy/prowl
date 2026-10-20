// Page v7.40 (the owner, after a look at how Shop, Vinted, Walmart, Airbnb and the rest draw their filters on Mobbin:
// "this is perfect, build it"): a sliders button beside the search box opens one Filter sheet (Sort by, Price, Sites,
// Skip words), chips under the box show what is in force, and nothing applies until Show N listings. The filters shape
// every live strip, the Best picks and Daily; sort, price and skip words live under a new key, the sites stay in the
// drawer's saved set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const LS = { seen: true, hunts: ['rookwood vase'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 };

/* live answers: eBay has three prices and a reproduction, Etsy one; every other site two cheap ones */
const EBAY = [
  { title: 'Rookwood vase 1946 signed 7.5 in', price: '$190.00', listed: '2026-10-18' },
  { title: 'Rookwood vase reproduction style, brown drip', price: '$45.00', listed: '2026-10-20' },
  { title: 'Rookwood 1913 cabinet vase, incised', price: '$880.00' },
];
const ETSY = [{ title: 'Rookwood Pottery vase 1922 matte blue', price: '$120.00' }];
function serve() {
  const calls = [];
  const impl = (url) => {
    const s = String(url); calls.push(s);
    const u = new URL(s, 'https://www.owlandtwigvintage.com/');
    if (u.pathname.startsWith('/apps/prowl/')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
    if (u.pathname === '/hunt') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ rows: [], picks: [] }) });
    const src = u.pathname.replace(/\//g, '') || 'shopgoodwill';
    const base = src === 'ebay' ? EBAY : src === 'etsy' ? ETSY : [{ title: 'Rookwood vase find 0', price: '$10.00' }, { title: 'Rookwood vase find 1', price: '$11.00' }];
    const host = src === 'shopgoodwill' ? 'shopgoodwill.com/item' : src === 'ebay' ? 'www.ebay.com/itm' : `www.${src}.com/listing`;
    const items = base.map((x, i) => ({ ...x, url: `https://${host}/${src}-${i}`, image: `https://img.example.com/${src}/${i}.jpg`, src: src === 'shopgoodwill' ? '' : src }));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
  };
  return { impl, calls };
}
function open(storage = {}) {
  return loadPage({ fetchImpl: serve().impl, storage: { 'prowl.v36': LS, ...storage } });
}
async function hunt(p) {
  p.$('#otp-q').value = 'rookwood vase';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$$('.rlive[data-lv="ebay"] .sgw-cell').length, { timeout: 8000 });
  await tick(40);
}
const cells = (p) => p.$$('.run-live .sgw-cell').length;
const ebayPrices = (p) => p.$$('.rlive[data-lv="ebay"] .sgw-cell').map((c) => c.getAttribute('data-p'));
const click = (p, el) => el.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));

test('the search bar has the filter button before Hunt, the chips sit under it, and the page is v7.42', () => {
  assert.ok(Number(/var PROWL_VERSION='v7\.(\d+)';/.exec(html)[1]) >= 42, 'v7.42 or later');
  const form = html.slice(html.indexOf('<form id="otp-sf"'), html.indexOf('</form>'));
  assert.ok(form.indexOf('id="otp-flt"') > -1 && form.indexOf('id="otp-flt"') < form.indexOf('type="submit"'), 'the filter button comes before Hunt');
  assert.match(form, /class="flt-n" id="otp-fltN" hidden/);
  assert.ok(html.indexOf('id="otp-fltChips"') > html.indexOf('</form>'), 'the chips row is right under the form');
  /* the stylesheet stays scoped */
  const css = html.slice(html.indexOf('<style id="prowl-css">'), html.indexOf('</style>', html.indexOf('<style id="prowl-css">')));
  for (const rule of css.match(/^[^@\s][^{]*\.flt-[^{]*\{/gm) || []) assert.match(rule, /\.scout-app-wrapper/, rule);
});

test('a price reads as a number, other currencies stay unknown, and the sort orders by price or listing date', async () => {
  const p = open();
  await tick(50);
  const w = p.win.prowlFlt;
  assert.equal(w.num('$1,234.56'), 1234.56);
  assert.equal(w.num('US $12'), 12);
  assert.ok(Number.isNaN(w.num('¥12,000')));
  assert.ok(Number.isNaN(w.num('12.00 EUR')));
  assert.ok(Number.isNaN(w.num('')));
  const items = [{ title: 'A', price: '$50' }, { title: 'B', price: '¥900' }, { title: 'C', price: '$5', listed: '2026-10-19' }, { title: 'D', price: '$500', found: '2026-10-20' }];
  assert.deepEqual(w.sorted(items, { sort: 'lo' }).map((x) => x.title), ['C', 'A', 'D', 'B'], 'no price last');
  assert.deepEqual(w.sorted(items, { sort: 'hi' }).map((x) => x.title), ['D', 'A', 'C', 'B']);
  assert.deepEqual(w.sorted(items, { sort: 'new' }).map((x) => x.title), ['D', 'C', 'A', 'B'], 'dated first, newest first, the rest in their order');
  assert.deepEqual(w.sorted(items, { sort: 'best' }).map((x) => x.title), ['A', 'B', 'C', 'D']);
  const s = { sort: 'best', lo: 100, hi: 300, skip: ['reproduction'] };
  assert.equal(w.pass({ title: 'Rookwood vase', price: '$190' }, s), true);
  assert.equal(w.pass({ title: 'Rookwood vase', price: '$45' }, s), false);
  assert.equal(w.pass({ title: 'Rookwood vase', price: '¥900' }, s), true, 'an unknown price is left alone');
  assert.equal(w.pass({ title: 'Rookwood vase REPRODUCTION', price: '$190' }, s), false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the sheet opens from the button, Show applies a price range to every strip, chips and the badge follow, and the saved hunts key is untouched', async () => {
  const p = open();
  await hunt(p);
  const before = p.win.localStorage.getItem('prowl.v36');
  assert.equal(ebayPrices(p).length, 3);
  assert.equal(p.$('#otp-fltChips').hidden, true);
  assert.equal(p.$('#otp-fltN').hidden, true);
  click(p, p.$('#otp-flt'));
  await waitFor(() => p.$('#otp-sheet').classList.contains('on'));
  assert.equal(p.$('#otp-sheetT').textContent, 'Filter');
  const sheet = p.$('#otp-sheetB .flt');
  assert.ok(sheet, 'the sheet body is the filter sheet');
  assert.deepEqual(p.$$('#otp-sheetB .flt-rh .l').map((x) => x.textContent), ['Sort by', 'Price', 'Sites', 'Skip wordsPRO']);
  assert.deepEqual(p.$$('#otp-sheetB .flt-rh .v').map((x) => x.textContent), ['Best match', 'Any', 'All 29', 'None']);
  const go = p.$('#otp-fltGo'), all = cells(p);
  assert.ok(all >= 10, 'several strips answered');
  assert.equal(go.textContent, 'Show ' + all + ' listings', 'every live listing on screen counts');
  click(p, p.$('#otp-sheetB [data-fa="price"][data-lo="100"][data-hi="300"]'));
  assert.equal(p.$('#otp-sheetB [data-fv="price"]').textContent, '$100 to $300');
  assert.equal(p.$('#otp-fltHi').value, '300');
  assert.equal(go.textContent, 'Show 2 listings', 'nothing applied yet, but the count says what would show');
  assert.equal(ebayPrices(p).length, 3, 'the strips wait for Show');
  click(p, go);
  await waitFor(() => !p.$('#otp-sheet').classList.contains('on'));
  await tick(40);
  assert.deepEqual(ebayPrices(p), ['$190.00']);
  assert.match(p.$('.rlive[data-lv="ebay"] .sgw-upd').textContent, /1 live now · 2 hidden by your filters/);
  assert.match(p.$('.rlive[data-lv="poshmark"] .sgw-note').textContent, /2 on Poshmark, all hidden by your filters/);
  assert.deepEqual(p.$$('#otp-fltChips .flt-chip').map((c) => c.getAttribute('data-fc') + ':' + c.querySelector('b').textContent), ['price:$100 to $300']);
  assert.equal(p.$('#otp-fltChips').hidden, false);
  assert.equal(p.$('#otp-fltN').textContent, '1');
  assert.equal(p.$('#otp-fltN').hidden, false);
  assert.ok(p.$('#otp-flt').classList.contains('is-on'));
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.filter')), { sort: 'best', lo: 100, hi: 300, skip: [] });
  assert.equal(p.win.localStorage.getItem('prowl.v36'), before, 'the hunts key never changes shape');
  /* the chip's cross takes the filter off */
  click(p, p.$('#otp-fltChips .flt-chip[data-fc="price"]'));
  await tick(40);
  assert.equal(ebayPrices(p).length, 3);
  assert.equal(p.$('#otp-fltChips').hidden, true);
  assert.equal(p.$('#otp-fltN').hidden, true);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a saved sort orders every strip by price and drops the exact/close split; the "hidden" link reopens the sheet', async () => {
  const p = open({ 'prowl.filter': { sort: 'lo', lo: 0, hi: 0, skip: [] } });
  await hunt(p);
  assert.deepEqual(ebayPrices(p), ['$45.00', '$190.00', '$880.00']);
  assert.equal(p.$('.rlive[data-lv="ebay"] .sgw-close'), null);
  assert.deepEqual(p.$$('#otp-fltChips .flt-chip b').map((b) => b.textContent), ['Price: low to high']);
  click(p, p.$('#otp-flt'));
  await waitFor(() => p.$('#otp-sheet').classList.contains('on'));
  assert.equal(p.$('#otp-sheetB input[name="otp-fltSort"]:checked').value, 'lo');
  assert.ok(p.$('#otp-sheetB .flt-row[data-fr="sort"]').classList.contains('open'), 'a row that holds something opens by itself');
  /* Clear all in the sheet is a draft too: the strips move only on Show */
  click(p, p.$('#otp-sheetB [data-fa="clear"]'));
  assert.equal(p.$('#otp-sheetB [data-fv="sort"]').textContent, 'Best match');
  assert.deepEqual(ebayPrices(p), ['$45.00', '$190.00', '$880.00']);
  click(p, p.$('#otp-fltGo'));
  await waitFor(() => !p.$('#otp-sheet').classList.contains('on'));
  await tick(40);
  assert.deepEqual(ebayPrices(p), ['$190.00', '$45.00', '$880.00'], 'back to the site\'s own order');
  assert.equal(p.win.localStorage.getItem('prowl.filter'), JSON.stringify({ sort: 'best', lo: 0, hi: 0, skip: [] }));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('skip words are Prowl Pro: locked without it, and with it a word hides the listing and goes to the saved filter', async () => {
  const free = open();
  await hunt(free);
  click(free, free.$('#otp-flt'));
  await waitFor(() => free.$('#otp-sheet').classList.contains('on'));
  assert.equal(free.$('#otp-fltSkip').disabled, true);
  assert.match(free.$('#otp-sheetB .flt-row[data-fr="skip"] .flt-hint').innerHTML, /href="\/products\/prowl-pro"/);
  await free.close();

  const pro = open({ 'prowl.alertPro': '1', 'prowl.alertTok': 'tok' });
  await hunt(pro);
  click(pro, pro.$('#otp-flt'));
  await waitFor(() => pro.$('#otp-sheet').classList.contains('on'));
  const inp = pro.$('#otp-fltSkip');
  assert.equal(inp.disabled, false);
  inp.value = 'Reproduction, lot';
  inp.dispatchEvent(new pro.win.Event('input', { bubbles: true }));
  assert.equal(pro.$('#otp-sheetB [data-fv="skip"]').textContent, 'reproduction, lot');
  assert.equal(pro.$('#otp-fltGo').textContent, 'Show ' + (cells(pro) - 1) + ' listings');
  click(pro, pro.$('#otp-fltGo'));
  await waitFor(() => !pro.$('#otp-sheet').classList.contains('on'));
  await tick(40);
  assert.deepEqual(ebayPrices(pro), ['$190.00', '$880.00']);
  assert.deepEqual(JSON.parse(pro.win.localStorage.getItem('prowl.filter')).skip, ['reproduction', 'lot']);
  assert.deepEqual(pro.$$('#otp-fltChips .flt-chip b').map((b) => b.textContent), ['Skip: reproduction, lot']);
  assert.deepEqual(pro.errors, []);
  await pro.close();
});

test('the Sites row is the drawer\'s set: unticking eBay drops its strip, the drawer and the saved marketplaces agree, Select all brings it back', async () => {
  const p = open();
  await hunt(p);
  click(p, p.$('#otp-flt'));
  await waitFor(() => p.$('#otp-sheet').classList.contains('on'));
  assert.equal(p.$$('#otp-fltMk input[data-fm]').length, 19, 'the SHOP tab first');
  click(p, p.$('#otp-sheetB [data-fa="tab"][data-t="bolo"]'));
  assert.equal(p.$$('#otp-fltMk input[data-fm]').length, 10);
  click(p, p.$('#otp-sheetB [data-fa="tab"][data-t="shop"]'));
  const box = p.$('#otp-fltMk input[data-fm="ebay"]');
  box.checked = false;
  box.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  assert.equal(p.$('#otp-sheetB [data-fv="sites"]').textContent, '28 of 29');
  assert.equal(p.$('#otp-fltGo').textContent, 'Show ' + (cells(p) - 3) + ' listings');
  assert.ok(p.$('.rlive[data-lv="ebay"]'), 'still on screen until Show');
  click(p, p.$('#otp-fltGo'));
  await waitFor(() => !p.$('#otp-sheet').classList.contains('on'));
  await tick(40);
  assert.equal(p.$('.rlive[data-lv="ebay"]'), null);
  assert.ok(p.$('.rlive[data-lv="etsy"]'));
  assert.deepEqual(p.$$('#otp-fltChips .flt-chip b').map((b) => b.textContent), ['28 of 29 sites']);
  const saved = JSON.parse(p.win.localStorage.getItem('prowl.v36'));
  assert.equal(saved.mkt.length, 28);
  assert.equal(saved.mkt.indexOf('ebay'), -1);
  assert.equal(p.$('#otp-dc').textContent, '28 of 29 selected', 'the Den\'s marketplace drawer says the same');
  /* the sites chip puts every site back */
  click(p, p.$('#otp-fltChips .flt-chip[data-fc="sites"]'));
  await waitFor(() => p.$('.rlive[data-lv="ebay"] .sgw-cell'), { timeout: 8000 });
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.v36')).mkt.length, 29);
  assert.equal(p.$('#otp-fltChips').hidden, true);
  assert.deepEqual(p.errors, []);
  await p.close();
});
