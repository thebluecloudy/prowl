// Page v7.33 (the owner, on an Etsy Rookwood vase: "Best pick is overlapping price check ... check font for price
// check it seems different and too small to read on phone"): the popup's Price check box is never tagged Best pick,
// and its text reads at the popup's 16px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('the Best pick tag skips the popup price check box, in the script and in the stylesheet', () => {
  assert.match(html, /function pickMark\(root\)\{[\s\S]*?!els\[i\]\.classList\.contains\('pp-fp'\)\)els\[i\]\.classList\.add\('is-pick'\)/);
  const rules = html.match(/\.sgw-cell\.is-pick[^{]*\{/g) || [];
  assert.ok(rules.length >= 2);
  for (const r of rules.filter((x) => x.indexOf('is-gone') < 0)) assert.match(r, /:not\(\.pp-fp\)/, r);
});

test('the popup price check reads at 16px in the popup font, its notes at 14px', () => {
  assert.match(html, /\.scout-app-wrapper \.pp-fp \.sgw-fpr\{padding:12px 14px;font-family:inherit;font-size:16px;line-height:1\.5\}/);
  assert.match(html, /\.scout-app-wrapper \.pp-fp \.sgw-fpn,\.scout-app-wrapper \.pp-fp \.sgw-fpl\{margin-top:8px;font-size:14px\}/);
  /* after the card-size rules, so they win */
  assert.ok(html.indexOf('.pp-fp .sgw-fpr{') > html.indexOf('.scout-app-wrapper .sgw-fpr{margin:0'));
});
