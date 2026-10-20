// Page v7.47 (the owner, standing in the middle of Maumee Antique Mall with only the Vintage chip on: "it doesn't come
// up"). The search was right: Antiques was off. The page said "Antique, vintage and thrift shops" anyway. Now the copy
// names the kinds that are on, a usual kind that is off is said with one tap to turn it back on, and a listed shop a
// few hundred feet away is where you are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const card = (id, name, town, why, near, lat, lng) => ({ id, name, town, why, rating: 4.6, n: 300, photo: '', url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name) + '&query_place_id=' + id, lat: lat || 41.6, lng: lng || -83.7, hours: null, near });
const VINTAGE = [card('V1', 'Vintage Groves 116', 'Perrysburg, OH', 'Vintage', 0.05), card('V2', 'Bella River Boutique', 'Maumee, OH', 'Store', 2.1)];
const ALL = [card('M1', 'Maumee Antique Mall', 'Maumee, OH', 'Antique mall', 1.5, 41.5657, -83.6612)].concat(VINTAGE);   /* v7.48: 1.5 from the cell's first asker, steps from this phone */
const J = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
const fx = (calls) => (u) => {
  const url = String(u); calls.push(url);
  if (/\/near\?/.test(url)) { const cats = decodeURIComponent((/cats=([^&]*)/.exec(url) || [])[1] || ''); return J({ at: '', town: 'Maumee, OH', places: cats === 'vintage' ? VINTAGE : /^records/.test(cats) ? [] : ALL }); }
  return J({ items: [] });
};
const phone = (win) => Object.defineProperty(win.navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 41.5655, longitude: -83.661 } }), 0) } });
const open = async (storage, calls) => {
  const p = loadPage({ storage: Object.assign({ 'prowl.v36': { seen: true, hunts: [] } }, storage), fetchImpl: fx(calls), beforeLoad: phone });
  await tick(30); p.$('#otp-localBtn').click(); await tick(120); return p;
};

test('only Vintage on: the line says vintage shops, says Antiques and Thrift are off, and one tap brings them back with the mall you are standing in', async () => {
  const calls = [];
  const p = await open({ 'prowl.nearCats': ['vintage'] }, calls);
  const lede = p.$('#otp-nrLive .nearp').textContent;
  assert.match(lede, /^You are in Maumee, OH\. Vintage shops near where you are standing, biggest first\./);
  assert.doesNotMatch(p.$('#otp-nrLive').textContent, /Antique, vintage and thrift/, 'never the fixed list');
  const off = p.$('#otp-nrLive .nr-kindsoff');
  assert.ok(off, 'the kinds that are off are said');
  assert.equal(off.textContent, 'Antiques and Thrift are off, so antique malls are not listed. Show them too');
  assert.equal(p.$('#otp-nrCatsAll').tagName, 'BUTTON', 'v7.48: a real button');
  assert.match(p.$('#otp-nrLive .nearp').textContent, /^You are in Maumee, OH\./, 'v7.48: a shop the worker called close is miles from this phone, so not "You are at"');
  p.$('#otp-nrCatsAll').click();
  await tick(60);
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.nearCats')).join(','), 'antiques,vintage,thrift', 'the same key, the usual kinds added, in chip order');
  assert.match(calls.filter((u) => /\/near\?/.test(u)).pop(), /cats=antiques%2Cvintage%2Cthrift$/);
  assert.deepEqual(p.$$('#otp-nrCatsA [aria-pressed="true"]').map((b) => b.getAttribute('data-nrcat')), ['antiques', 'vintage', 'thrift'], 'the chips light up');
  assert.match(p.$('#otp-nrLive .nearp').textContent, /^You are at Maumee Antique Mall in Maumee, OH\. Antique, vintage and thrift shops near where you are standing/);
  assert.equal(p.$('#otp-nrLive .nr-kindsoff'), null, 'nothing off any more');
  assert.equal(p.$('#otp-nrLive .nr-card .nr-n').textContent, 'Maumee Antique Mall');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the usual kinds on: no note; records alone and nothing near: the empty line names records and offers the usual kinds', async () => {
  const a = await open({}, []);
  assert.match(a.$('#otp-nrLive .nearp').textContent, /^You are at Maumee Antique Mall in Maumee, OH\. Antique, vintage and thrift shops near/);
  assert.equal(a.$('#otp-nrLive .nr-kindsoff'), null);
  await a.close();
  const b = await open({ 'prowl.nearCats': ['records', 'flea'] }, []);
  assert.match(b.$('#otp-nrLive .nearp').textContent, /^You are in Maumee, OH\. No record shops and flea markets close by right now\./);
  assert.equal(b.$('#otp-nrLive .nr-kindsoff').textContent, 'Antiques, Vintage and Thrift are off, so antique malls are not listed. Show them too');
  assert.deepEqual(b.errors, []);
  await b.close();
});
