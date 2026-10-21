// Page v7.58: Facebook watches in the Den (worker v157, extension 1.7.0). Each saved hunt shows its watch: off, or
// Weekly / Daily / Hot with its places, ceiling, skip-words, when it last checked and how many listings its filters
// held back. Hot is one tap with the limit of 3 said beside it. Signed out: one line offering the store sign-in. A
// browser without the extension says so with the install link, a phone says watches run from a computer. Watch finds
// join Flock; a Flock discard hides one everywhere, and what an email hid joins prowl.discarded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const FIND = { id: '1234567', title: 'Black ceramic panther TV lamp', price: '$60', url: 'https://www.facebook.com/marketplace/item/1234567/', image: 'https://scontent.xx.fbcdn.net/v/p.jpg', location: 'Novi, MI', found: '2026-10-21' };
const HIDDEN = 'https://www.facebook.com/marketplace/item/9999999/';
const W = (extra = {}) => ({ id: 'wabcdefgh', term: 'ceramic panther', tier: 'daily', runs: 'daily', paused: false, metros: ['local', 'detroit'], ceiling: 200, skip: ['repro'], gen: 1,
  activeAt: ago(3000), checkedAt: ago(20), skips: 0, filtered: 3, found: 1, ...extra });
const answer = (watches, { pro = true, mail = true, email = true, finds } = {}) => ({ plan: { pro, max: pro ? 25 : 1, hot: pro ? 3 : 0, tiers: pro ? ['weekly', 'daily', 'hot'] : ['weekly'] }, mail, email, watches,
  hidden: [HIDDEN], finds: finds || Object.fromEntries(watches.map((w) => [w.id, w.id === 'wabcdefgh' ? [FIND] : []])) });

function wFetch(state) {
  const base = liveFetch(), log = [];
  const impl = (url, opts = {}) => {
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.host === 'prowl.thebluecloud.workers.dev' && (u.pathname === '/watches' || u.pathname === '/watches/hide')) {
      const body = opts.body ? JSON.parse(opts.body) : null;
      const hd = opts.headers || {};
      log.push({ path: u.pathname + u.search, method: opts.method || 'GET', auth: hd.Authorization || '', email: hd['X-Prowl-Email'] || '', tok: hd['X-Prowl-Tok'] || '', body });
      let a = state.get;
      if (u.pathname === '/watches' && opts.method === 'POST') a = state.post ? state.post(body) : { ok: true, ...state.get };
      if (u.pathname === '/watches/hide') a = { ok: true, hidden: 1 };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) });
    }
    return base.impl(url, opts);
  };
  return { impl, log };
}
async function den(state, { storage = {}, ext = '1.7.0', phone = false, session = true } = {}) {
  const f = wFetch(state);
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts: ['ceramic panther', 'owl'], lock: [0] }, owlTwigSgwTerms: [], ...(session ? { 'prowl.session': sess() } : {}), ...storage },
    beforeLoad: (w) => { if (phone) Object.defineProperty(w.navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true }); } });
  p.log = f.log;
  if (ext) p.doc.documentElement.setAttribute('data-prowl-ext', ext);
  p.posted = [];
  p.win.addEventListener('message', (e) => { if (e.data && e.data.prowl) p.posted.push(e.data.prowl); });
  await tick(50);
  p.$('#otp-denBtn').click();
  if (session) await waitFor(() => p.$$('#otp-denList .fw').length === 2);
  else await tick(80);
  return p;
}
const row = (p, t) => p.$$('#otp-denList li.term').find((li) => li.querySelector('.tt').textContent.indexOf(t) === 0);

test('signed out: no watch rows and no worker call; one line offers Prowl\'s own sign-in, never a store login', async () => {
  const p = await den({ get: answer([]) }, { session: false });
  await tick(100);
  assert.equal(p.$$('#otp-denList .fw').length, 0);
  assert.equal(p.log.length, 0);
  const top = p.$('#otp-fwTop');
  assert.equal(top.hidden, false);
  assert.match(top.textContent, /Facebook watches\..*Sign in to Prowl to set one/);
  assert.equal(p.$('a[href*="customer_authentication"]'), null);
  top.querySelector('#otp-fwIn').click();
  await waitFor(() => p.$('#otp-denSettings .otp-mail') && !p.$('#otp-denSettings').hidden, { timeout: 2000 });
  await p.close();
});

test('a member signed in with the emailed code (no store account) has watches too, by their Prowl pair', async () => {
  const p = await den({ get: answer([W()]) }, { session: false, storage: { 'prowl.alertEmail': 'a@b.co', 'prowl.alertTok': 'tok-0123456789abcdef' } });
  await waitFor(() => p.$$('#otp-denList .fw').length === 2);
  const h = p.log[0];
  assert.equal(h.auth, '', 'no store session to send');
  assert.deepEqual([h.email, h.tok], ['a@b.co', 'tok-0123456789abcdef']);
  assert.match(row(p, 'ceramic panther').textContent, /Daily watch/);
  await p.close();
});

test('a watch shows its tier, places, ceiling, skip-words, when it checked and what its filters held back', async () => {
  const p = await den({ get: answer([W()]) });
  assert.equal(p.log[0].path, '/watches?finds=1');
  assert.match(p.log[0].auth, /^Bearer /, 'the store session, no cookie');
  const on = row(p, 'ceramic panther').querySelector('.fw.on');
  assert.match(on.textContent, /Daily watch · Near you, Detroit · up to \$200 · skips repro/);
  assert.match(on.textContent, /Checked 20 minutes ago · 1 new so far · 3 held back by your filters/);
  const hot = on.querySelector('.fw-hot');
  assert.equal(hot.disabled, false); assert.equal(hot.getAttribute('aria-pressed'), 'false');
  const off = row(p, 'owl').querySelector('.fw');
  assert.match(off.textContent, /Facebook watch: off/);
  assert.ok(off.querySelector('[data-fwa="edit"]'));
  assert.equal(p.$('#otp-fwTop').hidden, true, 'the extension is here: nothing to say up top');
  const dis = JSON.parse(p.win.localStorage.getItem('prowl.discarded'));
  assert.ok(dis.includes(HIDDEN), 'what an email hid is discarded here too');
  await p.close();
});

test('Hot is one tap: the watch turns Hot, says so, and tells the extension to look', async () => {
  const p = await den({ get: answer([W()]), post: (b) => ({ ok: true, ...answer([W({ tier: b.tier, runs: b.tier })]) }) });
  row(p, 'ceramic panther').querySelector('.fw-hot').click();
  await waitFor(() => p.log.some((l) => l.method === 'POST'));
  const post = p.log.find((l) => l.method === 'POST');
  assert.deepEqual(post.body, { id: 'wabcdefgh', tier: 'hot' });
  await waitFor(() => row(p, 'ceramic panther').querySelector('.fw-hot.on'));
  assert.match(p.$('#otp-toast').textContent, /is Hot: checked every 30 minutes while your browser is open/);
  await waitFor(() => p.posted.includes('watches-changed'));
  await p.close();
});

test('the 3-Hot limit is stated where the toggle is', async () => {
  const hots = [0, 1, 2].map((i) => W({ id: 'whot0000' + i, term: 'hot ' + i, tier: 'hot', runs: 'hot' }));
  const p = await den({ get: answer([W()].concat(hots)) });
  const on = row(p, 'ceramic panther').querySelector('.fw.on');
  assert.equal(on.querySelector('.fw-hot').disabled, true);
  assert.match(on.textContent, /3 of 3 Hot watches in use\. Make one Daily to heat this one up\./);
  await p.close();
});

test('a new watch from the editor: places (up to 3), ceiling and skip-words; Free offers Weekly only', async () => {
  const p = await den({ get: answer([], { pro: false }), post: (b) => ({ ok: true, ...answer([W({ id: 'wnew00000', term: 'owl', tier: 'weekly', runs: 'weekly', activeAt: '', checkedAt: '', ceiling: 150, filtered: 0, found: 0 })], { pro: false }) }) });
  row(p, 'owl').querySelector('[data-fwa="edit"]').click();
  await waitFor(() => row(p, 'owl').querySelector('.fw-ed'));
  let ed = row(p, 'owl').querySelector('.fw-ed');
  assert.equal(ed.querySelector('[data-fwtier="weekly"]').getAttribute('aria-pressed'), 'true');
  assert.equal(ed.querySelector('[data-fwtier="daily"]').disabled, true);
  assert.equal(ed.querySelector('[data-fwtier="hot"]').disabled, true);
  assert.match(ed.textContent, /The free plan watches one hunt, once a week/);
  ed.querySelector('[data-fwm="detroit"]').click();
  ed = row(p, 'owl').querySelector('.fw-ed');
  ed.querySelector('[data-fwm="nyc"]').click();
  ed = row(p, 'owl').querySelector('.fw-ed');
  assert.equal(ed.querySelector('[data-fwm="chicago"]').disabled, true, 'three places at most');
  const ceil = ed.querySelector('[data-fwk="ceiling"]'); ceil.value = '$150'; ceil.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  const skip = ed.querySelector('[data-fwk="skip"]'); skip.value = 'repro, lamp shade'; skip.dispatchEvent(new p.win.Event('input', { bubbles: true }));
  ed.querySelector('[data-fwa="save"]').click();
  await waitFor(() => p.log.some((l) => l.method === 'POST'));
  assert.deepEqual(p.log.find((l) => l.method === 'POST').body, { tier: 'weekly', metros: ['local', 'detroit', 'nyc'], ceiling: '150', skip: 'repro, lamp shade', term: 'owl' });
  await waitFor(() => row(p, 'owl').querySelector('.fw.on'));
  assert.equal(row(p, 'owl').querySelector('.fw-ed'), null, 'the editor closes');
  assert.match(row(p, 'owl').textContent, /Taking its first look\. What is listed now won.t alert, only what comes after\./);
  assert.match(p.$('#otp-toast').textContent, /Watching Facebook for owl/);
  await p.close();
});

test('the worker\'s refusal is shown in its own words, in the editor', async () => {
  const p = await den({ get: answer([]), post: () => ({ error: 'You already have 3 Hot watches. Make one of them Daily first.' }) });
  row(p, 'owl').querySelector('[data-fwa="edit"]').click();
  await waitFor(() => row(p, 'owl').querySelector('.fw-ed'));
  row(p, 'owl').querySelector('[data-fwa="save"]').click();
  await waitFor(() => row(p, 'owl').querySelector('.fw-ed [role="alert"]'));
  assert.match(row(p, 'owl').querySelector('.fw-ed [role="alert"]').textContent, /already have 3 Hot watches/);
  await p.close();
});

test('honest states: no extension here, a phone, waiting for Facebook login, a quiet day, a plan that shrank', async () => {
  let p = await den({ get: answer([W({ checkedAt: ago(3000) })]) }, { ext: '' });
  let on = row(p, 'ceramic panther').querySelector('.fw.on');
  assert.match(on.textContent, /Install the Prowl extension to turn this watch on\./);
  assert.doesNotMatch(on.textContent, /Checked/, 'no fake active state');
  assert.match(on.querySelector('a').getAttribute('href'), /^https:\/\/chromewebstore\.google\.com\//);
  assert.match(p.$('#otp-fwTop').textContent, /Install the Prowl extension/);
  await p.close();
  p = await den({ get: answer([W()]) }, { ext: '' });
  assert.match(row(p, 'ceramic panther').textContent, /Checked 20 minutes ago/, 'it checked from another computer within the day: that is true');
  await p.close();
  p = await den({ get: answer([W({ checkedAt: '' , activeAt: '' })]) }, { ext: '', phone: true });
  assert.match(row(p, 'ceramic panther').textContent, /Watches check from a computer\. Install the Prowl extension there/);
  assert.match(p.$('#otp-fwTop').textContent, /Phones can.t run it/);
  await p.close();
  p = await den({ get: answer([W({ skips: 2 }), W({ id: 'wquiet000', term: 'owl', checkedAt: ago(26 * 60), ceiling: 0, skip: [] })]) });
  assert.match(row(p, 'ceramic panther').textContent, /Waiting for Facebook login\. Log in to Facebook in this browser and it picks up again\./);
  assert.match(row(p, 'owl').textContent, /Last checked a day ago|Last checked 26 hours ago|Last checked yesterday/);
  assert.match(row(p, 'owl').textContent, /only checks while your computer.s browser is open/);
  await p.close();
  p = await den({ get: answer([W({ paused: true, runs: 'weekly' })], { pro: false }) });
  assert.match(row(p, 'ceramic panther').textContent, /Resting: your plan watches 1 hunt\./);
  await p.close();
});

test('Flock: a watch find is a card under its hunt; discarding it hides it on the worker too, and Undo brings it back', async () => {
  const p = await den({ get: answer([W()]) });
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => p.$$('#otp-flockRow .fl-card').some((c) => c.getAttribute('data-u') === FIND.url), { timeout: 8000 });
  const card = p.$$('#otp-flockRow .fl-card').find((c) => c.getAttribute('data-u') === FIND.url);
  assert.match(card.textContent, /for ceramic panther/);
  assert.match(card.textContent, /Facebook/);
  card.querySelector('.fl-x').click();
  await waitFor(() => p.log.some((l) => l.path === '/watches/hide'));
  assert.deepEqual(p.log.find((l) => l.path === '/watches/hide').body, { id: '1234567', on: true });
  p.$('#otp-undis').click();
  await waitFor(() => p.log.filter((l) => l.path === '/watches/hide').length === 2);
  assert.deepEqual(p.log.filter((l) => l.path === '/watches/hide')[1].body, { id: '1234567', on: false });
  await p.close();
});

test('the source: ES5, no Liquid, no new localStorage key, the version', () => {
  const i = PAGE.indexOf('/* ---------- v7.58: FACEBOOK WATCHES'), j = PAGE.indexOf('function rDenHunts(){');
  const block = PAGE.slice(i, j);
  assert.ok(i > 0 && j > i);
  assert.doesNotMatch(block, /\b(let|const)\s|=>|\?\.|async\s|`/);
  assert.doesNotMatch(block, /\{%|\{\{/);
  assert.doesNotMatch(block, /localStorage\.setItem|xSet\(|mSet\(/, 'the watches live on the worker');
  assert.match(PAGE, /var PROWL_VERSION='v7\.58';/);
});
