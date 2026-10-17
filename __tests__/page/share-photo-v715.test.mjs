// Page v7.15 (Matt, 2026-10-17: share a picture into Prowl on Android, like the Chrome extension). The installed app
// registers the Prowl service worker for /pages/prowl-app; ?shared=1 opens Photo check with the kept photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const APP = 'https://www.owlandtwigvintage.com/pages/prowl-app';

function phone(win, { blob, ios } = {}) {
  const reg = [], deleted = [];
  if (ios) Object.defineProperty(win.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', configurable: true });
  Object.defineProperty(win.navigator, 'serviceWorker', { value: { register: (u, o) => { reg.push([u, o && o.scope]); return Promise.resolve({}); }, getRegistration: () => Promise.resolve(null) }, configurable: true });
  win.caches = { open: () => Promise.resolve({ match: () => Promise.resolve(blob ? { blob: () => Promise.resolve(blob) } : undefined), delete: (k) => { deleted.push(k); return Promise.resolve(true); } }) };
  return { reg, deleted };
}

test('a shared photo opens Photo check and runs it', async () => {
  let ph;
  const p = loadPage({ url: APP + '?shared=1', beforeLoad: (w) => { ph = phone(w, { blob: new w.Blob([new Uint8Array([9, 9])], { type: 'image/jpeg' }) }); } });
  let got = null;
  p.win.prowlPhotoFile = (b) => { got = b; };
  await tick(600);
  assert.ok(p.$('#otp-photo').classList.contains('on'), 'Photo check is open');
  assert.ok(got && got.size === 2, 'the shared photo is handed to the photo check');
  assert.deepEqual(ph.deleted, ['/__prowl-share'], 'used once, then removed from the phone');
  assert.equal(p.win.location.search, '', 'the address is cleaned up');
  assert.deepEqual(ph.reg, [['/apps/prowl/sw.js', '/pages/prowl-app']]);
  await p.close();
});

test('a failed share says so and does not open Photo check', async () => {
  const p = loadPage({ url: APP + '?shared=0', beforeLoad: (w) => phone(w) });
  await tick(500);
  assert.ok(!p.$('#otp-photo').classList.contains('on'));
  assert.match(p.$('#otp-toast').textContent, /could not be opened/);
  await p.close();
});

test('no share registration on iPhone or on the landing page', async () => {
  let a, b;
  const p1 = loadPage({ url: APP, beforeLoad: (w) => { a = phone(w, { ios: true }); } });
  const p2 = loadPage({ beforeLoad: (w) => { b = phone(w); } });
  await tick(300);
  assert.deepEqual(a.reg.filter((r) => r[1] === '/pages/prowl-app'), []);
  assert.deepEqual(b.reg.filter((r) => r[1] === '/pages/prowl-app'), []);
  await p1.close(); await p2.close();
});

test('prowlPhotoFile feeds the photo check like a picked file', async () => {
  const p = loadPage({ url: APP });
  await tick(100);
  assert.equal(typeof p.win.prowlPhotoFile, 'function');
  await p.close();
});
