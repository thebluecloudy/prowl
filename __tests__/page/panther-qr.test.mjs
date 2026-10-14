// Page v6.77: tap the panther at the top of the app to show the QR code. Showing someone Prowl meant scrolling to the
// share strip at the foot of the page to find the QR button, which took too long with a person waiting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const STORE = { 'prowl.v36': { seen: true } };   // past the first-visit Help modal
const sheetOn = (p) => !p.$('#otp-sheet').hidden && p.$('#otp-sheet').classList.contains('on');

async function open(opts = {}) {
  const p = loadPage({ storage: STORE, ...opts });
  await tick(20);
  p.$('#otp-panQr').click();
  await tick(40);   // the sheet slides in on the next frame
  return p;
}

test('the panther is a button that says it shows the QR code, with the little QR square on it', async () => {
  const p = loadPage({ storage: STORE });
  const b = p.$('#otp-pan > #otp-panQr');
  assert.ok(b, 'the button is inside the panther mark');
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.getAttribute('type'), 'button');
  assert.equal(b.getAttribute('aria-label'), 'Show the Prowl QR code');
  assert.ok(b.querySelector('#otp-panImg'), 'the panther image is the face of the button');
  assert.equal(b.querySelector('.pm-qr').getAttribute('aria-hidden'), 'true');
  assert.equal(p.errors.length, 0, p.errors.map(String).join('\n'));
  await p.close();
});

test('tapping the panther opens the sheet with the same QR code as the share strip', async () => {
  const p = await open();
  assert.ok(sheetOn(p));
  assert.equal(p.$('#otp-sheetT').textContent, 'Show someone Prowl');
  const strip = p.$('#otp-qrPanel .qr-box svg path').getAttribute('d');
  const shown = p.$('#otp-sheetB .qr-big .qr-box svg path');
  assert.ok(shown, 'the code is in the sheet');
  assert.equal(shown.getAttribute('d'), strip, 'one code, copied from the share strip');
  assert.ok(p.$('#otp-qrPanel').hidden, 'the share strip panel itself stays as it was');
  await p.close();
});

test('the sheet gives the name to say out loud and the address, without the scheme', async () => {
  const p = await open();
  const name = p.$('#otp-sheetB .qr-name');
  assert.match(name.textContent, /Or search Prowl by Owl & Twig/);
  assert.match(name.textContent, /owlandtwigvintage\.com\/pages\/prowl$/);
  assert.doesNotMatch(name.textContent, /https?:/);
  await p.close();
});

test('Send the link uses the system share sheet where there is one', async () => {
  const shared = [];
  const p = await open({ beforeLoad(win) { win.navigator.share = (d) => { shared.push(d); return Promise.resolve(); }; } });
  p.$('#otp-qrSend').click();
  assert.deepEqual(JSON.parse(JSON.stringify(shared)), [{ title: 'Prowl', url: 'https://owlandtwigvintage.com/pages/prowl' }]);   // made in the page's realm
  await p.close();
});

test('Send the link copies it, and says so, where there is no share sheet', async () => {
  const copied = [];
  const p = await open({
    beforeLoad(win) {
      Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } }, configurable: true });
    },
  });
  assert.equal(typeof p.win.navigator.share, 'undefined');
  p.$('#otp-qrSend').click();
  assert.deepEqual(copied, ['https://owlandtwigvintage.com/pages/prowl']);
  assert.equal(p.$('#otp-toast').textContent, 'Link copied.');
  await p.close();
});

test('the panther pounces when tapped, and not under reduced motion', async () => {
  const p = await open();
  assert.ok(p.$('#otp-pan').classList.contains('pm-pounce'));
  await tick(850);
  assert.equal(p.$('#otp-pan').classList.contains('pm-pounce'), false, 'cleared after the pounce');
  await p.close();
  const r = await open({ reducedMotion: true });
  assert.ok(sheetOn(r), 'the sheet still opens');
  assert.equal(r.$('#otp-pan').classList.contains('pm-pounce'), false);
  await r.close();
});

test('the sheet closes with its ✕ and the panther can open it again', async () => {
  const p = await open();
  p.$('#otp-sheetClose').click();
  await tick(350);
  assert.ok(p.$('#otp-sheet').hidden);
  p.$('#otp-panQr').click();
  await tick(40);
  assert.ok(sheetOn(p));
  assert.equal(p.$$('#otp-sheetB .qr-box').length, 1, 'one code, not one per tap');
  await p.close();
});

test('once the panther has tucked away on scroll it is hidden, so its button leaves the tab order', async () => {
  const p = loadPage({ storage: STORE });
  await tick(30);
  const pan = p.$('#otp-pan');
  assert.equal(pan.style.visibility, '');
  Object.defineProperty(p.win, 'pageYOffset', { value: 600, configurable: true });
  p.win.dispatchEvent(new p.win.Event('scroll'));
  await tick(40);
  assert.equal(pan.style.visibility, 'hidden');
  Object.defineProperty(p.win, 'pageYOffset', { value: 0, configurable: true });
  p.win.dispatchEvent(new p.win.Event('scroll'));
  await tick(40);
  assert.equal(pan.style.visibility, '');
  await p.close();
});

test('the QR button keeps the theme from styling it, and the page says v6.77 or later', () => {
  assert.match(PAGE, /\.scout-app-wrapper \.pm-btn\{[^}]*appearance:none[^}]*text-transform:none/);
  const m = /var PROWL_VERSION='v(\d+)\.(\d+)';/.exec(PAGE), v = m && [m[0], Number(m[1]) * 100 + Number(m[2]) - 600];   // v7.00 reads as 100, so v6.xx floors still hold
  assert.ok(v && Number(v[1]) >= 77);
});
