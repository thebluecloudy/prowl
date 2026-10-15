// Page v7.04: pressing a dock button morphs the main area (View Transitions when the browser has them, a CSS class
// animation otherwise). Den keeps its own drawer slide; Daily with no hunts only shows its toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('fallback: a dock press animates main and still switches mode', async () => {
  const p = loadPage();
  await tick(20);
  const main = p.$('#otp-main');
  assert.ok(main, 'main has an id for the transition');
  p.$('#otp-flockBtn').click();
  assert.ok(main.classList.contains('otp-in'), 'class fallback runs');
  assert.equal(p.$('#otp-flock').hidden, false, 'Flock still opens');
  await tick(350);
  assert.ok(!main.classList.contains('otp-in'), 'class removed after the animation');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('View Transitions: the mode change runs inside startViewTransition and the html flag is cleared', async () => {
  let calls = 0;
  let done;
  const p = loadPage({
    beforeLoad(win) {
      win.document.startViewTransition = (fn) => {
        calls++;
        fn();
        return { finished: new Promise((r) => { done = r; }) };
      };
    },
  });
  await tick(20);
  p.$('#otp-flockBtn').click();
  assert.equal(calls, 1);
  assert.ok(p.doc.documentElement.classList.contains('otp-vt'), 'root flag on while the morph runs');
  assert.equal(p.$('#otp-flock').hidden, false);
  done();
  await tick(5);
  assert.ok(!p.doc.documentElement.classList.contains('otp-vt'), 'root flag cleared');
  await p.close();
});

test('Den, Daily with no hunts and reduced motion do not morph', async () => {
  let calls = 0;
  const p = loadPage({
    storage: { 'prowl.sgw': { extra: [], lock: [] } },
    beforeLoad(win) { win.document.startViewTransition = (fn) => { calls++; fn(); return {}; }; },
  });
  await tick(20);
  p.$('#otp-denBtn').click();
  p.$('[data-m="daily"]').click();
  assert.equal(calls, 0);
  await p.close();
  const r = loadPage({ reducedMotion: true });
  await tick(20);
  r.$('#otp-flockBtn').click();
  assert.ok(!r.$('#otp-main').classList.contains('otp-in'));
  await r.close();
});

test('the transition CSS is scoped: only main is named, root animation is off only while Prowl runs one', async () => {
  const p = loadPage();
  const css = p.doc.getElementById('prowl-css').textContent;
  assert.match(css, /main#otp-main\{view-transition-name:prowl-main\}/);
  assert.match(css, /html\.otp-vt::view-transition-old\(root\)/);
  assert.doesNotMatch(css, /(^|\})::view-transition/);
  await p.close();
});
