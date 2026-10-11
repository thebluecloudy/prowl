// Page v6.82: on a phone the dark (uranium) theme's mushroom chip pushed Help off the header bar; the light theme has no
// chip and fit. Measured in Chromium at 360-430px wide with the App button showing: Help ran 11-101px past the bar's
// edge in uranium (and up to 49px in light at 390px); with this rule it ends 12px inside in both. jsdom has no layout, so
// this checks the rule that does it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('on phones the dark theme hides the header mushroom chip and the bar tightens, so Help stays on screen', () => {
  const rule = /@media\(max-width:479px\)\{\[data-theme=uranium\] \.scout-app-wrapper \.markwrap\{display:none\}([^\n]*)\}/.exec(PAGE);
  assert.ok(rule, 'the phone rule hides .markwrap in the uranium theme');
  assert.match(rule[1], /\.scout-app-wrapper \.bar\{gap:6px;padding-left:12px;padding-right:12px\}/);
  assert.match(rule[1], /\.scout-app-wrapper \.bar-actions \.gh\{min-width:0;padding-left:9px;padding-right:9px\}/);
  assert.match(PAGE, /<a class="homedots" href="\/"/, 'the ... link home stays');
});
