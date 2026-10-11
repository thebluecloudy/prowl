// docs/STATUS.md is the shared memory between the people and Claude sessions working on Prowl (CLAUDE.md): every PR
// updates it. This keeps its "Live" versions honest: a PR that bumps the page or worker without updating it fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('docs/STATUS.md names the page and worker versions in the code', () => {
  const status = read('docs/STATUS.md');
  const page = /var PROWL_VERSION='(v[\d.]+)'/.exec(read('page/prowl.html'))[1];
  const worker = /const WORKER_VERSION = "(v\d+)"/.exec(read('worker/index.js'))[1];
  const live = status.slice(status.indexOf('## Live'), status.indexOf('## In flight'));
  assert.match(live, new RegExp('\\| Page \\| \\*\\*' + page.replace(/\./g, '\\.') + '\\*\\*'), 'Live page version in docs/STATUS.md');
  assert.match(live, new RegExp('\\| Worker \\| \\*\\*' + worker + '\\*\\*'), 'Live worker version in docs/STATUS.md');
});

test('CLAUDE.md points every session at docs/STATUS.md', () => {
  assert.match(read('CLAUDE.md'), /Update `docs\/STATUS\.md` in every PR/);
});
