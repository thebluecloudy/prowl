// Page v7.77: the Hunt screen from the owner's design brief ("Prowl design system and UX brief"), the parts still open
// at v7.76. Hunt is the full-width button under the box on a phone; a desktop collapses the hunt pills too (12 and
// +N more); the pills are 44px with 15px words; the sold-price row and Best picks name the hunt they follow; and one
// accent outline shows keyboard focus (the reset takes every button's outline off).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const H = Array.from({ length: 31 }, (_, i) => 'hunt number ' + (i + 1));
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const wide = (w) => (win) => { Object.defineProperty(win, 'innerWidth', { configurable: true, get: () => w }); };
const pills = (p) => p.$$('.sgw-chip[data-sgw="pick"]').map((c) => c.textContent.replace(/×$/, ''));

test('a desktop shows 12 hunt pills and +N more, then all of them, then Show fewer', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: H, lock: H.map((_, i) => i) } }, beforeLoad: wide(1280) });
  await tick(60);
  assert.equal(pills(p).length, 12);
  const more = p.$('.sgw-chip.sgw-more');
  assert.equal(more.textContent, '+19 more');
  more.click(); await tick(20);
  assert.equal(pills(p).length, 31);
  assert.equal(p.$('.sgw-chip.sgw-more').textContent, 'Show fewer');
  p.$('.sgw-chip.sgw-more').click(); await tick(20);
  assert.equal(pills(p).length, 12);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a phone keeps 8; a desktop with 13 shows them all (no "+1 more" for one)', async () => {
  const ph = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: H, lock: H.map((_, i) => i) } }, beforeLoad: wide(390) });
  await tick(60);
  assert.equal(pills(ph).length, 8);
  assert.equal(ph.$('.sgw-chip.sgw-more').textContent, '+23 more');
  await ph.close();
  const H13 = H.slice(0, 13);
  const d = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: H13, lock: H13.map((_, i) => i) } }, beforeLoad: wide(1280) });
  await tick(60);
  assert.equal(pills(d).length, 13);
  assert.equal(d.$('.sgw-chip.sgw-more'), null);
  await d.close();
});

test('the sold-price row and Best picks say which hunt they are for', async () => {
  const fetchImpl = (u) => /\/hunt\?/.test(String(u))
    ? J({ rows: [], median: '$80.00', picks: [{ title: 'Rookwood vase 1920', price: '$90', url: 'https://www.ebay.com/itm/1', src: 'ebay', image: '' }] })
    : J({ items: [] });
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['rookwood vase'], lock: [0] } }, fetchImpl });
  await tick(60);
  p.$$('.sgw-chip[data-sgw="pick"]')[0].click();
  await tick(80);
  const h = p.$('.sgw-body .comps-h');
  assert.equal(h.textContent, 'What has rookwood vase sold for?');
  assert.equal(h.querySelector('b').textContent, 'rookwood vase');
  assert.equal(p.$('.sgw-body .comps-top').getAttribute('aria-label'), 'What has rookwood vase sold for?');
  const pk = p.$('.pk-h');
  assert.ok(pk, 'Best picks drew');
  assert.match(pk.textContent, /^Best picks for rookwood vase typical price \$80\.00$/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a hunt name is text, never markup, in both headings', async () => {
  const t = '<img src=x onerror=alert(1)>';
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [t], lock: [0] } } });
  await tick(60);
  p.$$('.sgw-chip[data-sgw="pick"]')[0].click();
  await tick(60);
  assert.equal(p.$('.sgw-body .comps-h img'), null);
  assert.equal(p.$('.sgw-body .comps-h b').textContent, t);
  await p.close();
});

test('on a phone Hunt is the full-width 52px button; pills are 44px with 15px words; one focus outline', () => {
  assert.match(PAGE, /@media \(max-width:600px\)\{\.scout-app-wrapper #otp-sf>button\[type=submit\]\{flex:1 1 100%;min-height:52px;font-size:17px\}\}/);
  const chip = PAGE.split('\n').find((l) => l.startsWith('.scout-app-wrapper .sgw-chip{display:inline-flex;'));
  assert.match(chip, /min-height:44px/); assert.match(chip, /font-size:15px/); assert.match(chip, /color:var\(--i2\)/);
  assert.ok(!PAGE.includes('.sgw-chip{min-height:40px'), 'no 40px pills left');
  const reset = PAGE.indexOf('.scout-app-wrapper button{cursor:pointer}');
  const ring = PAGE.indexOf('.scout-app-wrapper a:focus-visible,.scout-app-wrapper button:focus-visible,.scout-app-wrapper [role=button]:focus-visible');
  assert.ok(reset > 0 && ring > reset, 'right after the reset that takes the outline off');
  assert.match(PAGE.slice(ring, PAGE.indexOf('}', ring)), /\{outline:2px solid var\(--ac\);outline-offset:2px$/);
});
