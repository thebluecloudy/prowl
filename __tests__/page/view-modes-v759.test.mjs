// Page v7.59 (Matt, 2026-10-21: "I want two modes. I want the swipe mode or show everything mode on the hunt page").
// A switch over the live finds, in search results and over a favorite hunt pill's listings: Swipe keeps one sideways
// row per marketplace, Show everything lays every find out in a grid and opens the full marketplace list. It is the
// same setting as the Den's (prowl.detail, no new key), so the two stay in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const pressed = (root) => [...root.querySelectorAll('[data-view]')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed'));

test('search results: the switch sits over the live finds, Swipe first; Show everything is saved and unfolds the list', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(40);
  p.$('#otp-q').value = 'Pyrex butterprint';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(60);
  const rc = p.$('#otp-res .rc'), sw = rc.querySelector('.view-sw'), wrap = p.$('.scout-app-wrapper');
  assert.ok(sw, 'the switch');
  assert.equal(sw.getAttribute('role'), 'group');
  assert.ok(sw.compareDocumentPosition(rc.querySelector('.run-live')) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'over the live finds');
  assert.deepEqual(pressed(sw), ['Swipe:true', 'Show everything:false'], 'Swipe is the default');
  assert.ok(wrap.classList.contains('dt-simple'));
  sw.querySelector('[data-view="all"]').click();
  assert.equal(p.win.localStorage.getItem('prowl.detail'), 'all', 'the same key as the Den setting');
  assert.ok(!wrap.classList.contains('dt-simple'), 'rows become the grid, and More places to look unfolds');
  assert.deepEqual(pressed(sw), ['Swipe:false', 'Show everything:true']);
  assert.equal(p.$('#otp-detailBtn').textContent, 'Show everything', 'the Den setting follows');
  sw.querySelector('[data-view="simple"]').click();
  assert.equal(p.win.localStorage.getItem('prowl.detail'), 'simple');
  assert.ok(wrap.classList.contains('dt-simple'));
  assert.equal(p.$('#otp-detailBtn').textContent, 'Swipe');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a hunt pill\'s listings have the switch too, drawn in the saved mode', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: ['catalin bracelet', 'rookwood vase'], lock: [0, 1] }, 'prowl.detail': 'all' } });
  await tick(40);
  p.$$('.sgw-chip').find((c) => /rookwood vase/.test(c.textContent)).click();
  await waitFor(() => p.$('.sgw-body .view-sw'));
  const sw = p.$('.sgw-body .view-sw');
  assert.deepEqual(pressed(sw), ['Swipe:false', 'Show everything:true']);
  assert.ok(!p.$('.scout-app-wrapper').classList.contains('dt-simple'));
  sw.querySelector('[data-view="simple"]').click();
  assert.deepEqual(pressed(sw), ['Swipe:true', 'Show everything:false']);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the CSS: Show everything turns the sideways rows into a grid, two across on a phone; Swipe keeps the rows', () => {
  assert.match(PAGE, /\.scout-app-wrapper #otp-res \.sgw-grid,\.scout-app-wrapper #otp-sgw \.sgw-grid\{display:flex!important;/, 'the v7.31 rows');
  assert.match(PAGE, /\.scout-app-wrapper:not\(\.dt-simple\) #otp-res \.sgw-grid,\.scout-app-wrapper:not\(\.dt-simple\) #otp-sgw \.sgw-grid\{display:grid!important;/);
  assert.match(PAGE, /@media\(max-width:420px\)\{\.scout-app-wrapper:not\(\.dt-simple\) #otp-res \.sgw-grid,\.scout-app-wrapper:not\(\.dt-simple\) #otp-sgw \.sgw-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
});
