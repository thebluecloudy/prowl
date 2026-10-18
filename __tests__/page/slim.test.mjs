// The page goes to Shopify without its comments (scripts/slim-page.mjs): Shopify caps a page body at 512 KB and
// page v6.61 with its comments is 535 KB. Comments come out at a real parser's positions, so code, strings, regular
// expressions and templates are untouched, and the slim page must still work in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { slimJs, slimCss, slimPage, SHOPIFY_MAX_BYTES } from '../../scripts/slim-page.mjs';
import { deploy, checkBody } from '../../scripts/deploy-page.mjs';
import { deployBody } from '../../scripts/page-css.mjs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const SLIM = slimPage(PAGE);
const scripts = (html) => [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1] || '', code: m[2] }));

test('JavaScript: comments go; strings, regexes and templates that look like comments stay', () => {
  const src = [
    'var a = "/* not a comment */", b = \'// nor this\';   /* drop-1 */',
    'var re = /\\/*x/g, re2 = /[/*]/;   // drop-2',
    'var t = `// kept ${1 /* drop-3 */ + 1} /* kept */`;',
    '/* drop-4',
    '   drop-5 */',
    'var c = a/**/+b;',
  ].join('\n');
  const out = slimJs(src);
  assert.match(out, /"\/\* not a comment \*\/"/);
  assert.match(out, /'\/\/ nor this'/);
  assert.match(out, /\/\\\/\*x\/g/);
  assert.match(out, /\/\[\/\*\]\//);
  assert.match(out, /`\/\/ kept \$\{1 +\+ 1\} \/\* kept \*\/`/);
  assert.doesNotMatch(out, /drop-\d/);
  assert.match(out, /var c = a \+b;/, 'a comment between tokens becomes a space, never joins them');
  const run = (code) => { const ctx = {}; vm.runInNewContext(code + ';this.r=[a,b,re.source,re2.source,t,c]', ctx); return JSON.stringify(ctx.r); };
  assert.equal(run(out), run(src), 'the same values come out');
});

test('JavaScript: a block comment holding a line break still ends a statement (return, ASI)', () => {
  const src = 'function f(){ return /*\n*/ 1 }\nvar g = 1 /*\n*/ +2;';
  const out = slimJs(src);
  const val = (code) => { const ctx = {}; vm.runInNewContext(code + ';this.r=[f(),g]', ctx); return JSON.stringify(ctx.r); };
  assert.equal(val(out), val(src));
  assert.equal(val(out), '[null,3]');
});

test('JavaScript: a string or template over several lines keeps its lines exactly', () => {
  const src = 'var t = `a  \n\n\n  b`; /* x */\n\n\nvar u = 1;';
  const out = slimJs(src);
  assert.match(out, /`a {2}\n\n\n {2}b`/);
  assert.doesNotMatch(out, /\/\* x/);
});

test('JavaScript that does not parse stops the slimming (and so the deploy)', () => {
  assert.throws(() => slimJs('var = ;'));
});

test('CSS: comments go; strings and url() that hold comment-like text stay', () => {
  const css = '.a{content:"/* keep */"}/* drop */\n.b{background:url(data:image/svg+xml;utf8,<svg/*x*/>)}\n.c{color:red}/* drop\n too */';
  const out = slimCss(css);
  assert.equal(out, '.a{content:"/* keep */"}\n.b{background:url(data:image/svg+xml;utf8,<svg/*x*/>)}\n.c{color:red}');
  assert.throws(() => slimCss('div/* x */p{}'), /between two names/, 'a comment that would join two names stops');
  assert.throws(() => slimCss('.a{content:"open}'), /not closed/);
});

test('the page sent to Shopify fits its 512 KB, with every script parsing and the rest untouched', async () => {
  /* v6.92: what is sent carries the main stylesheet as a link (scripts/page-css.mjs, __tests__/page/page-css.test.mjs) */
  const D = await deployBody(PAGE), SENT = D.body;
  const bytes = Buffer.byteLength(SENT.trimEnd(), 'utf8');
  assert.ok(bytes <= SHOPIFY_MAX_BYTES, 'the page sent is ' + bytes + ' bytes, over ' + SHOPIFY_MAX_BYTES);
  assert.deepEqual(checkBody(SENT.trimEnd(), Buffer.byteLength(D.css + D.js, 'utf8')), [], 'v7.21: with what it links, a whole page');
  assert.ok(checkBody(SENT.trimEnd()).some((e) => /only \d+ bytes/.test(e)), 'without them it is too small to be the page');
  const before = scripts(PAGE), after = scripts(SLIM);
  assert.equal(after.length, before.length);
  after.forEach((s, i) => {
    if (/ld\+json|\ssrc=/.test(s.attrs)) { assert.equal(s.code, before[i].code, 'JSON-LD and src scripts as they are'); return; }
    assert.doesNotThrow(() => new vm.Script(s.code), 'script ' + (i + 1) + ' parses');
  });
  /* the HTML around the scripts and styles is byte for byte the same */
  const shell = (h) => h.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/gi, '<script>').replace(/<style(\s[^>]*)?>[\s\S]*?<\/style>/gi, '<style>');
  assert.equal(shell(SLIM), shell(PAGE));
  /* slimming the slim page changes nothing */
  assert.equal(slimPage(SLIM), SLIM);
});

test('the slim page works: no errors, hunts, Flock cards, a like and the version', async () => {
  const f = liveFetch();
  const p = loadPage({ html: SLIM, fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex', 'fiesta'], lock: [0] }, owlTwigSgwTerms: [] } });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= 1);
  p.$('#otp-dock .db[data-m="flock"]').click();
  const card = await waitFor(() => p.$('#otp-flockRow .fl-card .fl-lk'), { timeout: 8000 });
  card.click();
  await tick(300);
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]').length >= 1, 'the like was kept');
  assert.match(p.doc.body.innerHTML, /v6\.\d+/);
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('deploy sends the slim page, verifies it, and refuses one over 512 KB before asking Shopify', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prowl-deploy-'));
  let live = PAGE, sent = null;
  const calls = [];
  const SENT = await deployBody(PAGE);
  const fetchFn = async (url, o) => {
    calls.push(String(url));
    if (/access_token/.test(url)) return new Response(JSON.stringify({ access_token: 'tok' }));
    if (/\/css\/prowl\./.test(url)) return new Response(null, { headers: { 'X-Prowl-Css': SENT.hash } });   /* the worker has the stylesheet */
    if (/\/js\/prowl\./.test(url)) return new Response(null, { headers: { 'X-Prowl-Js': SENT.jsHash } });   /* v7.21: and the main script */
    const b = JSON.parse(o.body);
    if (/pageUpdate/.test(b.query)) { sent = b.variables.body; live = sent; return new Response(JSON.stringify({ data: { pageUpdate: { page: { id: 'p', updatedAt: 'now' }, userErrors: [] } } })); }
    return new Response(JSON.stringify({ data: { page: { id: 'p', updatedAt: 'before', body: live } } }));
  };
  const file = join(dir, 'prowl.html');
  writeFileSync(file, PAGE);
  const logs = [];
  const r = await deploy({ fetchFn, file, id: 'id', secret: 'secret', force: false, backupDir: join(dir, 'backup'), log: (s) => logs.push(s) });
  assert.equal(r.status, 'updated');
  assert.equal(sent, SENT.body.trimEnd());
  assert.match(sent, /<link rel="stylesheet" id="prowl-css" href="https:\/\/prowl\.thebluecloud\.workers\.dev\/css\/prowl\.[0-9a-f]{12}\.css">/);
  assert.match(logs[0], /sent without comments/);
  /* a page too big even without its comments: refused, and Shopify is never called */
  const big = PAGE.replace('</body>', '') + '<div hidden>' + 'x'.repeat(SHOPIFY_MAX_BYTES) + '</div>';
  writeFileSync(file, big);
  calls.length = 0;
  await assert.rejects(deploy({ fetchFn, file, id: 'id', secret: 'secret', force: false, backupDir: join(dir, 'backup'), log() {} }), /over Shopify's 524288 \(512 KB\)/);
  assert.equal(calls.length, 0);
});

/* Shopify rewrites a list item whose content starts or ends with a tag: <li><b>x</b> y</li> comes back as
   <li>\n<b>x</b> y</li>, and <li>x <span>28</span></li> as <li>x <span>28</span>\n</li>. The deploy then fails its
   live check (page v6.64: the page went out, but did not match the file). So list items in the page body either begin
   with that line break already or with text, and end with text. */
test('no list item that Shopify would rewrite (a tag right after <li> or right before </li>)', () => {
  const shell = SLIM.replace(/<script(\s[^>]*)?>[\s\S]*?<\/script>/gi, '').replace(/<style(\s[^>]*)?>[\s\S]*?<\/style>/gi, '');
  assert.deepEqual(shell.match(/<\/[a-z][a-z0-9]*><\/li>/gi) || [], [], 'a list item ends with a closing tag');
  assert.deepEqual(shell.match(/<li(\s[^>]*)?><[a-z]/gi) || [], [], 'a list item starts with a tag');
});

