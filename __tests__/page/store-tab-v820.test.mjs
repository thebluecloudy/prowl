// Page v8.20 (Matt, 2026-10-30: "instead of a button and going into the den to change it ... put a drop down right
// there so I can pick whatever marketplace", "a new button at the bottom ... to search just one store, everything"):
// the Store dock tab runs every hunt on one marketplace, picked in a dropdown at the top of that screen. Its pick
// (st.store) is kept apart from the Just … pill (st.one / oneOn), so choosing a store never turns the pill on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const HUNTS = ['pyrex butterprint', 'fire king jadeite', 'hull pottery'];
function rig() {
  const asked = [];
  const fetchImpl = (u) => {
    const s = String(u), m = /workers\.dev\/\?q=([^&]+)/.exec(s);
    if (m) { const q = decodeURIComponent(m[1]); asked.push(q); const items = q === 'hull pottery' ? [] : [{ title: 'A ' + q, url: 'https://shopgoodwill.com/item/' + q.length, price: '$5' }]; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { asked, fetchImpl };
}
const tab = (p) => p.$('#otp-dock .db[data-m="store"]');
const saved = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36'));
const pick = (p, v) => { const s = p.$('#otp-stSel'); s.value = v; s.dispatchEvent(new p.win.Event('change', { bubbles: true })); };

test('Store is a dock tab; one tap checks every hunt on ShopGoodwill, pill off, search box ignored', async () => {
  const r = rig();
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS } } });
  await tick(30);
  assert.equal(p.$('#otp-one').hidden, true, 'the Just … pill is off');
  assert.equal(tab(p).querySelector('span').textContent, 'Store');
  p.$('#otp-q').value = 'something typed';
  tab(p).click();
  await tick(HUNTS.length * 250 + 400);
  assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on ShopGoodwill');
  assert.equal(p.$('#otp-res .eb').textContent, 'One store');
  assert.deepEqual([...r.asked].sort(), [...HUNTS].sort());
  assert.deepEqual(p.$$('#otp-res .ol-blk h3').map((h) => h.textContent), ['pyrex butterprint', 'fire king jadeite']);
  assert.deepEqual(p.$$('#otp-olNone a').map((a) => a.textContent), ['hull pottery']);
  assert.ok(tab(p).classList.contains('on'), 'the tab lights up');
  assert.equal(p.$('#otp-stSel').value, 'shopgoodwill');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the dropdown switches store in place, is remembered, and never turns the pill on', async () => {
  let p = loadPage({ fetchImpl: rig().fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS } } });
  await tick(30);
  tab(p).click();
  await tick(50);
  const ids = p.$$('#otp-stSel option').map((o) => o.value);
  assert.ok(ids.includes('rubylane') && ids.includes('ebay') && ids.includes('shopgoodwill'));
  assert.ok(!ids.includes('ebaysold') && !ids.includes('facebook'), 'no sold prices, no city-by-city Facebook');
  pick(p, 'rubylane');
  await tick(50);
  assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on Ruby Lane');
  assert.equal(p.$$('#otp-res .hits a.hit').length, 3, 'a store without live listings gets one row per hunt');
  for (const a of p.$$('#otp-res .hits a.hit')) assert.match(a.href, /rubylane\.com/);
  assert.equal(p.$('#otp-stSel').value, 'rubylane', 'the dropdown is on that screen too');
  assert.equal(saved(p).store, 'rubylane');
  assert.equal(saved(p).oneOn, false, 'the pill stays off');
  assert.deepEqual(p.errors, []);
  await p.close();
  p = loadPage({ fetchImpl: rig().fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS, store: 'rubylane', oneOn: false } } });
  await tick(30);
  assert.equal(p.$('#otp-one').hidden, true);
  tab(p).click();
  await tick(50);
  assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on Ruby Lane', 'remembered after a reload');
  await p.close();
});

test('the search box searches only that store for one thing', async () => {
  const p = loadPage({ fetchImpl: rig().fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS, store: 'rubylane' } } });
  await tick(30);
  tab(p).click();
  await tick(50);
  p.$('#otp-stQ').value = 'roseville vase';
  p.$('#otp-stF').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(50);
  const rows = p.$$('#otp-res a.hit');
  assert.ok(rows.length >= 1);
  for (const a of rows) assert.match(a.href, /rubylane\.com/);
  assert.match(p.$('#otp-res').textContent, /roseville vase/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('one hunt says "Your hunt"; no hunts shows the dropdown, the search box and how to add hunts', async () => {
  let p = loadPage({ fetchImpl: rig().fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex butterprint'] } } });
  await tick(30);
  tab(p).click();
  await tick(400);
  assert.equal(p.$('#otp-res h2').textContent, 'Your hunt on ShopGoodwill');
  await p.close();
  p = loadPage({ fetchImpl: rig().fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  tab(p).click();
  await tick(30);
  assert.equal(p.$('#otp-res').hidden, false);
  assert.ok(p.$('#otp-stSel') && p.$('#otp-stQ'));
  assert.match(p.$('#otp-res').textContent, /Keep this hunt/);
  pick(p, 'etsy');
  await tick(30);
  assert.match(p.$('#otp-res h2').textContent, /Etsy/);
  p.$('#otp-cr').click();
  await tick(20);
  assert.equal(p.$('#otp-stSel'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('backup carries the store pick', async () => {
  const html = (await import('node:fs')).readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.match(html, /store:st\.store\|\|'',\s+\/\* v8\.20 \*\//);
  assert.match(html, /if\(typeof o\.store==='string'&&mb\(o\.store\)\)st\.store=o\.store;/);
});

test('the dropdown marks LIVE stores and lists them first (Matt: "mark the ones that are LIVE")', async () => {
  const p = loadPage({ fetchImpl: rig().fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS } } });
  await tick(30);
  tab(p).click();
  await tick(50);
  const groups = p.$$('#otp-stSel optgroup');
  assert.equal(groups.length, 2);
  assert.match(groups[0].label, /^LIVE/);
  const live = [...groups[0].querySelectorAll('option')].map((o) => o.value);
  const other = [...groups[1].querySelectorAll('option')].map((o) => o.value);
  for (const id of ['shopgoodwill', 'ebay', 'etsy', 'chairish']) assert.ok(live.includes(id), id + ' is live');
  assert.ok(other.includes('rubylane') && !live.includes('rubylane'));
  for (const o of groups[0].querySelectorAll('option')) assert.match(o.textContent, / · LIVE$/);
  for (const o of groups[1].querySelectorAll('option')) assert.doesNotMatch(o.textContent, /LIVE/);
  assert.match(p.$('.st-note').textContent, /LIVE: ShopGoodwill listings show right here/);
  pick(p, 'rubylane');
  await tick(50);
  assert.match(p.$('.st-note').textContent, /opens on its own site/);
  assert.deepEqual(p.errors, []);
  await p.close();
});
