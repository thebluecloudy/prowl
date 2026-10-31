// CI gaps (2026-10-31, Matt's CI/CD prompt): a secret scan on every PR and in `npm run lint`, and an optional Chrome Web
// Store upload in the Extension workflow once its four secrets are set. Every fake credential below is built at run time,
// so no credential-shaped string is ever in the repo for the scanner itself to find.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RULES, scanText, scanFiles } from '../scripts/scan-secrets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/scan-secrets.mjs');
const r = (s, n) => s.repeat(n);
const FAKES = {
  'Google API key': 'const k = "' + 'AI' + 'za' + r('Ab1_', 8) + 'xyz' + '";',
  'Google OAuth client secret': 'secret: GOC' + 'SPX-' + r('aB3', 9),
  'Shopify token': 'tok=' + 'shp' + 'at_' + r('a1', 16),
  'Stripe live key': 'sk' + '_live_' + r('Ab9', 9),
  'Resend API key': 'RESEND=' + 're' + '_Ab12Cd34_' + r('xY9', 7),
  'GitHub token': 'gh' + 'p_' + r('A1b2', 9),
  'Slack token': 'xo' + 'xb-' + r('12345-', 3),
  'AWS access key': 'AK' + 'IA' + r('ABCD', 4),
  'Private key': '-----BEGIN ' + 'RSA PRIVATE' + ' KEY-----',
  'SerpApi key': 'serpapi.com/search.json?api' + '_key=' + r('0f', 32),
  'Cloudflare API token': 'CLOUDFLARE' + '_API_TOKEN=' + r('aB3_x', 8),
  'Bearer token': 'Authorization: Bear' + 'er ' + 'ey' + 'J' + r('a', 12) + '.' + r('b', 12) + '.' + r('c', 12),
};

test('every rule catches its own kind of credential, and names the line, never the value', () => {
  assert.deepEqual(Object.keys(FAKES).sort(), RULES.map((x) => x.kind).sort(), 'a fake for every rule');
  for (const [kind, line] of Object.entries(FAKES)) {
    const hits = scanText('ok line\n' + line + '\n', 'f.txt');
    assert.deepEqual(hits.map((h) => [h.kind, h.line]), [[kind, 2]], kind);
    assert.deepEqual(Object.keys(hits[0]).sort(), ['file', 'kind', 'line'], 'no value in the result');
  }
});

test('names without values, placeholders and Prowl\'s public values pass', () => {
  const ok = [
    'env.GOOGLE_MAPS_KEY', 'Authorization: Bearer " + env.TYPESAFE_API_KEY', 'api_key=" + encodeURIComponent(key)',
    'CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}', 'sk_test_' + r('a', 24), 'AIza-too-short',
    readFileSync(join(ROOT, 'worker/wrangler.toml'), 'utf8'),   /* VAPID public key, EPN campaign ID */
  ];
  for (const t of ok) assert.deepEqual(scanText(t, 'x'), [], t.slice(0, 60));
});

test('the repo as committed scans clean, and the command fails, file and line named, when a secret slips in', () => {
  const clean = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stderr);
  assert.match(clean.stdout, /no secrets found/);
  const dir = mkdtempSync(join(tmpdir(), 'scan-')), f = join(dir, 'leak.js');
  writeFileSync(f, '// fine\nconst stripe = "' + 'sk' + '_live_' + r('Zz9', 9) + '";\n');
  const bad = spawnSync(process.execPath, [SCRIPT, f], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Stripe live key in .*leak\.js:2/);
  assert.doesNotMatch(bad.stderr, /Zz9Zz9/, 'the value is never printed');
  assert.deepEqual(scanFiles([join(dir, 'nope.js')]), [], 'a missing file is skipped');
});

test('lint and the PR build both run the scan', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.lint, /^node scripts\/scan-secrets\.mjs && /);
  assert.match(readFileSync(join(ROOT, '.github/workflows/blank.yml'), 'utf8'), /- name: No secrets in the repo \(scripts\/scan-secrets\.mjs\)\n        run: node scripts\/scan-secrets\.mjs\n/);
});

test('Extension workflow: the Web Store upload runs only with all four secrets, uses the v1.1 API and prints none of them', () => {
  const y = readFileSync(join(ROOT, '.github/workflows/extension.yml'), 'utf8');
  const step = y.slice(y.indexOf('- name: Upload to the Chrome Web Store'));
  assert.ok(step.length > 200 && y.indexOf('- name: Build zip and publish release') < y.indexOf('- name: Upload to the Chrome Web Store'), 'after the GitHub release');
  for (const s of ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_EXTENSION_ID']) {
    assert.match(step, new RegExp(s + ': \\$\\{\\{ secrets\\.' + s + ' \\}\\}'));
    assert.match(step, new RegExp('\\[ -z "\\$' + s + '" \\]'), s + ' gates the upload');
    assert.doesNotMatch(step, new RegExp('echo[^\\n]*\\$' + s + '(?!")'), s + ' is never echoed');
  }
  assert.match(step, /Chrome Web Store secrets not set: upload \$zip by hand/);
  assert.match(step, /exit 0\n          fi/, 'without the secrets the job still passes');
  assert.match(step, /https:\/\/www\.googleapis\.com\/upload\/chromewebstore\/v1\.1\/items\/\$CWS_EXTENSION_ID/);
  assert.match(step, /https:\/\/www\.googleapis\.com\/chromewebstore\/v1\.1\/items\/\$CWS_EXTENSION_ID\/publish/);
  assert.match(step, /echo "::add-mask::\$tok"/, 'the access token is masked');
  assert.doesNotMatch(y, /uses: (?!actions\/checkout@)/, 'no third-party actions');
});
