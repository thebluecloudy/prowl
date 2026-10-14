// Page v7.00: Back clears search results, and in the installed app the home screen asks for a second Back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const APP = 'https://www.owlandtwigvintage.com/pages/prowl-app';
const setup = (url) => loadPage({ url, fetchImpl: liveFetch().impl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
const back = (p) => Promise.race([
  new Promise((r) => { p.win.addEventListener('popstate', () => setTimeout(r, 30), { once: true }); p.win.history.back(); }),
  tick(3000),
]);
const tap = (p) => p.doc.body.dispatchEvent(new p.win.MouseEvent('pointerdown', { bubbles: true }));
async function search(p, term) {
  await tick(60);
  tap(p);
  p.$('#otp-q').value = term;
  p.$('#otp-sa').click();
  await tick(60);
}

test('Back closes search results and lands on the home screen', async () => {
  const p = setup();
  await search(p, 'haeger panther');
  assert.equal(p.$('#otp-res').hidden, false, 'results are showing');
  await back(p);
  await tick(30);
  assert.equal(p.$('#otp-res').hidden, true, 'Back cleared the results');
  await p.close();
});

test('installed app: the first Back on the home screen shows the toast, it does not leave', async () => {
  const p = setup(APP);
  await tick(60);
  const start = p.win.history.length;
  tap(p);
  assert.equal(p.win.history.length, start + 1, 'a tap adds the guard entry');
  tap(p);
  assert.equal(p.win.history.length, start + 1, 'only one guard');
  await back(p);
  assert.match(p.$('#otp-toast').textContent, /Press Back again to close Prowl/);
  tap(p);
  assert.equal(p.win.history.length, start + 1, 'no new guard right after the toast, so a second Back closes the app');
  await p.close();
});

test('installed app: results first, then the home screen guard', async () => {
  const p = setup(APP);
  await search(p, 'pyrex butterprint');
  await back(p);
  await tick(30);
  assert.equal(p.$('#otp-res').hidden, true);
  assert.doesNotMatch(p.$('#otp-toast').textContent, /Press Back again/, 'closing results is not the exit warning');
  await back(p);
  assert.match(p.$('#otp-toast').textContent, /Press Back again to close Prowl/);
  await p.close();
});

test('in a browser tab Back is left alone at the home screen', async () => {
  const p = setup();
  await tick(60);
  const start = p.win.history.length;
  tap(p);
  assert.equal(p.win.history.length, start, 'no guard entry outside the app');
  await p.close();
});
