// Page v7.68 (the owner, beside Roadtrippers on the phone: "the text needs to be bigger on the phone ... the font is a
// good size"). NEAR ME on a phone reads at about Roadtrippers' sizes, scoped to #otp-near, and a shop restacks so the
// bigger words have the width: name, town and hours beside the photo, OPEN NOW and the miles under them, Directions
// and Skip as a row under the card. Inputs are 16px so an iPhone does not zoom in on a tap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const block = (() => { const i = PAGE.indexOf('/* v7.68 (the owner, beside Roadtrippers'); const m = PAGE.indexOf('@media (max-width:600px){', i); return PAGE.slice(m, PAGE.indexOf('\n}\n', m)); })();
const size = (sel) => { const m = new RegExp('\\.scout-app-wrapper #otp-near ' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:,[^{]*)?\\{[^}]*font-size:([\\d.]+)px').exec(block); return m ? Number(m[1]) : null; };

test('NEAR ME on a phone: copy about 16px, a shop name 18px, nothing under 13px, inputs 16px', () => {
  assert.ok(block.length > 200, 'the phone block is there');
  assert.equal(size('.nearp'), 16);
  assert.equal(size('.nr-n'), 18);
  assert.equal(size('.nr-t'), 15);
  assert.equal(size('.nr-flockt'), 16);
  assert.equal(size('input'), 16, 'an iPhone zooms in on a tap below 16px');
  for (const m of block.matchAll(/font-size:([\d.]+)px/g)) assert.ok(Number(m[1]) >= 13, 'at least 13px: ' + m[0]);
  for (const line of block.split('\n').filter((l) => /\{/.test(l) && !/^@media/.test(l))) assert.match(line, /^\s*(\/\*.*|\.scout-app-wrapper #otp-near [^{]*\{)/, 'scoped to NEAR ME: ' + line.trim().slice(0, 80));
});

test('a shop restacks on a phone: the side line under the words, the buttons a row under the card', () => {
  assert.match(block, /#otp-near \.nr-row\{flex-wrap:wrap/);
  assert.match(block, /#otp-near \.nr-row>\.nr-card\{flex:1 1 100%\}/);
  assert.match(block, /#otp-near \.nr-side\{flex:1 1 100%;flex-direction:row/);
  assert.match(block, /#otp-near \.nr-acts\{flex:1 1 100%;flex-direction:row\}/);
  assert.match(block, /#otp-near \.nr-foot \.b\{font-size:14px/, 'the four footer buttons keep their words inside');
});
