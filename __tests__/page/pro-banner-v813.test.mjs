// Page v8.13 (2026-10-28): back from a Pro checkout but not signed in on this device, the banner's "sign in here"
// looked like plain text (its link style only applies inside the email panel) and thanked people for a checkout they
// may not have finished. Now a real Sign in button, neutral wording, and the leftover wait clears after 2 hours.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const opened = [];
const open = (o) => { const p = loadPage(o); opened.push(p); return p; };
after(async () => { for (const p of opened) await p.close(); });

test('not signed in after checkout: Sign in is a primary button, no thanks for an unfinished checkout', async () => {
  const p = open({ storage: { 'prowl.alertProWait': '1', 'prowl.alertProWaitAt': String(Date.now() - 60e3) } });
  await new Promise((r) => setTimeout(r, 900));
  const ban = p.win.document.querySelector('#otp-proBan');
  assert.equal(ban.hidden, false);
  const btn = ban.querySelector('button.b.p[data-pro="settings"]');
  assert.ok(btn, 'a primary Sign in button');
  assert.equal(btn.textContent, 'Sign in');
  assert.doesNotMatch(ban.textContent, /Thanks for upgrading/);
  assert.equal(ban.querySelectorAll('.sgw-ml').length, 0);
});

test('a checkout started over 2 hours ago no longer shows the banner', async () => {
  const p = open({ storage: { 'prowl.alertProWait': '1', 'prowl.alertProWaitAt': String(Date.now() - 3 * 3600e3) } });
  await new Promise((r) => setTimeout(r, 900));
  const ban = p.win.document.querySelector('#otp-proBan');
  assert.ok(ban.hidden || !ban.innerHTML);
});
