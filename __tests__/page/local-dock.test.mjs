// Page v6.88: the dock's ALL button (which only scrolled home when nothing was typed) is now LOCAL.
// Search All stays under the search box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('dock LOCAL with no hunt opens Den > Local', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  assert.equal(p.$('#otp-dock .db[data-m="all"]'), null, 'ALL is gone from the dock');
  assert.ok(p.$('#otp-sa'), 'Search All is still under the search box');
  p.$('#otp-localBtn').click();
  await tick(30);
  assert.equal(p.$('#otp-den').hidden, false, 'the Den opened');
  assert.equal(p.$('#otp-denLocal').hidden, false, 'on the Local tab');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('dock LOCAL with a hunt searches only the city-aware sites', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  p.$('#otp-q').value = 'Pyrex Butterprint';
  p.$('#otp-localBtn').click();
  await tick(30);
  const hosts = p.$$('#otp-res a.hit').map((a) => new URL(a.href).hostname.replace(/^www\./, ''));
  assert.ok(hosts.length >= 4, 'rows: ' + hosts.join(', '));
  for (const h of hosts) assert.match(h, /facebook|craigslist|offerup|estatesales|ctbids/, h);
  assert.ok(p.$('#otp-localBtn').classList.contains('on'), 'LOCAL lights up while its run shows');
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
