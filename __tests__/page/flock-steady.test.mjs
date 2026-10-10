// Page v6.73: on a computer the Flock grid shows every card at once, and finds that arrived later used to be mixed in
// among them: the grid reshuffled under the mouse and a click landed on the find that had just moved in. Now the
// cards on screen stay where they are (the very same elements, never redrawn) and later finds go at the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const cards = (p) => p.$$('#otp-flockRow .fl-card');

/* every marketplace answers at once except eBay, whose answers wait until the test lets them go */
function heldEbay() {
  const held = [];
  const impl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname.startsWith('/apps/prowl/')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null), text: () => Promise.resolve('') });
    const q = u.searchParams.get('q') || 'x', src = u.pathname.replace(/\//g, '') || 'shopgoodwill';
    const host = src === 'shopgoodwill' ? 'shopgoodwill.com/item' : src === 'ebay' ? 'www.ebay.com/itm' : `www.${src}.com/listing`;
    const items = [0, 1].map((i) => ({ title: `${q} find ${src} ${i}`, price: `$${10 + i}.00`, url: `https://${host}/${encodeURIComponent(q)}-${i}`, image: '', src: src === 'shopgoodwill' ? '' : src }));
    const answer = () => ({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
    if (src !== 'ebay') return Promise.resolve(answer());
    return new Promise((r) => held.push(() => r(answer())));
  };
  return { impl, held };
}

async function open(f, wide) {
  const p = loadPage({ fetchImpl: f.impl, storage: { owlTwigSgwTerms: [], 'prowl.v36': { seen: true, hunts: ['pyrex', 'fiesta'] } }, beforeLoad: (w) => {
    w.Math.random = () => 0.5;
    if (wide) { const mm = w.matchMedia; w.matchMedia = (q) => (/min-width:\s*1024px/.test(q) ? { ...mm(q), matches: true } : mm(q)); }
  } });
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => cards(p).length >= 4 && f.held.length >= 1, { timeout: 8000 });
  await tick(1500);
  return p;
}

test('on a computer, finds that arrive later go at the bottom and the cards on screen are never redrawn', async () => {
  const f = heldEbay();
  const p = await open(f, true);
  const before = cards(p), urls = before.map((c) => c.getAttribute('data-u'));
  assert.ok(!urls.some((u) => /ebay\.com/.test(u)), 'no eBay finds yet');
  while (f.held.length) f.held.shift()();
  await waitFor(() => cards(p).some((c) => /ebay\.com/.test(c.getAttribute('data-u'))), { timeout: 8000 });
  await tick(1500);
  const after = cards(p);
  assert.ok(after.length > before.length, 'eBay finds were added');
  before.forEach((c, i) => assert.equal(after[i], c, 'card ' + i + ' is the same element, in the same place'));
  assert.ok(after.slice(0, before.length).every((c) => !/ebay\.com/.test(c.getAttribute('data-u'))), 'every eBay find (and any other late one) is below the cards that were on screen');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the Aa button at the top changes the text size, like the one in the Den', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const top = p.$('#otp-sizeTop'), theme = p.$('#otp-themeBtn');
  assert.ok(top && top.parentNode === theme.parentNode, 'beside the theme switch');
  assert.equal(top.nextElementSibling, theme);
  const wrap = p.$('.scout-app-wrapper');
  top.click();
  assert.equal(wrap.style.zoom, '1.12');
  assert.equal(p.win.localStorage.getItem('prowl.textSize'), '1');
  assert.equal(p.$('#otp-sizeBtn').textContent, 'Large', 'the Den setting follows');
  assert.match(top.getAttribute('aria-label'), /Large/);
  top.click(); top.click();
  assert.equal(wrap.style.zoom, '', 'and back to standard');
  assert.deepEqual(p.errors, []);
  await p.close();
});
