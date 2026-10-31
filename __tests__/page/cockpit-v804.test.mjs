// Page v8.04 (Matt: "Can you make a red version like a fighter cockpit theme"). Cockpit is a fifth theme after Uranium:
// Uranium's layout (data-theme=uranium plus data-hud=cockpit, the way Midnight sits on Dark) in red night lighting,
// with faint HUD scan lines. Uranium's own colours became variables (--u-rgb, --u-hi, ...) so Cockpit can swap them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { uVars, resolveU } from '../helpers/uranium.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
function lum(h) {
  const c = [0, 2, 4].map((i) => parseInt(h.slice(1).slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const block = /\[data-theme=uranium\]\[data-hud=cockpit\]\{([^}]*)\}/.exec(PAGE)[1];
const v = (k) => new RegExp(k + ':([^;]+)').exec(block)[1].trim();

test('the theme button cycles Uranium, then Cockpit, then Light; Cockpit is Uranium plus data-hud', async () => {
  const p = loadPage({ storage: { ...DEN, 'prowl.theme': 'uranium' } });
  try {
  await tick(30);
  const h = p.doc.documentElement, btn = p.$('#otp-themeBtn');
  assert.equal(btn.getAttribute('aria-label'), 'Cockpit mode');
  assert.equal(btn.textContent, '✈');
  btn.click();
  assert.equal(h.getAttribute('data-theme'), 'uranium', 'every Uranium rule still applies');
  assert.equal(h.getAttribute('data-hud'), 'cockpit');
  assert.equal(p.win.localStorage.getItem('prowl.theme'), 'cockpit');
  assert.match(PAGE, /var THEME_META_COLOR=\{[^}]*cockpit:'#1f0606'\}/, 'the phone bar colour');
  assert.equal(btn.getAttribute('aria-label'), 'Light mode');
  btn.click();
  assert.equal(h.getAttribute('data-theme'), 'light');
  assert.equal(h.getAttribute('data-hud'), null, 'leaving Cockpit takes the red off');
  assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('a saved Cockpit opens in Cockpit from the first paint', async () => {
  const p = loadPage({ storage: { ...DEN, 'prowl.theme': 'cockpit' } });
  await tick(30);
  const h = p.doc.documentElement;
  assert.deepEqual([h.getAttribute('data-theme'), h.getAttribute('data-hud')], ['uranium', 'cockpit']);
  assert.equal(p.$('#otp-themeBtn').textContent, '☀');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Uranium keeps its green: the variables default to its old colours', () => {
  const u = uVars(PAGE);
  assert.equal(u['--u-rgb'], '57,255,20');
  assert.equal(u['--u-hi'], '#39ff14');
  assert.equal(u['--u-card'], '#0a0a1e');
  assert.ok(!/rgba\(57,255,20,/.test(PAGE.replace(/<script[\s\S]*?<\/script>/g, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'no green left written in the stylesheets');
});

test('Cockpit is red: every Uranium colour has a red value, and the text reads on its black', () => {
  const c = uVars(PAGE, 'cockpit');
  assert.equal(c['--u-rgb'], '255,42,26');
  for (const k of Object.keys(uVars(PAGE))) assert.notEqual(c[k], uVars(PAGE)[k], k + ' is recoloured');
  for (const k of ['--ink', '--i2', '--i3', '--mu', '--mu2', '--ac']) {
    for (const bg of [v('--bg'), v('--cd'), v('--cd3')]) assert.ok(contrast(v(k), bg) >= 4.5, k + ' ' + v(k) + ' on ' + bg + ': ' + contrast(v(k), bg).toFixed(2));
  }
  const R = resolveU(PAGE, 'cockpit');
  const band = /\[data-theme=uranium\] \.scout-app-wrapper\.k2 \.dh\{background:linear-gradient\(180deg,(#[0-9a-f]{6}) 0,(#[0-9a-f]{6}) 100%\)\}/.exec(R);
  const title = /\[data-theme=uranium\] \.scout-app-wrapper\.k2 \.dh h2\{color:(#[0-9a-f]{6})!important\}/.exec(R)[1];
  for (const bg of [band[1], band[2]]) assert.ok(contrast(title, bg) >= 4.5, 'pop-up band title ' + title + ' on ' + bg);
  assert.match(PAGE, /\[data-hud=cockpit\] \.scout-app-wrapper\{background:repeating-linear-gradient\(0deg,rgba\(255,42,26,\.035\) 0 1px,transparent 1px 4px\)/, 'HUD scan lines');
});

test('the help text names all five modes', () => {
  assert.match(PAGE, /Cycles through all five\./);
});

test('v8.05 (worker v177; v8.22: the blood moon photo): a saved Cockpit asks for its own scene at once, not the fireflies', async () => {
  const p = loadPage({ storage: { ...DEN, 'prowl.theme': 'cockpit' } });
  try {
    await tick(20);
    const A = 'https://prowl.thebluecloud.workers.dev/art/';
    assert.match(p.$('.heromark .hm-scene').getAttribute('src'), new RegExp('^' + A + 'bloodmoon-sm\\.webp\\?v=\\d+$'));
    assert.deepEqual(p.$$('.heromark source').map((s) => s.getAttribute('srcset').replace(/\?v=\d+$/, '').slice(A.length)),
      ['bloodmoon.webp', 'bloodmoon-sm.webp', 'bloodmoon.webp'], 'every source: the 1600 px photo over 480 px, the 800 px one on phones');
    assert.match(PAGE, /\[data-theme=uranium\]\[data-hud=cockpit\] \.scout-app-wrapper \.heromark \.hm-mark\{filter:hue-rotate/, 'only the mark is turned red; the scene is red already');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});
