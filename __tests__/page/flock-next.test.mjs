import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const cards = (p) => p.$$('#otp-flockRow .fl-card');
const find = (n, price, at = n) => ({ title: `Find ${n}`, price, url: `https://shopgoodwill.com/item/f${n}`, image: '', src: '', hunt: 'pyrex', at });

async function open(opts = {}, fx = {}) {
  const f = liveFetch(fx);
  const p = loadPage({ fetchImpl: f.impl, ...opts });
  p.win.confirm = () => true;
  await tick(50);
  p.$('#otp-dock .db[data-m="flock"]').click();
  return p;
}
async function openSaved(finds, opts = {}) {
  const p = await open({ ...opts, storage: { 'prowl.finds': finds, ...(opts.storage || {}) } });
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  return p;
}
const rows = (p) => p.$$('#otp-sheetB .mg-rows dd').map((d) => d.textContent);

test('price pill opens the margin sheet, not the listing; math to the cent', async () => {
  const p = await openSaved([find(1, '$12.50')]);
  const pill = cards(p)[0].querySelector('.sgw-p');
  const click = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  pill.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'listing stays closed');
  await tick(40);
  assert.ok(p.$('#otp-sheet').classList.contains('on'));
  assert.equal(p.$('#otp-sheetT').textContent, 'What you’d clear');
  // v6.78: no separate payment processing (eBay's final value fee includes it), and the $0.40 per-order fee
  assert.deepEqual(rows(p), ['$12.50', '−$1.70', '−$0.40', '−$0.25']);
  assert.equal(p.$('#otp-sheetB .mg-clear b').textContent, '$10.15');
  assert.deepEqual(p.$$('#otp-sheetB .mg-rows dt').map((d) => d.firstChild.textContent.trim()), ['List price', 'Final value fee', 'Per-order fee', 'Promoted listing']);
  assert.doesNotMatch(p.$('#otp-sheetB').textContent, /processing/i);
  assert.match(p.$('#otp-sheetB .mg-sub').textContent, /Assuming you resell on eBay/);
  await p.close();
});

test('margin math on a four-figure price', async () => {
  const p = await openSaved([find(1, '$1,234.56')]);
  cards(p)[0].querySelector('.sgw-p').click();
  await tick(40);
  assert.deepEqual(rows(p), ['$1,234.56', '−$167.90', '−$0.40', '−$24.69']);
  assert.equal(p.$('#otp-sheetB .mg-clear b').textContent, '$1,041.57');
  await p.close();
});

test('margin math: an order of $10 or less pays the $0.30 per-order fee', async () => {
  const p = await openSaved([find(1, '$10.00')]);
  cards(p)[0].querySelector('.sgw-p').click();
  await tick(40);
  assert.deepEqual(rows(p), ['$10.00', '−$1.36', '−$0.30', '−$0.20']);
  assert.equal(p.$('#otp-sheetB .mg-clear b').textContent, '$8.14');
  await p.close();
});

test('margin math: over $7,500 the final value fee drops to 2.35% on the rest, and the sheet says so', async () => {
  const p = await openSaved([find(1, '$10,000.00')]);
  cards(p)[0].querySelector('.sgw-p').click();
  await tick(40);
  /* 13.6% of 7,500 = 1,020.00; 2.35% of 2,500 = 58.75 */
  assert.deepEqual(rows(p), ['$10,000.00', '−$1,078.75', '−$0.40', '−$200.00']);
  assert.equal(p.$('#otp-sheetB .mg-clear b').textContent, '$8,720.85');
  assert.match(p.$('#otp-sheetB .mg-rows dt small').textContent, /2\.35% over \$7,500/);
  await p.close();
});

test('the sheet closes on ✕, the scrim and Escape (Escape leaves Flock open)', async () => {
  const p = await openSaved([find(1, '$5.00')]);
  const pill = () => cards(p)[0].querySelector('.sgw-p');
  pill().click(); await tick(40);
  p.$('#otp-sheetClose').click();
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false);
  pill().click(); await tick(40);
  p.$('#otp-sc').click();
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false);
  pill().click(); await tick(40);
  p.doc.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false);
  assert.ok(p.$('#otp-flock').classList.contains('as-feed'), 'Flock is still open');
  await p.close();
});

test('Watch for price drop: flips, saves, shows under Watching, and unwatches', async () => {
  const p = await openSaved([find(1, '$20.00'), find(2, '$8.00')]);
  p.$('#otp-flockRow .fl-card[data-u$="/f2"] .sgw-p').click();
  await tick(40);
  const btn = p.$('#otp-sheetB [data-watch]');
  assert.equal(btn.textContent, 'Watch for price drop');
  btn.click();
  assert.equal(btn.textContent, 'Watching ✓');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  const w = ls(p, 'prowl.watchlist');
  assert.equal(w.length, 1);
  assert.equal(w[0].u, 'https://shopgoodwill.com/item/f2');
  assert.equal(w[0].p, '$8.00');
  assert.ok(w[0].watchedAt > 0);
  await tick(600);
  assert.equal(p.$('#otp-sheet').classList.contains('on'), false, 'the sheet closes after a watch');
  const group = p.$('#otp-flockRow .fl-group');
  assert.equal(group.textContent, 'Watching');
  const watched = group.nextElementSibling;
  assert.ok(watched.classList.contains('fl-card'));
  assert.equal(watched.getAttribute('data-u'), 'https://shopgoodwill.com/item/f2');
  // nothing claims an alert will come
  assert.doesNotMatch(p.$('#otp-flock').textContent + p.$('#otp-sheet').textContent, /alert|email|notify/i);
  watched.querySelector('.sgw-p').click();
  await tick(40);
  const b2 = p.$('#otp-sheetB [data-watch]');
  assert.equal(b2.textContent, 'Watching ✓');
  b2.click();
  assert.equal(b2.textContent, 'Watch for price drop');
  assert.deepEqual(ls(p, 'prowl.watchlist'), []);
  await p.close();
});

test('discarding a watched find drops the watch; Undo restores it', async () => {
  const w = [{ u: 'https://shopgoodwill.com/item/w1', t: 'Watched', p: '$3', s: '', i: '', h: '', watchedAt: 5 }];
  const p = await openSaved([], { storage: { 'prowl.watchlist': w } });
  cards(p)[0].querySelector('.fl-x').click();
  assert.deepEqual(ls(p, 'prowl.watchlist'), []);
  p.$('#otp-undis').click();
  assert.equal(ls(p, 'prowl.watchlist')[0].u, 'https://shopgoodwill.com/item/w1');
  await p.close();
});

test('new since last visit: nothing on a first visit, then a divider and badges for unseen finds', async () => {
  const p = await open();
  await waitFor(() => p.$('#otp-flockRow .fl-end') && cards(p).length >= 4);
  assert.equal(p.$('#otp-flockRow .fl-new'), null, 'no divider on a first visit');
  assert.equal(p.$('#otp-flockRow .fl-newb'), null);
  const shown = cards(p).map((c) => c.getAttribute('data-u'));
  p.$('#otp-dock .db[data-m="prowl"]').click();
  const seen = ls(p, 'prowl.flockSeen');
  assert.deepEqual(seen, shown.slice(0, 1), 'v6.52: only the cards you scrolled to count as seen');
  await p.close();

  // next visit: half of those were seen before
  const keep = shown.slice(0, 2);
  const p2 = await open({ storage: { 'prowl.flockSeen': keep } });
  await waitFor(() => p2.$('#otp-flockRow .fl-end') && cards(p2).length >= 4);
  const div = p2.$('#otp-flockRow .fl-new');
  assert.ok(div, 'divider shows');
  assert.equal(div.textContent, 'New since your last visit');
  const first = div.closest('.fl-card');
  assert.ok(first, 'the divider sits at the top of the first new card, where a snapped feed can show it');
  assert.equal(first.querySelector('.fl-newb').textContent, 'New');
  assert.equal(p2.$$('#otp-flockRow .fl-new').length, 1);
  const firstNew = cards(p2).find((c) => !keep.includes(c.getAttribute('data-u')));
  assert.equal(first, firstNew);
  for (const c of cards(p2)) {
    const isSeen = keep.includes(c.getAttribute('data-u'));
    assert.equal(!!c.querySelector('.fl-newb'), !isSeen, c.getAttribute('data-u'));
  }
  await p2.close();
});

test('seen list keeps the newest 1000', async () => {
  const old = Array.from({ length: 1000 }, (_, i) => `https://shopgoodwill.com/item/old${i}`);
  const p = await open({ storage: { 'prowl.flockSeen': old } });
  await waitFor(() => p.$('#otp-flockRow .fl-end') && cards(p).length >= 2);
  const first = cards(p)[0].getAttribute('data-u');
  p.$('#otp-dock .db[data-m="prowl"]').click();
  const seen = ls(p, 'prowl.flockSeen');
  assert.equal(seen.length, 1000);
  assert.equal(seen[0], 'https://shopgoodwill.com/item/old1', 'the oldest one drops for the one card you reached');
  assert.equal(seen[999], first);
  await p.close();
});

test('share uses the system sheet when there is one', async () => {
  const p = await openSaved([find(1, '$12.00')]);
  const got = [];
  Object.defineProperty(p.win.navigator, 'share', { value: (d) => { got.push(d); return Promise.resolve(); }, configurable: true });
  cards(p)[0].querySelector('.fl-sh').click();
  assert.deepEqual(JSON.parse(JSON.stringify(got)), [{ title: 'Find 1', text: 'Found this on ShopGoodwill: Find 1 · $12.00\n\nFound with Prowl, a vintage search tool from Owl & Twig Vintage', url: 'https://shopgoodwill.com/item/f1' }]);   // the object comes from the page's realm
  await p.close();
});

test('share falls back to copying the link', async () => {
  const p = await openSaved([find(1, '$12.00')]);
  const copied = [];
  p.win.navigator.clipboard.writeText = (t) => { copied.push(t); return Promise.resolve(); };
  cards(p)[0].querySelector('.fl-sh').click();
  assert.deepEqual(copied, ['https://shopgoodwill.com/item/f1']);
  assert.equal(p.$('#otp-toast').textContent, 'Link copied.');
  await p.close();
});

test('star while logged out holds the find and opens the in-app sign-in (v6.86, no trip to the store)', async () => {
  const p = await open();
  await waitFor(() => cards(p).length);
  const c = cards(p)[0];
  c.querySelector('.sgw-sv').click();
  const pend = JSON.parse(p.win.sessionStorage.getItem('prowl.pendStar'));
  assert.equal(pend.url, c.getAttribute('data-u'));
  assert.equal(ls(p, 'prowl.finds'), null, 'nothing saved locally yet');
  assert.ok(!p.errors.some((e) => /navigation/i.test(String(e.message || e))), 'it stays in Prowl');
  assert.equal(p.$('#otp-denSettings').hidden, false, 'Den > Settings, where the sign-in is');
  assert.ok(p.$('#otp-denSettings .otp-mail input[data-k=code]'), 'the email box for the code');
  await p.close();
});

test('back from sign-in: the held star is saved', async () => {
  const f = liveFetch({ me: { in: true, id: '1', e: 'a@b.co' } });
  const p = loadPage({
    fetchImpl: f.impl,
    url: 'https://www.owlandtwigvintage.com/pages/prowl?flock=1',
    beforeLoad: (win) => win.sessionStorage.setItem('prowl.pendStar', JSON.stringify({ title: 'Held', price: '$4', url: 'https://shopgoodwill.com/item/held', src: '' })),
  });
  await waitFor(() => ls(p, 'prowl.finds'));
  assert.equal(ls(p, 'prowl.finds')[0].url, 'https://shopgoodwill.com/item/held');
  assert.equal(p.win.sessionStorage.getItem('prowl.pendStar'), null);
  await waitFor(() => /Saved/.test(p.$('#otp-toast').textContent));
  await p.close();
});

test('back without signing in: nothing is saved and the hold is dropped', async () => {
  const f = liveFetch({ me: { in: false } });
  const p = loadPage({
    fetchImpl: f.impl,
    beforeLoad: (win) => win.sessionStorage.setItem('prowl.pendStar', JSON.stringify({ title: 'Held', price: '$4', url: 'https://shopgoodwill.com/item/held', src: '' })),
  });
  await tick(200);
  assert.equal(ls(p, 'prowl.finds'), null);
  assert.equal(p.win.sessionStorage.getItem('prowl.pendStar'), null);
  await p.close();
});

test('signed-in members star straight away', async () => {
  const p = await open({ storage: { 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' } });
  await waitFor(() => cards(p).length);
  const c = cards(p)[0];
  c.querySelector('.sgw-sv').click();
  assert.equal(ls(p, 'prowl.finds')[0].url, c.getAttribute('data-u'));
  await p.close();
});

test('backup v7 carries the watchlist', async () => {
  const p = loadPage();
  p.win.confirm = () => true;
  await tick(30);
  p.$('#otp-impText').value = JSON.stringify({ app: 'prowl', v: 7, hunts: ['a', 'b'], watchlist: [{ u: 'https://x.com/w', t: 'W', p: '$1' }, { u: 'http://x.com/bad', t: 'no' }] });
  p.$('#otp-impTextBtn').click();
  assert.deepEqual(ls(p, 'prowl.watchlist').map((w) => w.u), ['https://x.com/w']);
  await p.close();
});
