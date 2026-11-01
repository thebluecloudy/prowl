// Page v8.40 (worker v212, Matt 2026-11-01: a 14-day reverse trial instead of a pay-only plan): a member on the trial
// sees how many days are left and can still buy Pro; once it ends, the Free plan says so and checkout skips PROWLMONTH.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const HTML = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

const opened = [];
after(async () => { for (const p of opened) await p.close(); });
const ENDS = new Date(Date.now() + 5.5 * 86400000).toISOString();
function rig(status) {
  const calls = [];
  const fetchImpl = (u, o) => {
    const url = String(u), body = o && o.body ? JSON.parse(o.body) : null;
    calls.push({ url, body });
    const j = /cart\.js$/.test(url) ? { items: [] } : /alerts\/status/.test(url) ? Object.assign({ on: true, email: 'a@b.co' }, status) : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
  };
  return { calls, fetchImpl };
}
async function open(r, pro) {
  const p = loadPage({ fetchImpl: r.fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'] }, 'prowl.alertEmail': 'a@b.co', 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertPro': pro ? '1' : '' } });
  opened.push(p);
  await waitFor(() => r.calls.some((c) => /alerts\/status/.test(c.url)), { timeout: 8000 });
  await tick(120);
  return p;
}
const TRIAL = { pro: true, hadPro: true, plan: { via: 'trial', trial: true, ends: ENDS, daysLeft: 6 } };

test('version is v8.40', () => {
  assert.match(HTML, /var PROWL_VERSION='v8\.40';/);
});

test('on the trial: the plan says Free trial with the days left and offers Keep Pro', async () => {
  const p = await open(rig(TRIAL), true);
  const t = p.$('#otp-denSettings .otp-mail').textContent;
  assert.match(t, /Free trial · 6 days left/);
  assert.match(t, /14 days of Pro free, no card/);
  assert.match(t, /Keep Pro · \$7\/mo/);
});

test('on the trial, Upgrade still opens checkout, without the free-month code', async () => {
  const r = rig(TRIAL);
  const p = await open(r, true);
  const link = p.doc.createElement('a'); link.href = '/products/prowl-pro'; p.$('.scout-app-wrapper').appendChild(link);
  link.click();
  await tick(80);
  assert.equal(r.calls.filter((c) => /cart\/add\.js$/.test(c.url)).length, 1, 'no "you already have Pro" stop');
  assert.doesNotMatch(p.$('#otp-denSettings .otp-mail') ? p.$('#otp-denSettings .otp-mail').textContent : '', /You already have Prowl Pro/);
});

test('after the trial: Free says it ended and Upgrade is the paid plan', async () => {
  const p = await open(rig({ pro: false, hadPro: true, plan: null, trialEnded: '2026-11-15' }), false);
  const t = p.$('#otp-denSettings .otp-mail').textContent;
  assert.match(t, /Your 14 free days of Pro ended/);
  assert.match(t, /Upgrade · \$7\/mo/);
  assert.doesNotMatch(t, /Start my free month/);
});

test('signed-out visitors are told about the 14 days, not the free month', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['pyrex'] } } });
  opened.push(p);
  await tick(60);
  assert.match(HTML, /<span>14 days of Pro free<\/span>/);
  assert.doesNotMatch(HTML, /<span>First month free<\/span>/);
  assert.match(HTML, /function proFreeTxt\(\)\{return !mGet\('alertTok'\)\?'14 days free when you sign up'/);
});
