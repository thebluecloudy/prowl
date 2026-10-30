// Page v8.18 (Matt, 2026-10-29: "i want to see all hunts in goodwill. i don't like the way it is layed out right now",
// picked Grouped by hunt): All N hunts on ShopGoodwill shows each hunt's live Goodwill listings in Prowl, one block per
// hunt, instead of a list of links. v8.19 (Matt: "can i search all hunts at the same time on shopgoodwill only"): every
// hunt is checked (was the first 30), hunts with listings come first, the quiet ones fold into one line of chips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const HUNTS = ['pyrex butterprint', 'fire king jadeite', 'hull pottery'];
const item = (n, t) => ({ title: t, url: 'https://shopgoodwill.com/item/' + n, price: '$' + n, image: 'https://shopgoodwillimages.azureedge.net/p/' + n + '.jpg', bids: 2, time_left: '3h' });
const ANSWERS = {
  'pyrex butterprint': [item(101, 'Pyrex Butterprint bowl'), item(102, 'Pyrex Butterprint 403')],
  'fire king jadeite': [item(201, 'Fire King Jadeite mug')],
  'hull pottery': [],
};
function rig() {
  const asked = [];
  const fetchImpl = (u) => {
    const s = String(u), m = /workers\.dev\/\?q=([^&]+)/.exec(s);
    if (m) { const q = decodeURIComponent(m[1]); asked.push(q); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: ANSWERS[q] || [] }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { asked, fetchImpl };
}
async function allOnGoodwill(hunts) {
  const r = rig();
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts, one: 'shopgoodwill', oneOn: true } } });
  await tick(30);
  p.$('#otp-q').value = '';
  p.$('#otp-one').click();
  await tick(20);
  p.$('#otp-fall').click();
  await tick(hunts.length * 250 + 300);
  return { p, r };
}

test('hunts with listings get a block each; the quiet ones fold into chips', async () => {
  const { p, r } = await allOnGoodwill(HUNTS);
  assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on ShopGoodwill');
  const blocks = [...p.$$('#otp-res .ol-blk')];
  assert.deepEqual(blocks.map((b) => b.querySelector('h3').textContent), ['pyrex butterprint', 'fire king jadeite']);
  assert.equal(blocks[0].querySelectorAll('.sgw-card').length, 2);
  assert.match(blocks[0].querySelector('.sgw-card').textContent, /Pyrex Butterprint bowl/);
  assert.equal(blocks[1].querySelectorAll('.sgw-card').length, 1);
  assert.match(blocks[0].querySelector('.dg-n').textContent, /2 live/);
  assert.match(blocks[0].querySelector('a.dg-run').getAttribute('href'), /shopgoodwill\.com/);
  const none = p.$('#otp-olNone');
  assert.equal(none.hidden, false);
  assert.match(none.textContent, /Nothing on ShopGoodwill right now/);
  assert.deepEqual([...none.querySelectorAll('a')].map((a) => a.textContent), ['hull pottery']);
  assert.match(none.querySelector('a').getAttribute('href'), /shopgoodwill\.com/);
  assert.match(p.$('#otp-olSum').textContent, /3 hunts · 3 listings on 2 of them/);
  assert.doesNotMatch(p.$('#otp-olSum').textContent, /checking/);
  assert.equal(p.$$('#otp-res .hits').length, 0, 'no list of links');
  assert.deepEqual([...r.asked].sort(), [...HUNTS].sort(), 'one Goodwill lookup per hunt');
  assert.match(p.$('#otp-oa').textContent, /Open all 3 on ShopGoodwill/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('every hunt is looked up, not just the first 30; blocks keep hunt order', async () => {
  const many = Array.from({ length: 66 }, (_, i) => 'hunt number ' + i);
  ANSWERS['hunt number 65'] = [item(901, 'last one')];
  ANSWERS['hunt number 3'] = [item(902, 'early one')];
  const { p, r } = await allOnGoodwill(many);
  assert.equal(r.asked.length, 66);
  assert.deepEqual([...p.$$('#otp-res .ol-blk h3')].map((h) => h.textContent), ['hunt number 3', 'hunt number 65']);
  assert.equal(p.$$('#otp-olNone a').length, 64);
  assert.equal(p.$$('#otp-res .ol-rest').length, 2, 'no "more hunts" links under 100');
  p.$('#otp-cr').click();
  await tick(20);
  assert.equal(p.$$('#otp-res .ol-blk').length, 0);
  assert.deepEqual(p.errors, []);
  await p.close();
});
