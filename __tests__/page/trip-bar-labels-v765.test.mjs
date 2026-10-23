// Page v7.65: the Road trip bar's pills were spilling their words on a phone (the owner's screenshot), so they were
// cut to GOOGLE, APPLE, REBUILD, SHARE. v7.72 made the bar Start in Maps and More, with the rest inside More a row
// each; v7.73 gives them their full sentence-case words there, and the pills still never spill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
test('the trip bar says what each button does, in sentence case', () => {
  assert.match(html, /id="otp-nrStart"[^>]*>Start in Maps<\/a>/);
  assert.match(html, /id="otp-nrFootMore"[^>]*>⋯ More<\/button>/);
  assert.match(html, /id="otp-nrMaps"[^>]*>Google Maps<\/a>/);
  assert.match(html, /id="otp-nrHere"[^>]*>Rebuild from here<\/button>/);
  assert.match(html, /id="otp-nrShare">Share<\/button>/);
  assert.match(html, /nrLegsGen\(t,APPLE_WP,nrAppleUrl,'Apple Maps','Apple Maps '\)/);
  assert.doesNotMatch(html, />(GOOGLE|APPLE|REBUILD|SHARE|OPEN IN MAPS)</);
});
test('the trip bar pills share the width and never spill', () => {
  const rule = html.match(/\.scout-app-wrapper \.nr-foot \.b\{flex:1 1 0;[^}]*\}/);
  assert.ok(rule, 'nr-foot pill rule');
  for (const k of ['min-width:0', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis']) assert.ok(rule[0].includes(k), k);
  assert.match(html, /\.scout-app-wrapper \.nr-footp \.nr-legs\{flex-wrap:wrap\}/, 'three legs wrap rather than squeeze');
});
