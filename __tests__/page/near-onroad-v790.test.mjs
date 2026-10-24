// Page v7.90 / worker v167 (the owner: "do all 3"). On the road:
// 1. On a group trip, ✓ Been is the group's: the trip view carries been, and a mark is sent to POST /trips/<id>/been.
// 2. Next stop says how far it is and when you would be there (from the phone, else from your last stop).
// 3. Hide the stops closed by the time you get there: off the list and out of the Maps link, a town's open shop
//    taking its stop's place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const today = () => { const d = new Date(), m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; };
const ALWAYS = { offset: 0, periods: [{ open: { day: 0, hour: 0, minute: 0 }, close: null }], days: [] };
function dailyShut() {   /* the same window every day: an hour ago to 30 minutes from now, so a stop reached hours later is closed, whatever the time */
  const a = new Date(Date.now() - 3600000), b = new Date(Date.now() + 1800000), wrap = b.getUTCDay() !== a.getUTCDay() ? 1 : 0, out = [];
  for (let d = 0; d < 7; d++) out.push({ open: { day: d, hour: a.getUTCHours(), minute: a.getUTCMinutes() }, close: { day: (d + wrap) % 7, hour: b.getUTCHours(), minute: b.getUTCMinutes() } });
  return { offset: 0, periods: out, days: [] };
}
const place = (id, name, lat, lng, hours, extra) => Object.assign({ id, name, town: 'Somewhere, OH', why: 'Antiques', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat, lng, hours: hours || ALWAYS, nested: [] }, extra || {});
const phone = (win) => Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 42.4806, longitude: -83.4755 } }), 0) } });
const sess = () => { const exp = Math.floor(Date.now() / 1000) + 86400; return Buffer.from('123.' + exp + '.abc').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

/* 300 miles in 300 minutes; Toledo about an hour off, Huntington about four */
const TRIP = () => ({ origin: { town: 'Novi, MI' }, route: { mi: 300, min: 300 }, day: today(), maps: 'https://www.google.com/maps/dir/?api=1', more: [],
  dest: place('D', 'Blenko Glass Company', 38.43, -82.2),
  stops: [
    place('S1', 'Open All Day Mall', 41.65, -83.54, ALWAYS, { nested: [place('S2', 'Shuts Soon Vintage', 41.66, -83.55, dailyShut())] }),
    place('S3', 'Gone By Then Antiques', 38.42, -82.44, dailyShut(), { nested: [place('S4', 'Late Night Thrift', 38.42, -82.45)] }),
  ] });
async function built(calls) {
  const p = loadPage({ storage: Object.assign({}, DEN), fetchImpl: (u) => { const url = String(u); calls.push(url); if (/\/trip\?/.test(url)) return J(TRIP()); return J({ places: [], items: [] }); }, beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT2').click(); await tick(20);
  p.$('#otp-nrTo').value = 'Blenko Glass Company, Milton, WV';
  p.$('#otp-nrGo').click(); await tick(200);
  return p;
}
const names = (p) => p.$$('#otp-nrOut .nr-stops .nr-card .nr-n').map((e) => e.textContent);

test('v7.90: hide the stops closed by the time you get there: off the list and out of the Maps link; Show brings them back', async () => {
  const p = await built([]);
  assert.deepEqual(names(p), ['Open All Day Mall', 'Shuts Soon Vintage', 'Gone By Then Antiques', 'Late Night Thrift']);
  const b = p.$('#otp-nrOut [data-nrlate]');
  assert.equal(b.textContent, 'Hide the 2 closed by then');
  assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.match(decodeURIComponent(p.$('#otp-nrStart').href), /Gone By Then Antiques/);
  b.click(); await tick(20);
  assert.deepEqual(names(p), ['Open All Day Mall', 'Late Night Thrift'], 'the town\'s open shop takes its stop\'s place');
  assert.deepEqual(p.$$('#otp-nrOut .nr-stops .nr-anchor .nr-num').map((e) => e.textContent), ['A', 'B']);
  assert.match(p.$('#otp-nrOut .nr-head').textContent, /Hiding 2 closed by the time you get there/);
  const go = decodeURIComponent(p.$('#otp-nrStart').href);
  assert.doesNotMatch(go, /Gone By Then Antiques/, 'out of the Maps link');
  assert.match(go, /Late Night Thrift/, 'and the open one in');
  const show = p.$('#otp-nrOut [data-nrlate]');
  assert.equal(show.textContent, 'Show the 2 closed by then'); assert.equal(show.getAttribute('aria-pressed'), 'true');
  show.click(); await tick(20);
  assert.equal(names(p).length, 4);
  assert.deepEqual(p.errors, []);
});

test('v7.90: Next stop says how far it is from you, about how long, and when you would be there', async () => {
  const p = await built([]);
  p.$('#otp-nrOut [data-nrbeen="S1"]').click(); await tick(40);
  assert.equal(p.$('#otp-nrOut .nr-next .nr-n').textContent, 'Gone By Then Antiques');
  const m = p.$('#otp-nrOut .nr-next .nr-nextm').textContent;
  assert.match(m, /^About \d+ mi from you · about \d+ h( \d+ min)? · there by \d{1,2}(:\d{2})? (AM|PM)$/, m);
  assert.deepEqual(p.errors, []);
});

test('v7.90: on a group trip the marks are the group\'s: shown from the trip, sent when you tap, taken off for everyone', async () => {
  const calls = [];
  const VIEW = Object.assign(TRIP(), { id: 'tabcdefghi', mine: true, org: false, members: 2, origin: 'Novi, MI', closes: '2099-01-01T00:00:00.000Z', finds: 0, been: ['S1'] });
  let fail = false;
  const fetchImpl = (u, o) => {
    const url = String(u); calls.push({ url, o: o || {} });
    if (/\/trips\/tabcdefghi\/been$/.test(url)) { if (fail) return J({ error: 'down' }, 503); const b = JSON.parse(o.body); VIEW.been = b.on ? VIEW.been.concat([b.stop]) : VIEW.been.filter((x) => x !== b.stop); return J({ ok: true, been: VIEW.been }); }
    if (/\/trips\/tabcdefghi\/finds$/.test(url)) return J({ finds: [] });
    if (/\/trips\/tabcdefghi$/.test(url)) return J(VIEW);
    if (/\/trips$/.test(url)) return J({ trips: [{ id: 'tabcdefghi', day: VIEW.day, origin: 'Novi, MI', dest: VIEW.dest, members: 2, stops: 2, org: false }] });
    return J({ places: [], items: [] });
  };
  const p = loadPage({ storage: Object.assign({}, DEN, { 'prowl.session': sess() }), fetchImpl, beforeLoad: phone });
  await tick(30);
  p.$('#otp-localBtn').click(); await tick(60);
  p.$('#otp-nrT3').click(); await tick(40);
  p.$('#otp-nrTrips [data-nrtrip="tabcdefghi"]').click(); await tick(100);
  const been = (id) => p.$(`#otp-nrOut .nr-stops [data-nrbeen="${id}"]`);
  assert.equal(been('S1').textContent, 'Undo', 'a friend marked it: Been there here too');
  assert.ok(p.$('#otp-nrOut .nr-next'), 'and Next stop follows it');
  been('S3').click(); await tick(60);
  const sent = calls.filter((x) => /\/been$/.test(x.url));
  assert.equal(sent.length, 1); assert.equal(sent[0].o.method, 'POST'); assert.deepEqual(sent[0].o.body ? JSON.parse(sent[0].o.body) : null, { stop: 'S3', on: true });
  assert.equal(been('S3').textContent, 'Undo');
  been('S1').click(); await tick(60);
  assert.deepEqual(JSON.parse(calls.filter((x) => /\/been$/.test(x.url)).pop().o.body), { stop: 'S1', on: false }, 'a friend\'s mark can be taken off for everyone');
  assert.equal(been('S1').textContent, '✓ Been');
  fail = true;
  been('S2').click(); await tick(60);
  assert.match(p.$('#otp-toast').textContent, /Marked on this phone/);
  assert.equal(been('S2').textContent, 'Undo', 'still marked here');
  assert.deepEqual(p.errors, []);
  await p.close();
});
