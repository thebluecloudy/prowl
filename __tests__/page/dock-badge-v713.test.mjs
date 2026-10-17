// Page v7.13 (Matt, 2026-10-17: the Flock count "is blocking the cool bird icon"): the dock's number badges sit up and
// to the right of the 22px icon, starting past its edge (50% + 11px), instead of on top of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('the dock badge starts past the icon', () => {
  const m = /\.scout-app-wrapper \.db \.bd\{position:absolute;top:(\d+)px;left:calc\(50% \+ (\d+)px\)/.exec(PAGE);
  assert.ok(m, 'the badge rule');
  const icon = /\.scout-app-wrapper \.db svg\{width:(\d+)px/.exec(PAGE);
  assert.ok(Number(m[2]) > Number(icon[1]) / 2, 'left of the badge is past the right edge of the icon');
  assert.ok(Number(m[1]) <= 6, 'up at the top of the button');
});
