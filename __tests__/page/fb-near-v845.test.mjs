// Page v8.45 (worker v219, Matt, of a strip that said "Facebook had 16: 11 too far, 4 without all your words, 1 sold or
// not usable." and showed no cards: "When Facebook says this why not show them?"): /fb-finds' near (the listings Prowl
// set aside) stays folded behind a "Show them (N)" button on the reason line; it opens "Close but not a match", each
// card tagged "62 mi away" or "missing: escher". Collapsed by default, nothing new in localStorage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const today = new Date(); today.setHours(8, 5, 0, 0);
const DAY = today.toISOString().slice(0, 10);
const PRO = { 'prowl.alertPro': '1', 'prowl.alertTok': 'T'.repeat(24), 'prowl.alertEmail': 'pro@example.com' };
const U = (id) => 'https://www.facebook.com/marketplace/item/' + id + '/';
const item = (id, extra = {}) => ({ title: 'Escher print ' + id, price: '$' + id.slice(0, 2), url: U(id), image: '', found: DAY, ...extra });
const NEAR = [item('2222222', { title: 'Escher print far', miles: 62, why: 'far' }), item('3333333', { title: 'Framed print', miles: 2, why: 'words', missing: ['escher'] }),
  item('4444444', { why: 'far' }), item('5555555', { why: 'sold' }), item('6666666', { why: 'words', missing: ['<b>', 'ok'] }), { why: 'far', title: 'bad', url: 'https://evil.example/1/' }];
const WHY = { raw: 16, far: 11, words: 4, mi: 25 };

function rig({ finds, all } = {}) {
  const base = liveFetch({});
  const ok = (j, s = 200) => Promise.resolve({ ok: s < 400, status: s, json: () => Promise.resolve(j) });
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname === '/fb-finds') return ok(u.searchParams.get('all') ? all || { live: true, left: 5, hunts: [] } : finds);
    if (u.pathname === '/fb-search') return ok({ ok: true, q: 'escher', radius: 25, items: [], near: [NEAR[0]], left: 4 });
    if (u.pathname === '/alerts/status') return ok({ on: true, pro: true, hunts: ['escher print'], prefs: { zip: '48375', radius: 25 }, fb: true });
    return base.impl(url, opts);
  };
  return { impl };
}
async function home(f) {
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['escher print'], lock: [0] }, owlTwigSgwTerms: [], ...PRO } });
  await waitFor(() => p.$$('#otp-sgw .sgw-sub').some((x) => /Facebook Marketplace/.test(x.textContent)), { timeout: 8000 });
  return p;
}
const btn = (p, root = '#otp-sgw') => p.$(root + ' button[data-fbnear]');
const sec = (p, root = '#otp-sgw') => p.$(root + ' .fb-near');

test('v8.45: an empty strip: the reason line gets Show them (N); the section is collapsed by default', async () => {
  const p = await home(rig({ finds: { term: 'escher print', live: true, updated: today.toISOString(), usa: false, radius: 25, pending: false, why: WHY, items: [], near: NEAR } }));
  await waitFor(() => btn(p), { timeout: 4000 });
  const b = btn(p), note = b.closest('p');
  assert.match(note.textContent, /^Facebook had 16: 11 too far, 4 without all your words, 1 sold or not usable\. Show them \(4\)$/);
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.ok(sec(p).hasAttribute('hidden'), 'collapsed by default');
  assert.equal(p.$$('#otp-sgw .fb-near .sgw-cell').length, 4, 'sold and bad links are dropped');
  const before = JSON.stringify(Object.keys(p.win.localStorage).sort());
  b.click();
  await tick(10);
  assert.ok(!sec(p).hasAttribute('hidden'), 'open');
  assert.equal(btn(p).getAttribute('aria-expanded'), 'true');
  assert.equal(btn(p).textContent, 'Hide them');
  assert.match(sec(p).textContent, /Close but not a match/);
  assert.match(sec(p).textContent, /not in your alerts/);
  const tags = p.$$('#otp-sgw .fb-near .sgw-fbtag').map((x) => x.textContent);
  assert.deepEqual(tags, ['62 mi away', 'missing: escher', 'Too far to tell', 'missing: ok']);
  assert.doesNotMatch(sec(p).innerHTML, /62 mi<\/|· 62 mi/, 'the far one’s miles are its tag, not said twice');
  assert.match(p.$$('#otp-sgw .fb-near .sgw-m')[1].textContent, /2 mi/, 'a missing-word one keeps its distance');
  btn(p).click();
  await tick(10);
  assert.ok(sec(p).hasAttribute('hidden'));
  assert.equal(btn(p).textContent, 'Show them (4)');
  assert.equal(JSON.stringify(Object.keys(p.win.localStorage).sort()), before, 'nothing new kept on the device');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.45: a strip with finds says Facebook also had N; no near, no button; an old answer without near loads', async () => {
  let p = await home(rig({ finds: { term: 'escher print', live: true, updated: today.toISOString(), usa: false, radius: 25, pending: false, why: WHY, items: [item('1111111', { miles: 4 })], near: NEAR.slice(0, 2) } }));
  await waitFor(() => btn(p), { timeout: 4000 });
  assert.match(btn(p).closest('p').textContent, /^Facebook also had 2 close but not a match\. Show them \(2\)$/);
  assert.ok(sec(p).hasAttribute('hidden'));
  await p.close();
  p = await home(rig({ finds: { term: 'escher print', live: true, updated: today.toISOString(), usa: true, radius: 25, pending: false, why: { raw: 5, far: 0, words: 5, mi: 500 }, items: [] } }));
  await waitFor(() => /none with all your words/.test(p.$('#otp-sgw').textContent), { timeout: 4000 });
  assert.equal(btn(p), null, 'nothing set aside: no button (All USA, a record from before v219)');
  assert.equal(sec(p), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.45: Store › Facebook: a hunt with nothing and one with finds both offer theirs, collapsed', async () => {
  const all = { live: true, left: 5, hunts: [
    { term: 'escher print', updated: today.toISOString(), pending: false, usa: false, why: WHY, items: [], near: NEAR },
    { term: 'hull vase', updated: today.toISOString(), pending: false, usa: true, why: { raw: 3, far: 0, words: 1, mi: 500 }, items: [item('7777777')], near: [item('8888888', { why: 'words', missing: ['hull'] })] }] };
  const p = await home(rig({ finds: { term: 'escher print', live: true, updated: today.toISOString(), pending: false, why: WHY, items: [], near: [] }, all }));
  p.$('#otp-dock .db[data-m="store"]').click();
  await tick(50);
  const s = p.$('#otp-stSel'); s.value = 'facebook'; s.dispatchEvent(new p.win.Event('change', { bubbles: true }));
  await waitFor(() => p.$$('#otp-fbAll button[data-fbnear]').length === 2, { timeout: 4000 });
  const bs = p.$$('#otp-fbAll button[data-fbnear]');
  assert.deepEqual(bs.map((b) => b.textContent), ['Show them (1)', 'Show them (4)']);
  assert.ok(p.$$('#otp-fbAll .fb-near').every((x) => x.hasAttribute('hidden')));
  bs[1].click();
  await tick(10);
  const open = p.$$('#otp-fbAll .fb-near').filter((x) => !x.hasAttribute('hidden'));
  assert.equal(open.length, 1);
  assert.equal(open[0].querySelectorAll('.sgw-cell').length, 4);
  assert.match(open[0].textContent, /Close but not a match/);
  assert.equal(p.$('#otp-fbAll .fb-rl li span').textContent.replace(/Updated.*$/, ''), 'Facebook had 16: 11 too far, 4 without all your words, 1 sold or not usable.', 'the reason line is as before');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('v8.45: the page script stays ES5 in the new parts and has no Liquid openers', () => {
  const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  const a = html.indexOf('function fbNearClean('), b = html.indexOf('function fbOneGo(');
  assert.ok(a > 0 && b > a);
  const part = html.slice(a, b);
  assert.doesNotMatch(part, /\b(let|const)\s|=>|`|\?\.|async\s/);
  assert.doesNotMatch(part, /\{%|\{\{/);
  assert.match(html, /var PROWL_VERSION='v8\.(4[5-9]|[5-9]\d)'/);
});
