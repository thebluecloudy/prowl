// Page v6.93 (Hark's Pounce, brought onto main): Den > Settings has a Pounce section. A quarry is one of the member's
// alert hunts plus their own words for the exact piece; the worker (v112) judges new listings against it and keeps the
// matches, which show here as "Spotted for you" with Open it, Fair price? and Not it. A match newer than this device
// last saw shows a note, and nothing more: Prowl magic already moves the panther, so Pounce does not repeat it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const HUNT = 'Royal Haeger panther';
const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'matt.partsch@icloud.com' };
const MATCH = { hunt: 'royal haeger panther', title: 'Royal Haeger panther 26 inch, flat tail', price: '$185', url: 'https://www.ebay.com/itm/1', image: 'https://i.ebayimg.com/1.jpg', match: 'yes', p: 0.9, reason: 'Flat tail along the base, 26 inches.', at: '2026-10-12T15:00:00.000Z' };
const QUARRY = { spec: 'Royal Haeger R-495 black panther, 26 inches, tail flat along the base.', avoid: ['lamp'], min: 22, max: 30, photo: '', maybe: 0 };

function base(extra) {
  return Object.assign({ 'prowl.v36': { seen: true, hunts: [HUNT] }, owlTwigSgwTerms: [{ t: HUNT }] }, SIGNED, extra || {});
}
function worker(calls, over) {
  return (u, o) => {
    const url = String(u), body = (o && o.body) || '';
    calls.push({ url, body });
    if (/alerts\/status/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(Object.assign({ on: true, email: 'matt.partsch@icloud.com', hunts: [HUNT], pro: false, free: 3, quarries: { 'royal haeger panther': QUARRY }, quarryMax: 1, quarryMatches: [MATCH], push: null }, over || {})) });
    if (/alerts\/quarry/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, quarries: { 'royal haeger panther': Object.assign({}, QUARRY, JSON.parse(body)) }, max: 1, matches: [MATCH] }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
}
async function openSettings(p) {
  await tick(1500);
  p.$('#otp-acct').click();
  await tick(80);
  const sec = p.$('#otp-denSettings .pnc');
  assert.ok(sec, 'the Pounce section is in Den > Settings');
  return sec;
}

test('Den > Settings shows the quarry and what Pounce spotted, with Open it and Not it', async () => {
  const calls = [];
  const p = loadPage({ storage: base({ 'prowl.pounceSeen': MATCH.at }), fetchImpl: worker(calls) });
  const sec = await openSettings(p);
  assert.match(sec.querySelector('h4').textContent, /Pounce\s*1 of 1/);
  assert.match(sec.textContent, /Royal Haeger R-495 black panther/);
  const hit = sec.querySelector('.pnc-hit');
  assert.ok(hit, 'the match is listed');
  assert.match(hit.textContent, /Flat tail along the base, 26 inches\./);
  assert.equal(hit.querySelector('a.b.p').getAttribute('href'), MATCH.url);
  assert.equal(hit.querySelector('img').getAttribute('src'), MATCH.image);
  assert.ok(hit.querySelector('[data-pnc="not"]'), 'Not it');
  assert.doesNotMatch(sec.textContent, /ntfy/, 'v6.97: ntfy is gone');
  assert.match(sec.textContent, /Finds wait at the top of your Prowl email\./, 'without Prowl\'s own alerts here, finds come by email');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('editing a quarry posts the member\'s words to the worker; v7.19: an empty description means any genuine one', async () => {
  const calls = [];
  const p = loadPage({ storage: base({ 'prowl.pounceSeen': MATCH.at }), fetchImpl: worker(calls) });
  const sec = await openSettings(p);
  sec.querySelector('[data-pnc="edit"]').click();
  await tick(30);
  const ta = p.$('#otp-pncSpec');
  assert.ok(ta, 'the editor opens');
  p.$('#otp-pncSpec').value = 'Royal Haeger R-495 panther, 26 inches, flat tail. Not the TV lamp.';
  p.$('#otp-pncSpec').dispatchEvent(new p.win.Event('input', { bubbles: true }));
  p.$('#otp-denSettings [data-pnc="save"]').click();
  await tick(60);
  const sent = calls.filter((c) => /alerts\/quarry/.test(c.url));
  assert.equal(sent.length, 1);
  const b = JSON.parse(sent[0].body);
  assert.equal(b.hunt, 'royal haeger panther');
  assert.match(b.spec, /Not the TV lamp/);
  assert.deepEqual([b.min, b.max], [22, 30]);
  assert.equal(b.tok, SIGNED['prowl.alertTok']);
  assert.match(p.$('#otp-denSettings .pnc').textContent, /Saved\. Pounce is stalking it\./);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a refused save says why right under the box, not below every hunt (v6.95)', async () => {
  const calls = [];
  const refuse = (u, o) => /alerts\/quarry/.test(String(u))
    ? (calls.push({ url: String(u), body: (o && o.body) || '' }), Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'Pounce works on one of your saved hunts.' }) }))
    : worker(calls, { quarries: {}, quarryMatches: [] })(u, o);
  const p = loadPage({ storage: base({ owlTwigSgwTerms: [{ t: HUNT }, { t: 'Fiesta' }, { t: 'Pyrex' }] }), fetchImpl: refuse });
  const sec = await openSettings(p);
  sec.querySelector('[data-pnc="edit"]').click();
  await tick(30);
  p.$('#otp-pncSpec').value = 'Royal Haeger R-495 panther, 26 inches, flat tail.';
  p.$('#otp-pncSpec').dispatchEvent(new p.win.Event('input', { bubbles: true }));
  p.$('#otp-denSettings [data-pnc="save"]').click();
  assert.match(p.$('#otp-denSettings .pnc-msg').textContent, /Saving/, 'it says it is saving at once');
  await tick(60);
  const msg = p.$('#otp-denSettings .pnc-msg');
  assert.equal(msg.textContent, 'Pounce works on one of your saved hunts.');
  assert.ok(msg.previousElementSibling && msg.previousElementSibling.classList.contains('pnc-ed'), 'right under the open box');
  await p.close();
});

test('an answer that is not JSON still says what came back', async () => {
  const calls = [];
  const broken = (u, o) => /alerts\/quarry/.test(String(u))
    ? Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('not json')) })
    : worker(calls, { quarries: {}, quarryMatches: [] })(u, o);
  const p = loadPage({ storage: base(), fetchImpl: broken });
  const sec = await openSettings(p);
  sec.querySelector('[data-pnc="edit"]').click();
  await tick(30);
  p.$('#otp-pncSpec').value = 'Royal Haeger R-495 panther, 26 inches, flat tail.';
  p.$('#otp-pncSpec').dispatchEvent(new p.win.Event('input', { bubbles: true }));
  p.$('#otp-denSettings [data-pnc="save"]').click();
  await tick(60);
  assert.match(p.$('#otp-denSettings .pnc-msg').textContent, /Prowl could not save it \(502\)/);
  await p.close();
});

test('a new match shows a note and nothing else: no pounce event, the panther is not made to move again', async () => {
  const calls = [];
  const p = loadPage({
    storage: base({ 'prowl.pounceSeen': '2026-10-11T00:00:00.000Z' }), fetchImpl: worker(calls),
    beforeLoad: (win) => { win.__pounces = 0; win.document.addEventListener('prowl:pounce', () => { win.__pounces++; }); }
  });
  await tick(1500);
  assert.match(p.$('#otp-toast').textContent, /Pounce spotted something for royal haeger panther/);
  assert.equal(p.win.localStorage.getItem('prowl.pounceSeen'), MATCH.at, 'remembered, so the note shows once');
  assert.equal(p.win.__pounces, 0, 'no pounce event');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the first time a device sees matches, no note: it only remembers where it is', async () => {
  const calls = [];
  const p = loadPage({ storage: base(), fetchImpl: worker(calls) });
  await tick(1500);
  assert.doesNotMatch(p.$('#otp-toast').textContent || '', /Pounce spotted/);
  assert.equal(p.win.localStorage.getItem('prowl.pounceSeen'), MATCH.at);
  await p.close();
});
