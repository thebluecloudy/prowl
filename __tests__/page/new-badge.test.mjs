// Page v7.01: the "N new" badge keeps its shape beside a long hunt name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
test('the new badge never shrinks or wraps inside a chip', () => {
  const rules = [...PAGE.matchAll(/\.scout-app-wrapper \.sgw-new\{([^}]*)\}/g)].map((m) => m[1]).join(';');
  assert.match(rules, /flex:none/);
  assert.match(rules, /white-space:nowrap/);
});
