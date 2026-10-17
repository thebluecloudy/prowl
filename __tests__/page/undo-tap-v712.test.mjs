// Page v7.12 (from the UI/UX brief, Matt 2026-10-17): the popup's View on <site> stays on screen, "Hunt removed." and
// "Removed from saved finds." have Undo, and the small controls take a 44px tap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const css = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const state = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36'));
const finds = (p) => JSON.parse(p.win.localStorage.getItem('prowl.finds'));

async function den(saved) {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, ...saved } } });
  await tick(60);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  return p;
}
const rmBtn = (p, name) => p.$$('#otp-denList li').find((li) => li.textContent.includes(name)).querySelector('.rm');

test('Undo puts a removed hunt back in its place, with its tick and lock', async () => {
  const p = await den({ hunts: ['catalin bracelet', 'rookwood vase', 'pyrex snowflake'], sel: [1, 2], lock: [1, 2] });
  rmBtn(p, 'rookwood vase').click();
  assert.deepEqual(state(p).hunts, ['catalin bracelet', 'pyrex snowflake']);
  assert.deepEqual(state(p).lock, [1], 'pyrex snowflake moved up to 1');
  assert.match(p.$('#otp-toast').textContent, /Hunt removed\. Undo/);
  assert.ok(p.$('#otp-toast').classList.contains('act'), 'the toast takes taps');
  p.$('#otp-unhunt').click();
  const s = state(p);
  assert.deepEqual(s.hunts, ['catalin bracelet', 'rookwood vase', 'pyrex snowflake']);
  assert.deepEqual([...s.sel].sort(), [1, 2]);
  assert.deepEqual([...s.lock].sort(), [1, 2]);
  assert.ok(!p.$('#otp-toast').classList.contains('on'), 'the toast goes');
  assert.ok(p.$$('#otp-denList li').some((li) => li.textContent.includes('rookwood vase')), 'the Den list shows it again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Undo does not add a hunt twice when it was typed in again meanwhile', async () => {
  const p = await den({ hunts: ['catalin bracelet', 'rookwood vase'] });
  rmBtn(p, 'rookwood vase').click();
  const undo = p.$('#otp-unhunt');
  p.$('#otp-newTerm').value = 'Rookwood vase';
  p.$('#otp-addTerm').click();
  assert.equal(state(p).hunts.length, 2, 'typed in again');
  p.$('#otp-toast').innerHTML = '';
  p.$('#otp-toast').appendChild(undo);
  undo.click();
  assert.equal(state(p).hunts.filter((h) => /rookwood vase/i.test(h)).length, 1);
  undo.click();   // a second tap does nothing
  assert.equal(state(p).hunts.length, 2);
  assert.deepEqual(p.errors, []);
  await p.close();
});

const FINDS = [
  { title: 'Haeger panther', price: '$45.00', url: 'https://www.ebay.com/itm/123456789012', image: 'https://i.ebayimg.com/a.jpg', src: 'ebay', hunt: 'panther', at: 3 },
  { title: 'Madballs lot', price: '$12.50', url: 'https://shopgoodwill.com/item/278987071', image: 'https://img.example/b.jpg', src: 'shopgoodwill', hunt: 'madballs', at: 2 },
  { title: 'Etsy hen', price: '$30.00', url: 'https://www.etsy.com/listing/1234567890/hen', image: 'https://img.example/c.jpg', src: 'etsy', hunt: 'hen', at: 1 },
];

test('Undo puts a removed saved find back where it was, saved time and all', async () => {
  const p = loadPage({ storage: { 'prowl.finds': FINDS, 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' } });
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length === 3);
  p.$('#otp-flockRow .fl-card[data-u*="shopgoodwill"] .sgw-sv').click();
  assert.deepEqual(finds(p).map((f) => f.at), [3, 1]);
  assert.match(p.$('#otp-toast').textContent, /Removed from saved finds\. Undo/);
  p.$('#otp-unfind').click();
  assert.deepEqual(finds(p), FINDS);
  await waitFor(() => p.$$('#otp-flockRow .fl-card').length === 3);
  assert.ok(p.$('#otp-flockRow .fl-card[data-u*="shopgoodwill"]'), 'back in Flock › Saved');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the popup keeps View on <site> in a dock pinned to the sheet’s foot', async () => {
  const fetchImpl = (url) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    const body = u.pathname === '/item' ? { src: 'ebay', title: 'Haeger Black Panther TV Lamp', price: '$45.00', images: ['https://i.ebayimg.com/1.jpg'], url: FINDS[0].url } : { items: [] };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.finds': FINDS.slice(0, 1), 'prowl.alertTok': 't', 'prowl.alertEmail': 'a@b.co' } });
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  await waitFor(() => p.$('#otp-flockRow .fl-card .sgw-card img'));
  p.$('#otp-flockRow .fl-card .sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB .pp-dock .pp-go'));
  assert.equal(p.$('#otp-sheetB .pp-dock').parentNode.id, 'otp-sheetB', 'the dock is a direct child of the scrolling body');
  assert.equal(p.$('#otp-sheetB .pp-go').textContent, 'View on eBay ↗');
  assert.match(css, /\.scout-app-wrapper \.pp-dock\{position:-webkit-sticky;position:sticky;bottom:/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the small controls get a 44px tap area', () => {
  const sel = ['.sgw-chip .sgw-x', '.lk-chip button', '.sgw-cbar .sgw-sv', '.sgw-cbar .sgw-lk', '.sgw-cbar .sgw-fp', '.fl-seg button', '#otp-toast .gh'];
  const rule = /\n([^{}\n]*::after[^{}\n]*)\{content:'';position:absolute;top:50%;left:50%;width:100%;min-width:44px;height:44px;min-height:100%;transform:translate\(-50%,-50%\)\}/.exec(css);
  assert.ok(rule, 'the hit-area rule is there');
  for (const s of sel) assert.ok(rule[1].includes('.scout-app-wrapper ' + s + '::after'), s);
});
