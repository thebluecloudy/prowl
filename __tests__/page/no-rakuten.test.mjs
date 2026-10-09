// Rakuten closed the Owl & Twig publisher account on 2026-10-09, and its agreement says to stop using and remove
// its links. Nothing Prowl ships may carry a Rakuten link or the old publisher ID: the page, the worker (alert
// emails, /aff, the admin area) and the Chrome extension. Worker v92, page v6.62, extension 1.6.4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BANNED = /linksynergy|jh1j\/r7|mid=53555|click\.linksynergy/i;
const files = [
  'page/prowl.html',
  ...readdirSync(join(ROOT, 'worker')).filter((f) => f.endsWith('.js')).map((f) => 'worker/' + f),
  ...readdirSync(join(ROOT, 'extension')).filter((f) => /\.(js|html|json)$/.test(f)).map((f) => 'extension/' + f),
];

test('no Rakuten link or publisher ID in the page, the worker or the extension', () => {
  assert.ok(files.length > 10, 'the files are found');
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const m = BANNED.exec(src);
    assert.equal(m, null, f + ' still has "' + (m && m[0]) + '"');
  }
});
