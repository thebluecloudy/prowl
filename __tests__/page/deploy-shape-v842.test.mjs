// v8.42: v8.41's deploy md5 check failed because Shopify stores the How Prowl works search form (#303) with a line
// break after <form ...> and before </form>. The page file must be written the way Shopify stores it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('v8.42: the How Prowl works search form is written the way Shopify stores it', () => {
  assert.match(html, /<form class="hw-try" id="otp-hwTry" autocomplete="off">\n<input id="otp-hwQ"/);
  assert.match(html, /aria-label="Hunt it">→<\/button>\n<\/form>/);
});
