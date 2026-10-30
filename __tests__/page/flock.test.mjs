import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const DIS = 'prowl.discarded';
const FINDS = 'prowl.finds';
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');

// v6.60: Flock reads the whole Den, so each test says what is in it (first-visit samples by default would be 12 hunts).
// seen: the first-visit welcome opens 420ms after load and Escape closes it before Flock, so on a busy runner a test
// that pressed Escape could close the welcome instead; these tests are about Flock, not the welcome
const DEN = { seen: true, hunts: ['Roseville jardiniere', 'Pyrex Butterprint', 'Fire-King jadeite'] };
async function openFeed(opts = {}, fx = {}) {
  const f = liveFetch(fx);
  const p = loadPage({ fetchImpl: f.impl, ...opts, storage: { 'prowl.v36': DEN, ...(opts.storage || {}) } });
  p.win.confirm = () => true;
  await tick(50);
  p.$('#otp-dock .db[data-m="flock"]').click();
  return p;
}
const cards = (p) => p.$$('#otp-flockRow .fl-card');

function pointer(win, el, type, x, y, id = 1) {
  const Ctor = win.PointerEvent || win.MouseEvent;
  const e = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: id, pointerType: 'touch' });
  if (!('pointerId' in e) || e.pointerId !== id) Object.defineProperty(e, 'pointerId', { value: id });
  if (e.pointerType !== 'touch') Object.defineProperty(e, 'pointerType', { value: 'touch' });
  el.dispatchEvent(e);
  return e;
}

test('dock: Hunt · Daily · Store · Flock · Near me · Den (v7.30, Store since v8.20); PHOTO is gone, the camera still opens photo check', async () => {
  const p = loadPage();
  await tick(30);
  const modes = p.$$('#otp-dock .db').map((b) => b.dataset.m);
  assert.deepEqual(modes, ['prowl', 'daily', 'store', 'flock', 'local', 'den'], 'v7.30: Matt\'s order; GOODWILL left the dock; v8.20 Store');
  assert.deepEqual(p.$$('#otp-dock .db span').map((s) => s.textContent), ['Hunt', 'Daily', 'Store', 'Flock', 'Near me', 'Den']);
  assert.equal(p.$('#otp-photoBtn'), null);
  assert.ok(p.$('#otp-flockBtn use[href="#otp-swallow"]'));
  assert.ok(p.$('#otp-cam'));
  await p.close();
});

test('flock is not in the home flow until the tab opens', async () => {
  const p = loadPage();
  await tick(30);
  assert.equal(p.$('#otp-flock').hidden, true);
  assert.equal(p.$('#otp-flock').classList.contains('as-feed'), false);
  await p.close();
});

test('opening Flock shows the feed over a hidden home; PROWL closes it', async () => {
  const p = await openFeed();
  const sec = p.$('#otp-flock');
  assert.equal(sec.hidden, false);
  assert.ok(sec.classList.contains('as-feed'));
  assert.ok(p.$('.scout-app-wrapper').classList.contains('flock-mode'));
  assert.ok(p.$('#otp-dock .db[data-m="flock"]').classList.contains('on'));
  await waitFor(() => cards(p).length > 0);
  p.$('#otp-dock .db[data-m="prowl"]').click();
  assert.equal(sec.hidden, true);
  assert.equal(sec.classList.contains('as-feed'), false);
  assert.equal(p.$('.scout-app-wrapper').classList.contains('flock-mode'), false);
  assert.ok(p.$('#otp-dock .db[data-m="prowl"]').classList.contains('on'));
  await p.close();
});

test('Escape closes Flock', async () => {
  const p = await openFeed();
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.$('#otp-flock').classList.contains('as-feed'), false);
  await p.close();
});

test('cards: class hook, roles, Gem-clean face, end card', async () => {
  const p = await openFeed({}, { only: 'shopgoodwill' });   // v6.52: a feed small enough to reach its end
  // the end card waits until every marketplace has been asked, a few rounds (Vinted takes at most two a round, v6.61);
  // that is about 4s here, but CI runs four test files at once on two cores, so allow far longer
  const t0 = Date.now();
  await waitFor(() => cards(p).length >= 3 && /That.s the flock/.test((p.$('#otp-flockRow .fl-end') || {}).textContent || ''), { timeout: 45000 })
    .catch((e) => { throw new Error(e.message + ' after ' + (Date.now() - t0) + 'ms: ' + cards(p).length + ' cards, end card "' + ((p.$('#otp-flockRow .fl-end') || {}).textContent || 'none') + '"'); });
  assert.equal(p.$('#otp-flockRow').getAttribute('role'), 'feed');
  for (const c of cards(p)) {
    assert.equal(c.getAttribute('role'), 'article');
    assert.ok(c.getAttribute('aria-label'));
    assert.match(c.getAttribute('data-u'), /^https:\/\//);
    assert.ok(c.querySelector('.fl-x'));
    assert.ok(c.querySelector('.sgw-sv'));
    assert.ok(c.querySelector('.fl-for').textContent.startsWith('for '));
    assert.equal(c.querySelector('.sgw-fp'), null, 'no Fair price? on flock cards');
  }
  assert.ok(p.$('#otp-flockRow .sgw-p[data-act="margin"]'));
  assert.match(p.$('#otp-flockRow .fl-end').textContent, /That.s the flock/);
  await p.close();
});

test('auction cards carry the time-left and bids pill', async () => {
  const p = await openFeed({}, { only: 'shopgoodwill' });
  const pill = await waitFor(() => p.$('#otp-flockRow .fl-auc'));
  assert.match(pill.textContent, /^2d 4h \u00b7 \d+ bids?$/);
  await p.close();
});

test('no hunts at all: a friendly full-screen card with a way back', async () => {
  const p = await openFeed({ storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [] } });
  const empty = await waitFor(() => p.$('#otp-flockRow .fl-empty'));
  assert.match(empty.textContent, /Add a hunt in the Den and the flock takes flight/);
  assert.equal(p.errors.length, 0);
  empty.querySelector('[data-fl="home"]').click();
  assert.equal(p.$('#otp-flock').classList.contains('as-feed'), false);
  await p.close();
});

test('✕ in the feed discards for good but keeps a saved find saved (v7.91), and Undo brings the card back', async () => {
  const p = await openFeed({ storage: { 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' } });
  await waitFor(() => cards(p).length >= 2);
  const c = cards(p)[0];
  const u = c.getAttribute('data-u');
  c.querySelector('.sgw-sv').click();   // star it first
  assert.ok(ls(p, FINDS).some((f) => f.url === u));
  c.querySelector('.fl-x').click();
  assert.ok(!cards(p).some((x) => x.getAttribute('data-u') === u), 'card left the feed');
  assert.deepEqual(ls(p, DIS), [u]);
  assert.ok(ls(p, FINDS).some((f) => f.url === u), 'v7.91: a swipe in the feed no longer deletes a saved find (Matt: "Some things I was saving don\'t seem to be there anymore")');
  assert.ok(p.$('#otp-toast').classList.contains('act'));
  // shuffle: it never comes back
  p.$('#otp-flockShuf').click();
  await tick(400);
  assert.ok(!cards(p).some((x) => x.getAttribute('data-u') === u));
  // undo
  p.$('#otp-undis').click();
  assert.deepEqual(ls(p, DIS), []);
  assert.ok(ls(p, FINDS).some((f) => f.url === u), 'still saved');
  await p.close();
});

test('discard list keeps the newest 500', async () => {
  const old = Array.from({ length: 500 }, (_, i) => `https://shopgoodwill.com/item/old-${i}`);
  const p = await openFeed({ storage: { [DIS]: old } });
  await waitFor(() => cards(p).length);
  const u = cards(p)[0].getAttribute('data-u');
  cards(p)[0].querySelector('.fl-x').click();
  const a = ls(p, DIS);
  assert.equal(a.length, 500);
  assert.equal(a[a.length - 1], u);
  assert.equal(a[0], 'https://shopgoodwill.com/item/old-1');
  await p.close();
});

test('swipe right discards and swallows the click that follows', async () => {
  const p = await openFeed();
  await waitFor(() => cards(p).length >= 2);
  const c = cards(p)[0];
  const u = c.getAttribute('data-u');
  const img = c.querySelector('img');
  pointer(p.win, img, 'pointerdown', 10, 300);
  pointer(p.win, img, 'pointermove', 40, 302);
  pointer(p.win, img, 'pointermove', 250, 305);
  pointer(p.win, img, 'pointerup', 250, 305);
  const click = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  c.querySelector('a').dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'the listing does not open');
  await tick(300);
  assert.deepEqual(ls(p, DIS), [u]);
  await p.close();
});

test('a short or vertical drag does not discard', async () => {
  const p = await openFeed();
  await waitFor(() => cards(p).length >= 2);
  const img = cards(p)[0].querySelector('img');
  pointer(p.win, img, 'pointerdown', 10, 300);
  pointer(p.win, img, 'pointermove', 60, 302);   // 50px of a 320px card, slowly: springs back
  await tick(200);
  pointer(p.win, img, 'pointerup', 60, 302);
  pointer(p.win, img, 'pointerdown', 10, 300, 2);
  pointer(p.win, img, 'pointermove', 15, 200, 2);   // vertical: a scroll
  pointer(p.win, img, 'pointerup', 15, 200, 2);
  await tick(300);
  assert.equal(ls(p, DIS), null);
  await p.close();
});

test('reduced motion: a swipe discards with no fly-off', async () => {
  const p = await openFeed({ reducedMotion: true });
  await waitFor(() => cards(p).length >= 2);
  const c = cards(p)[0];
  const img = c.querySelector('img');
  pointer(p.win, img, 'pointerdown', 10, 300);
  pointer(p.win, img, 'pointermove', 250, 300);
  assert.equal(c.style.transform, '', 'the card does not follow the finger');
  pointer(p.win, img, 'pointerup', 250, 300);
  assert.equal(ls(p, DIS).length, 1, 'discarded at once');
  await p.close();
});

test('Saved view: newest first, unstar removes at once, badge counts', async () => {
  const mk = (n, at) => ({ title: `Saved ${n}`, price: '$5', url: `https://shopgoodwill.com/item/s${n}`, image: '', src: '', hunt: 'pyrex', at });
  const p = await openFeed({ storage: { [FINDS]: [mk(1, 100), mk(3, 300), mk(2, 200)] } });
  assert.equal(p.$('#otp-flbd').textContent, '3');
  assert.equal(p.$('#otp-flbd').hidden, false);
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  assert.equal(p.$('#otp-flock .fl-seg [data-fv="saved"]').getAttribute('aria-selected'), 'true');
  assert.deepEqual(cards(p).map((c) => c.getAttribute('aria-label')), ['Saved 3', 'Saved 2', 'Saved 1']);
  cards(p)[0].querySelector('.sgw-sv').click();
  assert.deepEqual(cards(p).map((c) => c.getAttribute('aria-label')), ['Saved 2', 'Saved 1']);
  assert.equal(p.$('#otp-flbd').textContent, '2');
  await p.close();
});

test('Saved view: empty state sounds like a person', async () => {
  const p = await openFeed();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  assert.match(p.$('#otp-flockRow .fl-empty').textContent, /Nothing saved yet\. Tap the star on any find to keep it here\./);
  assert.equal(p.$('#otp-flbd').hidden, true);
  await p.close();
});

test('the Den no longer carries a second saved list', async () => {
  const p = loadPage();
  await tick(30);
  assert.equal(p.$('#otp-denFinds'), null);
  await p.close();
});

test('backup v6 restores the discard list; v5 and v1 still import', async () => {
  const p = loadPage();
  p.win.confirm = () => true;
  await tick(30);
  const box = p.$('#otp-impText'), go = p.$('#otp-impTextBtn');
  box.value = JSON.stringify({ app: 'prowl', v: 6, hunts: ['a', 'b'], discarded: ['https://x.com/1', 'javascript:bad', 'https://x.com/1', 'https://x.com/2'] });
  go.click();
  assert.deepEqual(ls(p, DIS), ['https://x.com/1', 'https://x.com/2']);
  box.value = JSON.stringify({ app: 'prowl', v: 5, hunts: ['c', 'd'] });
  go.click();
  assert.deepEqual(ls(p, DIS), ['https://x.com/1', 'https://x.com/2'], 'a v5 backup leaves it alone');
  box.value = JSON.stringify(['e', 'f', 'g']);
  go.click();
  assert.match(p.$('#otp-toast').textContent, /Restored 3 hunts/);
  await p.close();
});

test('?flock=1 opens the tab', async () => {
  const p = loadPage({ url: 'https://www.owlandtwigvintage.com/pages/prowl?flock=1' });
  await tick(500);
  assert.ok(p.$('#otp-flock').classList.contains('as-feed'));
  assert.equal(p.win.location.search, '');
  await p.close();
});
