// Page v8.22 (Matt: "fix the mushroom and panther illustration, make it look more professional", then his blood moon
// photo). Cockpit's scene is the photo, cropped to the moon over the treeline, with the panther standing on its floor.
// In both night themes the panther is centred on the scene with a crisp shadow, and the QR square sits in the scene's
// top corner instead of on the tail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const V822 = PAGE.slice(PAGE.indexOf('/* v8.22 (Matt: "fix the mushroom'), PAGE.indexOf('[data-hud=cockpit] .scout-app-wrapper .pmark img{height:84px'));   /* the v8.22 block */
const rule = (sel) => { const i = V822.indexOf('\n' + sel + '{'); assert.ok(i > -1, sel); return V822.slice(i + sel.length + 2, V822.indexOf('}', i)); };

test('Cockpit: the photo fills the strip from its treeline down, darkened at the edges, and the panther stands on its floor', () => {
  assert.match(rule('[data-hud=cockpit] .scout-app-wrapper .heromark .hm-scene'), /object-fit:cover;object-position:50% 40%/);
  assert.match(rule('[data-hud=cockpit] .scout-app-wrapper .heromark'), /position:relative/, 'the edge shade stays inside the strip');
  assert.match(rule('[data-hud=cockpit] .scout-app-wrapper .heromark::after'), /inset:0;[^}]*pointer-events:none;[^}]*box-shadow:inset/);
  assert.match(rule('[data-hud=cockpit] .scout-app-wrapper .pmark'), /align-items:flex-start/);
  assert.match(rule('[data-hud=cockpit] .scout-app-wrapper .pmark img'), /max-height:none;height:104px;margin-top:10px;filter:drop-shadow\(0 3px 2px/);
  assert.match(PAGE, /@media\(max-width:480px\)\{\[data-hud=cockpit\] \.scout-app-wrapper \.heromark \.hm-scene\{object-position:50% 30%\}\[data-hud=cockpit\] \.scout-app-wrapper \.pmark img\{height:84px;margin-top:30px;max-width:none\}\}/);
});

test('both night themes: the panther centred on the scene, a crisp shadow, and the QR square in the top corner', () => {
  assert.match(rule('[data-theme=uranium] .scout-app-wrapper .pmark'), /max-width:560px;margin-left:auto;margin-right:auto/);
  assert.equal(rule('[data-theme=uranium] .scout-app-wrapper .pm-btn'), 'position:static', 'the square places itself on the scene, not the picture');
  assert.match(rule('[data-theme=uranium] .scout-app-wrapper .pmark img'), /^filter:drop-shadow\(0 3px 2px rgba\(0,0,0,\.85\)\) drop-shadow\(0 0 8px/);
  assert.match(rule('[data-theme=uranium] .scout-app-wrapper .pm-qr'), /^top:8px;right:8px;bottom:auto;width:26px;height:26px;/);
});

test('the QR square is still inside the panther button, so a tap still shows the QR code', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.theme': 'cockpit' } });
  try {
    await tick(20);
    const btn = p.$('#otp-panQr');
    assert.ok(btn.querySelector('.pm-qr'), 'the square is in the button');
    assert.equal(btn.getAttribute('aria-label'), 'Show the Prowl QR code');
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the page says v8.22 or later', () => {
  const m = /var PROWL_VERSION='v(\d+)\.(\d+)';/.exec(PAGE);
  assert.ok(m && Number(m[1]) * 100 + Number(m[2]) >= 822);
});
