// Page v6.64: the marketplace count written into the HTML (what Google, link previews and a plain text fetch read) is
// the real count. The page rewrites every <span data-t> to TOTAL once it runs, but the HTML said 26 for weeks after
// the count reached 28, and "16 more" survived from the 24-marketplace days. The true number comes from the running
// page (M.length), so this keeps working when a marketplace is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slimPage } from '../../scripts/slim-page.mjs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
/* what Shopify serves, without scripts and styles: the text a crawler reads */
const SHELL = slimPage(PAGE).replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/gi, '').replace(/<style(\s[^>]*)?>[\s\S]*?<\/style>/gi, '');
const TEXT = SHELL.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

async function live() {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const n = {
    total: Number(p.$('.lede [data-t]').textContent),
    shop: Number(p.$('#otp-ts u').textContent),
    bolo: Number(p.$('#otp-tb u').textContent),
  };
  await p.close();
  return n;
}

test('every count written into the HTML is the real number of marketplaces', async () => {
  const n = await live();
  assert.ok(n.total >= 28, 'the running page counts ' + n.total);
  assert.equal(n.shop + n.bolo, n.total);
  const spans = [...SHELL.matchAll(/<span data-t>(\d+)<\/span>/g)].map((m) => Number(m[1]));
  assert.ok(spans.length >= 10, 'the hero, the intro, the ALL button, the footer and the rest');
  for (const v of spans) assert.equal(v, n.total, '<span data-t>' + v + '</span>');
  assert.match(SHELL, new RegExp('SHOP <u>' + n.shop + '</u>'));
  assert.match(SHELL, new RegExp('BOLO <u>' + n.bolo + '</u>'));
  /* plain-text counts too: "28 vintage marketplaces", "28 marketplaces" */
  for (const m of TEXT.matchAll(/\b(\d+) (?:vintage )?marketplaces\b/g)) assert.equal(Number(m[1]), n.total, m[0]);
});

test('no "N more" sum that goes stale when a marketplace is added', () => {
  assert.doesNotMatch(TEXT, /\b\d+ more\b/, 'say it with the live count (<span data-t>) or without a number');
  assert.match(SHELL, /All <span data-t>\d+<\/span>, from ShopGoodwill auctions to Facebook Marketplace, searched directly\./);
  assert.match(SHELL, /<li>Plus eBay, Etsy and the rest, <span data-t>\d+<\/span> in all<\/li>/);
});
