// Page v7.08: Keep it simple / Show everything, and shelf scan on the photo screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch } from '../helpers/flockFixture.mjs';

const ST = { 'prowl.v36': { seen: true, hunts: [] } };
async function search(p, term) { await tick(60); p.$('#otp-q').value = term; p.$('#otp-sa').click(); await tick(300); }

test('simple is the default: the marketplace list folds behind one button, and the button opens it', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: ST });
  await search(p, 'pyrex');
  assert.ok(p.$('.scout-app-wrapper').classList.contains('dt-simple'));
  const more = p.$('#otp-dtMore');
  assert.match(more.textContent, /^More places to look/, 'v7.31: was Show all N marketplaces');
  assert.match(more.textContent, /All \d+ marketplaces, Facebook, Instagram, sold prices/);
  more.click();
  assert.ok(p.$('#otp-res .rc').classList.contains('dt-open'));
  await p.close();
});

test('Show everything is saved and drops the simple class', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: ST });
  await tick(60);
  assert.equal(p.$('#otp-detailBtn').textContent, 'Swipe', 'v7.59: Keep it simple is called Swipe');
  p.$('#otp-detailBtn').click();
  assert.equal(p.win.localStorage.getItem('prowl.detail'), 'all');
  assert.ok(!p.$('.scout-app-wrapper').classList.contains('dt-simple'));
  assert.equal(p.$('#otp-detailBtn').textContent, 'Show everything');
  await p.close();
});

test('the photo screen offers One piece or A whole shelf', async () => {
  const p = loadPage({ fetchImpl: liveFetch().impl, storage: ST });
  await tick(60);
  const b = p.$$('#otp-apr .apr-mode [data-am]');
  assert.deepEqual(b.map((x) => x.textContent), ['One piece', 'A whole shelf']);
  b[1].click();
  assert.equal(b[1].getAttribute('aria-pressed'), 'true');
  assert.equal(b[0].getAttribute('aria-pressed'), 'false');
  await p.close();
});
