// Page v8.45 (Matt, 2026-11-01, in an incognito window: "Nothing is showing what we get with pro. Like estate sales and
// Facebook live."): free visitors see what Pro adds on the home screen, in Near me's Estate sales tab and on a hunt's
// Facebook row, and every teaser leads to the 14-day trial (sign in) or checkout.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const HTML = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const opened = [];
after(async () => { for (const p of opened) await p.close(); });
async function open(storage = {}) {
  const p = loadPage({ storage: Object.assign({ 'prowl.v36': { seen: true, hunts: ['pyrex'] } }, storage) });
  opened.push(p);
  await tick(150);
  return p;
}

test('version is v8.45 or later', () => {
  assert.match(HTML, /var PROWL_VERSION='v8\.(4[5-9]|[5-9]\d)';/);
});

test('signed out: the home screen lists what Pro adds, Facebook and estate sales first, with the 14-day trial', async () => {
  const p = await open();
  const c = p.$('#otp-proAdds');
  assert.ok(c, 'card is on the page');
  await waitFor(() => !c.hidden, { timeout: 4000 });
  const t = c.textContent;
  assert.match(t, /Facebook Marketplace, live in your hunts/);
  assert.match(t, /Estate sales this week near you/);
  assert.match(t, /Up to 100 hunts/);
  assert.equal(p.$('#otp-proAddsGo').textContent, 'Try Pro free for 14 days');
});

test('a Pro member does not see the card', async () => {
  const p = await open({ 'prowl.alertEmail': 'a@b.co', 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertPro': '1' });
  await tick(100);
  assert.equal(p.$('#otp-proAdds').hidden, true);
});

test('signed out: Try Pro opens the sign-in with the trial message, no checkout', async () => {
  const p = await open();
  p.$('#otp-proAddsGo').click();
  await tick(80);
  const box = p.$('#otp-denSettings .otp-mail');
  assert.ok(box);
  assert.match(box.textContent, /Prowl Pro is on, free for 14 days\. No card, no password/);
});

test('Near me shows the Estate sales tab to everyone; a free visitor sees what it does, not a sweep', async () => {
  const p = await open();
  p.$('#otp-dock .db[data-m="local"]').click();
  await tick(200);
  const tab = p.$('#otp-nrT4');
  assert.equal(tab.hidden, false);
  tab.click();
  await tick(200);
  const t = p.$('#otp-wkHost').textContent;
  assert.match(t, /Estate sales this week/);
  assert.match(t, /Plan my week turns them into a day-by-day route/);
  assert.match(t, /Try Pro free for 14 days/);
  assert.equal(p.$('#otp-wkGo'), null, 'no sweep for a free visitor');
});

test('a hunt with no Facebook finds yet tells a free visitor that Pro shows them there', () => {
  assert.match(HTML, /if\(!c&&!fbOn\(\)&&!mailPro\(\)&&!fbOwnerKey\(\)\)return '<div class="sgw-sub"><span class="sgw-fbh">Facebook Marketplace<\/span><span class="sgw-lock">/);
  assert.match(HTML, /With Prowl Pro, Facebook Marketplace listings near you for this hunt show right here/);
});

test('the plans and the plan table name Facebook, estate sales, Pounce and saved finds; no stale free-month buttons', () => {
  assert.match(HTML, /<li>Facebook Marketplace near you, in your hunts<\/li><li>This week’s estate sales near you<\/li>/);
  assert.match(HTML, /\['Facebook Marketplace near you, in your hunts'/);
  assert.match(HTML, /\['Pounce \(photo-checked new listings\)','1 piece','5 pieces'\]/);
  assert.doesNotMatch(HTML, /Try Prowl Pro free for a month<\/a>/);
  assert.doesNotMatch(HTML, /free for the first month<\/b>/);
});
