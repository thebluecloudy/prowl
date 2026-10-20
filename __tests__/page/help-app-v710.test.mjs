// Page v7.10 (Matt, 2026-10-17: "When people first come to it I want them to get to the app version but they don't see
// it until the end"): How Prowl works, which opens by itself on a first visit, starts with the Get the app card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('How Prowl works (from the menu since v7.31; it no longer opens by itself) has Get the app first, ahead of the steps', async () => {
  const p = loadPage({ storage: {} });
  await tick(600);
  const ms = p.$('#otp-ms');
  assert.ok(!ms.classList.contains('on'), 'v7.31: a first visit lands on the search box, not the help');
  p.$('#otp-how').click();
  assert.ok(ms.classList.contains('on'), 'the menu opens it');
  const card = ms.querySelector('.otp-getapp[data-mode="help"]');
  assert.ok(card && !card.hidden, 'the card shows');
  const first = ms.querySelector('.mi');
  assert.ok(card.compareDocumentPosition(first) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'before step 1');
  assert.match(card.textContent, /Get the Prowl app/);
  assert.equal(card.querySelector('a.b.p').getAttribute('href'), '/pages/prowl-app?install=1');
  assert.ok(card.querySelector('[data-ga="open"]'), 'Open it now');
  assert.equal(card.querySelector('[data-ga="x"]'), null, 'nothing to hide it with here');
  assert.doesNotMatch([...ms.querySelectorAll('.mi h3')].map((h) => h.textContent).join('|'), /Get the app/, 'no second copy at the end');
  assert.deepEqual([...ms.querySelectorAll('.mi u')].map((u) => u.textContent), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('in the installed app the card stays hidden', async () => {
  const p = loadPage({ storage: {}, beforeLoad: (win) => { win.matchMedia = (q) => ({ matches: /standalone/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); } });
  await tick(600);
  assert.equal(p.$('#otp-ms .otp-getapp').hidden, true);
  await p.close();
});
