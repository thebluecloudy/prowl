// scripts/ci-tests.mjs: which tests a pull request's CI run needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTests } from '../scripts/ci-tests.mjs';

const TESTS = {
  '__tests__/status-doc.test.mjs': "read('docs/STATUS.md')",
  '__tests__/extension/amazon.test.mjs': "await import('../../extension/service-worker.js')",
  '__tests__/page/plain.test.mjs': "loadPage(); // asks the worker for listings",
  '__tests__/page/reads-worker.test.mjs': "readFileSync(new URL('../../worker/index.js', import.meta.url))",
  '__tests__/page/lists-worker.test.mjs': "readdirSync(join(ROOT, 'worker'))",
  'worker/__tests__/trip.test.mjs': "import { trip } from '../index.js'",
};
const LIGHT_SET = [
  '__tests__/extension/amazon.test.mjs',
  '__tests__/page/lists-worker.test.mjs',
  '__tests__/page/reads-worker.test.mjs',
  '__tests__/status-doc.test.mjs',
  'worker/__tests__/trip.test.mjs',
];

test('a worker-only change skips the page tests that never read the worker', () => {
  assert.deepEqual(pickTests(['worker/index.js', 'worker/__tests__/trip.test.mjs'], TESTS), LIGHT_SET);
});

test('docs, extension and .md files anywhere are light too', () => {
  assert.deepEqual(pickTests(['docs/STATUS.md', 'extension/manifest.json', 'page/README.md', 'README.md'], TESTS), LIGHT_SET);
});

test('any page, test, script or workflow change runs the whole suite', () => {
  for (const f of ['page/prowl.html', '__tests__/page/plain.test.mjs', 'scripts/slim-page.mjs', 'package.json', '.github/workflows/blank.yml', 'src/x.js']) {
    assert.equal(pickTests(['worker/index.js', f], TESTS), null, f);
  }
});

test('no list of changes runs the whole suite', () => {
  assert.equal(pickTests([], TESTS), null);
});
