import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A stand-in for the chrome.* APIs the service worker touches at load: every
// event gets an addListener that records the handler, and menu items are kept.
function fakeChrome() {
  const listeners = {}, menus = [];
  const ev = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const chrome = {
    runtime: { onInstalled: ev('installed'), onMessage: ev('message'), onStartup: ev('startup'), getURL: (p) => p },
    contextMenus: { removeAll: async () => { menus.length = 0; }, create: (o) => { menus.push(o); }, onClicked: ev('clicked') },
    omnibox: { onInputStarted: ev('omniStart'), onInputChanged: ev('omniChange'), onInputEntered: ev('omniEnter'), setDefaultSuggestion() {} },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { create: async (o) => o, query: async () => [], group: async () => 1 },
    tabGroups: { update: async () => {} },
    action: { setBadgeText() {} },
  };
  return { chrome, listeners, menus };
}

test('sites.js: Amazon is off and builds no URL', async () => {
  const s = await import('../../extension/sites.js');
  assert.equal(s.AFF.amzEnabled, false);
  assert.equal(s.amazonOn(), false);
  assert.equal(s.amazonUrl('pyrex cleaner'), null);
});

test('sites.js: a real tag plus the switch builds a tagged search', async () => {
  const s = await import('../../extension/sites.js');
  const keep = { ...s.AFF };
  try {
    s.AFF.amz = 'owltwig-20'; s.AFF.amzEnabled = true;
    assert.equal(s.amazonUrl('pyrex cleaner'), 'https://www.amazon.com/s?k=pyrex%20cleaner&tag=owltwig-20');
    s.AFF.amz = 'YOUR_AMAZON_TAG';
    assert.equal(s.amazonUrl('x'), null, 'the placeholder never goes out');
  } finally { Object.assign(s.AFF, keep); }
});

test('service worker: no Amazon menu item while the switch is off', async () => {
  const f = fakeChrome();
  globalThis.chrome = f.chrome;
  await import('../../extension/service-worker.js');
  await f.listeners.installed();
  const ids = f.menus.map((m) => m.id);
  assert.ok(ids.includes('prowl-sold'));
  assert.ok(!ids.includes('prowl-amazon'));
  delete globalThis.chrome;
});

test('sites.js 1.6.3: Depop links are plain until its switch is on; then the Rakuten deep link, and only for Depop', async () => {
  const s = await import('../../extension/sites.js');
  const RAN = 'https://click.linksynergy.com/deeplink?id=jh1j/r7*wkQ&mid=53555&murl=';
  const dep = s.SITES.find((x) => x.id === 'depop');
  assert.equal(s.AFF.on.depop, false, 'off by default (Rakuten declined)');
  assert.equal(dep.url('ceramic panther'), 'https://www.depop.com/search/?q=ceramic%20panther');
  s.AFF.on.depop = true;
  try {
    assert.equal(dep.url('ceramic panther'), RAN + encodeURIComponent('https://www.depop.com/search/?q=ceramic%20panther'));
    for (const x of s.SITES.filter((y) => y.id !== 'depop')) assert.equal(x.url('x').indexOf('linksynergy'), -1, x.id);
    assert.equal(s.depopAff('https://www.etsy.com/x'), 'https://www.etsy.com/x');
  } finally { s.AFF.on.depop = false; }
});

test('sites.js 1.6.3 affSync: the worker answer is applied and kept; offline, the kept answer is used', async () => {
  const s = await import('../../extension/sites.js');
  const store = {};
  globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } } };
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (u) => { assert.equal(u, 'https://prowl.thebluecloud.workers.dev/aff'); return { ok: true, json: async () => ({ on: { ebay: true, depop: true } }) }; };
    assert.deepEqual(await s.affSync(), { depop: true });
    assert.deepEqual(store.affOn, { depop: true });
    s.AFF.on.depop = false;
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert.deepEqual(await s.affSync(), { depop: true }, 'the kept answer');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ on: { depop: 'yes' } }) });
    store.affOn = undefined; s.AFF.on.depop = false;
    assert.deepEqual(await s.affSync(), { depop: false }, 'junk changes nothing');
  } finally { globalThis.fetch = realFetch; s.AFF.on.depop = false; delete globalThis.chrome; }
});

test('popup 1.6.3: the commission note is hidden unless a switch is on', () => {
  const html = readFileSync(new URL('../../extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="foot">Prowl &copy; 2026 Owl &amp; Twig Vintage\.<span id="affnote" hidden> Depop links earn Owl &amp; Twig a small commission, at no cost to you\.<\/span><\/p>/);
  const js = readFileSync(new URL('../../extension/popup.js', import.meta.url), 'utf8');
  assert.match(js, /const aff = await affSync\(\);\n  \$\('#affnote'\)\.hidden = aff\.depop !== true;/);
  const sw = readFileSync(new URL('../../extension/service-worker.js', import.meta.url), 'utf8');
  assert.match(sw, /await affSync\(\);   \/\/ 1\.6\.3/);
});
