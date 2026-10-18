// Page v6.92, worker v111: the page's main stylesheet goes to Shopify as a link to the worker, so the page body
// (capped at 512 KB, 886 bytes to spare at v6.91) carries 140 KB less. The repo page keeps the CSS inline in
// <style id="prowl-css">; scripts/page-css.mjs swaps it for the link when deploying, and worker/page-css.js (written by
// scripts/build-page-css.mjs) serves the same CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { slimPage, SHOPIFY_MAX_BYTES } from '../../scripts/slim-page.mjs';
import { pageCss, cssHash, cssUrl, externalize, deployBody, waitForCss, jsUrl } from '../../scripts/page-css.mjs';
import { PAGE_JS, PAGE_JS_HASH } from '../../worker/page-js.js';
import { workerModule } from '../../scripts/build-page-css.mjs';
import { PAGE_CSS, PAGE_CSS_HASH } from '../../worker/page-css.js';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const WORKER_MOD = readFileSync(fileURLToPath(new URL('../../worker/page-css.js', import.meta.url)), 'utf8');
const INDEX = readFileSync(fileURLToPath(new URL('../../worker/index.js', import.meta.url)), 'utf8');

test('the page has one main stylesheet, marked, before the app, and the curtain\'s own style stays inline', () => {
  const marked = PAGE.match(/<style id="prowl-css">/g) || [];
  assert.equal(marked.length, 1);
  const at = PAGE.indexOf('<style id="prowl-css">');
  assert.ok(at < PAGE.indexOf('<div class="scout-app-wrapper'), 'before the app, so nothing draws before it loads');
  assert.match(PAGE.slice(at, at + 200), /@import url\('https:\/\/fonts\.googleapis\.com/);
  assert.match(pageCss(PAGE), /\.scout-app-wrapper/);
  assert.ok(pageCss(PAGE).length > 100000, 'the big stylesheet, not a small one');
});

test('the worker serves exactly the page\'s stylesheet (else run node scripts/build-page-css.mjs)', () => {
  assert.equal(WORKER_MOD, workerModule(PAGE), 'worker/page-css.js is out of date: run node scripts/build-page-css.mjs');
  assert.equal(PAGE_CSS, pageCss(PAGE));
  assert.equal(PAGE_CSS_HASH, cssHash(PAGE_CSS));
  assert.match(PAGE_CSS_HASH, /^[0-9a-f]{12}$/);
});

test('what is sent: the stylesheet as a link with its hash, a small safety script, the rest as it was', async () => {
  const slim = slimPage(PAGE), sent = await deployBody(PAGE);
  assert.equal(sent.hash, PAGE_CSS_HASH);
  assert.equal(sent.url, 'https://prowl.thebluecloud.workers.dev/css/prowl.' + PAGE_CSS_HASH + '.css');
  assert.doesNotMatch(sent.body, /<style id="prowl-css">/);
  assert.equal((sent.body.match(/<link rel="stylesheet" id="prowl-css" href="[^"]+">/g) || []).length, 1);
  /* v7.21: the main script goes as a link too (__tests__/page/page-js.test.mjs) */
  const noJs = (h) => h.replace(/<script id="prowl-js" src="[^"]+"><\/script><script>\(function\(\)\{if\(window\.PROWL_JS\)[\s\S]*?<\/script>/, '##').replace(/<script id="prowl-js">[\s\S]*?<\/script>/, '##');
  assert.equal(noJs(sent.body).replace(/<link rel="stylesheet" id="prowl-css"[\s\S]*?<\/script>/, '@@'), noJs(slim).replace(/<style id="prowl-css">[\s\S]*?<\/style>/, '@@'), 'only the stylesheet and main script blocks changed');
  const safety = /<link rel="stylesheet" id="prowl-css"[^>]*><script>([\s\S]*?)<\/script>/.exec(sent.body)[1];
  assert.doesNotThrow(() => new vm.Script(safety));
  assert.doesNotMatch(safety, /\{\{|\{%|\/\*/,'no Liquid opener or comment in it');
  const bytes = Buffer.byteLength(sent.body.trimEnd(), 'utf8');
  assert.ok(bytes < SHOPIFY_MAX_BYTES - 100000, 'at least 100 KB to spare (' + (SHOPIFY_MAX_BYTES - bytes) + ')');
  /* an older page file without the marked stylesheet goes as it is */
  const old = PAGE.replace('<style id="prowl-css">', '<style>');
  assert.deepEqual(await deployBody(old), { body: slimPage(old), hash: null, url: null, css: '', jsHash: null, jsUrl: null, js: '' });
});

test('the page as sent works: no errors, hunts, Flock cards and a like, with the stylesheet a link', async () => {
  const sent = (await deployBody(PAGE)).body, f = liveFetch();
  const p = loadPage({ html: sent, scripts: { [jsUrl(PAGE_JS_HASH)]: PAGE_JS }, fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex', 'fiesta'], lock: [0] }, owlTwigSgwTerms: [] } });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= 1);
  assert.equal(p.$('#prowl-css').tagName, 'LINK');
  assert.equal(p.$('#prowl-css').getAttribute('href'), cssUrl(PAGE_CSS_HASH));
  p.$('#otp-dock .db[data-m="flock"]').click();
  const lk = await waitFor(() => p.$('#otp-flockRow .fl-card .fl-lk'), { timeout: 8000 });
  lk.click();
  await tick(200);
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]').length >= 1);
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('if the link is taken out of the page, the safety script puts it back; if the worker fails once, it asks again', async () => {
  const sent = (await deployBody(PAGE)).body;
  const p = loadPage({ html: sent.replace(/<link rel="stylesheet" id="prowl-css" href="[^"]+">/, ''), storage: { 'prowl.v36': { seen: true } } });
  await tick(30);
  const l = p.$('#prowl-css');
  assert.ok(l && l.tagName === 'LINK', 'added back');
  assert.equal(l.getAttribute('href'), cssUrl(PAGE_CSS_HASH));
  l.dispatchEvent(new p.win.Event('error'));
  l.dispatchEvent(new p.win.Event('error'));
  assert.equal(p.$$('#prowl-css-r').length, 1, 'one retry, not one per error');
  assert.equal(p.$('#prowl-css-r').getAttribute('href'), cssUrl(PAGE_CSS_HASH) + '?r=1');
  await p.close();
});

test('the worker route: its own hash a year in the cache, any other hash never cached, and a header that names it', async () => {
  const src = /^function cssResponse\([\s\S]*?\n\}\n/m.exec(INDEX)[0];
  const cssResponse = new Function('PAGE_CSS', 'PAGE_CSS_HASH', src + 'return cssResponse;')(PAGE_CSS, PAGE_CSS_HASH);
  const own = cssResponse('prowl.' + PAGE_CSS_HASH + '.css', 'GET');
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('Content-Type'), 'text/css; charset=utf-8');
  assert.equal(own.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(own.headers.get('X-Prowl-Css'), PAGE_CSS_HASH);
  assert.equal(await own.text(), PAGE_CSS);
  const other = cssResponse('prowl.000000000000.css', 'GET');
  assert.equal(other.status, 200, 'a page a minute ahead of the worker still gets a stylesheet');
  assert.equal(other.headers.get('Cache-Control'), 'no-store', 'but never cached under the wrong name');
  assert.equal(await other.text(), PAGE_CSS);
  const head = cssResponse('prowl.' + PAGE_CSS_HASH + '.css', 'HEAD');
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('X-Prowl-Css'), PAGE_CSS_HASH);
  assert.equal(cssResponse('prowl.css', 'GET').status, 404);
  assert.equal(cssResponse('../index.js', 'GET').status, 404);
  assert.equal(cssResponse('prowl.' + PAGE_CSS_HASH + '.css', 'POST').status, 405);
  assert.match(INDEX, /if \(url\.pathname\.startsWith\("\/css\/"\)\) return cssResponse\(url\.pathname\.slice\(5\), request\.method\);/);
  assert.match(INDEX, /const WORKER_VERSION = "v(11[1-9]|1[2-9]\d|[2-9]\d\d)";/);
});

test('the deploy waits for the worker to serve the new stylesheet, and gives up without sending when it never does', async () => {
  let n = 0;
  const later = async (u, o) => { n++; assert.equal(o.method, 'HEAD'); return new Response(null, { headers: { 'X-Prowl-Css': n < 3 ? 'aaaaaaaaaaaa' : 'bbbbbbbbbbbb' } }); };
  const logs = [];
  assert.equal(await waitForCss(later, 'bbbbbbbbbbbb', { tries: 5, delayMs: 1, log: (s) => logs.push(s) }), true);
  assert.equal(n, 3);
  assert.match(logs[0], /Waiting for the worker to serve stylesheet bbbbbbbbbbbb \(it has aaaaaaaaaaaa\)/);
  const never = async () => { throw new Error('offline'); };
  assert.equal(await waitForCss(never, 'bbbbbbbbbbbb', { tries: 3, delayMs: 1 }), false);
});
