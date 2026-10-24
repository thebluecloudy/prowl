// Page v7.91 (Matt: "Yes move likes into flock feed saved likes. They are different. The likes are feeding the
// algorithm ... You could like 100 but only save 5. Some things I was saving don't seem to be there anymore").
// Likes is Flock's third view (Flock · Saved · Likes; the feed's tab says Flock, not Feed) and leaves the Den. A swipe-away in the feed used to take a saved
// find out of Saved (and a price watch with it), so kept finds quietly vanished; now only the ✕ in Saved (or the ★)
// removes them, and Saved shows everything saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const LIKES = Array.from({ length: 3 }, (_, i) => ({ u: 'https://www.ebay.com/itm/55500' + i, t: 'Haeger panther lamp ' + i, p: '$2' + i, s: 'ebay', i: '', h: '', at: 10 - i }));
const SAVED = { title: 'Rookwood 1920s vase', price: '$180', url: 'https://www.ebay.com/itm/9990', image: '', src: 'ebay', hunt: 'rookwood vase', at: 1 };
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
async function flock(extra) {
  const p = loadPage({ storage: Object.assign({ 'prowl.v36': { seen: true, hunts: ['rookwood vase'], lock: [0] }, 'prowl.likes': LIKES, 'prowl.finds': [SAVED] }, extra || {}), fetchImpl: () => J({ items: [] }) });
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click(); await tick(60);
  return p;
}
const view = (p, v) => { p.$('#otp-flock [data-fv="' + v + '"]').click(); };

test('Flock has Flock · Saved · Likes, each counted; Likes shows what Prowl learned and the likes, the feed hides', async () => {
  const p = await flock();
  assert.deepEqual(p.$$('#otp-flock .fl-seg [data-fv]').map((b) => b.textContent), ['Flock', 'Saved 1', 'Likes 3']);
  view(p, 'likes'); await tick(20);
  const pane = p.$('#otp-denLikes');
  assert.ok(p.$('#otp-flock').contains(pane), 'in Flock');
  assert.equal(pane.hidden, false);
  assert.equal(p.$('#otp-flock [data-fv="likes"]').getAttribute('aria-selected'), 'true');
  assert.ok(p.$('#otp-flock').classList.contains('fl-likesv'), 'the feed row steps aside');
  assert.match(pane.textContent, /What Prowl learned/);
  assert.equal(pane.querySelectorAll('.lk-cell').length, 3);
  pane.querySelector('[data-unlike="' + LIKES[0].u + '"]').click(); await tick(10);
  assert.equal(p.$('#otp-flock [data-fv="likes"]').textContent, 'Likes 2');
  view(p, 'saved'); await tick(20);
  assert.equal(pane.hidden, true);
  assert.ok(!p.$('#otp-flock').classList.contains('fl-likesv'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the Den has no Likes tab now; four tabs', async () => {
  const p = await flock();
  p.$('#otp-dock .db[data-m="den"]').click(); await tick(40);
  assert.deepEqual(p.$$('#otp-den .tab').map((b) => b.textContent), ['All hunts', 'About', 'Stats', 'Settings']);
  assert.equal(p.$('#otp-denT5'), null);
  assert.equal(p.$('#otp-den #otp-denLikes'), null);
  await p.close();
});

test('a find swiped away in the feed before v7.91 shows in Saved again', async () => {
  const p = await flock({ 'prowl.discarded': [SAVED.url] });
  view(p, 'saved'); await tick(20);
  assert.ok(p.$$('#otp-flockRow .fl-card').some((c) => c.getAttribute('data-u') === SAVED.url));
  await p.close();
});

test('✕ in Saved still removes a saved find, says so, and Undo puts it back', async () => {
  const p = await flock();
  view(p, 'saved'); await tick(20);
  const c = p.$$('#otp-flockRow .fl-card').find((x) => x.getAttribute('data-u') === SAVED.url);
  c.querySelector('.fl-x').click(); await tick(10);
  assert.deepEqual(ls(p, 'prowl.finds'), []);
  assert.match(p.$('#otp-toast').textContent, /^Removed from Saved\./);
  p.$('#otp-undis').click(); await tick(10);
  assert.equal(ls(p, 'prowl.finds')[0].url, SAVED.url);
  await p.close();
});

test('the Den opens on All hunts (a Likes tab it remembered becomes All hunts)', async () => {
  const p = await flock();
  p.$('#otp-dock .db[data-m="den"]').click(); await tick(40);
  assert.ok(p.$('#otp-denT1').classList.contains('on'));
  assert.equal(p.$('#otp-denTerms').hidden, false);
  await p.close();
});
