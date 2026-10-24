// Page v7.88 (Matt, on v7.87: "Some worked some didn't. It still blinks and vibrates"). Some phones take a touch back
// after a long press (their own menu), so the hold buzzed but the drag never came. Now a held pill that is let go, or
// taken back, without a landing place stays picked up: "Tap where … goes", and the next tap on a hunt puts it there
// (its right half: after it). Cancel, Escape or a tap on the same pill puts it down. The phone's own tap flash is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const DEN = (o) => Object.assign({ 'prowl.v36': { seen: true, hunts: ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter'], lock: [0, 1, 2, 3] } }, o || {});
const pills = (p) => p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]');
const names = (p) => pills(p).map((c) => c.textContent.replace(/^◉/, '').replace(/×$/, '').replace(/\d+\+? new/, ''));
function layout(p) { pills(p).forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 110, right: i * 110 + 100, top: 0, bottom: 44, width: 100, height: 44 }); }); }
function touch(p, el, type, x, y) {
  const e = new p.win.Event(type, { bubbles: true, cancelable: true });
  const t = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : t });
  Object.defineProperty(e, 'changedTouches', { value: t });
  el.dispatchEvent(e);
}
const tap = (p, el, x) => el.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: 20 }));
async function boot(storage) { const p = loadPage({ storage: storage || DEN(), fetchImpl: () => J({ items: [] }) }); await tick(60); layout(p); return p; }
async function pickUp(p, i, how) {
  const c = pills(p)[i];
  touch(p, c, 'touchstart', i * 110 + 50, 20);
  await tick(500);
  touch(p, c, how || 'touchcancel', i * 110 + 50, 20);
  await tick(20);
}

test('the phone takes the touch back after the hold: the pill stays picked up, and a tap puts it where it goes', async () => {
  const p = await boot();
  await pickUp(p, 3);
  const bar = p.$('#otp-sgw .sgw-pickbar');
  assert.ok(bar, 'the line');
  assert.equal(bar.getAttribute('role'), 'status');
  assert.equal(bar.textContent, 'Moving mccoy planter: tap where it goes.Cancel');   /* v7.89 wording */
  assert.ok(p.$('#otp-sgw .sgw-chips').firstElementChild === bar, 'above the pills');
  assert.ok(pills(p)[3].classList.contains('sgw-pickd'));
  layout(p);
  tap(p, pills(p)[0], 20);
  await tick(20);
  assert.deepEqual(names(p), ['mccoy planter', 'rookwood vase', 'catalin bracelet', 'pyrex butterprint']);
  assert.equal(p.$('#otp-sgw .sgw-pickbar'), null);
  assert.equal(p.$('.sgw-pickd'), null);
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts, ['mccoy planter', 'rookwood vase', 'catalin bracelet', 'pyrex butterprint']);
  assert.equal(p.$('#otp-toast').textContent, 'Moved mccoy planter to spot 1 of 4. Saved.');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('held and let go without moving: picked up too; the lift\'s own tap does not put it down; the right half of a hunt is after it', async () => {
  const p = await boot();
  await pickUp(p, 0, 'touchend');
  tap(p, pills(p)[0], 50);   /* the click a lifted finger makes */
  await tick(20);
  assert.ok(p.$('#otp-sgw .sgw-pickbar'), 'still picked up');
  layout(p);
  tap(p, pills(p)[2], 2 * 110 + 90);
  await tick(20);
  assert.deepEqual(names(p), ['catalin bracelet', 'pyrex butterprint', 'rookwood vase', 'mccoy planter']);
  await p.close();
});

test('Cancel, Escape, or a tap on the same pill puts it down where it was', async () => {
  const p = await boot();
  const before = names(p);
  await pickUp(p, 2);
  p.$('#otp-sgw .sgw-pickbar [data-sgw="pickx"]').click(); await tick(20);
  assert.equal(p.$('#otp-sgw .sgw-pickbar'), null);
  await pickUp(p, 2);
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(20);
  assert.equal(p.$('#otp-sgw .sgw-pickbar'), null);
  await pickUp(p, 2);
  await tick(700);
  tap(p, pills(p)[2], 270); await tick(20);
  assert.equal(p.$('#otp-sgw .sgw-pickbar'), null);
  assert.deepEqual(names(p), before);
  await p.close();
});

test('a picked-up locked hunt cannot go among the unlocked ones: it says why', async () => {
  const p = await boot(DEN({ 'prowl.v36': { seen: true, hunts: ['rookwood vase', 'catalin bracelet'], lock: [0, 1] }, owlTwigSgwTerms: ['hull pottery'] }));
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'hull pottery']);
  await pickUp(p, 0);
  layout(p);
  tap(p, pills(p)[2], 230); await tick(20);
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'hull pottery']);
  assert.match(p.$('#otp-toast').textContent, /Locked hunts stay ahead of the others/);
  await p.close();
});

test('no tap flash on a pill', () => {
  assert.ok(PAGE.includes('.scout-app-wrapper .sgw-chip[data-sgw="pick"]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}'));
});
