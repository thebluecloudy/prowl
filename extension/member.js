// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
//
// The extension is a Prowl Pro bonus. Membership is the same email + token the
// Prowl page keeps after sign-in; content.js copies the pair here when the
// member visits Prowl while signed in, and the Prowl server says whether that
// email has Pro. The answer is kept for a few hours so the toolbar opens fast.

export const PRO_PAGE = 'https://owlandtwigvintage.com/products/prowl-pro';
const API = 'https://prowl.thebluecloud.workers.dev';
const FRESH_MS = 6 * 60 * 60 * 1000;

export async function saveMember(e, t) {
  e = String(e || '').trim().toLowerCase().slice(0, 200);
  t = String(t || '').trim().slice(0, 200);
  if (!e || !t || !/^[A-Za-z0-9_.~-]+$/.test(t)) return;
  const { member } = await chrome.storage.local.get('member');
  if (member && member.e === e && member.t === t) return;
  await chrome.storage.local.set({ member: { e, t, pro: false, at: 0 } });
}

// True only when the Prowl server confirms Pro for the saved sign-in.
export async function isPro({ force = false } = {}) {
  const { member } = await chrome.storage.local.get('member');
  if (!member || !member.e || !member.t) return false;
  if (!force && member.at && Date.now() - member.at < FRESH_MS) return !!member.pro;
  try {
    const r = await fetch(`${API}/alerts/status?e=${encodeURIComponent(member.e)}&t=${encodeURIComponent(member.t)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    member.pro = !!(j && j.on && j.pro);
    member.at = Date.now();
    await chrome.storage.local.set({ member });
    return member.pro;
  } catch (err) {
    console.error('Prowl could not check membership:', err);
    return !!member.pro;   // offline: keep the last answer
  }
}

export async function signOut() {
  await chrome.storage.local.remove('member');
}
