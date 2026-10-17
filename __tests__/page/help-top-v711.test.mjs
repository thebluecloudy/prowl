// Page v7.11 (Matt, 2026-10-17: "When a new user comes to the app it jumps to 6 for the what is it. It needs to start
// at 1"): How Prowl works focused its Got it button, below step 6, and the browser scrolled the help to the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('How Prowl works opens at the top, not scrolled to Got it', async () => {
  const p = loadPage({ storage: {} });
  const ms = p.$('#otp-ms'), md = ms.querySelector('.md'), mok = p.$('#otp-mok');
  let opts = 'none';
  const orig = mok.focus.bind(mok);
  mok.focus = (o) => { opts = o; orig(o); };
  md.scrollTop = 900;
  await tick(600);
  p.$('#otp-mok').click();
  md.scrollTop = 900;
  p.$('#otp-how').click();
  assert.ok(ms.classList.contains('on'));
  assert.equal(md.scrollTop, 0, 'starts at step 1');
  assert.equal(opts && opts.preventScroll, true, 'focus does not scroll');
  assert.equal(p.doc.activeElement, mok, 'keyboard focus still lands on Got it');
  assert.deepEqual(p.errors, []);
  await p.close();
});
