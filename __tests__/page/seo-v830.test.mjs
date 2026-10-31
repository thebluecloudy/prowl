// Page v8.30 (Matt, 2026-10-31: the PROWL_SEO_BRIEF): the canonical address is https://www.owlandtwigvintage.com/pages/prowl
// everywhere in the page (schema, share links); a first visit shows, in the static HTML Google reads, what Prowl is and
// the main marketplaces it searches; the stale "in the Den, under Local" line is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('v8.30: every link to the shop uses the www canonical host', () => {
  assert.doesNotMatch(PAGE, /https:\/\/owlandtwigvintage\.com/);
  assert.doesNotMatch(PAGE, /https%3A%2F%2Fowlandtwigvintage\.com/);
});

test('v8.30: the WebApplication schema names the canonical URL and parses', () => {
  const blocks = [...PAGE.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const app = blocks.find((b) => b['@type'] === 'WebApplication');
  assert.ok(app);
  assert.equal(app.url, 'https://www.owlandtwigvintage.com/pages/prowl');
});

test('v8.30: the first-visit hero says what Prowl is and names the main marketplaces, in static HTML', () => {
  const m = /<p class="lede k2-only lede-more">([^<]*(?:<[^p][^>]*>[^<]*)*)<\/p>/.exec(PAGE);
  assert.ok(m, 'the line is in the markup, not built by script');
  for (const w of ['free search tool', 'ShopGoodwill', 'eBay', 'Etsy', 'Facebook Marketplace']) assert.ok(m[1].includes(w), w);
  assert.ok(PAGE.indexOf('<p class="lede k2-only lede-more">') > PAGE.indexOf('<h1>Find the prey</h1>'), 'under the one H1');
  assert.equal((PAGE.match(/<h1[\s>]/g) || []).length, 1, 'one H1');
  assert.ok(PAGE.includes('.scout-app-wrapper p.lede.lede-more{'));
});

test('v8.30: Near me is no longer described as in the Den', () => {
  assert.doesNotMatch(PAGE, /in the Den, under Local/);
});
