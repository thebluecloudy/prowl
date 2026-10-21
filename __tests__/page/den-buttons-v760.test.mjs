// Page v7.60 (the owner's screenshot of Den settings: "Standard" spilling out of its button). In a settings row the
// button sits beside a description in a flex row and shrank below its own words; now it keeps them on one line and the
// description wraps instead. jsdom has no layout, so this checks the rule and that every settings button is a direct
// child of its row (the rule's selector); the Playwright check at 390, 640 and 1280 px found no overflow after it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');

test('a settings button never shrinks below its words; the description takes the squeeze', () => {
  assert.match(PAGE, /\.scout-app-wrapper \.setrow>\.gh,\.scout-app-wrapper \.setrow>button\{flex:0 0 auto;white-space:nowrap\}/);
  assert.match(PAGE, /\.scout-app-wrapper \.setrow>div\{flex:1 1 auto;min-width:0\}/);
});

test('every Den settings button is a direct child of its row, so the rule reaches it', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const rows = p.$$('#otp-denSettings .setrow');
  assert.ok(rows.length >= 4, 'the settings rows');
  for (const id of ['otp-sizeBtn', 'otp-detailBtn']) {
    const b = p.$('#' + id);
    assert.ok(b.parentElement.classList.contains('setrow'), id + ' sits in its row');
  }
  assert.deepEqual(p.errors, []);
  await p.close();
});
