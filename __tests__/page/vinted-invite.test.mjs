// Page v6.91: Matt's Vinted invite shows once, right under a run's first Vinted row. Not on runs without Vinted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const URL_ = 'https://www.vinted.com/invite/thebluecloud/d44jnOwl00QMa1jkpzy6izwlkx6gat8ci';
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const isVinted = (li) => { const a = li && li.querySelector('a.hit'); return !!a && /(^|\.)vinted\.com$/.test(new URL(a.href).hostname); };

async function run(p, q, id) {
  p.$('#otp-q').value = q;
  p.$(id).click();
  await tick(30);
}

test('Search All: one invite line, right after the Vinted row, opening the invite in a new tab', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  await run(p, 'Pyrex Butterprint', '#otp-sa');
  const inv = p.$$('#otp-res li.vinv');
  assert.equal(inv.length, 1);
  assert.ok(isVinted(inv[0].previousElementSibling), 'sits under the Vinted row');
  const a = inv[0].querySelector('a');
  assert.equal(a.href, URL_);
  assert.equal(a.target, '_blank');
  assert.match(a.rel, /noopener/);
  assert.equal(a.hasAttribute('data-li'), false, 'not a result row, so Open all and the row launcher skip it');
  assert.match(a.textContent, /Matt’s invite.*\$20.*3 items.*\$30.*Terms apply/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('two hunts give two Vinted rows but still one invite line', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['Pyrex Butterprint', 'Blenko decanter'], sel: [0, 1] } } });
  await tick(30);
  p.$('#otp-sa').click();
  await tick(30);
  const vRows = p.$$('#otp-res li').filter(isVinted);
  assert.ok(vRows.length >= 2, 'Vinted rows: ' + vRows.length);
  assert.equal(p.$$('#otp-res li.vinv').length, 1);
  await p.close();
});

test('no Vinted in the run, no invite line', async () => {
  const p = loadPage({ storage: DEN });
  await tick(30);
  await run(p, 'Pyrex Butterprint', '#otp-one');   /* the one-site run has no Vinted (v7.30: a pill under the search box, no longer a dock tab) */
  assert.ok(p.$$('#otp-res a.hit').length > 0, 'the run drew rows');
  assert.equal(p.$('#otp-res li.vinv'), null);
  await p.close();
});
