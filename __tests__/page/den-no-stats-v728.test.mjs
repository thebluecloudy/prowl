// Page v7.28 (the owner, 2026-10-19: "I didn't really need it in den this should all only be in admin"): the Den's
// STATS tab is gone. Visitors, searches and referrers live on the admin's Searches tab (v7.27 / worker v127). Your
// marketplaces, which counts this device only, is back in Den › Settings where it was before v7.22.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('the Den has no Stats tab; Your marketplaces is in Settings', async () => {
  const p = loadPage({ storage: { 'prowl.owner': 'abcdefghijklmnop', 'prowl.mktStats': { ebay: { o: 3, f: 1, l: 1 } } } });
  await tick(300);
  p.$('#otp-denBtn').click();
  assert.equal(p.$('#otp-denT6'), null);
  assert.equal(p.$('#otp-denStatsP'), null);
  assert.ok(![...p.doc.querySelectorAll('#otp-den .tab')].some((t) => /STATS/.test(t.textContent)));
  p.$('#otp-denT3').click();
  const box = p.$('#otp-denSettings #otp-denStats');
  assert.ok(box, 'Your marketplaces sits in Settings');
  assert.match(box.textContent, /Your marketplaces/);
  assert.match(box.textContent, /1 saved · 3 opened/);
  assert.deepEqual(p.errors, []);
  await p.close();
});
