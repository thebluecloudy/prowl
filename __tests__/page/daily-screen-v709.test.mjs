// Page v7.09: Daily announces itself (Matt, 2026-10-17: "it reads as I tapped DAILY and nothing changed"). A "Your
// daily prowl" header with the hunt count, What's new since the last day's Daily at the top, then one block per hunt.
// Live listings only: no marketplace rows and no Open all (Matt: "no one should open 500 tabs").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const HUNTS = { 'prowl.v36': { seen: true, hunts: ['fiesta', 'pyrex'], lock: [0, 1], h21: 1, h36: 1, h42: 1, h68: 1 } };
function dayStr(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

async function openDaily(storage, perSource, opts) {
  const base = liveFetch({ perSource });
  const down = opts && opts.down;
  const f = { impl: (u) => (down && new URL(String(u), 'https://x.test/').pathname.replace(/\//g, '') === down
    ? Promise.resolve({ ok: false, status: 502, json: () => Promise.resolve({}), text: () => Promise.resolve('') })
    : base.impl(u)) };
  const p = loadPage({ fetchImpl: f.impl, storage });
  await tick(50);
  p.$('#otp-dock .db[data-m="daily"]').click();
  await tick(20);
  /* every queued fetch has landed: no marketplace in any hunt block is still blank or looking */
  await waitFor(() => {
    const subs = [...p.doc.querySelectorAll('.dg-blk .sgw-sub')];
    return subs.length && subs.every((s) => s.querySelector('.sgw-upd') || /Could not reach|busy|Nothing live/.test((s.nextElementSibling || {}).textContent || ''));
  }, { timeout: 12000 });
  await tick(200);
  return p;
}

test('the first Daily: its own header and hunt count, one block per hunt, and no rows or Open all', async () => {
  const p = await openDaily(Object.assign({}, HUNTS), 2);
  assert.equal(p.$('.dg-rh h2').textContent, 'Your daily prowl');
  assert.match(p.$('#otp-dgSum').textContent, /^2 hunts · first day on this device$/);
  assert.match(p.$('.dg-rh .dg-hunts').textContent, /fiesta · pyrex/);
  assert.equal(p.doc.querySelectorAll('.dg-blk').length, 2, 'grouped per hunt');
  assert.match(p.$('#otp-dgNew').textContent, /first daily prowl on this device/);
  assert.equal(p.$('#otp-res .hits'), null, 'no marketplace rows');
  assert.equal(p.$('#otp-oa'), null, 'no Open all');
  assert.equal(p.$('#otp-dtMore'), null);
  assert.doesNotMatch(p.$('#otp-res').textContent, /below still search/, 'no notes pointing at rows that are gone');
  const kept = JSON.parse(p.win.localStorage.getItem('prowl.dailySeen'));
  assert.equal(kept.d, dayStr(new Date()));
  assert.ok(kept.cur.fiesta.length > 0 && kept.cur.pyrex.length > 0, 'what Daily saw today is kept');
  assert.ok(kept.cur.fiesta.every((h) => /^[0-9a-z]{1,8}$/.test(h)), 'as short hashes, not links');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the next day: what is new since yesterday is at the top, per hunt, and counted in the header', async () => {
  const p1 = await openDaily(Object.assign({}, HUNTS), 2);
  const kept = JSON.parse(p1.win.localStorage.getItem('prowl.dailySeen'));
  await p1.close();
  kept.d = dayStr(new Date(Date.now() - 864e5));   /* that run was yesterday */
  const p = await openDaily(Object.assign({}, HUNTS, { 'prowl.dailySeen': kept }), 3);
  const groups = [...p.doc.querySelectorAll('#otp-dgNew .dg-nh')];
  assert.equal(groups.length, 2, 'one group per hunt');
  assert.match(p.$('#otp-dgNew h3').textContent, /What’s new since yesterday/);
  let total = 0;
  for (const g of groups) {
    const n = +/(\d+) new/.exec(g.querySelector('h4 span').textContent)[1];
    total += n;
    const cells = [...g.querySelectorAll('.sgw-cell[data-u]')];
    assert.ok(cells.length > 0 && cells.length <= 6, 'at most 6 cards a hunt');
    assert.ok(cells.every((c) => /-2$/.test(c.getAttribute('data-u'))), 'only listings yesterday did not have');
  }
  assert.match(p.$('#otp-dgSum').textContent, new RegExp('^2 hunts · ' + total + ' new since yesterday$'));
  assert.match(p.$('.dg-blk .dg-n').textContent, /\d+ new · \d+ live now/);
  const after = JSON.parse(p.win.localStorage.getItem('prowl.dailySeen'));
  assert.equal(after.pd, kept.d, 'yesterday is what today compares with');
  assert.deepEqual(after.prev.fiesta, kept.cur.fiesta);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('nothing new since yesterday says so; a broken saved list starts over', async () => {
  const p1 = await openDaily(Object.assign({}, HUNTS), 2);
  const kept = JSON.parse(p1.win.localStorage.getItem('prowl.dailySeen'));
  await p1.close();
  kept.d = dayStr(new Date(Date.now() - 864e5));
  const p = await openDaily(Object.assign({}, HUNTS, { 'prowl.dailySeen': kept }), 2);
  assert.match(p.$('#otp-dgSum').textContent, /nothing new since yesterday/);
  assert.match(p.$('#otp-dgNew').textContent, /Nothing new since yesterday\. Everything live for each hunt is below\./);
  await p.close();
  const b = await openDaily(Object.assign({}, HUNTS, { 'prowl.dailySeen': [1, 2] }), 1);
  assert.match(b.$('#otp-dgSum').textContent, /first day on this device/);
  assert.deepEqual(b.errors, []);
  await b.close();
});

test('a marketplace that was down yesterday does not make all of its listings new today', async () => {
  const p1 = await openDaily(Object.assign({}, HUNTS), 2, { down: 'ebay' });
  const kept = JSON.parse(p1.win.localStorage.getItem('prowl.dailySeen'));
  await p1.close();
  assert.ok(!kept.cs.fiesta.includes('ebay'), 'eBay did not answer');
  kept.d = dayStr(new Date(Date.now() - 864e5));
  const p = await openDaily(Object.assign({}, HUNTS, { 'prowl.dailySeen': kept }), 2);
  assert.match(p.$('#otp-dgSum').textContent, /nothing new since yesterday/);
  assert.equal(p.doc.querySelectorAll('#otp-dgNew .sgw-cell').length, 0);
  await p.close();
});

test('Close leaves Daily, and Run the full hunt still opens one hunt', async () => {
  const p = await openDaily(Object.assign({}, HUNTS), 1);
  p.$('.dg-blk [data-dh="0"]').click();
  await tick(30);
  assert.equal(p.$('.dg-rh'), null);
  assert.match(p.$('#otp-res .rh h2').textContent, /fiesta/);
  p.$('#otp-cr').click();
  await tick(20);
  assert.equal(p.$('#otp-res').hidden, true);
  await p.close();
});
