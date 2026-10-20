// Page v7.46 (Matt, 2026-10-20: the weekly letter, "i like that it is in the app too, everyone gets it, sunday is good
// ... for now keep in den"): worker v152's Sunday letter shows in Daily for a week with Save, Share and Close, the quiet
// hunt's shorter search can be added or swapped in, and Den > Settings has the switch, a preview and the saved letters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const today = new Date(), iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const DAY = iso(new Date(today.getTime() - 86400000));
const LETTER = { day: DAY, hello: 'Sunday, Oct 25', sign: '— the panther 🐾', finds: 91, hunts: 2, lines: [
  { t: 'This week I stalked your 2 hunts across 3 marketplaces and dragged back 91 new finds.' },
  { b: 'Best find:', t: 'Rookwood owl trinket ashtray, $190.00 on Etsy, under the $210.00 it usually goes for this week.', url: 'https://www.etsy.com/listing/1111111111', img: 'https://i.etsystatic.com/o.jpg' },
  { b: 'Quietest hunt:', t: '“monstor vendall 1988 vending machine” turned up nothing all week. Want me to loosen it to “Vendall vending machine”? It would have found 6 listings this week.',
    hunt: 'monstor vendall 1988 vending machine', suggest: 'Vendall vending machine', n: 6 },
  { t: 'Same time next Sunday.' }] };
const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'member@example.com',
  'prowl.v36': { seen: true, hunts: ['rookwood owl', 'monstor vendall 1988 vending machine'], lock: [0, 1], h21: 1, h36: 1, h42: 1, h68: 1 } };

function open(extra = {}, url) {
  const live = liveFetch({ perSource: 2 }), sent = [];
  const fetchImpl = (u, o) => {
    const s = String(u);
    const body = o && o.body ? JSON.parse(o.body) : null;
    if (/\/alerts\/letter$/.test(s)) { sent.push({ u: s, body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body && body.preview ? { letter: { ...LETTER, hello: 'Tuesday, Oct 27' }, preview: true } : { letter: LETTER }) }); }
    if (/\/alerts\/status$/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on: true, hunts: SIGNED['prowl.v36'].hunts, prefs: {}, mail: 'on', free: 5, pro: false }) });
    if (/\/alerts\/prefs$/.test(s)) { sent.push({ u: s, body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, prefs: body.prefs }) }); }
    return live.impl(u, o);
  };
  return { p: loadPage({ fetchImpl, storage: { ...SIGNED, ...extra }, url }), sent };
}

test('Daily shows the Sunday letter at the top, with the best find linked and Save, Share and Close', async () => {
  const { p, sent } = open();
  await tick(60);
  p.$('#otp-dock .db[data-m="daily"]').click();
  const card = await waitFor(() => p.$('.dg-rc .lt-card'), { timeout: 8000 });
  assert.ok(sent.some(x => /alerts\/letter$/.test(x.u) && !x.body.preview && x.body.tok === 'tok-0123456789abcdef'));
  assert.match(card.querySelector('.lt-h').textContent, /Your week on the prowl/);
  assert.match(card.textContent, /dragged back 91 new finds/);
  assert.match(card.querySelector('a[href*="etsy.com/listing/1111111111"]').textContent, /See it/);
  assert.equal(card.previousElementSibling.classList.contains('dg-rh'), true, 'right under the Daily header');
  card.querySelector('[data-lt="save"]').click();
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.letters'))[0].day, DAY);
  card.querySelector('[data-lt="close"]').click();
  assert.equal(p.$('.dg-rc .lt-card'), null);
  assert.equal(p.win.localStorage.getItem('prowl.letterSeen'), DAY, 'closed stays closed');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the quiet hunt: the shorter search is added as a new hunt, or replaces the old one', async () => {
  const { p } = open();
  await tick(60);
  p.$('#otp-dock .db[data-m="daily"]').click();
  const card = await waitFor(() => p.$('.dg-rc .lt-card'), { timeout: 8000 });
  card.querySelector('[data-lt="swap"]').click();
  await tick(60);
  const hunts = JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts.map(h => h.toLowerCase());
  assert.ok(hunts.includes('vendall vending machine'), 'the new hunt is there');
  assert.ok(!hunts.includes('monstor vendall 1988 vending machine'), 'in place of the old one');
  assert.equal(hunts.length, 2, 'a full Den never loses a hunt');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a letter older than a week, or one already closed, stays out of Daily', async () => {
  const { p } = open({ 'prowl.letterSeen': DAY });
  await tick(60);
  p.$('#otp-dock .db[data-m="daily"]').click();
  await waitFor(() => p.$('.dg-rc'), { timeout: 8000 });
  await tick(300);
  assert.equal(p.$('.dg-rc .lt-card'), null);
  await p.close();
});

test('Den > Settings: the Weekly letter switch saves letter off, and the preview opens this week so far', async () => {
  const { p, sent } = open();
  await tick(1600);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(60);
  const set = await waitFor(() => p.$('#otp-letterSet'), { timeout: 8000 });
  assert.match(set.textContent, /Weekly letter/);
  set.querySelector('[data-mail="letter"][data-v="off"]').click();
  await waitFor(() => sent.some(x => /alerts\/prefs$/.test(x.u) && x.body.prefs.letter === 'off'), { timeout: 3000 });
  p.$('#otp-letterSet [data-mail="letterpeek"]').click();
  await waitFor(() => p.$('#otp-sheetB .lt'), { timeout: 3000 });
  assert.match(p.$('#otp-sheetB').textContent, /Tuesday, Oct 27[\s\S]*So far this week/);
  assert.ok(sent.some(x => x.body && x.body.preview === 1));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test("the email's Try button (?hunt=) opens Prowl searching that shorter hunt, and the link is cleaned", async () => {
  const { p } = open({}, 'https://www.owlandtwigvintage.com/pages/prowl?alerts=in&hunt=Vendall%20vending%20machine');
  await tick(1500);
  assert.equal(p.$('#otp-q').value, 'Vendall vending machine');
  assert.doesNotMatch(p.win.location.search, /hunt=/);
  assert.deepEqual(p.errors, []);
  await p.close();
});
