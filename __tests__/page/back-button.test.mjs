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
  /* jsdom has no history.scrollRestoration; give it the browser's, starting at the default */
  const beforeLoad = (win) => { let v = 'auto'; Object.defineProperty(win.history, 'scrollRestoration', { get: () => v, set: (x) => { v = x; }, configurable: true }); };
  return loadPage({ fetchImpl, beforeLoad, storage: { owlTwigSgwTerms: ['panther', 'pyrex'], 'prowl.finds': finds, 'prowl.v36': { seen: true, hunts: [] } } });
}
const sheetOn = (p) => p.$('#otp-sheet').classList.contains('on');
const flockOn = (p) => p.$('#otp-flock').classList.contains('as-feed');
// waits for the Back itself (popstate), not a fixed time, so a busy machine cannot outrun it; gives up after 3s so a
// Back that never comes fails the test instead of hanging it
const back = (p) => Promise.race([
  new Promise((r) => { p.win.addEventListener('popstate', () => setTimeout(r, 30), { once: true }); p.win.history.back(); }),
  tick(3000),
]);
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
  /* the Den turns on in an animation frame and the entry follows it: wait for it, not a fixed time (a busy CI runner overran 50ms) */
  await waitFor(() => p.win.history.state && p.win.history.state.prowlOv === 1, { timeout: 3000 }).catch(() => {});
  assert.equal(p.win.history.state && p.win.history.state.prowlOv, 1, 'Den open: entry pushed');
  p.$('#otp-denClose').click();
  await waitFor(() => !(p.win.history.state && p.win.history.state.prowlOv === 1), { timeout: 3000 }).catch(() => {});
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

// v7.10 (Matt: in Daily, Back from a card's popup sent the screen to the top; its X did not): while Prowl's own
// history entries are in use the browser must not restore the scroll it saved with them.
test('Back keeps the scroll: no browser scroll restoration while Prowl has layers open, and it comes back after', async () => {
  const p = setup();
  await tick(60);
  assert.notEqual(p.win.history.scrollRestoration, 'manual', 'nothing open: the browser restores as usual');
  await openPopupInFlock(p);
  assert.equal(p.win.history.scrollRestoration, 'manual', 'a layer is open');
  await back(p);
  assert.ok(!sheetOn(p) && flockOn(p));
  assert.equal(p.win.history.scrollRestoration, 'manual', 'still a layer open under it');
  await back(p);
  await tick(30);
  assert.ok(!flockOn(p));
  assert.equal(p.win.history.scrollRestoration, 'auto', 'all closed: back to the browser default');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('closing the last layer with its own button also hands scroll restoration back', async () => {
  const p = setup();
  await openPopupInFlock(p);
  p.$('#otp-dock .db[data-m="prowl"]').click();   /* closes the popup and Flock without Back */
  await waitFor(() => p.win.history.scrollRestoration === 'auto', { timeout: 3000 });
  await p.close();
});
