// v8.18: sites with live listings (ShopGoodwill, eBay, Chairish...) show listings instead; see one-site-live-v818. Ruby Lane keeps these rows.
// Page v8.17 (Matt, 2026-10-29: "i want to look at all hunts in one store"): the one-site screen gets an
// "All N hunts on <site>" button. It lists one row per hunt on that one marketplace, unfolded, with Open all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const HUNTS = ['pyrex butterprint', 'fire king jadeite', 'hull pottery'];
async function focus(hunts) {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts, one: 'rubylane', oneOn: true } } });
  await tick(30);
  p.$('#otp-q').value = '';
  p.$('#otp-one').click();
  await tick(20);
  return p;
}

test('the one-site screen offers every hunt on that site', async () => {
  const p = await focus(HUNTS);
  const b = p.$('#otp-fall');
  assert.ok(b, 'the All hunts button is there');
  assert.equal(b.textContent, 'All 3 hunts on Ruby Lane');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('tapping it lists one Ruby Lane row per hunt, open from the start, with Open all', async () => {
  const p = await focus(HUNTS);
  p.$('#otp-fall').click();
  await tick(20);
  const rc = p.$('#otp-res .rc');
  assert.ok(rc.classList.contains('dt-open'), 'rows are not folded behind More places to look');
  assert.equal(p.$('#otp-res h2').textContent, 'All 3 hunts on Ruby Lane');
  const rows = [...p.$$('#otp-res .hits a.hit')];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((a) => a.querySelector('.hit-title').textContent).sort(), [...HUNTS].sort());
  for (const a of rows) assert.match(a.getAttribute('href'), /rubylane\.com/);
  assert.equal(p.$$('#otp-res .hits li.grp').length, 0, 'one store, no group headers');
  assert.match(p.$('#otp-oa').textContent, /Open all 3/);
  assert.match(p.$('#otp-res .rs').textContent, /3 searches ready, one per hunt/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('one hunt only: no All button (tapping the hunt already does it)', async () => {
  const p = await focus(['pyrex butterprint']);
  assert.equal(p.$('#otp-fall'), null);
  await p.close();
});

test('version is v8.17 or later', () => {
  const m = /var PROWL_VERSION='v(\d+)\.(\d+)';/.exec(readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8'));
  assert.ok(Number(m[1]) * 100 + Number(m[2]) >= 817);
});
