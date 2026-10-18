// Page v7.24: in the dark themes a field of fireflies drifts over the page and moves with the mouse. Never in Light,
// never under reduced motion, off with prowl.fireflies = '0', and it goes when the theme turns light.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
function theme(p, t, dark) {
  const de = p.doc.documentElement;
  de.setAttribute('data-theme', t);
  if (dark) de.setAttribute('data-dark', dark); else de.removeAttribute('data-dark');
}

test('dark themes get a firefly field on body that the script animates', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  theme(p, 'uranium');
  await tick(80);
  const box = p.$('body > .pm-fly');
  assert.ok(box, 'the field is on body');
  assert.equal(box.getAttribute('aria-hidden'), 'true');
  assert.equal(box.getAttribute('data-k'), 'uranium');
  const flies = box.querySelectorAll('i');
  assert.ok(flies.length >= 12 && flies.length <= 36, 'between 12 and 36 fireflies, got ' + flies.length);
  assert.ok(box.querySelector('b'), 'a glow for the cursor');
  assert.match(flies[0].style.transform, /^translate3d\(-?[\d.]+px, ?-?[\d.]+px, ?0(px)?\) scale\([\d.]+\)$/);

  theme(p, 'dark', 'midnight');
  await tick(30);
  assert.equal(p.$$('.pm-fly').length, 1, 'a theme change recolours the same field');
  assert.equal(p.$('.pm-fly').getAttribute('data-k'), 'midnight');

  const ev = new p.win.Event('pointermove');
  Object.assign(ev, { clientX: 100, clientY: 120, pointerType: 'mouse' });
  p.win.dispatchEvent(ev);
  await tick(80);
  assert.equal(p.$('.pm-fly b').style.opacity, '1', 'the glow shows once the mouse moves');

  theme(p, 'light');
  await tick(30);
  assert.equal(p.$$('.pm-fly').length, 0, 'gone in Light');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no field in Light, under reduced motion, or with prowl.fireflies off', async () => {
  let p = loadPage({ storage: DEN });
  await tick(30);
  assert.equal(p.$$('.pm-fly').length, 0, 'Light has none');
  await p.close();

  p = loadPage({ storage: DEN, reducedMotion: true });
  await tick(30);
  theme(p, 'dark');
  await tick(30);
  assert.equal(p.$$('.pm-fly').length, 0, 'reduced motion has none');
  await p.close();

  p = loadPage({ storage: { ...DEN, 'prowl.fireflies': '0' } });
  await tick(30);
  theme(p, 'uranium');
  await tick(30);
  assert.equal(p.$$('.pm-fly').length, 0, 'switched off');
  assert.deepEqual(p.errors, []);
  await p.close();
});
