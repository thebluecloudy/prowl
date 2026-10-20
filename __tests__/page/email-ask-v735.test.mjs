// Page v7.35 (Matt, 2026-10-20: "how do i get them to trust me"; "3 hunts is good, pro gets unlimited"; "we can just say
// owl and twig vintage"). The new plans in the copy, and the email ask: who it is from and what never happens to the
// address, a preview of the email from the visitor's own hunt, a card on the second day Daily is opened, and a line in
// the Den that hunts kept only on this device can be kept safe with an email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'a@b.co' };
async function settings(p) {
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  p.$('#otp-denT3').click();
  await tick(30);
  return p.$('#otp-denSettings');
}

test('the sign-in says who it is from and what never happens to the address; the plan table is the new plan', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const box = await settings(p);
  assert.match(box.textContent, /free for 3 hunts, or up to 100 with Prowl Pro/);
  const tr = box.querySelector('.mail-trust');
  assert.ok(tr, 'the promise line');
  assert.equal(tr.textContent, 'From Owl & Twig Vintage. No password. Your email is never sold or shared. One tap to unsubscribe.');
  const rows = Object.fromEntries([...box.querySelectorAll('.mail-tbl tbody tr')].map((r) => [r.cells[0].textContent, [r.cells[1].textContent, r.cells[2].textContent]]));
  assert.deepEqual(rows['Hunts in the alerts email'], ['3 hunts', 'Up to 100, or your whole Den']);
  assert.deepEqual(rows['How often'], ['You pick', 'You pick, at your time']);
  assert.deepEqual(rows['Photo checks'], ['1 a day', 'Unlimited']);
  assert.equal(box.querySelector('.mail-pv'), null, 'no hunts, no preview');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the preview shows the email from the visitor\'s own hunt, up to 3 listings it already has', async () => {
  const f = liveFetch({ perSource: 3 });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['Blenko glass'], lock: [0] } } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  /* the locked hunt's own start-up searches can still be landing on a slow machine: count from when they have stopped */
  for (let last = -1, i = 0; f.calls.length !== last && i < 40; i++) { last = f.calls.length; await tick(400); }
  const before = f.calls.length;
  const box = await settings(p);
  const pv = box.querySelector('.mail-pv');
  assert.ok(pv, 'the preview');
  assert.match(pv.querySelector('.mail-pv-h').textContent, /Prowl Alerts · new for Blenko glass/);
  const figs = [...pv.querySelectorAll('figure')];
  assert.equal(figs.length, 3);
  for (const fg of figs) { assert.match(fg.querySelector('img').getAttribute('src'), /^https:\/\/img\.example\.com\//); assert.match(fg.querySelector('figcaption').textContent, /^\$\d/); }
  assert.match(pv.textContent, /only listings you have not seen/);
  assert.equal(f.calls.length, before, 'nothing fetched for it');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Daily: a line on the first day, a card with the promise from the second day it is opened', async () => {
  const run = async (storage) => {
    const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: ['fiesta'], lock: [0] }, ...storage } });
    await tick(40);
    p.$('#otp-dock .db[data-m="daily"]').click();
    await waitFor(() => p.$('.dg-rc .dg-tip'));
    return p;
  };
  const p1 = await run({});
  assert.ok(p1.$('.dg-rc .dg-mailq'), 'the first day: one line');
  assert.equal(p1.$('.dg-rc .dg-ask'), null);
  assert.equal(JSON.parse(p1.win.localStorage.getItem('prowl.dailyDays')).n, 1);
  await p1.close();
  const p2 = await run({ 'prowl.dailyDays': { d: '2000-1-1', n: 1 } });
  const ask = p2.$('.dg-rc .dg-ask');
  assert.ok(ask, 'the second day: the card');
  assert.match(ask.querySelector('h3').textContent, /Get your daily prowl by email/);
  assert.match(ask.textContent, /New finds for your first 3 hunts, as often as you like/);
  assert.ok(ask.querySelector('.mail-trust'));
  assert.equal(JSON.parse(p2.win.localStorage.getItem('prowl.dailyDays')).n, 2);
  ask.querySelector('#otp-dgMail').click();
  await tick(60);
  assert.equal(p2.$('#otp-denSettings').hidden, false, 'it opens the sign-up');
  assert.deepEqual(p2.errors, []);
  await p2.close();
  const p3 = await run({ ...SIGNED, 'prowl.dailyDays': { d: '2000-1-1', n: 4 } });
  assert.equal(p3.$('.dg-rc .dg-ask'), null, 'signed in: no ask');
  assert.equal(p3.$('.dg-rc .dg-mailq'), null);
  await p3.close();
});

test('the Den says hunts on this device can be kept safe with an email; signed in, it does not', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['rookwood vase'] } } });
  await tick(30);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  const safe = p.$('#otp-denSafe');
  assert.equal(safe.hidden, false);
  assert.match(safe.textContent, /Your hunts live only on this device\. Keep them safe with your email and they follow you to every phone and computer\./);
  p.$('#otp-denSafeGo').click();
  await tick(30);
  assert.equal(p.$('#otp-denSettings').hidden, false);
  await p.close();
  const s = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['rookwood vase'] }, ...SIGNED } });
  await tick(30);
  s.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  assert.equal(s.$('#otp-denSafe').hidden, true);
  await s.close();
  const e = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  e.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  assert.equal(e.$('#otp-denSafe').hidden, true, 'no hunts, nothing to keep safe');
  await e.close();
});

test('no plan copy still quotes the old plan', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /1 hunt, Mondays|1 hunt on Mondays|1 hunt, every Monday|1 hunt every Monday|25 hunts every day|up to 25 hunts|\(up to 25\)/);
  assert.match(page, /<span>Free: 3 hunts<\/span><span>Pro: up to 100 hunts<\/span>/);
});
