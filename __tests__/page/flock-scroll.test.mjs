// Page v6.51: Flock stops moving under your finger. Finds that arrive mid-scroll wait until you stop, and a scroll
// that lands a few cards up is no longer pulled back down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

// the first hunt answers at once; the second waits until release()
function heldFetch() {
  const base = liveFetch(), held = [];
  const impl = (url, o) => {
    const q = new URL(String(url), 'https://www.owlandtwigvintage.com/').searchParams.get('q') || '';
    if (q === 'pyrex') return new Promise((r) => held.push(() => r(base.impl(url, o))));
    return base.impl(url, o);
  };
  return { impl, release: () => held.splice(0).forEach((f) => f()), held };
}
async function flock(fetchImpl) {
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { hunts: [] }, owlTwigSgwTerms: ['panther', 'pyrex'] }, beforeLoad: (w) => { w.Math.random = () => 0.5; } });
  await tick(60);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length >= 1);
  return p;
}
const row = (p) => p.$('#otp-flockRow');

test('finds that arrive while your finger is on the feed wait until you let go', async () => {
  const f = heldFetch();
  const p = await flock(f.impl);
  await waitFor(() => f.held.length > 0);
  const grid = row(p).firstChild, n = p.$$('#otp-flockRow .fl-card').length;
  row(p).dispatchEvent(new p.win.Event('touchstart'));
  f.release();
  await tick(500);
  assert.equal(row(p).firstChild, grid, 'no redraw while touching');
  row(p).dispatchEvent(new p.win.Event('touchend'));
  await waitFor(() => row(p).firstChild !== grid, { timeout: 3000 });
  assert.ok(p.$$('#otp-flockRow .fl-card').length >= n, 'nothing is lost');
  assert.ok(p.$$('#otp-flockRow .fl-card[data-h="pyrex"]').length, 'the new finds show once you stop');
  await p.close();
});

test('a redraw also waits while the feed is still moving after a flick', async () => {
  const f = heldFetch();
  const p = await flock(f.impl);
  await waitFor(() => f.held.length > 0);
  const grid = row(p).firstChild;
  f.release();
  const t0 = Date.now();
  while (Date.now() - t0 < 600) { row(p).dispatchEvent(new p.win.Event('scroll')); await tick(50); }
  assert.equal(row(p).firstChild, grid, 'no redraw while scrolling');
  await waitFor(() => row(p).firstChild !== grid, { timeout: 3000 });
  await p.close();
});

test('a scroll that lands several cards away stays there, down or up', async () => {
  const p = await flock(liveFetch().impl);
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length >= 4);
  await tick(1200);   // let background finds settle
  const cs = p.$$('#otp-flockRow .fl-card,#otp-flockRow .fl-note');
  cs.forEach((c, i) => { Object.defineProperty(c, 'offsetTop', { value: i * 100 }); Object.defineProperty(c, 'offsetHeight', { value: 100 }); });
  const r = row(p);
  r.scrollTop = 400; r.dispatchEvent(new p.win.Event('scroll'));   // down three cards in one go
  await tick(250);
  assert.equal(r.scrollTop, 400, 'not eased back toward where you started');
  r.scrollTop = 100; r.dispatchEvent(new p.win.Event('scroll'));   // up three cards in one go
  await tick(400);
  assert.equal(r.scrollTop, 100, 'the feed stays where you scrolled');
  await p.close();
});
