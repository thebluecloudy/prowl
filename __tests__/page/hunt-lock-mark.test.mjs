// Page v6.58: a locked hunt's ◉ chip marker has its own class. In v6.54-v6.57 it shared .sgw-lk with the new result-card
// heart, took the heart's absolute 40px circle styling and floated at the top right of the app, under the header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const HUNTS = ['1984 Transformers G1 cassette Ravage', 'Will George'];

async function locked() {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: HUNTS, lock: [0] }, owlTwigSgwTerms: [HUNTS[1]] } });
  await waitFor(() => p.$$('.sgw-chip[data-sgw="pick"]').length >= 2 && p.$$('.sgw-cell').length >= 1);
  return p;
}
const chipFor = (p, t) => p.$$('.sgw-chip[data-sgw="pick"]').find((c) => c.textContent.indexOf(t) > -1);

test('the locked hunt chip carries its ◉ marker inside the chip, with its own class', async () => {
  const p = await locked();
  const chip = chipFor(p, HUNTS[0]);
  assert.ok(chip, 'the locked hunt has a chip');
  const marks = chip.querySelectorAll('s.sgw-lock');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent, '◉');
  assert.equal(marks[0].matches('.scout-app-wrapper .sgw-lk'), false, 'the heart styling does not reach it');
  assert.equal(chip.querySelectorAll('.sgw-lk').length, 0);
  await p.close();
});

test('every .sgw-lk on the page is a heart button inside a result cell', async () => {
  const p = await locked();
  const all = p.$$('.sgw-lk');
  assert.ok(all.length >= 1, 'results have hearts');
  for (const el of all) {
    assert.equal(el.tagName, 'BUTTON');
    assert.ok(el.closest('.sgw-cell'), 'inside a result cell');
    assert.equal(el.closest('.sgw-chip'), null);
  }
  assert.doesNotMatch(PAGE, /<s class="sgw-lk"/, 'the marker markup no longer uses the heart class');
  await p.close();
});

test('tapping the ◉ picks its hunt like the chip does, and likes nothing', async () => {
  const p = await locked();
  chipFor(p, HUNTS[1]).click();
  await waitFor(() => chipFor(p, HUNTS[1]).classList.contains('on'));
  chipFor(p, HUNTS[0]).querySelector('.sgw-lock').click();
  await waitFor(() => chipFor(p, HUNTS[0]).classList.contains('on'));
  assert.equal(chipFor(p, HUNTS[0]).getAttribute('aria-pressed'), 'true');
  assert.equal((ls(p, 'prowl.likes') || []).length, 0);
  await p.close();
});

test('the page says v6.58 or later', () => {
  const m = /var PROWL_VERSION='v(\d+)\.(\d+)';/.exec(PAGE), v = m && [m[0], Number(m[1]) * 100 + Number(m[2]) - 600];   // v7.00 reads as 100, so v6.xx floors still hold
  assert.ok(v && Number(v[1]) >= 58);
});
