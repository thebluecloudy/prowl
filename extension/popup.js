// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
import { SITES, LIVE, fetchLive, cleanTerm, prowlUrl, soldUrl, imagesUrl, guideUrl, photoUrl, dailyUrl, PROWL } from './sites.js';
import { isPro, PRO_PAGE } from './member.js';

const $ = (s) => document.querySelector(s);
const SHOW = 3;              // cards per marketplace; the rest are one tap away
let current = '';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function need() {
  const m = $('#msg');
  m.textContent = 'Type what you are hunting first.';
  m.hidden = false;
  $('#q').focus();
}

async function openTab(url) {
  try {
    await chrome.tabs.create({ url });
    window.close();
  } catch (err) {
    console.error('Prowl could not open a tab:', err);
  }
}

// Every result link opens in a new tab. Only http(s) links from the server
// are used, so nothing odd can be slipped into a link.
function safeUrl(u) {
  return /^https:\/\//i.test(String(u || '')) ? String(u) : '';
}

function renderSource(src, state, term) {
  const box = el('section', 'src');
  const h = el('h2', null, src.name + (state.items ? ` \u00b7 ${state.items.length}` : ''));
  const site = SITES.find((s) => s.id === src.id);
  if (site) {
    const more = el('a', null, 'See all \u2192');
    more.href = site.url(term);
    more.target = '_blank';
    more.rel = 'noopener noreferrer';
    h.appendChild(more);
  }
  box.appendChild(h);
  if (state.loading) { box.appendChild(el('p', 'note', 'Looking\u2026')); return box; }
  if (state.error) { box.appendChild(el('p', 'note', `Couldn't reach ${src.name} just now.`)); return box; }
  if (!state.items.length) { box.appendChild(el('p', 'note', 'Nothing right now.')); return box; }
  const grid = el('div', 'cards');
  for (const it of state.items.slice(0, SHOW)) {
    const url = safeUrl(it.url);
    if (!url) continue;
    const a = el('a', 'card');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = String(it.title || '');
    const img = el('img');
    img.alt = '';
    img.loading = 'lazy';
    const src2 = safeUrl(it.image);
    if (src2) img.src = src2;
    a.appendChild(img);
    a.appendChild(el('div', 't', String(it.title || '')));
    a.appendChild(el('div', 'p', String(it.price || '')));
    grid.appendChild(a);
  }
  box.appendChild(grid);
  return box;
}

function render(term, states) {
  const root = $('#results');
  root.textContent = '';
  for (const src of LIVE) root.appendChild(renderSource(src, states[src.id], term));
}

async function search(raw) {
  const term = cleanTerm(raw);
  if (!term) { need(); return; }
  $('#msg').hidden = true;
  $('#q').value = term;
  current = term;
  if (!PRO) {   // live listings are the Pro bonus; the buttons below work for everyone
    const r = $('#results'); r.textContent = '';
    r.appendChild(el('p', 'note', `Choose where to look for \u201c${term}\u201d below. Live listings in this window come with Prowl Pro.`));
    return;
  }
  const states = {};
  for (const src of LIVE) states[src.id] = { loading: true };
  render(term, states);
  await Promise.all(LIVE.map(async (src) => {
    try {
      states[src.id] = { items: await fetchLive(src, term) };
    } catch (err) {
      console.error(`Prowl live search failed for ${src.name}:`, err);
      states[src.id] = { error: true };
    }
    if (current === term) render(term, states);
  }));
  // Keep the last search for this browser session, so reopening the popup
  // after tapping a result shows the same listings.
  try {
    await chrome.storage.session.set({ last: { term, states } });
  } catch (err) {
    console.error('Prowl could not keep the last search:', err);
  }
}

$('#f').addEventListener('submit', (e) => {
  e.preventDefault();
  search($('#q').value);
});

function termOrAsk() {
  const t = cleanTerm($('#q').value);
  if (!t) need();
  return t;
}

$('#prowl').addEventListener('click', async () => { const t = termOrAsk(); if (t) await openTab(prowlUrl(t)); });
$('#sold').addEventListener('click', async () => { const t = termOrAsk(); if (t) await openTab(soldUrl(t)); });
$('#guide').addEventListener('click', async () => { const t = termOrAsk(); if (t) await openTab(guideUrl(t)); });
$('#photo').addEventListener('click', () => openTab(photoUrl()));
$('#daily').addEventListener('click', () => openTab(dailyUrl()));
$('#images').addEventListener('click', async () => { const t = termOrAsk(); if (t) await openTab(imagesUrl(t)); });
$('#all').addEventListener('click', async () => {
  const t = termOrAsk();
  if (!t) return;
  try {
    const win = await chrome.windows.getCurrent();
    await chrome.runtime.sendMessage({ type: 'openAll', term: t, windowId: win.id });
    window.close();
  } catch (err) {
    console.error('Prowl open-all failed:', err);
  }
});

// ---------- Pro ----------
// The basics are free. Live listings, Field Guide, Daily and photo checks are
// the Prowl Pro bonus. PRO is settled once when the popup opens.
let PRO = false;
function applyPro(on) {
  PRO = on;
  for (const n of document.querySelectorAll('[data-pro]')) n.hidden = !on;
  $('#locked').hidden = on;
}
$('#getpro').addEventListener('click', () => openTab(PRO_PAGE));
$('#signin').addEventListener('click', () => openTab(PROWL));
$('#recheck').addEventListener('click', async () => {
  const pro = await isPro({ force: true });
  applyPro(pro);
  if (pro) { if (current) search(current); return; }
  const m = $('#lockmsg');
  m.textContent = 'No Prowl Pro sign-in found yet. Sign in on Prowl first, then try again.';
  m.hidden = false;
});

// On open: a term handed over from the right-click menu wins; otherwise show
// the last search from this session, if there is one.
(async () => {
  applyPro(await isPro());
  try {
    const { pending, last } = await chrome.storage.session.get(['pending', 'last']);
    if (pending) {
      await chrome.storage.session.remove('pending');
      await search(pending);
    } else if (last && last.term) {
      $('#q').value = last.term;
      current = last.term;
      render(last.term, last.states);
    }
  } catch (err) {
    console.error('Prowl could not restore the last search:', err);
  }
})();
