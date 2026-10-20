// Page v7.31 (Matt's step 2, 2026-10-20: "yes, do them all"): a first visit lands on the search box, three steps and
// Try one, with no pop-up and no sample hunts. After a search, Keep this hunt is the one next step. Results are one
// sideways row per marketplace, each card has one button (the heart), and the extras fold behind More places to look.
// The Alerts box waits until a hunt is kept and stays off searches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const wrap = (p) => p.$('.scout-app-wrapper');
const hunt = () => ({ bubbles: true, cancelable: true });

test('a first visit: no pop-up, no sample hunts, three steps and Try one; the rest waits', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: {} });
  await tick(700);
  assert.equal(p.$('#otp-ms').classList.contains('on'), false, 'How Prowl works does not open by itself');
  assert.equal(f.calls.filter((u) => /[?&]q=/.test(u)).length, 0, 'nothing is searched for them');
  const start = p.$('#otp-start');
  assert.equal(start.hidden, false);
  assert.deepEqual(p.$$('#otp-start .start-steps li').map((l) => l.textContent.trim().replace(/\s+/g, ' ')),
    ['Search every vintage marketplace at once.', 'Keep a hunt you like.', 'Prowl watches and shows what is new in Daily.']);
  const chips = p.$$('#otp-startTry [data-bolo]').map((b) => b.textContent);
  assert.equal(chips.length, 8);
  assert.equal(chips[0], 'Roseville jardiniere');
  assert.ok(wrap(p).classList.contains('is-new'), 'the empty hunts panel, the guide card and the Alerts box wait');
  assert.match(PAGE, /\.scout-app-wrapper\.is-new #otp-sgw,\.scout-app-wrapper\.is-new #otp-guide,\.scout-app-wrapper\.is-new #otp-alerts,/);
  assert.equal(p.$('#otp-verEb').hidden, true, 'no version line for customers');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the owner still sees the version line', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.owner': 'owner-key-0123456789' } });
  await tick(30);
  assert.match(p.$('#otp-verEb').textContent, /^v\d+\.\d+ · live$/);
  await p.close();
});

test('Try one runs that hunt; Keep this hunt is the main button, then the email offer; the first visit is over', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: {} });
  await tick(60);
  p.$('#otp-startTry [data-bolo="Pyrex Butterprint"]').click();
  await waitFor(() => /Pyrex Butterprint/.test(p.$('#otp-res').textContent), { timeout: 6000 });
  assert.equal(p.$('#otp-start').hidden, true, 'the steps step aside for the results');
  const keep = p.$('#otp-keep');
  assert.ok(keep.classList.contains('p'), 'Keep is the primary button');
  assert.equal(keep.textContent, 'Keep this hunt');
  assert.match(p.$('#otp-res .keep-why').textContent, /Prowl watches it for you: new ones show in Daily/);
  keep.click();
  await tick(30);
  assert.equal(p.$('#otp-keep').textContent, '★ Kept');
  assert.match(p.$('#otp-res .keep-why').textContent, /Kept\. Prowl watches it and new ones show in Daily\./);
  assert.ok(p.$('#otp-keepMail'), 'now the email offer');
  p.$('#otp-keepMail').click();
  await tick(60);
  assert.equal(p.$('#otp-denSettings').hidden, false, 'it opens the alerts sign-up');
  assert.equal(wrap(p).classList.contains('is-new'), false, 'a hunt is kept: the home panels come back');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('signed in to alerts: no email offer after Keep', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' } });
  await tick(30);
  p.$('#otp-q').value = 'Blenko glass';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  await tick(30);
  p.$('#otp-keep').click();
  await tick(30);
  assert.equal(p.$('#otp-keepMail'), null);
  await p.close();
});

test('results: one sideways row per marketplace, cards with only the heart, extras behind More places to look', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: ['Fire-King jadeite'] } } });
  await tick(30);
  p.$('#otp-q').value = 'Fire-King jadeite';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  await waitFor(() => p.$$('#otp-res .sgw-cell').length >= 6, { timeout: 8000 });
  assert.match(PAGE, /\.scout-app-wrapper #otp-res \.sgw-grid,\.scout-app-wrapper #otp-sgw \.sgw-grid\{display:flex!important;[^}]*overflow-x:auto;/, 'rows scroll sideways');
  for (const c of p.$$('#otp-res .sgw-cell')) assert.deepEqual([...c.querySelector('.sgw-cbar').children].map((b) => b.className.split(' ')[0]), ['sgw-lk']);
  assert.ok(wrap(p).classList.contains('dt-simple'));
  const more = p.$('#otp-dtMore');
  assert.match(more.textContent, /^More places to look/);
  assert.match(PAGE, /\.scout-app-wrapper\.dt-simple \.rc:not\(\.dt-open\) \.rf,/, 'Facebook, Instagram and sold prices fold too');
  more.click();
  assert.ok(p.$('#otp-res .rc').classList.contains('dt-open'));
  assert.ok(wrap(p).classList.contains('is-run'), 'the home Alerts box stays off a search');
  assert.doesNotMatch(p.$('#otp-res').textContent, /The rows below/, 'no note points at rows that are folded away');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the popup has Save this find, and Price check starts open', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' } });
  await tick(30);
  p.$('#otp-q').value = 'Hull pottery';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  const c = await waitFor(() => p.$$('#otp-res .sgw-cell').find((x) => /vinted/.test(x.getAttribute('data-u'))), { timeout: 8000 });
  c.querySelector('.sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const sv = await waitFor(() => p.$('#otp-sheetB .pp-sv .sgw-sv'));
  assert.match(p.$('#otp-sheetB .pp-go').textContent, /View on Vinted/, 'a light popup for a site the popup cannot read');
  assert.ok(p.$('#otp-sheetB details[data-sec="price"]').open);
  sv.click();
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.finds')).some((f) => f.url === c.getAttribute('data-u')));
  assert.ok(p.$('#otp-sheetB .pp-sv .sgw-sv').classList.contains('on'));
  assert.deepEqual(p.errors, []);
  await p.close();
});
