// Page v6.66: on a Flock card the site pill, the heart, Share and the star are one row under the title, in the card's
// flow. They were placed over the bottom of the photo at a fixed distance from the card's foot, and on some phones they
// covered the title and its New badge. Only the ✕ and the price stay on the photo, in its top corners.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const cards = (p) => p.$$('#otp-flockRow .fl-card');

async function flock(hunts, storage = {}) {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts }, ...storage } });
  p.win.confirm = () => true;
  await tick(50);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => cards(p).length >= 3, { timeout: 8000 });
  return p;
}

test('every card: photo and text first, then one row with the site, the heart, Share and the star', async () => {
  const p = await flock(['Roseville jardiniere', 'Pyrex Butterprint'], { 'prowl.flockSeen': JSON.stringify(['https://seen.example/1']) });
  const all = cards(p);
  for (const c of all) {
    const a = c.querySelector(':scope > .sgw-card');
    assert.ok(a, 'the listing link');
    assert.ok(a.querySelector('img') && a.querySelector('.sgw-t'), 'photo and title in the link');
    assert.equal(a.lastElementChild.className, 'fl-for', 'the hunt line closes the link');
    const bar = a.nextElementSibling;
    assert.equal(bar && bar.className, 'fl-bar', 'the row comes straight after the title and hunt line');
    assert.deepEqual([...bar.children].map((x) => x.className), ['fl-tags', 'fl-acts']);
    assert.ok(bar.querySelector('.fl-tags .fl-site').textContent, 'the site pill');
    assert.deepEqual([...bar.querySelector('.fl-acts').children].map((x) => x.className.split(' ')[0]), ['fl-lk', 'fl-sh', 'sgw-sv'], 'heart, Share, star');
    assert.equal(c.querySelector(':scope > .fl-lk, :scope > .fl-sh, :scope > .sgw-sv, :scope > .fl-tags'), null, 'nothing loose on the card to be placed over the photo');
    assert.equal(c.querySelectorAll('.sgw-sv').length, 1, 'one star');
    assert.ok(c.querySelector(':scope > .fl-x'), 'the ✕ stays on the photo');
    assert.ok(c.querySelector('.sgw-card .sgw-p[data-act="margin"]'), 'the price stays on the photo');
  }
  assert.ok(all.some((c) => c.querySelector('.sgw-t .fl-newb')), 'a New card keeps its badge in the title');
  await p.close();
});

test('the buttons in the row still work: star saves, heart likes', async () => {
  const p = await flock(['Roseville jardiniere', 'Pyrex Butterprint'], { 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' });
  const c = cards(p)[0], u = c.getAttribute('data-u');
  c.querySelector('.fl-bar .sgw-sv').click();
  assert.ok((ls(p, 'prowl.finds') || []).some((f) => f.url === u), 'saved');
  assert.ok(c.querySelector('.fl-bar .sgw-sv').classList.contains('on') || p.$('#otp-flockRow .fl-card[data-u="' + u + '"] .fl-bar .sgw-sv.on'), 'the star shows saved');
  const lk = c.querySelector('.fl-bar .fl-lk');
  lk.click();
  await tick(30);
  const now = p.$('#otp-flockRow .fl-card[data-u="' + u + '"] .fl-lk');
  assert.equal(now.getAttribute('aria-pressed'), 'true');
  assert.ok((ls(p, 'prowl.likes') || []).some((x) => x.u === u), 'liked');
  await p.close();
});

test('a "$&" or "$\'" in a hunt stays as typed: the card markup is never copied into the title or the hunt line', async () => {
  const hunt = "Pyrex $' and $& bowl";
  const p = await flock([hunt]);
  for (const c of cards(p)) {
    assert.equal(c.querySelector('.fl-for').textContent, 'for ' + hunt);
    assert.match(c.getAttribute('aria-label'), /\$' and \$& bowl/);
    assert.equal(c.querySelectorAll('.sgw-card').length, 1, 'one listing link');
    assert.equal(c.querySelectorAll('.fl-bar').length, 1, 'one row');
    assert.equal(c.querySelectorAll('.fl-x').length, 1, 'one ✕');
  }
  await p.close();
});

test('no Flock style puts the row, the site pill, the heart, Share or the star back over the photo', () => {
  const css = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const flockRules = rules.filter((r) => /#otp-flock/.test(r.sel) && /\.fl-(bar|tags|site|auc|acts|lk|sh)\b|\.fl-card \.sgw-sv|\.fl-bar \.sgw-sv/.test(r.sel));
  assert.ok(flockRules.length >= 6, 'found the row styles: ' + flockRules.length);
  for (const r of flockRules) {
    assert.doesNotMatch(r.body, /position:\s*absolute|(^|;)\s*(bottom|top|left|right):/, r.sel + ' {' + r.body + '}');
  }
  const bar = rules.find((r) => /#otp-flock\.as-feed \.fl-bar$/.test(r.sel));
  assert.ok(bar && /display:flex/.test(bar.body) && /flex:0 0 auto/.test(bar.body), 'the row keeps its height; the photo takes what is left');
});
