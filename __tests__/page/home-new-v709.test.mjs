// Page v7.09 (Matt, 2026-10-17: "is there any way to show the new ones only or featured in the home page, i see that
// it says 1 new, but it isn't obvious"): New since your last look sits at the top of the home panel, with the
// listings behind the other hunts' "N new" badges, and inside a hunt the new ones come first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

/* yesterday's look at pyrex saw listings 0 and 1 everywhere; today each marketplace also has listing 2 */
function seenBefore(q) {
  const urls = [];
  for (const src of ['shopgoodwill', 'ebay', 'chairish', 'etsy', 'poshmark', 'vinted', 'grailed', 'salvation']) {
    const host = src === 'shopgoodwill' ? 'shopgoodwill.com/item' : src === 'ebay' ? 'www.ebay.com/itm' : `www.${src}.com/listing`;
    for (const i of [0, 1]) urls.push(`https://${host}/${encodeURIComponent(q)}-${i}`);
  }
  return urls;
}
const STORE = {
  'prowl.v36': { seen: true, hunts: ['fiesta', 'pyrex'], lock: [0, 1], h21: 1, h36: 1, h42: 1, h68: 1 },
  'prowl.seenUrls': { pyrex: seenBefore('pyrex') },
};

test('the home panel features what is new for the other hunts, tagged New, with a way into that hunt', async () => {
  const f = liveFetch({ perSource: 3 });
  const p = loadPage({ fetchImpl: f.impl, storage: STORE });
  await tick(50);
  /* the other hunts' listings come in as Flock or Daily look at them; Daily, then back home */
  p.$('#otp-dock .db[data-m="daily"]').click();
  await tick(5000);
  p.$('#otp-cr').click();
  const box = await waitFor(() => p.$('#otp-homeNew'), { timeout: 12000 });
  assert.match(box.querySelector('.hn-h').textContent, /New since your last look/);
  const cells = [...box.querySelectorAll('.sgw-cell[data-u]')];
  assert.ok(cells.length > 0 && cells.length <= 3, 'up to 3 for the hunt: ' + cells.length);
  for (const c of cells) {
    assert.match(c.getAttribute('data-u'), /pyrex-2$/);
    assert.equal(c.querySelector('.fl-newb').textContent, 'New');
    assert.match(c.querySelector('.sgw-m').textContent, /^for pyrex · /);
  }
  const go = box.querySelector('.hn-go');
  assert.match(go.textContent, /^pyrex · \d+ new$/);
  go.click();
  await tick(60);
  /* in the hunt, its new listings are first in each marketplace and say New */
  await waitFor(() => p.$('#otp-sgw .sgw-chip.on') && /pyrex/.test(p.$('#otp-sgw .sgw-chip.on').textContent));
  const first = p.$('#otp-sgw .sgw-body .sgw-grid .sgw-cell[data-u]');
  assert.match(first.getAttribute('data-u'), /pyrex-2$/, 'new first');
  assert.ok(first.querySelector('.fl-newb'), 'tagged New');
  assert.equal(p.$('#otp-homeNew'), null, 'seen now, so the strip has nothing left to feature');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('they glow: a ring on the card and a breathing light, still under reduced motion', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.match(css, /\.hn \.sgw-card,\.scout-app-wrapper \.sgw-cell\[data-fresh\] \.sgw-card\{position:relative;box-shadow:0 0 0 2px var\(--ac\)/);
  assert.match(css, /@media \(prefers-reduced-motion:no-preference\)\{[^}]*\.hn \.sgw-card:after[^}]*animation:hnGlow/);
});

test('nothing new anywhere: no strip', async () => {
  const f = liveFetch({ perSource: 2 });
  const p = loadPage({ fetchImpl: f.impl, storage: STORE });
  await tick(4000);
  assert.equal(p.$('#otp-homeNew'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});
