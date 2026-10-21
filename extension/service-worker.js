// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
import { SITES, cleanTerm, prowlUrl, soldUrl, imagesUrl, lensUrl, guideUrl, amazonOn, amazonUrl } from './sites.js';
import { isPro, saveMember, PRO_PAGE } from './member.js';
import { API, searchUrl, parseMarketplace, report, isDue, nextCheck, sessionOk, batches } from './watcher.js';   // 1.7.0
const PRO_PAGE_URL = PRO_PAGE;

// ---------- right-click menu ----------
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  const sel = ['selection'];
  chrome.contextMenus.create({ id: 'prowl', title: 'Prowl', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-live', parentId: 'prowl', title: 'Live listings for \u201c%s\u201d (Prowl Pro)', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-open', parentId: 'prowl', title: 'Search \u201c%s\u201d in Prowl', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-all', parentId: 'prowl', title: 'Open \u201c%s\u201d on every marketplace', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-sold', parentId: 'prowl', title: 'eBay sold prices for \u201c%s\u201d', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-guide', parentId: 'prowl', title: 'Field Guide for \u201c%s\u201d (Prowl Pro)', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-images', parentId: 'prowl', title: 'See \u201c%s\u201d on Google Images', contexts: sel });
  if (amazonOn()) chrome.contextMenus.create({ id: 'prowl-amazon', parentId: 'prowl', title: 'Search Amazon for \u201c%s\u201d', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-lens', title: 'Prowl: identify this with Google Lens', contexts: ['image'] });
  watchSetup();   // 1.7.0
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'prowl-lens') {
      if (info.srcUrl && /^https?:/i.test(info.srcUrl)) await openTab(lensUrl(info.srcUrl), tab);
      return;
    }
    const term = cleanTerm(info.selectionText);
    if (!term) return;
    if (info.menuItemId === 'prowl-live') await showLive(term, tab);
    else if (info.menuItemId === 'prowl-open') await openTab(prowlUrl(term), tab);
    else if (info.menuItemId === 'prowl-all') await openAll(term, tab && tab.windowId);
    else if (info.menuItemId === 'prowl-sold') await openTab(soldUrl(term), tab);
    else if (info.menuItemId === 'prowl-guide') await openTab((await isPro()) ? guideUrl(term) : PRO_PAGE_URL, tab);
    else if (info.menuItemId === 'prowl-images') await openTab(imagesUrl(term), tab);
    else if (info.menuItemId === 'prowl-amazon') { const u = amazonUrl(term); if (u) await openTab(u, tab); }
  } catch (err) {
    console.error('Prowl menu action failed:', err);
  }
});

// ---------- address bar: "prowl ceramic panther" ----------
chrome.omnibox.onInputStarted.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({
    description: 'Search vintage marketplaces in Prowl. Start with "all " to open every marketplace in tabs.',
  });
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  let term = cleanTerm(text);
  const all = /^all\s+/i.test(term);
  if (all) term = cleanTerm(term.replace(/^all\s+/i, ''));
  try {
    if (all && term) { await openAll(term); return; }
    const url = prowlUrl(term);
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  } catch (err) {
    console.error('Prowl address-bar search failed:', err);
  }
});

// ---------- messages from the toolbar popup ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'member') {
    // From content.js on the Prowl page.
    saveMember(msg.e, msg.t).then(() => isPro({ force: true })).catch((err) => console.error('Prowl sign-in hand-off failed:', err));
    return false;
  }
  // 1.7.0: the store sign-in for Facebook watches, and "my watches changed", only from the Prowl page itself
  if (msg && (msg.type === 'session' || msg.type === 'watchesChanged')) {
    if (!fromProwl(sender)) return false;
    (msg.type === 'session' ? saveAuth(msg) : Promise.resolve(true))
      .then((changed) => (changed ? watchCycle() : null))
      .catch((err) => console.error('Prowl watch hand-off failed:', err));
    return false;
  }
  if (!msg || msg.type !== 'openAll') return false;
  const term = cleanTerm(msg.term);
  // Answer first: the popup closes as soon as the first new tab takes focus.
  sendResponse({ ok: Boolean(term) });
  if (term) openAll(term, msg.windowId).catch((err) => console.error('Prowl open-all failed:', err));
  return false;
});

// ---------- helpers ----------
async function openTab(url, tab) {
  const props = { url, active: true };
  if (tab && typeof tab.index === 'number') props.index = tab.index + 1;
  if (tab && tab.windowId) props.windowId = tab.windowId;
  await chrome.tabs.create(props);
}

// Hand the term to the toolbar popup and open it. If Chrome won't open the
// popup from here, fall back to the Prowl page, which runs the search itself.
async function showLive(term, tab) {
  await chrome.storage.session.set({ pending: term });
  try {
    await chrome.action.openPopup();
  } catch (err) {
    await chrome.storage.session.remove('pending');
    await openTab(prowlUrl(term), tab);
  }
}

// Every marketplace in its own tab, gathered into one named tab group.
// Opened by the extension itself, so no pop-up blocker gets involved.
async function openAll(term, windowId) {
  if (!windowId) {
    const win = await chrome.windows.getLastFocused();
    windowId = win.id;
  }
  const tabIds = [];
  for (let i = 0; i < SITES.length; i++) {
    const t = await chrome.tabs.create({ url: SITES[i].url(term), active: i === 0, windowId });
    tabIds.push(t.id);
  }
  const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
  await chrome.tabGroups.update(groupId, { title: `Prowl: ${term}`, color: 'green' });
}

// ---------- 1.7.0: Facebook watches ----------
// The member's watches run here, in their own browser, with their own Facebook login (see watcher.js). Each cycle
// asks the Prowl worker which watches there are and what each has seen, opens the due ones' Marketplace searches,
// and posts back what is new. The browser's alarms wake it: one per watch at its next check, an hourly sync for
// watches added on another device, and the first session of the day (onStartup) for catch-up.
const SYNC_ALARM = 'prowl-watch-sync';
let cycling = null;

function fromProwl(sender) {
  return !!(sender && sender.id === chrome.runtime.id && /^https:\/\/(www\.)?owlandtwigvintage\.com\//.test(String(sender.url || '')));
}
// The sign-ins as the Prowl page holds them (watchAuth: the store session s, and the Prowl Alerts email e and token
// t), exactly as the worker's group trips take them. True when they changed and someone is signed in.
async function saveAuth(m) {
  const a = { s: sessionOk(m.s, Date.now()) ? m.s : '', e: '', t: '' };
  const e = String(m.e || '').trim().toLowerCase(), t = String(m.t || '').trim();
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) && e.length <= 120 && /^[A-Za-z0-9_.~-]{8,200}$/.test(t)) { a.e = e; a.t = t; }
  const { watchAuth } = await chrome.storage.local.get('watchAuth');
  if (watchAuth && watchAuth.s === a.s && watchAuth.e === a.e && watchAuth.t === a.t) return false;
  if (!a.s && !a.t) { await chrome.storage.local.remove('watchAuth'); await clearWatchAlarms(); return false; }
  await chrome.storage.local.set({ watchAuth: a });
  return true;
}
// the headers a watch request signs in with, or null
async function getAuth() {
  const { watchAuth: a } = await chrome.storage.local.get('watchAuth');
  if (!a) return null;
  const h = {};
  if (sessionOk(a.s, Date.now())) h.Authorization = 'Bearer ' + a.s;
  if (a.e && a.t) { h['X-Prowl-Email'] = a.e; h['X-Prowl-Tok'] = a.t; }
  return Object.keys(h).length ? h : null;
}
async function clearWatchAlarms() {
  for (const a of await chrome.alarms.getAll()) if (a.name.startsWith('w:')) await chrome.alarms.clear(a.name);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// One watch: each of its metros' searches, a few seconds apart, the way a person would open them.
async function checkWatch(w) {
  const all = [], have = new Set();
  for (let i = 0; i < w.metros.length; i++) {
    if (i) await pause(2000 + Math.floor(Math.random() * 3000));
    await chrome.storage.session.set({ watchRun: Date.now() });   // an extension call keeps the worker awake between pages
    let r;
    try { r = await fetch(searchUrl(w.term, w.metros[i]), { credentials: 'include', cache: 'no-store', redirect: 'follow' }); }
    catch (err) { return { status: 'error' }; }
    if (!r.ok) return { status: 'error' };
    const page = parseMarketplace(await r.text(), r.url);
    if (!page.loggedIn) return { status: 'nologin' };
    for (const x of page.items) if (!have.has(x.id)) { have.add(x.id); all.push(x); }
  }
  return Object.assign({ status: 'ok' }, report(w, all));
}

async function runCycle() {
  const auth = await getAuth();
  if (!auth) { await clearWatchAlarms(); return; }
  const r = await fetch(API + '/watches?seen=1', { headers: auth, credentials: 'omit', cache: 'no-store' });
  if (r.status === 401) { await chrome.storage.local.remove('watchAuth'); await clearWatchAlarms(); return; }
  if (!r.ok) return;
  const j = await r.json(), watches = Array.isArray(j && j.watches) ? j.watches : [];
  const got = await chrome.storage.local.get('watchSkip'), skip = (got && got.watchSkip) || {};
  const now = Date.now(), results = [];
  let out = false;
  for (const w of watches) {
    if (!isDue(w, now, skip[w.id])) continue;
    const res = out ? { status: 'nologin' } : await checkWatch(w);   // logged out once: the rest of the cycle is too
    if (res.status === 'nologin') { out = true; skip[w.id] = Date.now(); } else delete skip[w.id];
    results.push(Object.assign({ watch: w.id, gen: w.gen }, res));
  }
  for (const id of Object.keys(skip)) if (!watches.some((w) => w.id === id)) delete skip[id];
  await chrome.storage.local.set({ watchSkip: skip });
  for (const b of batches(results)) {
    const p = await fetch(API + '/fb-ingest', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), credentials: 'omit', body: JSON.stringify({ results: b }) });
    if (!p.ok) console.error('Prowl watch report failed:', p.status);
  }
  // the next wake-ups: what was just checked counts from now
  const after = Date.now();
  await clearWatchAlarms();
  for (const w of watches) {
    const done = results.find((x) => x.watch === w.id && x.status === 'ok');
    const t = nextCheck(done ? Object.assign({}, w, { activeAt: w.activeAt || 'now', checkedAt: new Date(after).toISOString() }) : w, after, skip[w.id]);
    if (t !== Infinity) chrome.alarms.create('w:' + w.id, { when: Math.max(after + 60000, t) });
  }
}
// one cycle at a time; a request during one waits for it and runs once after
let again = false;
async function watchCycle() {
  if (cycling) { again = true; return cycling; }
  cycling = (async () => {
    try { do { again = false; await runCycle(); } while (again); }
    catch (err) { console.error('Prowl watch cycle failed:', err); }
    finally { cycling = null; }
  })();
  return cycling;
}

chrome.alarms.onAlarm.addListener((a) => { if (a && (a.name === SYNC_ALARM || a.name.startsWith('w:'))) watchCycle(); });
chrome.runtime.onStartup.addListener(() => { watchCycle(); });   // the first browser session: catch up what came due
// on install and update (from the right-click menu's onInstalled above): the hourly sync, and a first look
function watchSetup() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 60 });
  watchCycle();
}
