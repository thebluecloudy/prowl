// Runs the unit tests CI needs for one pull request. The page tests (jsdom, about 4 minutes of a 5-minute CI run)
// only matter when the page side changed; the worker tests take a second. So when every changed file is under
// worker/, docs/, extension/ or is a .md file, this runs the worker and extension tests, docs/STATUS.md's check and
// the page tests that read the worker's files; anything else, or no list of changes, runs the whole suite (npm test).
//   node scripts/ci-tests.mjs <git range>   e.g. HEAD^1 HEAD on a pull request's merge commit
//   node scripts/ci-tests.mjs               the whole suite
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIGHT = [/^worker\//, /^docs\//, /^extension\//, /\.md$/];
const READS_WORKER = /worker\/|['"]worker['"]/;   // '../../worker/index.js', join(ROOT, 'worker')
const ALL = ['__tests__/**/*.test.mjs', 'worker/__tests__/*.test.mjs'];   // as package.json's npm test

// changed: repo-relative paths; tests: { path: source } for every test file under __tests__ and worker/__tests__.
// Answers the files to run, or null for the whole suite.
export function pickTests(changed, tests) {
  if (!changed.length || changed.some((f) => !LIGHT.some((re) => re.test(f)))) return null;
  return Object.keys(tests).filter((p) =>
    p.startsWith('worker/__tests__/') || p.startsWith('__tests__/extension/') ||
    p === '__tests__/status-doc.test.mjs' || READS_WORKER.test(tests[p])).sort();
}

function testFiles(dir) {
  return readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f).split('\\').join('/'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const range = process.argv.slice(2);
  const changed = range.length ? execFileSync('git', ['diff', '--name-only', ...range], { encoding: 'utf8' }).split('\n').filter(Boolean) : [];
  const tests = {};
  for (const p of [...testFiles('__tests__'), ...testFiles('worker/__tests__')]) tests[p] = readFileSync(p, 'utf8');
  const picked = pickTests(changed, tests);
  console.log(picked ? `Only worker, docs or extension files changed: ${picked.length} of ${Object.keys(tests).length} test files.` : 'Running the whole suite.');
  const r = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...(picked || ALL)], { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}
