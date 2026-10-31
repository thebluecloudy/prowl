// Page v8.35 (Matt, 2026-10-31: "i would like to see it in the admin"): Send feedback, from Den > Settings, the link at
// the foot of the page and ?feedback=1 (the update email's button). A rating (optional), two boxes, and "OK to email me
// back" only when signed in to Prowl Alerts; POST /feedback with the member's headers; a thank-you; errors keep the note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const BASE = { 'prowl.v36': { seen: true, hunts: [] } };
const SIGNED = Object.assign({ 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'member@example.com' }, BASE);

function open({ storage = BASE, answer = { status: 200, j: { ok: true, reply: false } }, url, offline = false } = {}) {
  const sent = [];
  const fetchImpl = (u, o) => {
    const s = String(u);
    if (/\/feedback$/.test(s)) {
      sent.push({ u: s, o, body: JSON.parse(o.body) });
      if (offline) return Promise.reject(new Error('offline'));
      const a = typeof answer === 'function' ? answer(sent.length) : answer;
      return Promise.resolve({ ok: a.status === 200, status: a.status, json: () => Promise.resolve(a.j) });
    }
    if (/\/alerts\/status$/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on: true, hunts: [], prefs: {}, mail: 'on', free: 5, pro: false }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { p: loadPage({ fetchImpl, storage, url }), sent };
}
const sheetOn = (p) => p.$('#otp-sheet') && !p.$('#otp-sheet').hidden && p.$('#otp-sheetT').textContent === 'Send feedback';

test('Den > Settings has Send feedback; it opens the sheet with a rating, two boxes of 1000, and no reply box when signed out', async () => {
  const { p } = open();
  await tick(60);
  const row = p.$('#otp-denSettings #otp-fbkRow');
  assert.ok(row, 'a row in Settings');
  assert.ok(!row.closest('details'), 'not tucked under More settings');
  p.$('#otp-fbkBtn').click();
  await tick(30);
  assert.ok(sheetOn(p));
  assert.equal(p.$$('#otp-fbk .fbk-st').length, 5);
  assert.equal(p.$('#otp-fbkLike').getAttribute('maxlength'), '1000');
  assert.equal(p.$('#otp-fbkMiss').getAttribute('maxlength'), '1000');
  assert.equal(p.$('#otp-fbkLike').labels[0].textContent, 'What do you like?');
  assert.equal(p.$('#otp-fbkMiss').labels[0].textContent, 'What’s missing or broken?');
  assert.equal(p.$('#otp-fbkReply'), null, 'no reply box signed out');
  assert.match(p.$('#otp-fbk').textContent, /Sent without your name or email/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the foot of the page has a Send feedback link that opens it in place', async () => {
  const { p } = open();
  await tick(60);
  const a = p.$('#otp-fbkFoot');
  assert.ok(a && a.closest('.copyr'), 'in the copyright line');
  assert.equal(a.getAttribute('href'), '?feedback=1', 'works without the script too');
  const ev = new p.win.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true);
  await tick(30);
  assert.ok(sheetOn(p));
  await p.close();
});

test('?feedback=1 opens it and leaves the address clean', async () => {
  const { p } = open({ url: 'https://www.owlandtwigvintage.com/pages/prowl?feedback=1' });
  await waitFor(() => sheetOn(p), { timeout: 4000 });
  assert.doesNotMatch(p.win.location.search, /feedback/);
  await p.close();
});

test('signed out: a rating and two lines go to POST /feedback with the page version, then a thank-you', async () => {
  const { p, sent } = open();
  await tick(60);
  p.$('#otp-fbkBtn').click(); await tick(20);
  p.$('#otp-fbk [data-fbkr="4"]').click();
  assert.equal(p.$$('#otp-fbk .fbk-st.on').length, 4, 'four stars lit');
  assert.equal(p.$('#otp-fbk [data-fbkr="4"]').getAttribute('aria-pressed'), 'true');
  p.$('#otp-fbkLike').value = '  The Store tab ';
  p.$('#otp-fbkMiss').value = 'A dark map';
  p.$('#otp-fbk').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('.fbk-done'), { timeout: 3000 });
  assert.equal(sent.length, 1);
  assert.match(sent[0].u, /^https:\/\/prowl\.thebluecloud\.workers\.dev\/feedback$/);
  assert.equal(sent[0].o.method, 'POST');
  assert.deepEqual(sent[0].body, { rating: 4, like: 'The Store tab', miss: 'A dark map', reply: false, v: p.win.PROWL_VERSION || PAGE.match(/var PROWL_VERSION='(v[\d.]+)'/)[1] });
  assert.equal(sent[0].o.headers['X-Prowl-Email'], undefined, 'no member headers signed out');
  assert.match(p.$('.fbk-done').textContent, /Thank you![\s\S]*Every note helps/);
  p.$('.fbk-done [data-fbkx]').click();
  await tick(350);
  assert.equal(p.$('#otp-sheet').hidden, true, 'Close closes it');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a second tap on the same star clears the rating; nothing at all asks for something first and sends nothing', async () => {
  const { p, sent } = open();
  await tick(60);
  p.$('#otp-fbkBtn').click(); await tick(20);
  p.$('#otp-fbk [data-fbkr="2"]').click();
  p.$('#otp-fbk [data-fbkr="2"]').click();
  assert.equal(p.$$('#otp-fbk .fbk-st.on').length, 0);
  p.$('#otp-fbkGo').click();
  await tick(30);
  assert.equal(sent.length, 0);
  assert.equal(p.$('#otp-fbkErr').hidden, false);
  assert.match(p.$('#otp-fbkErr').textContent, /Pick a rating or write a line first/);
  await p.close();
});

test('signed in: the reply box shows the address; ticked, the request carries reply and the member headers; the thank-you says we will write back', async () => {
  const { p, sent } = open({ storage: SIGNED, answer: { status: 200, j: { ok: true, reply: true } } });
  await tick(80);
  p.$('#otp-fbkBtn').click(); await tick(20);
  const ck = p.$('#otp-fbkReply');
  assert.ok(ck, 'the reply box is there');
  assert.equal(ck.checked, false, 'off until they tick it');
  assert.match(ck.closest('label').textContent, /OK to email me back at member@example\.com/);
  ck.checked = true;
  p.$('#otp-fbkMiss').value = 'Saved search on the map';
  p.$('#otp-fbkGo').click();
  await waitFor(() => p.$('.fbk-done'), { timeout: 3000 });
  assert.equal(sent[0].body.reply, true);
  assert.equal(sent[0].o.headers['X-Prowl-Email'], 'member@example.com');
  assert.equal(sent[0].o.headers['X-Prowl-Tok'], 'tok-0123456789abcdef');
  assert.match(p.$('.fbk-done').textContent, /write back to member@example\.com/);
  await p.close();
});

test('errors keep the note and say what to do: too many, refused, offline; it can send again after', async () => {
  const { p, sent } = open({ answer: (n) => (n === 1 ? { status: 429, j: { error: 'That is a lot of feedback for one day.' } } : n === 2 ? { status: 503, j: { error: 'x' } } : { status: 200, j: { ok: true } }) });
  await tick(60);
  p.$('#otp-fbkBtn').click(); await tick(20);
  p.$('#otp-fbkLike').value = 'keep me';
  p.$('#otp-fbkGo').click();
  await waitFor(() => !p.$('#otp-fbkErr').hidden, { timeout: 3000 });
  assert.match(p.$('#otp-fbkErr').textContent, /a lot of feedback for one day/);
  assert.equal(p.$('#otp-fbkLike').value, 'keep me');
  assert.equal(p.$('#otp-fbkGo').disabled, false);
  p.$('#otp-fbkGo').click();
  await waitFor(() => /could not save that just now/.test(p.$('#otp-fbkErr').textContent), { timeout: 3000 });
  assert.match(p.$('#otp-fbkErr').textContent, /your note is still here/);
  p.$('#otp-fbkGo').click();
  await waitFor(() => p.$('.fbk-done'), { timeout: 3000 });
  assert.equal(sent.length, 3);
  await p.close();
  const off = open({ offline: true });
  await tick(60);
  off.p.$('#otp-fbkBtn').click(); await tick(20);
  off.p.$('#otp-fbkLike').value = 'x';
  off.p.$('#otp-fbkGo').click();
  await waitFor(() => !off.p.$('#otp-fbkErr').hidden, { timeout: 3000 });
  assert.match(off.p.$('#otp-fbkErr').textContent, /could not be reached/);
  await off.p.close();
});

test('review: reopening the sheet while a send is on its way: the old answer never writes into the new form, and no second note goes meanwhile', async () => {
  for (const outcome of ['ok', 'fail']) {
    let release;
    const { p } = open();
    const fetch0 = p.win.fetch, sent = [];
    const answer = outcome === 'ok' ? { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) } : { ok: false, status: 503, json: () => Promise.resolve({ error: 'x' }) };
    p.win.fetch = (u, o) => (/\/feedback$/.test(String(u)) ? new Promise((res) => { sent.push({ u, o }); release = () => res(answer); }) : fetch0(u, o));
    await tick(60);
    p.$('#otp-fbkBtn').click(); await tick(20);
    p.$('#otp-fbkLike').value = 'first note';
    p.$('#otp-fbkGo').click();
    await tick(20);
    assert.equal(sent.length, 1);
    p.$('#otp-fbkBtn').click(); await tick(20);   /* reopened: a fresh, empty form */
    assert.equal(p.$('#otp-fbkLike').value, '');
    p.$('#otp-fbkLike').value = 'second, half typed';
    p.$('#otp-fbkGo').click(); await tick(20);
    assert.equal(sent.length, 1, 'no second note while the first is pending');
    assert.match(p.$('#otp-fbkErr').textContent, /still sending/);
    release();
    await tick(80);
    assert.ok(p.$('#otp-fbk'), outcome + ': the new form is still there');
    assert.equal(p.$('.fbk-done'), null, outcome + ': no thank-you over it');
    assert.equal(p.$('#otp-fbkLike').value, 'second, half typed', outcome + ': what they typed stays');
    assert.doesNotMatch(p.$('#otp-fbkErr').textContent, /could not save/, outcome + ': no error from the old send');
    p.$('#otp-fbkGo').click(); await tick(20);
    assert.equal(sent.length, 2, outcome + ': it can send once the first has answered');
    await p.close();
  }
});

test('?store=1 opens the Store tab (the update email links there)', async () => {
  const { p } = open({ url: 'https://www.owlandtwigvintage.com/pages/prowl?store=1' });
  await waitFor(() => { const b = p.$('#otp-dock .db[data-m="store"]'); return b && b.classList.contains('on'); }, { timeout: 4000 });
  assert.doesNotMatch(p.win.location.search, /store=1/);
  await p.close();
});

test('the feedback styles are scoped and the script stays ES5', () => {
  const css = PAGE.slice(PAGE.indexOf('/* v8.35: Send feedback (the sheet) */'), PAGE.indexOf('/* v6.89: Uranium only'));
  for (const line of css.split('\n').slice(1).filter(Boolean)) assert.match(line, /^\.scout-app-wrapper /, line);
  const js = PAGE.slice(PAGE.indexOf('/* v8.35: Send feedback (Matt'), PAGE.indexOf('/* v5.93: ?photo=1 opens'));
  assert.doesNotMatch(js, /\b(let|const)\s|=>|`|\?\./);
});
