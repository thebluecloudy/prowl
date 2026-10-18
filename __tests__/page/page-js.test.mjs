// Page v7.21, worker v124 (Matt: "why is there a limit??"): the page's main script goes to Shopify as a link to the
// worker, the way the stylesheet has since v6.92, so the page body (capped at 512 KB, 30 bytes over our own 100 KB
// margin at v7.20) carries about 310 KB less. The repo page keeps the script inline in <script id="prowl-js">;
// scripts/page-css.mjs swaps it for <script src> when deploying, and worker/page-js.js (written by
// scripts/build-page-css.mjs) serves the same script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { slimPage, SHOPIFY_MAX_BYTES } from '../../scripts/slim-page.mjs';
import { pageJs, jsUrl, JS_MARK, deployBody, waitForCss, cssHash } from '../../scripts/page-css.mjs';
import { workerJsModule } from '../../scripts/build-page-css.mjs';
import { PAGE_JS, PAGE_JS_HASH } from '../../worker/page-js.js';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const WORKER_MOD = readFileSync(fileURLToPath(new URL('../../worker/page-js.js', import.meta.url)), 'utf8');
const INDEX = readFileSync(fileURLToPath(new URL('../../worker/index.js', import.meta.url)), 'utf8');
const URL_JS = jsUrl(PAGE_JS_HASH);
const STORE = { 'prowl.v36': { seen: true, hunts: ['pyrex', 'fiesta'], lock: [0] }, owlTwigSgwTerms: [] };

test('the page has one main script, marked, and it is the app', () => {
  assert.equal((PAGE.match(/<script id="prowl-js">/g) || []).length, 1);
  assert.match(pageJs(PAGE), /var PROWL_VERSION='v\d+\.\d+';/);
  assert.ok(pageJs(PAGE).length > 200000, 'the big script, not a small one');
  assert.ok(pageJs(PAGE).startsWith(JS_MARK), 'it says it ran');
});

test('the worker serves exactly the page\'s main script (else run node scripts/build-page-css.mjs)', () => {
  assert.equal(WORKER_MOD, workerJsModule(PAGE), 'worker/page-js.js is out of date: run node scripts/build-page-css.mjs');
  assert.equal(PAGE_JS, pageJs(PAGE));
  assert.equal(PAGE_JS_HASH, cssHash(PAGE_JS));
  assert.equal(pageJs(slimPage(PAGE)), PAGE_JS, 'the deploy reads the slim page and gets the same script');
  assert.doesNotThrow(() => new vm.Script(PAGE_JS));
});

test('what is sent: the main script as a src with its hash, then a small fallback, and a body far under 512 KB', async () => {
  const sent = await deployBody(PAGE);
  assert.equal(sent.jsHash, PAGE_JS_HASH);
  assert.equal(sent.jsUrl, 'https://prowl.thebluecloud.workers.dev/js/prowl.' + PAGE_JS_HASH + '.js');
  assert.equal(sent.js, PAGE_JS);
  assert.doesNotMatch(sent.body, /<script id="prowl-js">/);
  assert.equal((sent.body.match(/<script id="prowl-js" src="[^"]+"><\/script>/g) || []).length, 1);
  const fallback = /<script id="prowl-js" src="[^"]+"><\/script><script>([\s\S]*?)<\/script>/.exec(sent.body)[1];
  assert.doesNotThrow(() => new vm.Script(fallback));
  assert.doesNotMatch(fallback, /\{\{|\{%|\/\*/, 'no Liquid opener or comment in it');
  assert.ok(sent.body.indexOf('<script id="prowl-js" src=') < sent.body.indexOf('v6.69 Prowl magic') || !/v6\.69 Prowl magic/.test(sent.body), 'in the main script\'s place');
  const bytes = Buffer.byteLength(sent.body.trimEnd(), 'utf8');
  assert.ok(bytes < SHOPIFY_MAX_BYTES - 300000, 'at least 300 KB to spare now (' + (SHOPIFY_MAX_BYTES - bytes) + ')');
});

test('the page as sent works with its script from the worker: no errors, hunts, Flock cards and a like', async () => {
  const sent = (await deployBody(PAGE)).body, f = liveFetch();
  const p = loadPage({ html: sent, scripts: { [URL_JS]: PAGE_JS }, fetchImpl: f.impl, storage: STORE });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= 1);
  assert.equal(p.win.PROWL_JS, 1);
  assert.equal(p.$('#prowl-js-r'), null, 'no second try when the first one ran');
  assert.equal(p.$('#prowl-js-err'), null);
  p.$('#otp-dock .db[data-m="flock"]').click();
  const lk = await waitFor(() => p.$('#otp-flockRow .fl-card .fl-lk'), { timeout: 8000 });
  lk.click();
  await tick(200);
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]').length >= 1);
  assert.equal(p.errors.filter((e) => !/offline|Could not load script/i.test(String(e.message || e))).length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('if the worker does not answer, the page asks once more and runs', async () => {
  const sent = (await deployBody(PAGE)).body, f = liveFetch();
  const p = loadPage({ html: sent, scripts: { [URL_JS]: null, [URL_JS + '?r=1']: PAGE_JS }, fetchImpl: f.impl, storage: STORE });
  await waitFor(() => p.$('#prowl-js-r'));
  await waitFor(() => p.win.PROWL_JS === 1, { timeout: 8000 });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= 1, { timeout: 8000 });
  assert.equal(p.$('#prowl-js-err'), null);
  await p.close();
});

test('if it still cannot load, the page says so with a way to try again', async () => {
  const sent = (await deployBody(PAGE)).body;
  const p = loadPage({ html: sent, scripts: { [URL_JS]: null, [URL_JS + '?r=1']: null }, storage: STORE });
  const err = await waitFor(() => p.$('#prowl-js-err'), { timeout: 8000 });
  assert.equal(err.getAttribute('role'), 'alert');
  assert.match(err.textContent, /Prowl could not load\. Tap to try again/);
  assert.equal(err.nextElementSibling && err.nextElementSibling.classList.contains('scout-app-wrapper'), true, 'right above the app');
  assert.equal(p.$$('#prowl-js-err').length, 1);
  await p.close();
});

test('the worker route: its own hash a year in the cache, any other hash never cached, and a header that names it', async () => {
  const src = /^function jsResponse\([\s\S]*?\n\}\n/m.exec(INDEX)[0];
  const jsResponse = new Function('PAGE_JS', 'PAGE_JS_HASH', src + 'return jsResponse;')(PAGE_JS, PAGE_JS_HASH);
  const own = jsResponse('prowl.' + PAGE_JS_HASH + '.js', 'GET');
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  assert.equal(own.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(own.headers.get('X-Prowl-Js'), PAGE_JS_HASH);
  assert.equal(own.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(await own.text(), PAGE_JS);
  const other = jsResponse('prowl.000000000000.js', 'GET');
  assert.equal(other.status, 200, 'a page a minute ahead of the worker still runs');
  assert.equal(other.headers.get('Cache-Control'), 'no-store', 'but nothing is cached under the wrong name');
  const head = jsResponse('prowl.' + PAGE_JS_HASH + '.js', 'HEAD');
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('X-Prowl-Js'), PAGE_JS_HASH);
  assert.equal(jsResponse('prowl.js', 'GET').status, 404);
  assert.equal(jsResponse('../index.js', 'GET').status, 404);
  assert.equal(jsResponse('prowl.' + PAGE_JS_HASH + '.js', 'POST').status, 405);
  assert.match(INDEX, /if \(url\.pathname\.startsWith\("\/js\/"\)\) return jsResponse\(url\.pathname\.slice\(4\), request\.method\);/);
  assert.match(INDEX, /import \{ PAGE_JS, PAGE_JS_HASH \} from "\.\/page-js\.js";/);
});

test('the deploy waits for the worker to serve the new main script, and gives up when it never does', async () => {
  let n = 0;
  const later = async (u, o) => { n++; assert.equal(o.method, 'HEAD'); assert.match(String(u), /\/js\/prowl\.bbbbbbbbbbbb\.js$/); return new Response(null, { headers: { 'X-Prowl-Js': n < 2 ? 'aaaaaaaaaaaa' : 'bbbbbbbbbbbb' } }); };
  const logs = [];
  assert.equal(await waitForCss(later, 'bbbbbbbbbbbb', { tries: 4, delayMs: 1, log: (s) => logs.push(s), js: true }), true);
  assert.match(logs[0], /Waiting for the worker to serve main script bbbbbbbbbbbb \(it has aaaaaaaaaaaa\)/);
  assert.equal(await waitForCss(async () => { throw new Error('offline'); }, 'bbbbbbbbbbbb', { tries: 2, delayMs: 1, js: true }), false);
});
