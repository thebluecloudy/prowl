// Page v8.40 (Matt: "I'm searching in hunt with the pills and I just want to find the items in one store but it goes to
// the bottom of hunt"; asked, he tapped Store in the dock and wanted just that hunt). With one hunt on screen, Store runs
// just that hunt on the store, says so, and keeps it when the store changes; All N hunts goes back to every hunt. From
// anywhere else Store still checks every hunt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const HUNTS = ['pyrex butterprint', 'fire king jadeite', 'hull pottery'];
function rig() {
  const asked = [];
  const fetchImpl = (u) => {
    const s = String(u), m = /workers\.dev\/\?q=([^&]+)/.exec(s);
    if (m) { const q = decodeURIComponent(m[1]); asked.push(q); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ title: 'A ' + q, url: 'https://shopgoodwill.com/item/' + q.length, price: '$5' }] }), text: () => Promise.resolve('') }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { asked, fetchImpl };
}
const tab = (p) => p.$('#otp-dock .db[data-m="store"]');
async function huntOne(p, t) {
  p.$('#otp-q').value = t;
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(60);
}

test('Store from one hunt on screen: just that hunt on the store, named, with All 3 hunts', async () => {
  const r = rig();
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS } } });
  try {
    await tick(30);
    await huntOne(p, 'fire king jadeite');
    r.asked.length = 0;
    tab(p).click();
    await tick(600);
    assert.equal(p.$('#otp-res h2').textContent, 'fire king jadeite on ShopGoodwill');
    assert.ok(r.asked.every((q) => q === 'fire king jadeite'), 'no other hunt is checked: ' + r.asked.join(', '));
    assert.deepEqual(p.$$('#otp-res .ol-blk h3').map((h) => h.textContent), ['fire king jadeite'], 'only that hunt on screen');
    assert.equal(p.$('#otp-res .st-one b').textContent, 'fire king jadeite');
    assert.equal(p.$('#otp-stAll').textContent, 'All 3 hunts');
    /* another store keeps the same hunt */
    const sel = p.$('#otp-stSel'); sel.value = 'ebay'; sel.dispatchEvent(new p.win.Event('change', { bubbles: true }));
    await tick(300);
    assert.equal(p.$('#otp-res h2').textContent, 'fire king jadeite on eBay');
    /* and All 3 hunts goes back to every hunt */
    p.$('#otp-stAll').click();
    await tick(HUNTS.length * 250 + 400);
    assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on eBay');
    assert.equal(p.$('#otp-res .st-one'), null, 'no "Just" line');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('Store from the home screen still checks every hunt, and the remembered hunt is not saved', async () => {
  const r = rig();
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS } } });
  try {
    await tick(30);
    tab(p).click();
    await tick(HUNTS.length * 250 + 400);
    assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on ShopGoodwill');
    assert.equal(p.$('#otp-res .st-one'), null);
    assert.ok(!('storeOne' in JSON.parse(p.win.localStorage.getItem('prowl.v36'))), 'nothing new kept on the phone');
  } finally { await p.close(); }
});
