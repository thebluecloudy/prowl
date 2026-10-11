// Page v6.75 (build plan item 5): the Den's Local tab lists garage sales, the listings themselves (Craigslist's garage &
// moving sales and free stuff for the saved city) rather than a map search. Worker v99's /__probe asks the other
// finders at fixed addresses, so the owner can see which ones a Worker may read before the page shows them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const links = (p) => p.$$('#otp-salesGrid a').map((a) => [a.textContent, a.getAttribute('href')]);

test('Local shows garage sales for the saved city, newest first, from Craigslist', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [], city: 'Detroit' } } });
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  assert.deepEqual(links(p), [
    ['Garage sales on a map', 'https://www.craigslist.org/search/area/detroit?cat=gms#search=1~map~0~0'],
    ['Garage & moving sales', 'https://www.craigslist.org/search/area/detroit?cat=gms#search=1~list~0~0'],
    ['Free stuff', 'https://www.craigslist.org/search/area/detroit?cat=zip#search=1~list~0~0'],
  ]);
  assert.equal(p.$('#otp-salesScope').textContent, 'near Detroit');
  for (const a of p.$$('#otp-salesGrid a')) { assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/); }
  /* a new city: the links follow */
  p.$('#otp-cityIn').value = 'sfbay';
  p.$('#otp-citySet').click();
  await tick(30);
  assert.match(links(p)[0][1], /\/search\/area\/sfbay\?cat=gms#search=1~map~/);
  assert.equal(p.$('#otp-salesScope').textContent, 'near sfbay');
  assert.deepEqual(p.errors, []);
  await p.close();
});

// v6.80: a ZIP typed as the city made www.craigslist.org/search/area/48377?cat=gms, a 404 (the owner, 2026-10-10)
test('a ZIP as the city: Craigslist searches 25 miles around it, never /search/area/<ZIP>', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [], city: '48377' } } });
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  assert.deepEqual(links(p), [
    ['Garage sales on a map', 'https://annarbor.craigslist.org/search/gms?postal=48377&search_distance=25#search=1~map~0~0'],
    ['Garage & moving sales', 'https://annarbor.craigslist.org/search/gms?postal=48377&search_distance=25#search=1~list~0~0'],
    ['Free stuff', 'https://annarbor.craigslist.org/search/zip?postal=48377&search_distance=25#search=1~list~0~0'],
  ]);
  for (const [, u] of links(p)) assert.doesNotMatch(u, /search\/area\/\d/);
  /* ZIP+4 too, and the keyword search goes the same way */
  p.$('#otp-cityIn').value = '48377-1234';
  p.$('#otp-citySet').click();
  await tick(30);
  assert.equal(links(p)[1][1], 'https://annarbor.craigslist.org/search/gms?postal=48377&search_distance=25#search=1~list~0~0');
  const cl = p.$$('#otp-denLocalList .tb').find((b) => /^Craigslist/.test(b.textContent));
  assert.ok(cl, 'the Craigslist row in Local');
  p.$('#otp-q').value = 'pyrex';
  p.$('#otp-sf').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
  await tick(300);
  const u = [...p.opened, ...p.$$('a[href*="craigslist"]').map((x) => x.getAttribute('href'))].find((x) => /craigslist.*pyrex/.test(String(x)));
  assert.equal(u, 'https://annarbor.craigslist.org/search/sss?query=pyrex&postal=48377&search_distance=25#search=1~gallery~0~0');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('no city yet: the Ann Arbor area, as Craigslist does elsewhere in Prowl, and it says so', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(50);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(50);
  assert.match(links(p)[0][1], /\/search\/area\/annarbor\?cat=gms/);
  assert.equal(p.$('#otp-salesScope').textContent, 'near Ann Arbor');
  await p.close();
});

test('worker v99 probes the garage-sale finders at fixed addresses only (v101: never gsalr)', () => {
  const W = readFileSync(new URL('../../worker/index.js', import.meta.url), 'utf8');
  const fn = /^function buildCandidates\(Q\) \{[\s\S]*?\n\}/m.exec(W)[0];
  const list = new Function(fn + '\nreturn buildCandidates;')()('ceramic panther');
  const by = Object.fromEntries(list);
  assert.equal(by['estatesales-city'], 'https://www.estatesales.net/MI/Novi');
  assert.equal(by['craigslist-gms'], 'https://detroit.craigslist.org/search/gms');
  assert.equal(by['craigslist-gms-rss'], 'https://detroit.craigslist.org/search/gms?format=rss');
  assert.equal(by.gsalr, undefined, 'v101: gsalr forbids any automated access, so it is never asked');
  assert.ok(!list.some(([, u]) => /gsalr/.test(u)));
  assert.equal(by.yardsalesearch, 'https://www.yardsalesearch.com/');
  const other = new Function(fn + '\nreturn buildCandidates;')()('anything else');
  for (const k of ['estatesales-city', 'craigslist-gms', 'craigslist-gms-rss', 'yardsalesearch']) assert.equal(Object.fromEntries(other)[k], by[k], k + ' does not depend on the query');
});
