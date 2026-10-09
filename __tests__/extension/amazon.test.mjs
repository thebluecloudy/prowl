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

test('sites.js 1.6.4: every marketplace link is the site\'s own plain link; no Rakuten link or switch is left', async () => {
  const s = await import('../../extension/sites.js');
  const dep = s.SITES.find((x) => x.id === 'depop');
  assert.equal(dep.url('ceramic panther'), 'https://www.depop.com/search/?q=ceramic%20panther');
  for (const x of s.SITES) assert.equal(/linksynergy|jh1j|mid=53555/.test(x.url('ceramic panther')), false, x.id);
  assert.equal(s.depopAff, undefined);
  assert.equal(s.affSync, undefined);
  assert.deepEqual(Object.keys(s.AFF).sort(), ['amz', 'amzEnabled']);
});

test('popup 1.6.4: no commission note, and nothing asks the worker for affiliate switches', () => {
  const html = readFileSync(new URL('../../extension/popup.html', import.meta.url), 'utf8');
  assert.match(html, /<p class="foot">Prowl &copy; 2026 Owl &amp; Twig Vintage\.<\/p>/);
  assert.doesNotMatch(html, /affnote|commission/);
  for (const f of ['popup.js', 'service-worker.js']) {
    const js = readFileSync(new URL('../../extension/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(js, /affSync|affnote|\/aff'/, f);
  }
});
