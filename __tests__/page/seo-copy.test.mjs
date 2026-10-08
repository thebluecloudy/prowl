// Page v6.49: SEO copy says what Prowl does for you, never what another site can't do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');

test('no copy frames Prowl against Google', () => {
  assert.doesNotMatch(PAGE, /Google (does not|doesn't|don't) index|rarely reaches|Google skips|Google can't|find vintage on Google|Google:|Why not just Google|where a Google search|aren't indexed/i);
  assert.doesNotMatch(PAGE, /the apps don't search|Most search tools cover/i, 'no other tools either');
  // Google may still be named as a tool Prowl opens (Lens, Maps) or in the trademark line
  const left = PAGE.match(/.{0,20}Google.{0,20}/g) || [];
  for (const m of left) assert.match(m, /Google (Lens|Maps)|Biblio, Google, Instagram|Google Images|google\.com/, m);
});

test('the schema and FAQ lead with what Prowl does', () => {
  assert.match(PAGE, /"description":"Free tool for vintage collectors - type a piece once and search 28 marketplaces at once, including ShopGoodwill, Facebook Marketplace and Craigslist\."/);
  const faq = 'Type a piece once and it builds that search for 28 marketplaces on one screen, including ShopGoodwill, Facebook Marketplace and Craigslist.';
  assert.equal(PAGE.split(faq).length - 1, 2, 'FAQ schema and the visible FAQ');
  assert.match(PAGE, /<h2>Every vintage marketplace, one search<\/h2>/);
  assert.match(PAGE, /<strong>Prowl runs your search across 28 vintage marketplaces at once\.<\/strong>/);
});
