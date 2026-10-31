// Page v8.28 (Matt, 2026-10-31: "move the theme switcher so that it is always visible"): the theme switch leaves the
// ☰ menu and sits on the top bar between the account dot and the menu, so it is visible on every screen without
// opening anything. It still cycles the five themes and the Den's Appearance button follows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('v8.28: the theme switch is on the bar, visible without opening the menu, between the account dot and ☰', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const btn = p.$('#otp-themeBtn'), menu = p.$('#otp-barMenu');
  assert.ok(btn, 'there is one');
  assert.equal(p.doc.querySelectorAll('#otp-themeBtn').length, 1);
  assert.ok(!menu.contains(btn), 'not inside the menu');
  assert.equal(menu.hidden, true, 'the menu is closed and the switch is still there');
  assert.equal(btn.parentNode.className, 'bar-actions');
  assert.equal(btn.previousElementSibling.id, 'otp-acct');
  assert.equal(btn.nextElementSibling.id, 'otp-menuTop');
  assert.equal(btn.getAttribute('role'), null, 'no longer a menu item');
  assert.ok(btn.getAttribute('aria-label'), 'it has a name');
  const h = p.doc.documentElement, before = h.getAttribute('data-theme');
  btn.click();
  assert.notEqual(h.getAttribute('data-theme') + (h.getAttribute('data-dark') || '') + (h.getAttribute('data-hud') || ''), before, 'a tap changes the theme');
  assert.equal(p.$('#otp-themeBtn2').textContent.length > 0, true, 'the Den button follows');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.28: the switch is styled as a round icon on the bar, scoped', () => {
  assert.ok(PAGE.includes('.scout-app-wrapper .bar .bar-th{'));
});
