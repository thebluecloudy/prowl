// Page v7.54 (the owner, 2026-10-21: "i had a hard time finding ebay sold and terapeak at the bottom of the search
// area, can you make sure that is always visible?"). The two sold-price buttons sit under the search title, in Keep it
// simple too, not in the footer that waits behind More places to look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };

async function hunt(p, q) {
  p.$('#otp-q').value = q;
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(40);
}

test('eBay Sold and Terapeak sit under the title, before the live results, outside the folded footer', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  const opened = [];
  p.win.open = (u) => { opened.push(String(u)); return null; };
  await hunt(p, 'Pyrex butterprint');
  const wrap = p.$('.scout-app-wrapper');
  assert.ok(wrap.classList.contains('dt-simple'), 'Keep it simple is the default');
  const rc = p.$('#otp-res .rc');
  const box = rc.querySelector('.comps-top');
  assert.ok(box, 'the sold-price row');
  assert.equal(box.querySelector('.comps-h').textContent, 'What has it sold for?');
  for (const sel of ['.rf', '.hits', '.oabar']) assert.equal(box.closest(sel), null, 'not inside ' + sel);
  assert.equal(box.previousElementSibling, rc.querySelector('.rh'), 'right under the title');
  assert.ok(box.compareDocumentPosition(rc.querySelector('.run-live')) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'before the live results');
  assert.equal(rc.querySelector('.rf .comps'), null, 'no second copy in the footer');
  assert.equal(p.$$('#otp-comps90').length, 1);
  p.$('#otp-comps90').click();
  p.$('#otp-comps3y').click();
  assert.match(opened[0], /ebay\.com\/sch\/i\.html\?_nkw=Pyrex%20butterprint&LH_Sold=1&LH_Complete=1/);
  assert.match(opened[1], /^https:\/\/www\.ebay\.com\/sh\/research\?marketplace=EBAY-US&tabName=SOLD&dayRange=1095&keywords=Pyrex%20butterprint$/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Keep it simple hides the footer, never the sold-price buttons', () => {
  const rule = PAGE.split('\n').find((l) => l.startsWith('.scout-app-wrapper.dt-simple .rc:not(.dt-open) .rf,'));
  assert.ok(rule, 'the fold rule');
  const sels = rule.slice(0, rule.indexOf('{')).split(',').map((s) => s.trim());
  for (const s of sels) assert.doesNotMatch(s, /\.comps(?!-note)|#otp-comps|\.gh$/, s);
});

