// Page v6.63: on result cards (home hunts, Daily, runs) the save star and the like heart leave the photo. They sit in
// one row under the card with Fair price?, so phones are less busy. A Fair price answer goes under that row. Flock keeps
// its own full-screen buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');

function withVerdict() {
  const base = liveFetch();
  const sent = [];
  const impl = (url, opts) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/verdict') { sent.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ basis: 'sold', verdict: 'DEAL', item: 'Black ceramic panther', fair: '$40-60', why: 'Sold at $55.' }) }); }
    return base.impl(url, opts);
  };
  return { impl, sent };
}
async function home(f, extra = {}) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther'], lock: [0] }, owlTwigSgwTerms: [], ...extra } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell').length >= 3, { timeout: 8000 });
  return p;
}

test('a result card is the link, then one row: star, heart, Fair price?; nothing sits on the photo', async () => {
  const p = await home(withVerdict());
  const cells = p.$$('#otp-sgw .sgw-cell');
  for (const c of cells) {
    const kids = [...c.children].map((k) => k.className.split(' ')[0]);
    assert.deepEqual(kids, ['sgw-card', 'sgw-cbar'], 'the link, then the row');
    const row = c.querySelector(':scope > .sgw-cbar');
    assert.deepEqual([...row.children].map((k) => k.className.split(' ')[0]), ['sgw-sv', 'sgw-lk', 'sgw-fp']);
    assert.equal(c.querySelector(':scope > .sgw-sv, :scope > .sgw-lk'), null, 'no button straight on the cell, where it was placed over the photo');
    assert.equal(c.querySelector('.sgw-card button'), null, 'no button inside the link');
  }
  /* the row's buttons are laid out in the row, not absolutely over the photo */
  assert.match(PAGE, /\.scout-app-wrapper \.sgw-cbar \.sgw-sv,\.scout-app-wrapper \.sgw-cbar \.sgw-lk\{position:static;/);
  assert.match(PAGE, /\.scout-app-wrapper \.sgw-cbar\{display:flex;/);
  assert.equal(p.errors.length, 0, String(p.errors[0] || ''));
  await p.close();
});

test('the star saves and the heart likes from the row', async () => {
  const p = await home(withVerdict(), { 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' });   /* saving finds is for members */
  const c = p.$('#otp-sgw .sgw-cell'), u = c.getAttribute('data-u');
  c.querySelector('.sgw-cbar .sgw-sv').click();
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.finds') || '[]').some((f) => f.url === u), 'saved');
  assert.equal(p.$('#otp-sgw .sgw-cell .sgw-cbar .sgw-sv').classList.contains('on'), true);
  p.$('#otp-sgw .sgw-cell .sgw-cbar .sgw-lk').click();
  await tick(50);
  assert.ok(JSON.parse(p.win.localStorage.getItem('prowl.likes') || '[]').some((l) => l.u === u), 'liked');
  await p.close();
});

test('a Fair price answer goes under the row; the star and heart stay in it', async () => {
  const f = withVerdict();
  const p = await home(f);
  const c = p.$('#otp-sgw .sgw-cell');
  c.querySelector('.sgw-cbar .sgw-fp').click();
  const ans = await waitFor(() => c.querySelector('.sgw-fpr'));
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].url, c.getAttribute('data-u'), 'the cell is found from the button in the row');
  assert.equal(ans.previousElementSibling.className, 'sgw-cbar', 'right under the row');
  assert.match(ans.textContent, /Deal|DEAL|deal/);
  const row = c.querySelector('.sgw-cbar');
  assert.deepEqual([...row.children].map((k) => k.className.split(' ')[0]), ['sgw-sv', 'sgw-lk']);
  /* a later redraw keeps the answer under the row */
  p.$$('.sgw-chip[data-sgw="pick"]')[0].click();
  await tick(60);
  const c2 = p.$('#otp-sgw .sgw-cell[data-u="' + c.getAttribute('data-u') + '"]');
  assert.ok(c2.querySelector(':scope > .sgw-cbar + .sgw-fpr'), 'drawn again with the answer under the row');
  assert.equal(c2.querySelector('.sgw-fp'), null);
  await p.close();
});

test('Flock cards keep their own buttons: no row, the star placed by Flock, no Fair price', async () => {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther'] }, owlTwigSgwTerms: [] } });
  await tick(50);
  p.$('#otp-dock .db[data-m="flock"]').click();
  const card = await waitFor(() => p.$('#otp-flockRow .fl-card'), { timeout: 8000 });
  assert.equal(card.querySelector('.sgw-cbar'), null);
  assert.ok(card.querySelector(':scope > .sgw-sv'), 'the star, placed by Flock');
  assert.equal(card.querySelector('.sgw-lk'), null, 'Flock has its own heart');
  assert.ok(card.querySelector('.fl-lk'));
  assert.equal(card.querySelector('.sgw-fp'), null);
  await p.close();
});
