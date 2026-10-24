// Page v7.80: the page script is one ES5 file of some 800 top-level functions. Two with the same name do not fail:
// the later one quietly replaces the earlier everywhere (v7.80's first Next stop was undone by the hours helper nrNext).
// So every top-level function name is used once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('v7.80: no top-level function in the page script is declared twice', () => {
  const page = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  const js = /<script id="prowl-js">([\s\S]*?)<\/script>/.exec(page)[1];
  const names = [...js.matchAll(/^function\s+([\w$]+)\s*\(/gm)].map((m) => m[1]);
  assert.ok(names.length > 500, 'found the functions');
  const seen = new Set(), twice = [];
  for (const n of names) { if (seen.has(n)) twice.push(n); seen.add(n); }
  assert.deepEqual(twice, []);
});
