// Page v7.09: on the store page the theme's pinned header drew its menu over the Flock cards (Matt's screenshot,
// 2026-10-17). Flock now starts under whatever is pinned at the top of the screen that is not Flock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const HUNTS = { 'prowl.v36': { seen: true, hunts: ['fiesta'], lock: [0], h21: 1, h36: 1, h42: 1, h68: 1 } };

function withHeader(win, bottom) {
  const hd = win.document.createElement('header');
  hd.style.position = 'sticky';
  hd.innerHTML = '<nav><a href="/collections/all">Shop</a></nav>';
  win.document.body.insertBefore(hd, win.document.body.firstChild);
  hd.getBoundingClientRect = () => ({ top: 0, bottom, left: 0, right: 1200, width: 1200, height: bottom });
  win.document.elementFromPoint = () => hd.querySelector('a');
}

test('Flock starts below the store header pinned over it', async () => {
  const f = liveFetch({ perSource: 2 });
  const p = loadPage({ fetchImpl: f.impl, storage: HUNTS });
  await tick(30);
  withHeader(p.win, 72);
  p.$('#otp-flockBtn').click();
  await tick(30);
  assert.equal(p.$('#otp-flock').style.top, '72px');
  p.$('#otp-dock .db[data-m="prowl"]').click();
  await tick(30);
  assert.equal(p.$('#otp-flock').style.top, '', 'cleared when Flock closes');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no header on top (the bare app page): Flock keeps the top of the screen', async () => {
  const f = liveFetch({ perSource: 2 });
  const p = loadPage({ fetchImpl: f.impl, storage: HUNTS });
  await tick(30);
  p.win.document.elementFromPoint = () => p.$('#otp-flock .flock-head') || p.$('#otp-flock');
  p.$('#otp-flockBtn').click();
  await tick(30);
  assert.equal(p.$('#otp-flock').style.top, '');
  await p.close();
});

test('a header taller than half the screen is not treated as one', async () => {
  const f = liveFetch({ perSource: 2 });
  const p = loadPage({ fetchImpl: f.impl, storage: HUNTS });
  await tick(30);
  withHeader(p.win, p.win.innerHeight);
  p.$('#otp-flockBtn').click();
  await tick(30);
  assert.equal(p.$('#otp-flock').style.top, '');
  await p.close();
});
