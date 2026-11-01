// Page v8.37 (Matt: "use liinks.co's home page as a reference for how prowl works"). How Prowl works opens with a
// promise and a box to try it; each feature is a short title, one line and a small picture of it, the steps folded under
// How; then Prowl or one site at a time, the two plans, questions, and Start hunting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const WORKER = readFileSync(new URL('../../worker/index.js', import.meta.url), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: ['Royal Haeger panther'] } };
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });

test('the top: the title band, a promise and a box to try it, then the film and the steps', async () => {
  const p = loadPage({ storage: DEN });
  try {
    await tick(30);
    const ms = p.$('#otp-ms'), hero = ms.querySelector('.hw-hero');
    assert.equal(hero.querySelector('h2').textContent, 'How Prowl works');
    assert.match(hero.querySelector('.hw-big').textContent, /^Type it once\. Prowl hunts \d+ vintage marketplaces\.$/);
    assert.ok(hero.querySelector('#otp-hwTry #otp-hwQ'), 'a box to try it');
    assert.ok(hero.compareDocumentPosition(p.$('#otp-film')) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'the film after it');
    const mi = [...ms.querySelectorAll('.mi')];
    assert.equal(mi.length, 9);
    for (const m of mi) {
      assert.ok(m.querySelector('h3').textContent.length <= 24, 'a short title: ' + m.querySelector('h3').textContent);
      assert.ok(m.querySelector('.hw-one'), 'one line');
      assert.equal(m.querySelector('.hw-mock').getAttribute('aria-hidden'), 'true', 'a picture of it, not read out');
      const how = m.querySelector('details.hw-how');
      assert.equal(how.querySelector('summary').textContent, 'How');
      assert.equal(how.open, false, 'the steps are folded');
    }
    assert.deepEqual(p.errors, []);
  } finally { await p.close(); }
});

test('the try box runs that search on the home screen and closes the help; empty, it runs the example', async () => {
  const urls = [];
  const p = loadPage({ storage: DEN, fetchImpl: (u) => { urls.push(String(u)); return J({ items: [] }); } });
  try {
    await tick(30);
    p.$('#otp-how').click(); await tick(10);
    assert.ok(p.$('#otp-ms').classList.contains('on'));
    p.$('#otp-hwQ').value = 'Blenko glass';
    p.$('#otp-hwTry').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
    await tick(30);
    assert.equal(p.$('#otp-ms').classList.contains('on'), false, 'the help closed');
    assert.equal(p.$('#otp-q').value, 'Blenko glass');
    p.$('#otp-how').click(); await tick(10);
    p.$('#otp-hwQ').value = '';
    p.$('#otp-hwTry').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
    await tick(30);
    assert.equal(p.$('#otp-q').value, 'Pyrex Butterprint', 'the placeholder example');
  } finally { await p.close(); }
});

test('Start hunting closes the help and puts you in the search box', async () => {
  const p = loadPage({ storage: DEN });
  try {
    await tick(30);
    p.$('#otp-how').click(); await tick(10);
    assert.equal(p.$('#otp-mok').textContent, 'Start hunting');
    p.$('#otp-mok').click(); await tick(10);
    assert.equal(p.$('#otp-ms').classList.contains('on'), false);
    assert.equal(p.doc.activeElement, p.$('#otp-q'));
  } finally { await p.close(); }
});

test('Prowl or one site at a time, the plans (their numbers are the code\'s), and the questions', () => {
  const free = /<div class="hw-plan"><b>Free<\/b>(.*?)<\/div>/.exec(PAGE)[1], pro = /<div class="hw-plan hw-pro"><b>Prowl Pro<\/b>(.*?)<\/div>/.exec(PAGE)[1];
  const hf = Number(/var HUNTS_FREE=(\d+),HUNTS_PRO=(\d+);/.exec(PAGE)[1]), hp = Number(/var HUNTS_FREE=(\d+),HUNTS_PRO=(\d+);/.exec(PAGE)[2]);
  const pf = Number(/const PHOTO_FREE_PER_DAY = (\d+);/.exec(WORKER)[1]);
  assert.match(free, new RegExp('<li>' + hf + ' hunts in your Den</li>'));
  assert.match(free, new RegExp('<li>' + pf + ' photo check a day</li>'));
  assert.match(free, /<li>Email alerts for 3 hunts<\/li>/);
  assert.match(pro, new RegExp('<li>Up to ' + hp + ' hunts, all in your alerts</li>'));
  assert.match(pro, /\$7<small>\/month<\/small>/);
  assert.match(pro, /First month free\. Cancel any time\./);
  assert.match(pro, /<a class="b p" href="\/products\/prowl-pro">Try Prowl Pro free for a month<\/a>/);
  const rows = [...PAGE.matchAll(/<tr><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)];
  assert.equal(rows.length, 5);
  for (const r of rows) assert.equal(r[2], '✓', 'Prowl does each: ' + r[1]);
  const qs = [...PAGE.matchAll(/<details class="hw-q"><summary>(.*?)<\/summary>/g)].map((m) => m[1]);
  assert.deepEqual(qs, ['Is Prowl free?', 'Which marketplaces does it search?', 'Does it work on my phone?', 'How do I know what a piece is worth?', 'Can I cancel Prowl Pro?']);
  assert.match(PAGE, /<details class="gloss"><summary>Prowl's words<\/summary>/, 'Prowl\'s words stay');
});
