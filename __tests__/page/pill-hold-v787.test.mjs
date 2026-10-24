// Page v7.87 (Matt, on v7.86's pill reorder: "It blinks and it vibrates but it doesn't lift and move the pills"). On the
// live page listings keep landing for a while, and each one redrew the pills: a pill held at that moment was replaced
// by a new one, so the lift happened on a pill no longer on screen and the drag went nowhere. Now nothing redraws the
// pills from the touch until the finger lifts; then they catch up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const J = (j) => ({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const DEN = { 'prowl.v36': { seen: true, hunts: ['rookwood vase', 'catalin bracelet', 'pyrex butterprint', 'mccoy planter'], lock: [0, 1, 2, 3] } };
const pills = (p) => p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]');
const names = (p) => pills(p).map((c) => c.textContent.replace(/^◉/, '').replace(/×$/, '').replace(/\d+\+? new/, ''));
function layout(p) { pills(p).forEach((c, i) => { c.getBoundingClientRect = () => ({ left: i * 110, right: i * 110 + 100, top: 0, bottom: 44, width: 100, height: 44 }); }); }
function touch(p, el, type, x, y) {
  const e = new p.win.Event(type, { bubbles: true, cancelable: true });
  const t = [{ clientX: x, clientY: y }];
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : t });
  Object.defineProperty(e, 'changedTouches', { value: t });
  el.dispatchEvent(e);
}
/* live listings wait until let go, then land all at once */
function slow() {
  const held = [];
  const fetchImpl = (u) => {
    const q = new URL(String(u), 'https://www.owlandtwigvintage.com').searchParams.get('q');
    if (!q) return Promise.resolve(J({ items: [] }));
    return new Promise((ok) => held.push(() => ok(J({ items: [{ title: q + ' 1', url: 'https://www.ebay.com/itm/' + q.length + held.length, price: '$9', image: '' }] }))));
  };
  return { fetchImpl, land: () => held.splice(0).forEach((f) => f()) };
}

test('listings landing while a pill is held do not take it away: it lifts, moves and drops', async () => {
  const s = slow();
  const p = loadPage({ storage: DEN, fetchImpl: s.fetchImpl });
  await tick(80); layout(p);
  const m = pills(p)[3];
  touch(p, m, 'touchstart', 380, 20);
  await tick(150);
  s.land(); await tick(150);   /* in v7.86 this redrew the pills under the finger */
  assert.equal(pills(p)[3], m, 'the held pill is still the one on screen');
  await tick(300);
  assert.ok(m.classList.contains('sgw-drag'), 'lifted');
  touch(p, m, 'touchmove', 20, 20);
  touch(p, m, 'touchend', 20, 20);
  await tick(30);
  assert.deepEqual(names(p), ['mccoy planter', 'rookwood vase', 'catalin bracelet', 'pyrex butterprint']);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a tap while listings land: the pills catch up as soon as the finger lifts', async () => {
  const s = slow();
  const p = loadPage({ storage: DEN, fetchImpl: s.fetchImpl });
  await tick(80); layout(p);
  const c = pills(p)[1];
  touch(p, c, 'touchstart', 150, 20);
  s.land(); await tick(150);
  assert.equal(pills(p)[1], c, 'waiting while the finger is down');
  touch(p, c, 'touchend', 150, 20);
  await tick(30);
  assert.notEqual(pills(p)[1], c, 'redrawn once lifted');
  assert.match(p.$('#otp-sgw .sgw-upd').textContent, /live now/, 'with what landed');
  await p.close();
});

test('a scroll that starts on a pill lets the pills catch up too', async () => {
  const s = slow();
  const p = loadPage({ storage: DEN, fetchImpl: s.fetchImpl });
  await tick(80); layout(p);
  const c = pills(p)[2];
  touch(p, c, 'touchstart', 260, 20);
  s.land(); await tick(100);
  touch(p, c, 'touchmove', 260, 80);
  await tick(30);
  assert.notEqual(pills(p)[2], c, 'redrawn when the scroll began');
  await p.close();
});
