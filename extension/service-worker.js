// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
import { SITES, cleanTerm, prowlUrl, soldUrl, imagesUrl, lensUrl, guideUrl } from './sites.js';
import { isPro, saveMember, PRO_PAGE } from './member.js';
const PRO_PAGE_URL = PRO_PAGE;

// ---------- right-click menu ----------
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  const sel = ['selection'];
  chrome.contextMenus.create({ id: 'prowl', title: 'Prowl', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-live', parentId: 'prowl', title: 'Live listings for \u201c%s\u201d', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-open', parentId: 'prowl', title: 'Search \u201c%s\u201d in Prowl', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-all', parentId: 'prowl', title: 'Open \u201c%s\u201d on every marketplace', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-sold', parentId: 'prowl', title: 'eBay sold prices for \u201c%s\u201d', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-guide', parentId: 'prowl', title: 'Field Guide for \u201c%s\u201d', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-images', parentId: 'prowl', title: 'See \u201c%s\u201d on Google Images', contexts: sel });
  chrome.contextMenus.create({ id: 'prowl-lens', title: 'Prowl: identify this with Google Lens', contexts: ['image'] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'prowl-lens') {
      if (!(await isPro())) { await openTab(PRO_PAGE_URL, tab); return; }
      if (info.srcUrl && /^https?:/i.test(info.srcUrl)) await openTab(lensUrl(info.srcUrl), tab);
      return;
    }
    const term = cleanTerm(info.selectionText);
    if (!term) return;
    // The extension is a Pro bonus. Everyone else lands on the free Prowl page.
    if (!(await isPro())) { await openTab(prowlUrl(term), tab); return; }
    if (info.menuItemId === 'prowl-live') await showLive(term, tab);
    else if (info.menuItemId === 'prowl-open') await openTab(prowlUrl(term), tab);
    else if (info.menuItemId === 'prowl-all') await openAll(term, tab && tab.windowId);
    else if (info.menuItemId === 'prowl-sold') await openTab(soldUrl(term), tab);
    else if (info.menuItemId === 'prowl-guide') await openTab(guideUrl(term), tab);
    else if (info.menuItemId === 'prowl-images') await openTab(imagesUrl(term), tab);
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
    if (all && term && (await isPro())) { await openAll(term); return; }
    const url = prowlUrl(term);
    if (disposition === 'currentTab') await chrome.tabs.update({ url });
    else await chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  } catch (err) {
    console.error('Prowl address-bar search failed:', err);
  }
});

// ---------- messages from the toolbar popup ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'member') {
    // From content.js on the Prowl page.
    saveMember(msg.e, msg.t).then(() => isPro({ force: true })).catch((err) => console.error('Prowl sign-in hand-off failed:', err));
    return false;
  }
  if (!msg || msg.type !== 'openAll') return false;
  const term = cleanTerm(msg.term);
  // Answer first: the popup closes as soon as the first new tab takes focus.
  sendResponse({ ok: Boolean(term) });
  if (term) {
    isPro().then((pro) => pro && openAll(term, msg.windowId)).catch((err) => console.error('Prowl open-all failed:', err));
  }
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
