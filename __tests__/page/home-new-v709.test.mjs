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

// v7.32 (the owner, on opening MC Escher: "it shows new since last look, best picks and then MC Escher"): with a hunt
// open, the other hunts' new listings are one line naming each hunt with its count, not a block of cards above the hunt
test('with a hunt open, the other hunts\' new listings are one line; in a hunt its new ones come first', async () => {
  const f = liveFetch({ perSource: 3 });
  const p = loadPage({ fetchImpl: f.impl, storage: STORE });
  await tick(50);
  /* the other hunts' listings come in as Flock or Daily look at them; Daily, then back home */
  p.$('#otp-dock .db[data-m="daily"]').click();
  await tick(5000);
  p.$('#otp-cr').click();
  const line = await waitFor(() => p.$('#otp-sgw .hn-line'), { timeout: 12000 });
  assert.match(line.textContent, /^New in your other hunts:\s*pyrex \d+$/);
  assert.equal(p.$('#otp-homeNew'), null, 'no block of cards above the hunt');
  /* in the hunt, its new listings are first in each marketplace and say New */
  const chip = [...p.$$('#otp-sgw .sgw-chip[data-i]')].find((c) => /pyrex/.test(c.textContent));
  chip.click();
  await waitFor(() => p.$('#otp-sgw .sgw-chip.on') && /pyrex/.test(p.$('#otp-sgw .sgw-chip.on').textContent));
  const first = await waitFor(() => p.$('#otp-sgw .sgw-body .sgw-grid .sgw-cell[data-u]'));
  assert.match(first.getAttribute('data-u'), /pyrex-2$/, 'new first');
  assert.ok(first.querySelector('.fl-newb'), 'tagged New');
  assert.equal(p.$('#otp-sgw .hn-line'), null, 'seen now, nothing new left in the other hunts');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('tapping a hunt on that line opens that hunt, the one its count is for', async () => {
  const f = liveFetch({ perSource: 3 });
  const p = loadPage({ fetchImpl: f.impl, storage: STORE });
  await tick(50);
  p.$('#otp-dock .db[data-m="daily"]').click();
  await tick(5000);
  p.$('#otp-cr').click();
  const pick = await waitFor(() => p.$('#otp-sgw .hn-line .hn-pick'), { timeout: 12000 });
  assert.match(pick.textContent, /^pyrex \d+$/);
  pick.click();
  await waitFor(() => p.$('#otp-sgw .sgw-chip.on') && /pyrex/.test(p.$('#otp-sgw .sgw-chip.on').textContent));
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
