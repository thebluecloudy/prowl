// Extension 1.7.0: Facebook watches. The schedule (Weekly, Daily, Hot with jitter, catch-up, the retry after a logged-out
// check), reading Marketplace's page, what a check reports, and a whole cycle in the service worker with a fake chrome.*
// and a fake network: Facebook is asked only from the browser, with its own login; the Prowl worker gets only the watch
// and listing data, with the store sign-in and never a cookie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as X from '../../extension/watcher.js';

const H = 3600000, D = 24 * H;
const local = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const W = (extra = {}) => ({ id: 'wabcdefgh', term: 'ceramic panther', metros: ['local'], tier: 'daily', runs: 'daily', gen: 1, activeAt: '2026-10-01T00:00:00Z', checkedAt: '', seen: '', ...extra });
const listing = (id, extra = {}) => ({ __typename: 'GroupCommerceProductItem', id: String(id), marketplace_listing_title: 'Ceramic panther ' + id,
  listing_price: { formatted_amount: '$45', amount: '45.00' }, primary_listing_photo: { image: { uri: 'https://scontent-ord5-1.xx.fbcdn.net/v/' + id + '.jpg' } },
  location: { reverse_geocode: { city: 'Novi', state: 'MI' } }, is_sold: false, is_pending: false, is_hidden: false, ...extra });
export function fbPage(listings, { user = '100012345678901' } = {}) {
  const data = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_x', { __bbox: { complete: true, result: { data: {
    marketplace_search: { feed_units: { edges: listings.map((l) => ({ node: { __typename: 'MarketplaceFeedListingStoryObject', listing: l } })) } } } } } }]]] } }]]] };
  return '<!DOCTYPE html><html><head><script>requireLazy(["Env"],function(){});{"USER_ID":"' + user + '","NAME":"x"}</script></head><body>' +
    '<script type="application/json" data-content-len="10" data-sjs>' + JSON.stringify(data) + '</script>' +
    '<script type="application/json">not json</script></body></html>';
}

test('the search link: the page\'s own Facebook link for each metro, newest first', () => {
  assert.equal(X.searchUrl("Fire-King jadeite (oval)", 'local'), "https://www.facebook.com/marketplace/category/search/?query=Fire-King+jadeite+%28oval%29&sortBy=creation_time_descend&exact=false");
  assert.equal(X.searchUrl('panther', 'detroit'), 'https://www.facebook.com/marketplace/151286001683429/search/?query=panther&sortBy=creation_time_descend&exact=false');
  assert.equal(X.searchUrl('panther', 'atlanta'), 'https://www.facebook.com/marketplace/atlanta/search/?query=panther&sortBy=creation_time_descend&exact=false');
  assert.match(X.searchUrl('panther', 'gotham'), /marketplace\/category\/search/, 'an unknown metro is the member\'s own area');
});

test('due: a watch not yet active checks now (its baseline); a paused one never', () => {
  const now = local(2026, 10, 21, 9);
  assert.equal(X.nextDue(W({ activeAt: '' }), now), now);
  assert.equal(X.nextDue(W({ checkedAt: '' }), now), now);
  assert.equal(X.nextDue(W({ paused: true }), now), Infinity);
});

test('due: Hot every 30 minutes, give or take 5, the same answer every time it is asked', () => {
  const last = local(2026, 10, 21, 9), w = W({ tier: 'hot', runs: 'hot', checkedAt: new Date(last).toISOString() });
  const t = X.nextDue(w, last);
  assert.ok(t >= last + 25 * 60000 && t <= last + 35 * 60000, 'within 25 to 35 minutes');
  assert.equal(X.nextDue(w, last + 1000), t);
  const spread = new Set(['wa0000001', 'wa0000002', 'wa0000003', 'wa0000004', 'wa0000005'].map((id) => X.nextDue({ ...w, id }, last)));
  assert.ok(spread.size > 1, 'watches do not land on a metronome');
  assert.equal(X.isDue(w, t - 1), false); assert.equal(X.isDue(w, t), true);
});

test('due: Daily on the first session of the next day; a missed day is caught up on the next one', () => {
  const last = local(2026, 10, 20, 18), w = W({ checkedAt: new Date(last).toISOString() });
  assert.equal(X.nextDue(w, last), local(2026, 10, 21));
  assert.equal(X.isDue(w, local(2026, 10, 20, 23, 59)), false);
  assert.equal(X.isDue(w, local(2026, 10, 21, 0, 1)), true);
  assert.equal(X.isDue(w, local(2026, 10, 23, 14)), true, 'two days closed: due on the next session');
});

test('due: Weekly on the first session on or after Monday', () => {
  const last = local(2026, 10, 19, 10);   // a Monday
  const w = W({ tier: 'weekly', runs: 'weekly', checkedAt: new Date(last).toISOString() });
  assert.equal(X.nextDue(w, last), local(2026, 10, 26));
  assert.equal(new Date(local(2026, 10, 26)).getDay(), 1);
  assert.equal(X.isDue(w, local(2026, 10, 25, 23)), false);
  assert.equal(X.isDue(w, local(2026, 10, 27, 15)), true, 'the laptop was shut on Monday: Tuesday catches it');
  const sat = W({ tier: 'weekly', runs: 'weekly', checkedAt: new Date(local(2026, 10, 24, 9)).toISOString() });
  assert.equal(X.nextDue(sat, Date.now()), local(2026, 10, 26), 'checked on a Saturday: next Monday');
  const pro = W({ tier: 'daily', runs: 'weekly', checkedAt: new Date(last).toISOString() });
  assert.equal(X.nextDue(pro, last), local(2026, 10, 26), 'runs (the plan) wins over tier');
});

test('not logged in to Facebook: the check waits a retry interval (Hot 30 minutes, others 3 hours)', () => {
  const now = local(2026, 10, 21, 9), w = W({ activeAt: '' });
  assert.equal(X.isDue(w, now, now - 10 * 60000), false);
  assert.equal(X.isDue(w, now, now - 3 * H), true);
  const hot = W({ activeAt: '', runs: 'hot' });
  assert.equal(X.isDue(hot, now, now - 31 * 60000), true);
  assert.equal(X.nextCheck(w, now, now), now + 3 * H);
});

test('reading Marketplace: listings out of the page JSON, sold and pending ones left out, logged in or not', () => {
  const html = fbPage([listing(1234567890123), listing(1234567890123), listing(2222222, { is_sold: true }), listing(3333333, { is_pending: true }),
    listing(4444444, { listing_price: { formatted_amount: 'FREE', amount: '0.00' }, primary_listing_photo: { image: { uri: 'https://evil.example/x.jpg' } }, creation_time: 1790000000 }),
    listing(5555555, { listing_price: { formatted_amount: '$1,200', amount: '1200.00' }, location: null })]);
  const p = X.parseMarketplace(html, 'https://www.facebook.com/marketplace/category/search/?query=x');
  assert.equal(p.loggedIn, true);
  assert.deepEqual(p.items.map((x) => x.id), ['1234567890123', '4444444', '5555555']);
  assert.deepEqual(p.items[0], { id: '1234567890123', title: 'Ceramic panther 1234567890123', price: '$45', image: 'https://scontent-ord5-1.xx.fbcdn.net/v/1234567890123.jpg', location: 'Novi, MI', listed: 0 });
  assert.equal(p.items[1].price, 'Free'); assert.equal(p.items[1].image, ''); assert.equal(p.items[1].listed, 1790000000);
  assert.equal(p.items[2].price, '$1,200'); assert.equal(p.items[2].location, '');
  assert.equal(X.parseMarketplace(fbPage([listing(1234567)], { user: '0' })).loggedIn, false, 'the viewer id is 0 when nobody is logged in');
  assert.equal(X.parseMarketplace(fbPage([]), 'https://www.facebook.com/login/?next=%2Fmarketplace').loggedIn, false, 'sent to the login page');
  assert.equal(X.parseMarketplace('<form id="login_form"></form>').loggedIn, false);
  assert.equal(X.cleanPrice({ formatted_amount: 'US$30' }), '$30');
  assert.equal(X.cleanPrice({ amount: '1500.00' }), '$1,500');
  assert.equal(X.cleanPrice(null), '');
});

test('what a check reports: everything on a baseline, else only what the digest has not seen; every asking price', () => {
  const items = [{ id: '1000000012345678', price: '$45' }, { id: '2222222', price: 'Free' }, { id: '3333333', price: '$1,200' }];
  const base = X.report(W({ activeAt: '', seen: '12345678' }), items);
  assert.equal(base.items.length, 3);
  const next = X.report(W({ seen: '12345678,2222222' }), items);
  assert.deepEqual(next.items.map((x) => x.id), ['3333333']);
  assert.deepEqual(next.comps, [45, 1200]);
});

test('the store sign-in: the right shape and not run out', () => {
  const tok = (cid, exp) => Buffer.from(cid + '.' + exp + '.' + 'a'.repeat(64)).toString('base64url');
  const now = Date.now(), ok = tok('7012345678901', Math.floor(now / 1000) + 3600);
  assert.equal(X.sessionOk(ok, now), true);
  assert.equal(X.sessionOk(tok('7012345678901', Math.floor(now / 1000) - 1), now), false);
  assert.equal(X.sessionOk('not a token!', now), false);
  assert.equal(X.sessionOk(undefined, now), false);
});

test('a big cycle goes in batches under the worker\'s size limit', () => {
  const r = Array.from({ length: 10 }, (_, i) => ({ watch: 'w' + i, items: 'x'.repeat(50000) }));
  const b = X.batches(r);
  assert.ok(b.length >= 3);
  assert.equal(b.flat().length, 10);
  for (const g of b) assert.ok(JSON.stringify(g).length < 210000);
});

test('manifest 1.7.0: alarms and facebook.com only; no cookies, no history, no other hosts', () => {
  const m = JSON.parse(readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(m.version, '1.7.0');
  assert.deepEqual(m.permissions, ['contextMenus', 'tabGroups', 'storage', 'alarms']);
  assert.deepEqual(m.host_permissions, ['https://prowl.thebluecloud.workers.dev/*', 'https://www.facebook.com/*']);
  assert.match(readFileSync(new URL('../../extension/CHANGELOG.md', import.meta.url), 'utf8'), /^## 1\.7\.0$/m);
  for (const f of ['watcher.js', 'service-worker.js', 'content.js']) {
    const js = readFileSync(new URL('../../extension/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(js, /chrome\.cookies|document\.cookie|chrome\.history/, f);
  }
});

// ---------- the cycle, in the service worker ----------
function fakeChrome() {
  const listeners = {}, store = {}, alarms = new Map();
  const ev = (name) => ({ addListener: (fn) => { (listeners[name] = listeners[name] || []).push(fn); } });
  const area = (o) => ({
    get: async (k) => (typeof k === 'string' ? (k in o ? { [k]: o[k] } : {}) : { ...o }),
    set: async (v) => { Object.assign(o, JSON.parse(JSON.stringify(v))); },
    remove: async (k) => { delete o[k]; },
  });
  const chrome = {
    runtime: { id: 'prowlext', onInstalled: ev('installed'), onMessage: ev('message'), onStartup: ev('startup'), getURL: (p) => p, getManifest: () => ({ version: '1.7.0' }) },
    contextMenus: { removeAll: async () => {}, create: () => {}, onClicked: ev('clicked') },
    omnibox: { onInputStarted: ev('a'), onInputChanged: ev('b'), onInputEntered: ev('c'), setDefaultSuggestion() {} },
    storage: { local: area(store), session: area({}) },
    tabs: { create: async (o) => o }, tabGroups: { update: async () => {} }, action: {},
    alarms: {
      create: (name, o) => { alarms.set(name, o); }, clear: async (n) => alarms.delete(n), get: async (n) => alarms.get(n),
      getAll: async () => [...alarms.keys()].map((name) => ({ name, ...alarms.get(name) })), onAlarm: ev('alarm'),
    },
  };
  return { chrome, listeners, store, alarms };
}
const realTimeout = setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, ms >= 1000 ? 0 : ms, ...a);   // the pauses between Facebook pages
const F = fakeChrome();
globalThis.chrome = F.chrome;
const net = { calls: [], watches: [], pages: {}, posts: [] };
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  net.calls.push({ url: String(url), opts });
  if (u.host === 'prowl.thebluecloud.workers.dev' && u.pathname === '/watches') return { ok: true, status: 200, json: async () => ({ watches: net.watches }) };
  if (u.host === 'prowl.thebluecloud.workers.dev' && u.pathname === '/fb-ingest') { net.posts.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
  if (u.host === 'www.facebook.com') { const h = net.pages[u.pathname] || fbPage([]); return { ok: true, status: 200, url: String(url), text: async () => h }; }
  throw new Error('unexpected ' + url);
};
await import('../../extension/service-worker.js');
const PROWL = { id: 'prowlext', url: 'https://www.owlandtwigvintage.com/pages/prowl' };
const TOKEN = Buffer.from('7012345678901.' + (Math.floor(Date.now() / 1000) + 86400) + '.' + 'b'.repeat(64)).toString('base64url');
const send = (m, sender = PROWL) => F.listeners.message.forEach((fn) => fn(m, sender, () => {}));
async function settle() { for (let i = 0; i < 60; i++) await new Promise((r) => realTimeout(r, 5)); }
function reset() { net.calls.length = 0; net.posts.length = 0; }

test('a cycle: due watches only, each metro from the browser with its own login, one report to Prowl with the sign-in and no cookie', async () => {
  net.watches = [
    W({ id: 'wbase0001', activeAt: '', metros: ['local', 'detroit'] }),
    W({ id: 'wdaily001', term: 'blenko', checkedAt: new Date().toISOString(), seen: '' }),
    W({ id: 'whot00001', term: 'roseville', runs: 'hot', tier: 'hot', checkedAt: new Date(Date.now() - 2 * H).toISOString(), seen: '67890123' }),
  ];
  net.pages['/marketplace/category/search/'] = fbPage([listing(1234567890123), listing(2222222)]);
  net.pages['/marketplace/151286001683429/search/'] = fbPage([listing(2222222), listing(3333333)]);
  send({ type: 'session', s: TOKEN });
  await settle();
  const fb = net.calls.filter((c) => c.url.startsWith('https://www.facebook.com/'));
  assert.deepEqual(fb.map((c) => new URL(c.url).searchParams.get('query')), ['ceramic+panther', 'ceramic+panther', 'roseville'].map((q) => q.replace(/\+/g, ' ')));
  for (const c of fb) {
    assert.equal(c.opts.credentials, 'include', 'rides the browser\'s own Facebook login');
    assert.equal(c.opts.headers, undefined, 'nothing of Prowl\'s goes to Facebook'); assert.equal(c.opts.body, undefined);
  }
  const prowl = net.calls.filter((c) => c.url.startsWith('https://prowl.thebluecloud.workers.dev/'));
  for (const c of prowl) {
    assert.equal(c.opts.credentials, 'omit', 'no cookie to Prowl');
    assert.deepEqual(Object.keys(c.opts.headers).sort(), c.opts.method === 'POST' ? ['Authorization', 'Content-Type'] : ['Authorization']);
    assert.equal(c.opts.headers.Authorization, 'Bearer ' + TOKEN);
  }
  assert.equal(net.posts.length, 1, 'one report a cycle');
  const res = net.posts[0].results;
  assert.deepEqual(res.map((r) => [r.watch, r.status]), [['wbase0001', 'ok'], ['whot00001', 'ok']], 'the Daily one checked today waits');
  assert.deepEqual(res[0].items.map((x) => x.id), ['1234567890123', '2222222', '3333333'], 'a baseline sends everything, once each');
  assert.deepEqual(res[0].comps, [45, 45, 45]);
  assert.deepEqual(Object.keys(res[0].items[0]).sort(), ['id', 'image', 'listed', 'location', 'price', 'title'], 'listing data only');
  assert.doesNotMatch(JSON.stringify(net.posts), /100012345678901/, 'the Facebook account id never leaves the page');
  assert.deepEqual(res[1].items.map((x) => x.id), ['2222222'], 'the hot one: its digest has seen ...67890123');
  assert.ok(F.alarms.has('w:wbase0001') && F.alarms.has('w:wdaily001') && F.alarms.has('w:whot00001'), 'a wake-up per watch');
  assert.ok(F.alarms.get('w:whot00001').when <= Date.now() + 36 * 60000);
});

test('logged out of Facebook: the cycle reports only that, asks Facebook once, and waits before trying again', async () => {
  reset();
  net.watches = [W({ id: 'wbase0001', activeAt: '', metros: ['local', 'detroit'] }), W({ id: 'wbase0002', activeAt: '', term: 'owl' })];
  net.pages['/marketplace/category/search/'] = fbPage([listing(1234567)], { user: '0' });
  send({ type: 'watchesChanged' });
  await settle();
  assert.equal(net.calls.filter((c) => c.url.startsWith('https://www.facebook.com/')).length, 1);
  assert.deepEqual(net.posts[0].results, [{ watch: 'wbase0001', gen: 1, status: 'nologin' }, { watch: 'wbase0002', gen: 1, status: 'nologin' }]);
  assert.ok(F.store.watchSkip.wbase0001 > 0);
  reset();
  send({ type: 'watchesChanged' });
  await settle();
  assert.equal(net.calls.filter((c) => c.url.startsWith('https://www.facebook.com/')).length, 0, 'waits its retry interval');
  assert.equal(net.posts.length, 0);
  net.pages['/marketplace/category/search/'] = fbPage([listing(1234567)]);
});

test('a member signed in with the emailed code (no store account): the Prowl Alerts pair signs the checks in', async () => {
  reset();
  net.watches = [W({ id: 'wcode0001', activeAt: '' })];
  send({ type: 'session', s: '', e: 'Code@Example.com', t: 'tok-0123456789abcdef' });
  await settle();
  const prowl = net.calls.filter((c) => c.url.startsWith('https://prowl.thebluecloud.workers.dev/'));
  assert.ok(prowl.length >= 2);
  for (const c of prowl) assert.deepEqual(Object.keys(c.opts.headers).filter((k) => k !== 'Content-Type').sort(), ['X-Prowl-Email', 'X-Prowl-Tok']);
  assert.equal(prowl[0].opts.headers['X-Prowl-Email'], 'code@example.com');
  send({ type: 'session', s: TOKEN, e: '', t: '' });
  await settle();
});

test('only the Prowl page can hand over a sign-in; signing out on the page stops the watches here', async () => {
  reset();
  send({ type: 'session', s: '' }, { id: 'prowlext', url: 'https://evil.example/' });
  await settle();
  assert.equal(F.store.watchAuth.s, TOKEN, 'another site cannot sign the extension out (or in)');
  send({ type: 'session', s: '', e: '', t: '' });
  await settle();
  assert.equal(F.store.watchAuth, undefined);
  assert.equal([...F.alarms.keys()].filter((k) => k.startsWith('w:')).length, 0);
  send({ type: 'watchesChanged' });
  await settle();
  assert.equal(net.calls.length, 0, 'no sign-in, no checks');
});

test('content.js: marks the page, hands over the store sign-in, and passes on "my watches changed"', () => {
  const js = readFileSync(new URL('../../extension/content.js', import.meta.url), 'utf8');
  assert.match(js, /setAttribute\('data-prowl-ext'/);
  assert.match(js, /localStorage\.getItem\('prowl\.session'\)/);
  assert.match(js, /send\(\{ type: 'session', s: s, e: e, t: t \}\)/, 'the page\'s sign-ins as they are now, signed out included');
  assert.match(js, /ev\.source !== window/);
  assert.match(js, /type: 'watchesChanged'/);
});
