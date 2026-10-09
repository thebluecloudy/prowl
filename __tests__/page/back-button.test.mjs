// Page v6.55: the phone's Back button closes what is open, one layer at a time, instead of leaving Prowl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const ITEM = { src: 'ebay', id: '123456789012', title: 'Haeger panther', price: '$45.00', images: ['https://i.ebayimg.com/1.jpg'], description: '', condition: '', aspects: [], url: 'https://www.ebay.com/itm/123456789012' };
const finds = [{ title: 'Haeger panther', price: '$45.00', url: 'https://www.ebay.com/itm/123456789012', image: 'https://i.ebayimg.com/a.jpg', src: 'ebay', hunt: 'panther', at: 3 }];
function setup() {
  const base = liveFetch();
  const fetchImpl = (url, o) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/item') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ITEM) });
    return base.impl(url, o);
  };
  return loadPage({ fetchImpl, storage: { owlTwigSgwTerms: ['panther', 'pyrex'], 'prowl.finds': finds, 'prowl.v36': { seen: true, hunts: [] } } });
}
const sheetOn = (p) => p.$('#otp-sheet').classList.contains('on');
const flockOn = (p) => p.$('#otp-flock').classList.contains('as-feed');
// waits for the Back itself (popstate), not a fixed time, so a busy machine cannot outrun it
const back = (p) => new Promise((r) => { p.win.addEventListener('popstate', () => setTimeout(r, 30), { once: true }); p.win.history.back(); });
async function openPopupInFlock(p) {
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  await tick(30);
  p.$('#otp-flockRow .fl-card .sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => sheetOn(p));
  await tick(50);
}

test('Back closes the popup, then Flock, and only then would leave', async () => {
  const p = setup();
  const start = p.win.history.length;
  await openPopupInFlock(p);
  assert.ok(flockOn(p));
  assert.equal(p.win.history.length, start + 1, 'one extra entry while things are open');
  await back(p);
  assert.ok(!sheetOn(p), 'Back closed the popup');
  assert.ok(flockOn(p), 'Flock is still open under it');
  await back(p);
  assert.ok(!flockOn(p), 'Back again closes Flock, back to the main screen');
  await p.close();
});

test('closing with the ✕ gives the extra history entry back, so Back is not swallowed later', async () => {
  const p = setup();
  await tick(60);
  p.$('#otp-denBtn').click();
  await tick(50);
  assert.equal(p.win.history.state && p.win.history.state.prowlOv, 1, 'Den open: entry pushed');
  p.$('#otp-denClose').click();
  await tick(120);
  assert.notEqual(p.win.history.state && p.win.history.state.prowlOv, 1, 'entry given back');
  assert.ok(!p.$('#otp-den').classList.contains('on'));
  await p.close();
});

test('nothing open: no extra entry', async () => {
  const p = setup();
  const n = p.win.history.length;
  await tick(150);
  assert.equal(p.win.history.length, n);
  await p.close();
});
