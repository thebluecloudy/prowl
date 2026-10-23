// Page v7.72 (the owner: "Using benchmark review the near me feature to make it more intuitive", release 2 of 3:
// Road trip, against Google and Apple Maps' directions, Waze and Roadtrippers). Where to is the first thing; From is
// the same pill as Around you; the options fold into one line that rebuilds once, on Done; stops are lettered A, B, C
// with what each adds to the drive; the bar is one Start in Maps, in the maps app picked, with the rest behind More.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const shop = (id, name, town, lat, lng, x) => Object.assign({ id, name, town, why: 'Antiques', photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + id, lat, lng, hours: null, nested: [] }, x || {});
const DEST = shop('D', 'Blenko Glass Company', 'Milton, WV', 38.4345, -82.1322);
const STOPS = [shop('S1', 'Maumee Antique Mall', 'Maumee, OH', 41.57, -83.64, { near: 4.2 }), shop('S2', 'Findlay Market', 'Findlay, OH', 41.04, -83.65, { near: 12 }), shop('S3', 'Chillicothe Emporium', 'Chillicothe, OH', 39.33, -82.98, { near: 0.3 })];
const mkTrip = (stops) => ({ origin: { town: 'Novi, MI' }, dest: DEST, route: { mi: 300, min: 300 }, day: '', stops, more: [], maps: 'https://www.google.com/maps/dir/?api=1', line: [[41.5, -83.6], [38.5, -82.5]] });
function fx(calls, stops, opt) {
  opt = opt || {};
  return (u) => {
    const url = String(u); calls.push(url);
    if (/\/trip\?/.test(url)) return J(mkTrip(stops));
    if (/\/near\?/.test(url)) return J({ town: 'Novi, MI', places: opt.near || [] });
    if (/\/trips$/.test(url)) return J({ trips: [] });
    return J({ items: [] });
  };
}
const phone = (denied) => (w) => Object.defineProperty(w.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok, err) => setTimeout(() => (denied ? err({ code: 1 }) : ok({ coords: { latitude: 42.48, longitude: -83.47 } })), 0) } });
async function roadTrip(opt) {
  opt = opt || {};
  const calls = [];
  const p = loadPage({ storage: Object.assign({}, DEN, opt.storage || {}), fetchImpl: fx(calls, opt.stops || STOPS, opt), beforeLoad: phone(opt.denied) });
  await tick(30); p.$('#otp-localBtn').click(); await tick(100);
  p.$('#otp-nrT2').click(); await tick(20);
  return { p, calls };
}
async function build(p, to) {
  p.$('#otp-nrTo').value = to;
  p.$('#otp-nrForm').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);
}
const trips = (calls) => calls.filter((u) => /\/trip\?/.test(u));

test('where to comes first; From is a pill under it, where you are until changed', async () => {
  const { p } = await roadTrip();
  const pane = p.$('#otp-nrTrip');
  assert.equal(pane.querySelector('h3').textContent, 'Where are you headed?');
  assert.equal(pane.querySelector('h3 label').htmlFor, 'otp-nrTo', 'the heading is the box\'s label');
  assert.equal(p.$('#otp-nrTo').placeholder, 'Town, City, ST, ZIP or a shop');
  assert.ok(p.$('#otp-nrForm').compareDocumentPosition(p.$('#otp-nrFromP')) & p.win.Node.DOCUMENT_POSITION_FOLLOWING, 'From under To');
  assert.equal(p.$('#otp-nrFromP .nr-wl').textContent, '📍 From where you are');
  assert.equal(p.$('#otp-nrFromBox').hidden, true, 'the From box waits behind Change');
  p.$('#otp-nrFromGo').click();
  assert.equal(p.$('#otp-nrFromBox').hidden, false);
  assert.equal(p.$('#otp-nrFromGo').textContent, 'Done');
  assert.equal(p.$('#otp-nrFromGo').getAttribute('aria-expanded'), 'true');
  p.$('#otp-nrFrom').value = 'Findlay, OH';
  p.$('#otp-nrFrom').dispatchEvent(new p.win.Event('input', { bubbles: true }));
  assert.equal(p.$('#otp-nrFromP .nr-wl').textContent, '📍 From Findlay, OH', 'the pill follows the box');
  p.$('#otp-nrFromGo').click();
  assert.equal(p.$('#otp-nrFromBox').hidden, true);
  assert.equal(p.$('#otp-nrTripL').textContent, 'Prowl lists the antique, vintage and thrift shops worth a stop on the way. No destination: a loop of the shops around the start.');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a place in use starts the pill there', async () => {
  const { p } = await roadTrip({ storage: { 'prowl.nearAt': { q: 'Milton, WV', lat: 38.4345, lng: -82.1322, town: 'Milton, WV', city: 'Milton', st: 'WV', zip: '25541', cl: 'huntington', fb: '', on: true } } });
  assert.equal(p.$('#otp-nrFromP .nr-wl').textContent, '📍 From Milton, WV');
  await p.close();
});

test('the options are one line; changes inside wait for Done, then the trip is rebuilt once with all of them', async () => {
  const { p, calls } = await roadTrip();
  const opts = p.$('#otp-nrOpts');
  assert.equal(opts.tagName, 'DETAILS'); assert.equal(opts.open, false);
  assert.equal(p.$('#otp-nrOptsL').textContent, 'Today · leave now · stops up to 15 min off the road · Antiques, Vintage, Thrift');
  assert.ok(opts.contains(p.$('#otp-nrCats')) && opts.contains(p.$('#otp-nrDetour')) && opts.contains(p.$('#otp-nrDays')) && opts.contains(p.$('#otp-nrLeave')), 'every option inside');
  await build(p, 'Blenko');
  assert.equal(trips(calls).length, 1);
  opts.open = true;
  p.$('#otp-nrCats [data-nrcat="records"]').click();
  p.$('#otp-nrDetour [data-nrdet="30"]').click();
  await tick(60);
  assert.equal(trips(calls).length, 1, 'no rebuild per chip');
  assert.equal(p.$('#otp-nrOptsL').textContent, 'Today · leave now · stops up to 30 min off the road · Antiques, Vintage, Thrift, Records', 'the line says what is set');
  p.$('#otp-nrOptsDone').click(); await tick(200);
  assert.equal(opts.open, false, 'Done folds it');
  assert.equal(trips(calls).length, 2, 'one rebuild');
  assert.match(trips(calls)[1], /cats=antiques%2Cvintage%2Cthrift%2Crecords&detour=30$/);
  p.$('#otp-nrOptsDone').click(); await tick(60);
  assert.equal(trips(calls).length, 2, 'nothing changed, nothing rebuilt');
  p.$('#otp-nrLeave').value = '09:30';
  p.$('#otp-nrLeave').dispatchEvent(new p.win.Event('change', { bubbles: true }));
  assert.match(p.$('#otp-nrOptsL').textContent, /^Today · leave 9:30 AM · /);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('stops are lettered A, B, C, each with what it adds to the drive; Skip has its sign', async () => {
  const { p } = await roadTrip();
  await build(p, 'Blenko');
  const cards = p.$$('#otp-nrOut .nr-stops > .nr-stop > .nr-row > a.nr-anchor');
  assert.deepEqual(cards.map((c) => c.querySelector('.nr-num').textContent), ['A', 'B', 'C']);
  assert.deepEqual(cards.map((c) => c.querySelector('.nr-det').textContent), ['+4 min', '+12 min', '+1 min']);
  assert.equal(cards[1].querySelector('.nr-det').title, 'Adds about 12 min to the drive');
  const skip = p.$('#otp-nrOut .nr-stop .nr-skip');
  assert.equal(skip.textContent, '− Skip');
  assert.equal(skip.getAttribute('aria-label'), 'Skip Maumee Antique Mall');
  assert.equal(skip.querySelector('[aria-hidden="true"]').textContent, '−');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the bar is one Start in Maps and More; More holds every Maps link, REBUILD and SHARE', async () => {
  const { p } = await roadTrip();
  await build(p, 'Blenko');
  assert.equal(p.$('#otp-nrFoot').hidden, false);
  const start = p.$('#otp-nrStart');
  assert.equal(start.textContent, 'Start in Maps');
  assert.equal(start.getAttribute('aria-label'), 'Start in Google Maps');
  assert.equal(start.href, p.$('#otp-nrMaps').href, 'the Google route');
  assert.equal(start.target, '_blank');
  assert.equal(p.$('#otp-nrFootP').hidden, true, 'the rest waits behind More');
  const more = p.$('#otp-nrFootMore');
  assert.equal(more.textContent, '⋯ More'); assert.equal(more.getAttribute('aria-expanded'), 'false');
  more.click();
  assert.equal(p.$('#otp-nrFootP').hidden, false);
  assert.equal(more.textContent, 'Close'); assert.equal(more.getAttribute('aria-expanded'), 'true');
  const panel = p.$('#otp-nrFootP');
  assert.ok(panel.contains(p.$('#otp-nrMaps')) && panel.contains(p.$('#otp-nrHere')) && panel.contains(p.$('#otp-nrShare')));
  assert.equal(p.$('#otp-nrApple a').textContent, 'APPLE');
  assert.equal(p.$('#otp-nrAppleL').hidden, false);
  more.click();
  assert.equal(p.$('#otp-nrFootP').hidden, true);
  await p.close();
  const a = await roadTrip({ storage: { 'prowl.maps': 'apple' } });
  await build(a.p, 'Blenko');
  assert.match(a.p.$('#otp-nrStart').href, /^https:\/\/maps\.apple\.com\//, 'Apple Maps when that is the pick');
  assert.equal(a.p.$('#otp-nrStart').getAttribute('aria-label'), 'Start in Apple Maps');
  await a.p.close();
});

test('a trip split into legs starts with the first, and says so', async () => {
  const many = Array.from({ length: 12 }, (_, i) => shop('M' + i, 'Shop ' + i, 'Town ' + i + ', OH', 41 - i * 0.2, -83.6, { near: 5 }));
  const { p } = await roadTrip({ stops: many });
  await build(p, 'Blenko');
  assert.equal(p.$$('#otp-nrLegs a').length, 2);
  assert.equal(p.$('#otp-nrStart').textContent, 'Start in Maps (1 of 2)');
  assert.equal(p.$('#otp-nrStart').href, p.$('#otp-nrLegs a').href);
  await p.close();
});

test('no stops: no bar, and the drive is a link right there instead of "in Maps below"', async () => {
  const { p } = await roadTrip({ stops: [] });
  await build(p, 'Blenko');
  assert.equal(p.$('#otp-nrFoot').hidden, true);
  const empty = p.$('#otp-nrOut .nr-empty');
  assert.match(empty.textContent, /The drive itself is ready: Open the drive in Google Maps ↗$/);
  assert.doesNotMatch(empty.textContent, /below/);
  assert.match(empty.querySelector('a').href, /^https:\/\/www\.google\.com\/maps\/dir\//);
  await p.close();
});

test('location blocked: Type where you start opens From, ready to type', async () => {
  const { p } = await roadTrip({ denied: true });
  await build(p, 'Blenko');
  assert.match(p.$('#otp-nrOut').textContent, /Or tap Change by From above and type a town, City, ST or ZIP/);
  p.$('#otp-nrOut [data-nrfromopen]').click();
  assert.equal(p.$('#otp-nrFromBox').hidden, false);
  assert.equal(p.doc.activeElement, p.$('#otp-nrFrom'));
  assert.deepEqual(p.errors, []);
  await p.close();
});
