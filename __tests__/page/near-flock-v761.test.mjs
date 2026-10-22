// Page v7.61 (the owner: "there is a lag and small text saying finding. I need an animated butterfly or flock of birds
// while it is searching"). While NEAR ME waits, a flock of the page's swallows crosses a card and the line under it
// moves through what is being done; the results replace it. Still birds when the phone asks for less motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const J = (j) => ({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const PL = [{ id: 'A1', name: 'Maumee Antique Mall', town: 'Maumee, OH', why: 'Antique mall', rating: 4.6, n: 1776, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=x', lat: 41.58, lng: -83.66, hours: null, near: 0.1 }];
function setup(gate) {
  return (u) => { const url = String(u); if (/\/near\?/.test(url)) return new Promise((r) => { gate.near = () => r(J({ town: 'Maumee, OH', places: PL })); }); if (/\/trip\?/.test(url)) return new Promise(() => {}); if (/\/trips$/.test(url)) return Promise.resolve(J({ trips: [] })); return Promise.resolve(J({ items: [] })); };
}
const phone = (win) => { win.prowlFlockMs = 40; Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.58, longitude: -83.66 } }), 0) } }); };

test('Around you: a flock of swallows while it looks, the line moves on, and the shops replace it', async () => {
  const gate = {};
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, fetchImpl: setup(gate), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(10);
  const fl = p.$('#otp-nrLive .nr-flock');
  assert.ok(fl, 'the flock, not a small line of text');
  assert.equal(fl.querySelectorAll('.nr-fb').length, 5, 'five birds');
  assert.equal(fl.querySelector('.nr-fb use').getAttribute('href'), '#otp-swallow', 'the page\'s own swallow');
  assert.equal(fl.querySelector('.nr-sky').getAttribute('aria-hidden'), 'true');
  const line = fl.querySelector('.nr-flockt');
  assert.equal(line.getAttribute('role'), 'status');
  assert.equal(line.textContent, 'Finding where you are…');
  await tick(60);
  assert.equal(p.$('#otp-nrLive .nr-flockt').textContent, 'Looking for antique, vintage and thrift shops nearby…');
  await tick(200);
  assert.equal(p.$('#otp-nrLive .nr-flockt').textContent, 'Checking today’s hours…', 'it stops at the last step');
  gate.near(); await tick(40);
  assert.equal(p.$('#otp-nrLive .nr-flock'), null, 'the shops replace the birds');
  assert.equal(p.$('#otp-nrLive .nr-card .nr-n').textContent, 'Maumee Antique Mall');
  await tick(100);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Road trip: the flock while the drive is mapped, naming where to', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } }, fetchImpl: setup({}), beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(10);
  p.$('#otp-nrT2').click();
  p.$('#otp-nrTo').value = 'Blenko wv';
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(5);
  assert.ok(p.$('#otp-nrOut .nr-flock'));
  assert.equal(p.$('#otp-nrOut .nr-flockt').textContent, 'Finding where you are…');
  await tick(60);
  assert.equal(p.$('#otp-nrOut .nr-flockt').textContent, 'Mapping the drive to Blenko wv…');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the birds fly and flap, and keep still when the phone asks for less motion', () => {
  assert.match(PAGE, /\.scout-app-wrapper \.nr-fb\{[^}]*animation:nrFly /);
  assert.match(PAGE, /\.scout-app-wrapper \.nr-fw\{[^}]*animation:nrFlap /);
  assert.match(PAGE, /@media\(prefers-reduced-motion:reduce\)\{\.scout-app-wrapper \.nr-fb\{animation:none!important;left:var\(--x\)\}\.scout-app-wrapper \.nr-fw\{animation:none!important\}\}/);
});
