// Page v6.70: Uranium mode's hero, two drawings from the owner. The mushroom-night mark (page/art/) is in the page; the
// fireflies scene comes from the worker (/art/fireflies.svg, worker v97) so it costs the 512 KB page nothing, and only
// once Uranium is on. With motion allowed a wide night box holds the mark and the scene fades in over it; under reduced
// motion, the mark alone; if the scene cannot load, the mark stays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { ART } from '../../worker/art.js';

const read = (f) => readFileSync(fileURLToPath(new URL('../../' + f, import.meta.url)), 'utf8');
const PAGE = read('page/prowl.html');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const scene = (p) => p.$('.scout-app-wrapper .heromark .hm-scene');
const [, BASE, V] = /var HERO_ART='([^']+)',HERO_V='([^']+)';/.exec(PAGE);
const HERO = BASE + 'fireflies.svg' + V, STILL = BASE + 'fireflies-still.svg' + V;

test("the scene's addresses are the worker's art, versioned: animated, and its first frame for phones", () => {
  for (const a of [HERO, STILL]) {
    const u = new URL(a);
    assert.equal(u.origin, 'https://prowl.thebluecloud.workers.dev');
    assert.ok(u.pathname.startsWith('/art/') && Object.hasOwn(ART, u.pathname.slice(5)), 'the worker has ' + u.pathname);
    assert.match(u.search, /^\?v=\d+$/, 'a new drawing is a new address (the worker caches a year)');
  }
  /* v8.22: wide sources too (Cockpit's blood moon has a 1600 px photo for screens over 480 px); Uranium's art is the same everywhere */
  assert.match(PAGE, /<picture><source media="\(hover:none\) and \(min-width:481px\)" data-art="fireflies-still\.svg" data-art-ck="bloodmoon\.webp"><source media="\(hover:none\)" data-art="fireflies-still\.svg" data-art-ck="bloodmoon-sm\.webp"><source media="\(min-width:481px\)" data-art="fireflies\.svg" data-art-ck="bloodmoon\.webp"><img class="hm-scene" alt="" decoding="async" loading="lazy" [^>]*data-art="fireflies\.svg" data-art-ck="bloodmoon-sm\.webp"><\/picture>/,   /* v8.05: Cockpit's own */
    'phones get the still; lazy, so reduced motion (where it is hidden) never fetches it');
});

test('the scene loads only in Uranium: at once when Uranium is saved, or when the theme button reaches it', async () => {
  let p = loadPage({ storage: { ...DEN, 'prowl.theme': 'uranium' } });
  await tick(20);
  assert.equal(scene(p).getAttribute('src'), HERO);
  assert.equal(p.$('.heromark source').getAttribute('srcset'), STILL);
  await p.close();
  p = loadPage({ storage: DEN });
  await tick(20);
  assert.equal(scene(p).getAttribute('src'), null, 'light: nothing fetched');
  assert.equal(p.$('.heromark source').getAttribute('srcset'), null);
  const btn = p.$('#otp-themeBtn');
  btn.click(); btn.click();   /* Blue hour, Midnight */
  assert.equal(scene(p).getAttribute('src'), null, 'nor in the dark themes');
  btn.click();   /* Uranium */
  assert.equal(p.doc.documentElement.getAttribute('data-theme'), 'uranium');
  assert.equal(scene(p).getAttribute('src'), HERO);
  btn.click();   /* v8.05: Cockpit has its own scene (v8.22: the blood moon photo) */
  assert.equal(scene(p).getAttribute('src'), BASE + 'bloodmoon-sm.webp' + V);
  assert.equal(p.$('.heromark source').getAttribute('srcset'), BASE + 'bloodmoon.webp' + V);
  assert.equal(p.$('.heromark').classList.contains('has-scene'), false, 'the mark shows until the red scene arrives');
  btn.click(); btn.click(); btn.click();   /* Light, Blue hour, Midnight */
  assert.equal(scene(p).getAttribute('src'), BASE + 'bloodmoon-sm.webp' + V, 'left as it was outside the two');
  btn.click();   /* Uranium again */
  assert.equal(scene(p).getAttribute('src'), HERO, 'back to the fireflies');
  await p.close();
});

test('loaded, it takes over from the mark; if it cannot load, the mark stays', async () => {
  let p = loadPage({ storage: { ...DEN, 'prowl.theme': 'uranium' } });
  await tick(20);
  const hm = p.$('.heromark');
  assert.equal(hm.classList.contains('has-scene'), false, 'the mark until it arrives');
  scene(p).dispatchEvent(new p.win.Event('load'));
  assert.equal(hm.classList.contains('has-scene'), true);
  await p.close();
  p = loadPage({ storage: { ...DEN, 'prowl.theme': 'uranium' } });
  await tick(20);
  scene(p).dispatchEvent(new p.win.Event('error'));
  assert.equal(p.$('.heromark').classList.contains('has-scene'), false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the mark is the mushroom-night drawing as given', () => {
  const src = /<div class="heromark">\s*<img class="hm-mark" src="data:image\/svg\+xml,([^"]+)"/.exec(PAGE)[1];
  const shape = (svg) => {
    const d = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    assert.equal(d.getElementsByTagName('parsererror').length, 0);
    return [...d.querySelectorAll('*')].map((e) => e.nodeName + ' ' + [...e.attributes].map((a) => a.name + '=' + a.value).sort().join(' '));
  };
  assert.deepEqual(shape(decodeURIComponent(src)), shape(read('page/art/prowl-mushroom-night.svg')));
  assert.doesNotMatch(src, /"/, 'single quotes only, inside the attribute');
});

test('every scene rule is inside prefers-reduced-motion: no-preference; the mark and its hiding of the scene are outside it', () => {
  const css = /\/\* v6\.70: Uranium's hero[\s\S]*?\*\/\n([\s\S]*?)\.scout-app-wrapper h1\{/.exec(PAGE)[1];
  const media = '@media (prefers-reduced-motion:no-preference){';
  const at = css.indexOf(media);
  assert.ok(at > -1);
  const outside = css.slice(0, at), inside = css.slice(at);
  assert.match(outside, /\.heromark \.hm-scene\{display:none\}/, 'no scene unless motion is allowed');
  assert.match(outside, /\.heromark \.hm-mark\{[^}]*width:96px/);
  assert.doesNotMatch(outside, /has-scene|aspect-ratio|opacity/, 'nothing about the scene outside');
  assert.match(inside, /\.heromark\{[^}]*aspect-ratio:5\/2/, 'the box is the scene\'s shape before it arrives, so nothing moves');
  assert.match(inside, /\.heromark \.hm-scene\{[^}]*opacity:0/);
  assert.match(inside, /\.heromark \.hm-mark\{height:min\(96px,\d+%\)/, 'the mark fits a narrow box (Extra large text on a small phone)');
  assert.match(inside, /\.heromark\.has-scene \.hm-scene\{opacity:1\}/);
  assert.doesNotMatch(PAGE, /glowPulse/, 'the old mark\'s pulse is gone with it');
});
