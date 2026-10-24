// Page v7.84 (Matt: "for the pills for the hunt, i want to reorder them, can i rearrange those? on phone press and hold
// and move?"). Press and hold a hunt pill, then drag it where it goes; a mouse drags it; the keyboard moves it with Alt
// and an arrow. The order is the hunt list's own (no new key): the lock set keeps its places, a selection follows its
// hunt, Goodwill-only terms move only among themselves, and Daily and Prowl Alerts go through the hunts in that order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = () => J({ items: [] });
/* four locked hunts, one unlocked one between them (index 2), pyrex selected */
const DEN = (o) => Object.assign({ 'prowl.v36': { seen: true, hunts: ['rookwood vase', 'catalin bracelet', 'old crock', 'pyrex butterprint', 'mccoy planter'], lock: [0, 1, 3, 4], sel: [3] } }, o || {});
const pills = (p) => p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]');
const names = (p) => pills(p).map((c) => c.textContent.replace(/^◉/, '').replace(/×$/, '').replace(/\d+\+? new/, ''));
const saved = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36'));
/* lay the pills out in one row, 100px each, so a finger position means a pill */
function layout(p) {
  pills(p).forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 110, right: i * 110 + 100, top: 0, bottom: 44, width: 100, height: 44 }); });
}
function touch(p, el, type, x, y) {
  const e = new p.win.Event(type, { bubbles: true, cancelable: true });
  const t = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : t });
  Object.defineProperty(e, 'changedTouches', { value: t });
  el.dispatchEvent(e);
  return e;
}
async function boot(storage) { const p = loadPage({ storage: storage || DEN(), fetchImpl: fx }); await tick(60); layout(p); return p; }

test('press and hold a pill, drag it before another, let go: the order changes and is kept', async () => {
  const p = await boot();
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter']);
  const m = pills(p)[3];
  touch(p, m, 'touchstart', 380, 20);
  await tick(500);
  assert.ok(m.classList.contains('sgw-drag'), 'lifted after the hold');
  const mv = touch(p, m, 'touchmove', 20, 20);
  assert.equal(mv.defaultPrevented, true, 'the page does not scroll while a pill is dragged');
  assert.ok(pills(p)[0].classList.contains('sgw-dropb'), 'the place it lands is marked');
  touch(p, m, 'touchend', 20, 20);
  await tick(20);
  assert.deepEqual(names(p), ['mccoy planter', 'rookwood vase', 'catalin bracelet', 'pyrex butterprint']);
  const s = saved(p);
  assert.deepEqual(s.hunts, ['mccoy planter', 'rookwood vase', 'old crock', 'catalin bracelet', 'pyrex butterprint'], 'the unlocked hunt keeps its place');
  assert.deepEqual(s.lock.sort(), [0, 1, 3, 4], 'the locked places are the same');
  assert.deepEqual(s.sel, [4], 'the selection follows pyrex');
  assert.match(p.$('#otp-toast').textContent, /Order saved\. Daily and Prowl Alerts go through your hunts in this order\./);
  assert.equal(p.$('.sgw-drag'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a quick tap still picks the hunt; moving before the hold is a scroll, not a drag', async () => {
  const p = await boot();
  const c = pills(p)[1];
  touch(p, c, 'touchstart', 150, 20);
  touch(p, c, 'touchend', 150, 20);
  c.click(); await tick(60);
  assert.ok(pills(p)[1].classList.contains('on'), 'catalin bracelet picked');
  const r = pills(p)[2];
  touch(p, r, 'touchstart', 260, 20);
  const mv = touch(p, r, 'touchmove', 260, 60);
  assert.equal(mv.defaultPrevented, false, 'the page scrolls');
  await tick(500);
  assert.equal(p.$('.sgw-drag'), null, 'no drag after a scroll');
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter']);
  await p.close();
});

test('the click that ends a drag does not pick the pill; letting go away from the pills changes nothing', async () => {
  const p = await boot();
  const before = p.$('#otp-sgw .sgw-chip.on').textContent;
  const m = pills(p)[3];
  touch(p, m, 'touchstart', 380, 20);
  await tick(500);
  touch(p, m, 'touchmove', 380, 900);
  touch(p, m, 'touchend', 380, 900);
  await tick(20);
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter'], 'nowhere to land');
  pills(p)[3].click(); await tick(40);
  assert.equal(p.$('#otp-sgw .sgw-chip.on').textContent, before, 'not picked by the drag\'s own click');
  await p.close();
});

test('Alt and an arrow move the focused pill, and it keeps the focus', async () => {
  const p = await boot();
  const k = (el, key) => el.dispatchEvent(new p.win.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }));
  k(pills(p)[0], 'ArrowRight');
  assert.deepEqual(names(p), ['catalin bracelet', 'rookwood vase', 'pyrex butterprint', 'mccoy planter']);
  assert.equal(p.doc.activeElement, pills(p)[1], 'rookwood vase, focused where it went');
  k(pills(p)[1], 'ArrowLeft');
  k(pills(p)[0], 'ArrowLeft');
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter'], 'nothing before the first');
  await p.close();
});

test('Goodwill-only terms move among themselves, never into the locked hunts', async () => {
  const p = await boot(DEN({ 'prowl.v36': { seen: true, hunts: ['rookwood vase', 'catalin bracelet'], lock: [0, 1] }, 'owlTwigSgwTerms': ['hull pottery', 'fenton glass'] }));
  const all = names(p);
  assert.deepEqual(all, ['rookwood vase', 'catalin bracelet', 'hull pottery', 'fenton glass']);
  const k = (el, key) => el.dispatchEvent(new p.win.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }));
  k(pills(p)[2], 'ArrowLeft');
  assert.deepEqual(names(p), all, 'not past the last locked hunt');
  k(pills(p)[3], 'ArrowLeft');
  assert.deepEqual(names(p), ['rookwood vase', 'catalin bracelet', 'fenton glass', 'hull pottery']);
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('owlTwigSgwTerms')), ['fenton glass', 'hull pottery'], 'kept');
  await p.close();
});

test('a mouse drags without a hold', async () => {
  const p = await boot();
  const m = pills(p)[2];
  const ev = (el, type, x) => el.dispatchEvent(new p.win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20, button: 0 }));
  ev(m, 'mousedown', 270);
  ev(p.doc, 'mousemove', 200);
  ev(p.doc, 'mousemove', 130);
  ev(p.doc, 'mouseup', 130);
  await tick(20);
  assert.deepEqual(names(p), ['rookwood vase', 'pyrex butterprint', 'catalin bracelet', 'mccoy planter']);
  await p.close();
});
