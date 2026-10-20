// Page v6.88: the dock's ALL button (which only scrolled home when nothing was typed) is now LOCAL.
// Search All stays under the search box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('dock NEAR ME with no hunt opens the Near me screen (v7.34: its own drawer, not the Den)', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  assert.equal(p.$('#otp-dock .db[data-m="all"]'), null, 'ALL is gone from the dock');
  assert.ok(p.$('#otp-sa'), 'Search All is still under the search box');
  p.$('#otp-localBtn').click();
  await tick(30);
  assert.equal(p.$('#otp-near').hidden, false, 'Near me opened');
  assert.equal(p.$('#otp-den').hidden, true, 'not the Den');
  assert.equal(p.$('#otp-denLocal').hidden, false, 'the store finder is on it');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v7.09: dock LOCAL with a hunt opens the Maps links for stores near you, not a run', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  p.$('#otp-q').value = 'Pyrex Butterprint';
  p.$('#otp-localBtn').click();
  await tick(120);
  assert.equal(p.$('#otp-denLocal').hidden, false);
  assert.ok(p.$$('#otp-nearGrid a.nearc').length >= 8);
  assert.equal(p.$('#otp-res a.hit'), null, 'no marketplace run');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a hunt names its sites in the sweep line, then says how many are ready; no new run, no sweep', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  p.$('#otp-q').value = 'Fire-King jadeite';
  p.$('#otp-sa').click();
  await tick(200);
  const sw = p.$('.pm-sw');
  assert.ok(sw, 'the sweep line is there');
  assert.ok(sw.nextElementSibling === p.$('#otp-res'), 'beside the results, so their redraw leaves it');
  await tick(2200);
  assert.match(sw.textContent, /\d+ searches ready/);
  p.$('#otp-q').value = '';
  p.$('#otp-localBtn').click();   /* no hunt: opens the Den, no run */
  await tick(200);
  assert.doesNotMatch(sw.textContent, /Checking/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('under reduced motion there is no sweep line', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, reducedMotion: true });
  await tick(30);
  p.$('#otp-q').value = 'Fire-King jadeite';
  p.$('#otp-sa').click();
  await tick(300);
  assert.equal(p.$('.pm-sw'), null);
  await p.close();
});
