// Page v7.02: tapping a favorite hunt chip scrolls to its finds when they are below the fold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

function setup() {
  return loadPage({ fetchImpl: liveFetch().impl, storage: { owlTwigSgwTerms: ['panther', 'pyrex', 'mccoy'], 'prowl.v36': { seen: true, hunts: [] } } });
}
function place(p, top) {
  p.win.innerHeight = 800;
  const b = p.$('#otp-sgw .sgw-body');
  b.getBoundingClientRect = () => ({ top, bottom: top + 400, left: 0, right: 390, width: 390, height: 400 });
  return b;
}
const chip = (p) => p.$('#otp-sgw [data-sgw="pick"]');

test('a chip tap scrolls the finds into view when they sit low on the screen', async () => {
  const p = setup();
  await tick(80);
  assert.ok(chip(p), 'there is a hunt chip');
  let scrolled = 0;
  p.win.Element.prototype.scrollIntoView = function () { if (this.classList.contains('sgw-body')) scrolled++; };
  place(p, 900);
  chip(p).click();
  place(p, 900);
  await tick(120);
  assert.equal(scrolled, 1);
  await p.close();
});

test('no jump when the finds are already on screen (wide layout)', async () => {
  const p = setup();
  await tick(80);
  let scrolled = 0;
  p.win.Element.prototype.scrollIntoView = function () { if (this.classList.contains('sgw-body')) scrolled++; };
  chip(p).click();
  place(p, 120);
  await tick(120);
  assert.equal(scrolled, 0);
  await p.close();
});
