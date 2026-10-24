// Page v7.89 (Matt, on v7.88: "It is trying to copy the text"). His phone selects a held pill's words despite
// user-select:none, so the long press became a copy. A Reorder button beside "All your hunts →" moves pills with taps
// alone: tap Reorder, tap the hunt to move, tap where it goes, Done. While reordering every pill shows, the x's hide and
// a tap never opens a hunt. The long press stays, with selectstart refused on pills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const DEN = (hunts) => ({ 'prowl.v36': { seen: true, hunts, lock: hunts.map((_, i) => i) } });
const pills = (p) => p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]');
const names = (p) => pills(p).map((c) => c.textContent.replace(/^◉/, '').replace(/×$/, '').replace(/\d+\+? new/, ''));
const bar = (p) => { const b = p.$('#otp-sgw .sgw-pickbar'); return b ? b.textContent : null; };
const ro = (p) => p.$('#otp-sgw .sgw-denln [data-sgw="reorder"]');
async function boot(hunts) { const p = loadPage({ storage: DEN(hunts || ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter']), fetchImpl: () => J({ items: [] }) }); await tick(60); return p; }

test('Reorder: tap the hunt, tap where it goes, Done; it is kept', async () => {
  const p = await boot();
  const cur = p.$('#otp-sgw .sgw-chip.on').textContent;
  assert.equal(ro(p).textContent, 'Reorder');
  ro(p).click(); await tick(20);
  assert.equal(ro(p).textContent, 'Done');
  assert.equal(ro(p).getAttribute('aria-pressed'), 'true');
  assert.equal(bar(p), 'Tap the hunt you want to move. Done');
  assert.ok(p.$('#otp-sgw').classList.contains('sgw-reordering'));
  pills(p)[3].click(); await tick(20);
  assert.equal(bar(p), 'Tap where mccoy planter goes. Not this one');
  assert.ok(pills(p)[3].classList.contains('sgw-pickd'));
  assert.equal(p.$('#otp-sgw .sgw-chip.on').textContent, cur, 'a tap while reordering does not open a hunt');
  pills(p)[0].click(); await tick(20);
  assert.deepEqual(names(p), ['mccoy planter', 'rookwood vase', 'catalin bracelet', 'pyrex butterprint']);
  assert.equal(bar(p), 'Tap the hunt you want to move. Done', 'still reordering, for the next one');
  pills(p)[1].click(); await tick(20);
  pills(p)[3].click(); await tick(20);
  assert.deepEqual(names(p), ['mccoy planter', 'catalin bracelet', 'rookwood vase', 'pyrex butterprint']);
  p.$('#otp-sgw .sgw-pickbar [data-sgw="reorder"]').click(); await tick(20);
  assert.equal(bar(p), null);
  assert.equal(ro(p).textContent, 'Reorder');
  assert.ok(!p.$('#otp-sgw').classList.contains('sgw-reordering'));
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts, ['mccoy planter', 'catalin bracelet', 'rookwood vase', 'pyrex butterprint']);
  pills(p)[2].click(); await tick(40);
  assert.ok(pills(p)[2].classList.contains('on'), 'after Done a tap picks a hunt again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Not this one puts it down; Escape leaves reordering', async () => {
  const p = await boot();
  ro(p).click(); await tick(20);
  pills(p)[1].click(); await tick(20);
  p.$('#otp-sgw .sgw-pickbar [data-sgw="pickx"]').click(); await tick(20);
  assert.equal(bar(p), 'Tap the hunt you want to move. Done');
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick(20);
  assert.equal(bar(p), null);
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter']);
  await p.close();
});

test('every pill shows while reordering, even past "+ more"', async () => {
  const many = Array.from({ length: 20 }, (_, i) => 'hunt number ' + (i + 1));
  const p = await boot(many);
  const shut = pills(p).length;
  assert.ok(shut < 20 && p.$('#otp-sgw .sgw-more'), 'some behind + more');
  ro(p).click(); await tick(20);
  assert.equal(pills(p).length, 20);
  ro(p).click(); await tick(20);
  assert.equal(pills(p).length, shut);
  await p.close();
});

test('one hunt: nothing to reorder, and it says so', async () => {
  const p = await boot(['rookwood vase']);
  ro(p).click(); await tick(20);
  assert.equal(bar(p), null);
  assert.match(p.$('#otp-toast').textContent, /Add another hunt first/);
  await p.close();
});

test('a phone that starts selecting a pill\'s words is told no', async () => {
  const p = await boot();
  const e = new p.win.Event('selectstart', { bubbles: true, cancelable: true });
  pills(p)[0].firstChild.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  const f = new p.win.Event('selectstart', { bubbles: true, cancelable: true });
  p.$('#otp-sgw .sgw-head').dispatchEvent(f);
  assert.equal(f.defaultPrevented, false, 'the rest of the card still selects');
  assert.ok(PAGE.includes('.scout-app-wrapper .sgw-chip[data-sgw="pick"] *{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}'));
  await p.close();
});
