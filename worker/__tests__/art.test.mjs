// Worker v97: GET /art/<name> serves the page's drawings (worker/art.js), so they cost the Shopify page (capped at
// 512 KB) nothing. fireflies.svg is Uranium mode's hero, the owner's drawing exactly; fireflies-still.svg its first frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ART, stillSvg, artResponse } from '../art.js';
import { routeKey } from '../metrics.js';

const read = (f) => readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8');
const INDEX = read('index.js');

test('the fireflies scene is the drawing exactly as given; the still is its first frame, with nothing left to animate', () => {
  const given = read('art/prowl-hero-fireflies.svg').replace(/\n$/, '');
  assert.equal(ART['fireflies.svg'], given);
  const still = ART['fireflies-still.svg'];
  assert.equal(still, stillSvg(given));
  assert.doesNotMatch(still, /<animate/, 'nothing moves');
  /* each firefly where it starts and as bright as it starts; the bloom as it begins */
  const moves = [...given.matchAll(/<animateTransform [^>]*values="([-\d.]+) ([-\d.]+);/g)].map((m) => `translate(${m[1]} ${m[2]})`);
  const fades = [...given.matchAll(/<animate attributeName="opacity" [^>]*values="([\d.]+);/g)].map((m) => m[1]);
  assert.equal(moves.length, 16);
  assert.equal(fades.length, 17);
  for (const t of moves) assert.ok(still.includes(`<g transform="${t}">`), t);
  const ops = [...still.matchAll(/<g opacity="([\d.]+)">/g)].map((m) => m[1]);
  assert.deepEqual(ops, fades);
  /* and otherwise the same drawing: every shape still there */
  const shapes = (s) => (s.match(/<(circle|path|rect|ellipse)\b/g) || []).length;
  assert.equal(shapes(still), shapes(given));
  for (const svg of [given, still]) assert.doesNotMatch(svg, /<script|on[a-z]+=|xlink:href|<foreignObject|<image/i, 'nothing that runs or fetches');
});

test('v177: the glowworm cave (Cockpit) is its file exactly; its still has nothing left to animate and every shape', () => {
  const given = read('art/prowl-hero-glowworms.svg').replace(/\n$/, '');
  assert.equal(ART['glowworms.svg'], given);
  const still = ART['glowworms-still.svg'];
  assert.equal(still, stillSvg(given));
  assert.doesNotMatch(still, /<animate/, 'nothing moves on a phone');
  const shapes = (x) => (x.match(/<(circle|path|rect|ellipse|line)\b/g) || []).length;
  assert.equal(shapes(still), shapes(given));
  assert.match(given, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 300 120">/, 'the same box as the fireflies');
  assert.ok(!/#39ff14|57,255,20/i.test(given), 'red, not Uranium green');
  for (const svg of [given, still]) assert.doesNotMatch(svg, /<script|on[a-z]+=|xlink:href|<foreignObject|<image/i, 'nothing that runs or fetches');
  assert.ok(given.length < 40000, 'small: ' + given.length);
  assert.equal(artResponse('glowworms.svg', 'GET').status, 200);
  assert.equal(artResponse('glowworms-still.svg', 'GET').status, 200);
});

test('GET answers the drawing as an image with a year-long immutable cache; HEAD without a body; others 405; unknown 404', async () => {
  assert.equal(artResponse('fireflies-still.svg', 'GET').status, 200);
  const r = artResponse('fireflies.svg', 'GET');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin', 'the Shopify page may show it');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(await r.text(), ART['fireflies.svg']);
  const h = artResponse('fireflies.svg', 'HEAD');
  assert.equal(h.status, 200);
  assert.equal(await h.text(), '');
  for (const m of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal(artResponse('fireflies.svg', m).status, 405, m);
  for (const n of ['', 'nope.svg', '../index.js', 'constructor', '__proto__', 'toString', 'FIREFLIES.SVG']) {
    const x = artResponse(n, 'GET');
    assert.equal(x.status, 404, JSON.stringify(n));
    assert.equal(await x.text(), 'not found');
  }
});

test('the route answers /art/ before anything else, and its hits are counted as "art"', () => {
  const body = /async function handleFetch\(request, env, ctx\) \{([\s\S]*?)\n\s*\/\* v78: the owner's admin area/.exec(INDEX)[1];
  const art = body.indexOf('if (url.pathname.startsWith("/art/")) return artResponse(url.pathname.slice(5), request.method);');
  assert.ok(art > -1, 'the route');
  assert.ok(art < body.indexOf('affLoad(env)'), 'before the KV read');
  assert.ok(art < body.indexOf('const origin'), 'before any origin rule');
  assert.match(INDEX, /^import \{ artResponse \} from "\.\/art\.js";/m);
  assert.equal(routeKey('/art/fireflies.svg'), 'art');
  assert.equal(routeKey('/artful'), 'other');
});
