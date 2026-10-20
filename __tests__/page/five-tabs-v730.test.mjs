// Page v7.30 (Matt and his wife, 2026-10-20: "too complicated for people to use"): five tabs, one job each. HUNT is
// one search in depth, DAILY is only what is new, FLOCK is the feed, NEAR ME is for the car, DEN keeps your things.
// The GOODWILL tab's one-site search is the Just ShopGoodwill pill under the search box, where Near me was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const hosts = (p) => p.$$('#otp-res a.hit').map((a) => new URL(a.href).hostname.replace(/^www\./, ''));

test('five tabs with plain names; no GOODWILL tab', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  assert.deepEqual(p.$$('#otp-dock .db span').map((s) => s.textContent), ['HUNT', 'DAILY', 'FLOCK', 'NEAR ME', 'DEN']);
  assert.equal(p.$('#otp-oneBtn'), null);
  assert.equal(p.$('#otp-dock .db[data-m="one"]'), null);
  assert.match(p.$('#otp-dock .db[data-m="prowl"]').getAttribute('aria-label'), /^Hunt/);
  assert.match(p.$('#otp-localBtn').getAttribute('aria-label'), /^Near me/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Just ShopGoodwill runs the typed hunt on that one site; with nothing typed it opens the one-site screen', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  const pill = p.$('#otp-one');
  assert.equal(pill.textContent, 'Just ShopGoodwill');
  p.$('#otp-q').value = 'Pyrex Butterprint';
  pill.click();
  await tick(30);
  const h = hosts(p);
  assert.ok(h.length > 0, 'the run drew rows');
  for (const x of h) assert.match(x, /shopgoodwill\.com$/, x);
  assert.match(p.$('#otp-res').textContent, /Pyrex Butterprint/);
  p.$('#otp-cr').click();
  await tick(20);
  p.$('#otp-q').value = '';
  pill.click();
  await tick(30);
  assert.ok(p.$('#otp-fq'), 'the one-site screen with its own search box');
  assert.equal(p.$('#otp-res a.hit'), null, 'no run');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the pill names the site picked in the Den', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [], one: 'chairish' } } });
  await tick(30);
  assert.equal(p.$('#otp-one').textContent, 'Just Chairish');
  await p.close();
});

test('NEAR ME opens its own screen, stores first, without the Den\'s tabs; DEN still opens the Den', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  const den = p.$('#otp-den');
  p.$('#otp-localBtn').click();
  await tick(60);
  assert.equal(den.hidden, false);
  assert.equal(p.$('#otp-dent').textContent, 'Near me');
  assert.ok(den.classList.contains('den-near'), 'the Den\'s tabs are hidden');
  assert.equal(p.$('#otp-denClose').getAttribute('aria-label'), 'Close Near me');
  assert.equal(p.$('#otp-denLocal').hidden, false);
  assert.ok(p.$$('#otp-nearGrid a.nearc').length >= 8, 'the store types');
  p.$('#otp-denClose').click();
  await tick(350);
  assert.equal(den.hidden, true);
  p.$('#otp-denBtn').click();
  await tick(60);
  assert.equal(p.$('#otp-dent').textContent, 'Den');
  assert.equal(den.classList.contains('den-near'), false);
  assert.equal(p.$('#otp-denTerms').hidden, false, 'on your hunts, not Near me');
  assert.equal(p.$('#otp-denT2').hidden, true, 'the Den has no LOCAL tab: Near me is its door');
  assert.equal(p.$('#otp-denClose').getAttribute('aria-label'), 'Close Den');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Daily: the alerts card comes after the finds, and the page is short', async () => {
  const f = liveFetch({ perSource: 3 });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['fiesta', 'pyrex', 'blenko'], lock: [0, 1, 2] } } });
  await tick(50);
  p.$('#otp-dock .db[data-m="daily"]').click();
  await waitFor(() => p.$$('.dg-blk').length === 3 && p.$$('.dg-blk').every((b) => b.getAttribute('data-done') === '1'), { timeout: 15000 });
  const rc = p.$('.dg-rc');
  const kids = [...rc.children];
  const mail = kids.indexOf(p.$('.dg-rc .dg-mail'));
  const last = kids.indexOf(p.$$('.dg-blk').pop());
  assert.ok(mail > last, 'the alerts card follows the last hunt');
  assert.ok(p.$$('.dg-rc .sgw-cell[data-u]').length <= 18, 'at most 6 cards a hunt, though 3 hunts x 8 sites x 3 are live');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('How Prowl works and Prowl\'s words name the new tabs', async () => {
  const p = loadPage({ storage: DEN });
  const ms = p.$('#otp-ms').textContent;
  assert.match(ms, /NEAR ME in the footer is for when you are out in the car/);
  assert.match(ms, /Just ShopGoodwill under the box searches that one site/);
  assert.match(ms, /shows only what is new since yesterday/);
  const words = p.$$('#otp-ms .gloss dt').map((d) => d.textContent);
  assert.ok(words.includes('Near me'));
  await p.close();
});
