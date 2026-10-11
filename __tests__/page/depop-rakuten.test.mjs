// Depop through Rakuten Advertising (worker v95, page v6.67). Rakuten closed Owl & Twig's earlier publisher account on
// 2026-10-09 (worker v92 / page v6.62 removed its link and publisher ID everywhere); Matthew was approved for Depop
// through Rakuten again the same day. The link is back on the Prowl page only, as a template with two slots filled from
// the admin area, never with a publisher ID written into the code:
// - the page's Rakuten URLs are Depop's and (v6.87) Etsy's templates in PROWL_AFF, each with {ranid} and {mid} slots;
// - the old publisher ID never comes back, anywhere;
// - the worker (alert emails, /aff, the admin area) and the Chrome extension build no Rakuten link (Rakuten bars its
//   links in email without written permission, and needs an extension approved before it carries them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const worker = readdirSync(join(ROOT, 'worker')).filter((f) => f.endsWith('.js')).map((f) => 'worker/' + f);
const extension = readdirSync(join(ROOT, 'extension')).filter((f) => /\.(js|html|json)$/.test(f)).map((f) => 'extension/' + f);
const OLD_ID = /jh1j\/r7/i;

test('the old publisher ID is nowhere: the page, the worker or the extension', () => {
  const files = ['page/prowl.html', ...worker, ...extension];
  assert.ok(files.length > 10, 'the files are found');
  for (const f of files) assert.doesNotMatch(read(f), OLD_ID, f);
});

test('the worker and the extension build no Rakuten link', () => {
  for (const f of [...worker, ...extension]) {
    const m = /linksynergy|mid=53555/i.exec(read(f));
    assert.equal(m, null, f + ' has "' + (m && m[0]) + '"');
  }
});

test("the page's Rakuten URLs are Depop's and Etsy's templates, with both IDs as slots", () => {
  const page = read('page/prowl.html');
  const all = page.match(/linksynergy/gi) || [];
  assert.equal(all.length, 2, 'two templates: Depop and (v6.87) Etsy');
  assert.match(page, /'etsy\.com':\{n:'Etsy',id:'etsy_rak',t:'https:\/\/click\.linksynergy\.com\/deeplink\?id=\{ranid\}&mid=\{mid\}&murl=\{url\}'\}/);
  assert.match(page, /window\.PROWL_AFF_ON=\{[^}]*etsy_rak:false/, 'Etsy off until the owner turns it on');
  assert.doesNotMatch(page, /window\.PROWL_AFF_ON=\{[^}]*\betsy:/, 'never the Awin-era key, which pages v6.60-v6.86 act on');
  assert.doesNotMatch(page, /'etsy\.com':\{[^}]*awin1/, 'no Awin Etsy template');
  assert.match(page, /'depop\.com':\{n:'Depop',id:'depop_rak',t:'https:\/\/click\.linksynergy\.com\/deeplink\?id=\{ranid\}&mid=\{mid\}&murl=\{url\}'\}/);
  assert.doesNotMatch(page, /mid=53555/, 'the advertiser ID comes from the admin area, like the publisher ID');
  assert.match(page, /window\.PROWL_AFF_ON=\{[^}]*depop_rak:false/, 'off until the owner turns it on');
  assert.doesNotMatch(page, /window\.PROWL_AFF_ON=\{[^}]*\bdepop:/, 'never the old key, which old pages and extension 1.6.3 act on');
  assert.doesNotMatch(/window\.PROWL_AFF_IDS=[^;]*;/.exec(page)[0], /depop/, 'no Depop ID written into the page: both come from the admin area');
});
