// Page v7.03: fewer buttons and words on the home page and in the Den (Matt's 1-7, 2026-10-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const setup = (storage = {}) => loadPage({ fetchImpl: liveFetch().impl, storage: { owlTwigSgwTerms: ['panther', 'pyrex'], 'prowl.v36': { seen: true, hunts: [] }, ...storage } });
const cls = (p) => p.$('.scout-app-wrapper').className;

test('one search button: Search All is hidden, Hunt and a chip remain (v7.30: Just ShopGoodwill, Near me is a tab)', async () => {
  const p = setup();
  await tick(60);
  assert.equal(p.$('#otp-sa').hidden, true);
  assert.ok(p.$('#otp-one').classList.contains('near-chip'));
  await p.close();
});

test('the header has the account button, the theme switch (v8.28) and a menu; the menu holds App, text size and help', async () => {
  const p = setup();
  await tick(60);
  const menu = p.$('#otp-barMenu');
  assert.equal(menu.hidden, true);
  for (const id of ['otp-sizeTop', 'otp-how', 'otp-appHdr']) assert.ok(menu.contains(p.$('#' + id)), id + ' is in the menu');
  assert.ok(!menu.contains(p.$('#otp-themeBtn')), 'v8.28: the theme switch is on the bar, not in the menu');
  p.$('#otp-menuTop').click();
  assert.equal(menu.hidden, false);
  assert.equal(p.$('#otp-menuTop').getAttribute('aria-expanded'), 'true');
  p.doc.body.click();
  assert.equal(menu.hidden, true, 'a tap outside closes it');
  await p.close();
});

test('the hunts panel drops the instruction line and the second Aa', async () => {
  const p = setup();
  await tick(80);
  const t = p.$('#otp-sgw').textContent;
  assert.doesNotMatch(t, /Tap × to move a hunt back/);
  assert.equal(p.$('#otp-sgw [data-sgw="size"]'), null);
  await p.close();
});

test('one promo: alerts for someone not signed up, otherwise the app or the guide', async () => {
  const a = setup();
  await tick(60);
  assert.match(cls(a), /\bpm-alerts\b/);
  await a.close();
  const b = setup({ 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' });
  await tick(60);
  assert.doesNotMatch(cls(b), /\bpm-alerts\b/);
  assert.match(cls(b), /\bpm-(app|guide)\b/);
  await b.close();
});

test('someone with saved guides keeps the guide box', async () => {
  const p = setup({ 'prowl.guides': [{ q: 'fire king', at: 1 }] });
  await tick(60);
  assert.equal(p.$('#otp-guide').classList.contains('gd-promo'), false);
  await p.close();
});

test('Den About opens short; the long page is folded; the feedback line moved there', async () => {
  const p = setup();
  await tick(60);
  const ab = p.$('#otp-denAbout');
  assert.ok(ab.querySelector('.ab-lead'));
  assert.ok(ab.querySelector('details.ab-more .scout-seo'), 'the long About is inside a closed details');
  assert.equal(ab.querySelector('details.ab-more').open, false);
  assert.ok(ab.querySelector('#otp-fbk'), 'feedback line is in About');
  assert.equal(p.$$('#otp-fbk').length, 1);
  await p.close();
});

test('Den Settings keeps the everyday rows up top and folds the rest under More settings', async () => {
  const p = setup();
  await tick(60);
  const more = p.$('#otp-denSettings details.set-more');
  assert.ok(more);
  for (const id of ['otp-mktBtn', 'otp-expBtn', 'otp-impBtn', 'otp-clearBtn']) assert.ok(more.contains(p.$('#' + id)), id + ' is under More settings');
  for (const id of ['otp-themeBtn2', 'otp-sizeBtn']) assert.equal(more.contains(p.$('#' + id)), false, id + ' stays up top');
  await p.close();
});
