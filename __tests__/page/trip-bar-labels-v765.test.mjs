// Page v7.65: the Road trip bar's pills were spilling their words on a phone (the owner's screenshot).
// Short labels (GOOGLE, APPLE, REBUILD, SHARE), equal-width pills that never wrap or overflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
test('the trip bar uses short labels', () => {
  assert.match(html, /id="otp-nrMaps"[^>]*>GOOGLE<\/a>/);
  assert.match(html, /id="otp-nrHere"[^>]*>REBUILD<\/button>/);
  assert.match(html, /id="otp-nrShare">SHARE<\/button>/);
  assert.match(html, /nrLegsGen\(t,APPLE_WP,nrAppleUrl,'APPLE','APPLE '\)/);
  assert.doesNotMatch(html, />(OPEN IN MAPS|APPLE MAPS|REBUILD FROM HERE)</);
});
test('the trip bar pills share the width and never spill', () => {
  const rule = html.match(/\.scout-app-wrapper \.nr-foot \.b\{flex:1 1 0;[^}]*\}/);
  assert.ok(rule, 'nr-foot pill rule');
  for (const k of ['min-width:0', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis']) assert.ok(rule[0].includes(k), k);
});
