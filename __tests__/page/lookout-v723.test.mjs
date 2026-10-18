// Page v7.23 (Matt, 2026-10-18, from the eBay teardown, kept in the panther's words): an empty search box offers
// hunts to tap (your hunts, then On the lookout, BOLO's old starter terms) instead of silently re-running the ticked
// ones; an empty search offers related hunts; a listing Prowl saw end is tagged Got away wherever its card shows;
// a Den hunt is Locked on or Hiding, with a bell when the alerts watch it; How Prowl works has Prowl's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const hunt = () => ({ bubbles: true, cancelable: true });

test('an empty Hunt box offers chips: your hunts (locked on first), then On the lookout; it searches nothing', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['catalin bracelet', 'Pyrex Butterprint', 'rookwood vase'], lock: [2], sel: [0, 1] }, owlTwigSgwTerms: [] } });
  await tick(300);
  const before = f.calls.length;
  p.$('#otp-q').value = '   ';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  const box = p.$('#otp-bolo');
  assert.equal(box.hidden, false, 'the chips show');
  assert.match(box.textContent, /What are we hunting\?/);
  const groups = [...box.querySelectorAll('.bolo-r')].map((r) => [...r.querySelectorAll('[data-bolo]')].map((b) => b.textContent));
  assert.deepEqual(groups[0], ['rookwood vase', 'catalin bracelet', 'Pyrex Butterprint'], 'your hunts, locked on first');
  assert.ok(groups[1].includes('Roseville jardiniere') && groups[1].includes('Fire-King jadeite'), 'On the lookout');
  assert.ok(!groups[1].some((t) => /pyrex butterprint/i.test(t)), 'not one that is already yours');
  assert.equal(groups[1].length, 8);
  await tick(200);
  // the locked hunt's own start-up run (rookwood vase) can still be in flight on a slow machine; nothing else may search
  const searched = f.calls.slice(before).filter((u) => /[?&][qh]=/.test(u) && !/rookwood/i.test(u));
  assert.deepEqual(searched, [], 'no search went out: no silent re-run of the ticked hunts');
  assert.equal(p.$('#otp-res').textContent.trim(), '', 'no results drawn');
  assert.equal(p.$$('body > .pm-spark').length, 0, 'and no hunt sparkle');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a chip runs that hunt; typing in the box puts the chips away', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [] } });
  await tick(300);
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  const chip = [...p.$$('#otp-bolo [data-bolo]')].find((b) => b.textContent === 'Blenko glass');
  assert.ok(chip, 'a first visit gets On the lookout only');
  chip.click();
  assert.equal(p.$('#otp-bolo').hidden, true);
  assert.equal(p.$('#otp-q').value, 'Blenko glass');
  await waitFor(() => /Blenko glass/.test(p.$('#otp-res').textContent), { timeout: 6000 });
  p.$('#otp-q').value = '';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  assert.equal(p.$('#otp-bolo').hidden, false);
  p.$('#otp-q').value = 'h';
  p.$('#otp-q').dispatchEvent(new p.win.Event('input', { bubbles: true }));
  assert.equal(p.$('#otp-bolo').hidden, true);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an empty search offers related hunts: fewer words first, then ones that share a word; a tap runs it', async () => {
  const f = liveFetch({ perSource: 0 });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['Haeger panther lamp'] }, owlTwigSgwTerms: [] } });
  await tick(300);
  p.$('#otp-q').value = 'royal haeger panther';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', hunt()));
  const card = await waitFor(() => p.$('#otp-res .sgw-empty'), { timeout: 8000 });
  assert.match(card.textContent, /Email me when it shows up/, 'the keep-watching offer stays');
  const rel = [...card.querySelectorAll('[data-bolo]')].map((b) => b.textContent);
  assert.deepEqual(rel.slice(0, 3), ['royal haeger', 'royal panther', 'haeger panther']);
  assert.ok(rel.includes('Haeger panther lamp'), 'a hunt of yours that shares a word');
  assert.ok(rel.length <= 5);
  card.querySelector('[data-bolo="royal panther"]').click();
  assert.equal(p.$('#otp-q').value, 'royal panther');
  await waitFor(() => /royal panther/.test(p.$('#otp-res h2').textContent), { timeout: 6000 });
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Got away: once the popup says a listing ended, its cards say so, here and after a reload', async () => {
  const U = 'https://www.ebay.com/itm/123456789012';
  const fetchImpl = (u) => /\/item\?/.test(String(u))
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ src: 'ebay', title: 'Haeger panther', price: '$45.00', images: ['https://i.ebayimg.com/1.jpg'], url: U, gone: true }) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  const storage = { 'prowl.finds': [{ title: 'Haeger panther', price: '$45.00', url: U, image: 'https://i.ebayimg.com/1.jpg', src: 'ebay', hunt: 'panther', at: 1 }], 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' };
  const open = async (p) => {
    await tick(40);
    p.$('#otp-dock .db[data-m="flock"]').click();
    p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
    return waitFor(() => p.$(`#otp-flockRow .fl-card[data-u="${U}"]`));
  };
  const p = loadPage({ fetchImpl, storage });
  const card = await open(p);
  assert.equal(card.classList.contains('is-gone'), false, 'not before Prowl knows');
  card.querySelector('.sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB .pp-end'));
  assert.ok(p.$(`#otp-flockRow .fl-card[data-u="${U}"]`).classList.contains('is-gone'), 'tagged at once');
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.gotAway')), [U]);
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.likesGone') || '[]').every((x) => x.u !== U), 'the un-liked list is untouched');
  assert.deepEqual(p.errors, []);
  await p.close();
  const p2 = loadPage({ fetchImpl, storage: { ...storage, 'prowl.gotAway': [U] } });
  const again = await open(p2);
  await waitFor(() => again.classList.contains('is-gone'));
  assert.deepEqual(p2.errors, []);
  await p2.close();
});

test('a Den hunt is Locked on or Hiding; tapping says so in the panther\'s words; the bell shows what the alerts watch', async () => {
  const signed = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'a@b.co' };
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['catalin bracelet', 'rookwood vase'], lock: [1] }, owlTwigSgwTerms: [], ...signed } });
  await tick(100);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  const sb = (i) => p.$(`#otp-denList .sb[data-l="${i}"]`);
  assert.equal(sb(0).querySelector('b').textContent, 'Hiding');
  assert.equal(sb(0).getAttribute('aria-pressed'), 'false');
  assert.match(sb(0).title, /Hiding: kept in your Den/);
  assert.equal(sb(1).querySelector('b').textContent, 'Locked on');
  assert.equal(sb(1).getAttribute('aria-pressed'), 'true');
  assert.ok(sb(1).classList.contains('bell'), 'signed in, and the one hunt the free alerts cover');
  assert.equal(sb(1).querySelector('i').textContent, '\u{1F514}');
  sb(0).click();
  assert.match(p.$('#otp-toast').textContent, /Locked on catalin bracelet\./);
  assert.equal(sb(0).querySelector('b').textContent, 'Locked on');
  assert.equal(sb(0).classList.contains('bell'), false, 'past what the free alerts cover: locked on, no bell');
  sb(1).click();
  assert.match(p.$('#otp-toast').textContent, /rookwood vase is hiding in your Den\./);
  assert.deepEqual(p.errors, []);
  await p.close();
  const p2 = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['rookwood vase'], lock: [0] }, owlTwigSgwTerms: [] } });
  await tick(100);
  p2.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  assert.equal(p2.$('#otp-denList .sb[data-l="0"]').classList.contains('bell'), false, 'not signed in: no alerts, no bell');
  assert.equal(p2.$('#otp-denList .sb[data-l="0"] i').textContent, '◉');
  await p2.close();
});

test('How Prowl works has Prowl\'s words', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true } } });
  const g = p.$('#otp-ms details.gloss');
  assert.ok(g);
  assert.equal(g.querySelector('summary').textContent, "Prowl's words");
  const words = [...g.querySelectorAll('dt')].map((d) => d.textContent);
  for (const w of ['Prowl', 'Hunt', 'Den', 'Locked on', 'Hiding', 'Daily', 'Flock', 'On the lookout', 'Pounce', 'Quarry', 'Got away']) assert.ok(words.includes(w), w);
  await p.close();
});
