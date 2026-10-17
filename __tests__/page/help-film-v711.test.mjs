// Page v7.11 (Matt, 2026-10-17: "add the horizontal video here, we need a help section"): the 20-second launch film
// sits at the top of How Prowl works. Nothing loads until it is tapped; it plays from Shopify's CDN and pauses when
// the help closes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

// jsdom has no media playback: record play/pause on the element instead.
function stubMedia(win) {
  const proto = win.HTMLMediaElement.prototype;
  proto.play = function () { this.__playing = true; this.__plays = (this.__plays || 0) + 1; return Promise.resolve(); };
  proto.pause = function () { this.__playing = false; };
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return !this.__playing; } });
}

test('How Prowl works opens with the film first, as a play card that loads nothing yet', async () => {
  const p = loadPage({ storage: {}, beforeLoad: stubMedia });
  await tick(600);
  const ms = p.$('#otp-ms');
  assert.ok(ms.classList.contains('on'), 'opens by itself the first time');
  const film = ms.querySelector('#otp-film');
  assert.ok(film, 'the film is in the help');
  assert.match(film.getAttribute('data-src'), /^https:\/\/cdn\.shopify\.com\/videos\/.+\.mp4$/);
  const app = ms.querySelector('.otp-getapp[data-mode="help"]');
  assert.ok(film.compareDocumentPosition(app) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'film first, then Get the app');
  assert.ok(film.compareDocumentPosition(ms.querySelector('.mi')) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'before step 1');
  assert.equal(film.querySelector('video'), null, 'no video until tapped');
  assert.match(film.textContent, /Watch Prowl in 20 seconds/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a tap swaps the card for the video and plays it; closing the help pauses it', async () => {
  const p = loadPage({ storage: {}, beforeLoad: stubMedia });
  await tick(600);
  p.$('#otp-filmGo').click();
  const v = p.$('#otp-film video');
  assert.ok(v, 'the video is there');
  assert.equal(v.getAttribute('src'), p.$('#otp-film').getAttribute('data-src'));
  assert.ok(v.controls, 'with controls');
  assert.ok(v.hasAttribute('playsinline'), 'plays inline on a phone');
  assert.equal(v.__plays, 1, 'started by the tap');
  assert.equal(p.$('#otp-filmGo'), null, 'the play card is gone');
  p.$('#otp-mok').click();
  await tick(50);
  assert.ok(!p.$('#otp-ms').classList.contains('on'), 'the help closed');
  assert.equal(v.paused, true, 'and the film paused');
  assert.deepEqual(p.errors, []);
  await p.close();
});
