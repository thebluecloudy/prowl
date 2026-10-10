// Page v6.74: the home panel ends with "Continue the full hunt" (the panel shows only the live listings, and the full
// hunt button sat up in the left column); "One search, every marketplace" and the Prowl Alerts sign-up go once
// someone is hunting / has Alerts; a new find keeps a "New" tag (the glow plays once) and the Den's hunts count new
// finds; and a single search redraws only the strip of the marketplace that answered (bug I3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const FAV = { 'prowl.v36': { seen: true, hunts: ['pyrex', 'fiesta'] }, owlTwigSgwTerms: ['pyrex', 'fiesta'], 'prowl.lastHunt': 'pyrex' };
async function home(storage = FAV, fetchImpl = liveFetch().impl) {
  const p = loadPage({ fetchImpl, storage });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-u]').length >= 3, { timeout: 6000 });
  await tick(400);
  return p;
}

test('the live listings end with "Continue the full hunt", which runs the hunt on every marketplace', async () => {
  const p = await home();
  const body = p.$('#otp-sgw .sgw-body');
  const cont = body.lastElementChild;
  assert.ok(cont.classList.contains('sgw-cont'), 'the last thing in the panel');
  assert.match(cont.textContent, /These are the live listings\. The full hunt searches all 29 marketplaces for “pyrex”/);
  const b = cont.querySelector('button[data-sgw="hunt"]');
  assert.deepEqual(p.$$('#otp-sgw [data-sgw="hunt"]'), [b], 'the only full-hunt button in the panel (it was up in the left column)');
  assert.equal(b.textContent, 'Continue the full hunt →');
  b.click();
  await waitFor(() => !p.$('#otp-res').hidden && p.$$('#otp-res a.hit').length > 20, { timeout: 6000 });
  assert.match(p.$('#otp-res').textContent, /pyrex/i);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('"One search, every marketplace" is for someone new: gone once there are favorite hunts or a hunt was run', async () => {
  const p = await home();
  assert.equal(p.$('.whyp').hidden, true, 'favorite hunts on the home panel');
  await p.close();
  const fresh = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [] } });
  await tick(200);
  assert.equal(fresh.$('.whyp').hidden, false, 'a new visitor still sees it');
  await fresh.close();
  const ran = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [], owlTwigSearchLog: { pyrex: Date.now() } } });
  await tick(200);
  assert.equal(ran.$('.whyp').hidden, true, 'a hunt run on this device');
  await ran.close();
});

test('the Prowl Alerts sign-up goes once Alerts are set up on this device', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [] } });
  await tick(200);
  assert.equal(p.$('#otp-alerts').hidden, false);
  await p.close();
  const m = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [], 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'me@example.com' } });
  await tick(200);
  assert.equal(m.$('#otp-alerts').hidden, true);
  await m.close();
});

test('a new find keeps a "New" tag on its title; one seen before has none', async () => {
  const p = await home({ ...FAV, 'prowl.seenUrls': { pyrex: ['https://shopgoodwill.com/item/pyrex-0'] } });
  await waitFor(() => p.$$('#otp-sgw .sgw-cell[data-fresh]').length >= 2, { timeout: 6000 });
  const cell = (u) => p.$(`#otp-sgw .sgw-cell[data-u="${u}"]`);
  assert.equal(cell('https://shopgoodwill.com/item/pyrex-0').querySelector('.fl-newb'), null);
  const t = cell('https://shopgoodwill.com/item/pyrex-1').querySelector('.sgw-t');
  assert.equal(t.firstElementChild.className, 'fl-newb');
  assert.equal(t.firstElementChild.textContent, 'New');
  assert.equal(p.$$('#otp-sgw .sgw-cell[data-fresh] .sgw-t .fl-newb').length, p.$$('#otp-sgw .sgw-cell[data-fresh]').length, 'one tag per new find');
  await p.close();
});

test('the Den says how many finds are new for a hunt opened before, like its chip on the home panel', async () => {
  const p = await home({ ...FAV, 'prowl.seenUrls': { fiesta: ['https://shopgoodwill.com/item/fiesta-0'] } });
  /* fiesta's finds come in through a search of it (not its chip, which would mark them seen) */
  p.$('#otp-q').value = 'fiesta';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => p.$('#otp-res .rlive[data-lv="shopgoodwill"] .sgw-cell'), { timeout: 6000 });
  await tick(300);
  const chip = () => p.$$('#otp-sgw .sgw-chip[data-sgw="pick"]').find((c) => /fiesta/.test(c.textContent));
  await waitFor(() => chip() && chip().querySelector('.sgw-new'), { timeout: 8000 });
  const want = chip().querySelector('.sgw-new').textContent;
  assert.match(want, /^\d\+? new$/);
  p.$('#otp-sgw [data-sgw="den"]').click();
  await tick(100);
  const rows = p.$$('#otp-denList li');
  const fiesta = rows.find((li) => /fiesta/.test(li.textContent)), pyrex = rows.find((li) => /pyrex/.test(li.textContent));
  assert.equal(fiesta.querySelector('.tt .sgw-new').textContent, want, 'the same count as the chip');
  assert.equal(pyrex.querySelector('.sgw-new'), null, 'the hunt on screen has nothing new');
  await p.close();
});

test('a single search redraws only the strip of the marketplace that answered (bug I3)', async () => {
  const f = liveFetch(), held = [];
  const impl = (u) => (/\/ebay\?/.test(String(u)) ? new Promise((r) => held.push(() => r(f.impl(u)))) : f.impl(u));
  const p = loadPage({ fetchImpl: impl, storage: { 'prowl.v36': { seen: true, hunts: [] }, owlTwigSgwTerms: [] } });
  await tick(100);
  p.$('#otp-q').value = 'pyrex';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { cancelable: true, bubbles: true }));
  await waitFor(() => p.$('#otp-res .rlive[data-lv="shopgoodwill"] .sgw-cell') && held.length > 0, { timeout: 6000 });
  await tick(400);
  const hit = p.$('#otp-res a.hit'), sgwStrip = p.$('#otp-res .rlive[data-lv="shopgoodwill"]'), ebay = p.$('#otp-res .rlive[data-lv="ebay"]');
  assert.ok(hit && sgwStrip && ebay, 'rows, the Goodwill strip and the eBay strip (still loading)');
  while (held.length) held.shift()();
  await waitFor(() => p.$('#otp-res .rlive[data-lv="ebay"] .sgw-cell'), { timeout: 6000 });
  assert.equal(p.$('#otp-res a.hit'), hit, 'the marketplace rows are the same elements');
  assert.equal(p.$('#otp-res .rlive[data-lv="shopgoodwill"]'), sgwStrip, 'and so is the Goodwill strip');
  assert.notEqual(p.$('#otp-res .rlive[data-lv="ebay"]'), ebay, 'only eBay\'s strip was redrawn');
  assert.deepEqual(p.errors, []);
  await p.close();
});

/* Email this (v5.99, back in v6.74; worker v98 POST /share/email): the row under a Photo check or research result */
test('Email this sends the notes and the photo card to the worker, and says so', async () => {
  const { readFileSync } = await import('node:fs');
  const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  const src = PAGE.slice(PAGE.indexOf("  var EAPI='"), PAGE.indexOf('  function shareCard(r,src,save){'));
  assert.match(src, /function emailRow\(host,item,text,r,src\)/);
  assert.match(PAGE, /emb\.textContent='Email this';[\s\S]{0,400}emailRow\(O,/, 'on the Photo check result');
  assert.match(PAGE, /emr\.textContent='Email this';[\s\S]{0,300}emailRow\(d,j\.item\|\|name,rsNotes\('research_email'\),r,pic\)/, 'and on research');
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.alertEmail': 'me@example.com' } });
  await tick(50);
  const posts = [];
  p.win.fetch = (u, o) => { posts.push({ u, o }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }); };
  p.win.eval('(function(){function OH(){return {"Content-Type":"application/json"}} function renderCard(r,s,cb){cb(null)}\n' + src + '\nwindow.__er=emailRow})()');
  const host = p.doc.createElement('div'); p.doc.body.appendChild(host);
  p.win.__er(host, 'Black panther lamp', 'Black panther lamp, fair price $40-60', null, null);
  const row = host.querySelector('.apr-em');
  assert.equal(row.querySelector('input').value, 'me@example.com', 'filled with your Alerts email');
  row.querySelector('input').value = 'not right';
  row.querySelector('button').click();
  assert.equal(row.querySelector('.apr-ems').textContent, 'That email does not look right.');
  assert.equal(posts.length, 0);
  row.querySelector('input').value = 'Friend@Example.com';
  row.querySelector('button').click();
  await tick(20);
  assert.equal(posts[0].u, 'https://prowl.thebluecloud.workers.dev/share/email');
  assert.deepEqual(JSON.parse(posts[0].o.body), { to: 'friend@example.com', from: 'me@example.com', item: 'Black panther lamp', text: 'Black panther lamp, fair price $40-60', card: '' });
  assert.equal(row.querySelector('.apr-ems').textContent, 'Sent to friend@example.com. Check spam the first time.');
  p.win.__er(host, 'x', 'y', null, null);
  assert.equal(host.querySelector('.apr-em'), null, 'a second tap closes the row');
  await p.close();
});
