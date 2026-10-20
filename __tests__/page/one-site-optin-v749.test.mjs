// Page v7.49 (Matt, 2026-10-20, Den > Settings: "this no longer is needed. Unless we can have them turn it on if they
// want"): the Just ShopGoodwill pill beside Hunt is off to start with. Den > Settings > One-site button has Off first;
// picking a site turns the pill on and names it. A save or backup from before keeps a site picked by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const saved = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36'));
const pick = (p, v) => { const s = p.$('#otp-oneSel'); s.value = v; s.dispatchEvent(new p.win.Event('change', { bubbles: true })); };

test('a new visitor sees no one-site pill, and the setting reads Off', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  assert.equal(p.$('#otp-one').hidden, true);
  const sel = p.$('#otp-oneSel');
  assert.equal(sel.value, '');
  assert.equal(sel.options[0].textContent, 'Off');
  assert.ok(sel.options.length > 20, 'every marketplace is still offered');
  assert.match(p.$('#otp-oneSel').parentNode.querySelector('.setnote').textContent, /Off to start with/);
  assert.doesNotMatch(p.$('#otp-oneSel').parentNode.querySelector('.setnote').textContent, /bar at the bottom/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('picking a site turns the pill on and names it; Off hides it again; both are saved', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  pick(p, 'chairish');
  await tick(10);
  assert.equal(p.$('#otp-one').hidden, false);
  assert.equal(p.$('#otp-one').textContent, 'Just Chairish');
  assert.equal(saved(p).oneOn, true);
  assert.equal(saved(p).one, 'chairish');
  pick(p, '');
  await tick(10);
  assert.equal(p.$('#otp-one').hidden, true);
  assert.equal(saved(p).oneOn, false);
  assert.equal(saved(p).one, 'chairish', 'the site is remembered for next time');
  pick(p, 'shopgoodwill');
  await tick(10);
  assert.equal(p.$('#otp-one').hidden, false, 'Goodwill picked on purpose counts too');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an older save keeps a site picked by hand; the untouched Goodwill default goes', async () => {
  let p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [], one: 'chairish' } } });
  await tick(30);
  assert.equal(p.$('#otp-one').hidden, false);
  assert.equal(p.$('#otp-oneSel').value, 'chairish');
  await p.close();
  p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [], one: 'shopgoodwill' } } });
  await tick(30);
  assert.equal(p.$('#otp-one').hidden, true);
  assert.equal(p.$('#otp-oneSel').value, '');
  await p.close();
  p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [], one: 'chairish', oneOn: false } } });
  await tick(30);
  assert.equal(p.$('#otp-one').hidden, true, 'a saved Off wins');
  await p.close();
});

test('a backup carries the switch; an older backup with a picked site turns it on', async () => {
  for (const [code, on, val] of [[{ v: 2, hunts: ['x'], one: 'etsy', oneOn: true }, false, 'etsy'], [{ hunts: ['x'], one: 'etsy' }, false, 'etsy'], [{ hunts: ['x'], one: 'etsy', oneOn: false }, true, '']]) {
    const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
    await tick(30);
    p.win.confirm = () => true;
    p.$('#otp-impText').value = JSON.stringify(code);
    p.$('#otp-impTextBtn').click();
    await tick(30);
    assert.equal(p.$('#otp-one').hidden, on, JSON.stringify(code));
    assert.equal(p.$('#otp-oneSel').value, val, 'the Den setting follows the restore');
    await p.close();
  }
});
