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
    ['Garage & moving sales', 'https://www.craigslist.org/search/area/detroit?cat=gms#search=1~list~0~0'],
    ['Free stuff', 'https://www.craigslist.org/search/area/detroit?cat=zip#search=1~list~0~0'],
  ]);
  assert.equal(p.$('#otp-salesScope').textContent, 'near Detroit');
  for (const a of p.$$('#otp-salesGrid a')) { assert.equal(a.target, '_blank'); assert.match(a.rel, /noopener/); }
  /* a new city: the links follow */
  p.$('#otp-cityIn').value = 'sfbay';
  p.$('#otp-citySet').click();
  await tick(30);
  assert.match(links(p)[0][1], /\/search\/area\/sfbay\?cat=gms/);
  assert.equal(p.$('#otp-salesScope').textContent, 'near sfbay');
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

test('worker v99 probes the garage-sale finders at fixed addresses only', () => {
  const W = readFileSync(new URL('../../worker/index.js', import.meta.url), 'utf8');
  const fn = /^function buildCandidates\(Q\) \{[\s\S]*?\n\}/m.exec(W)[0];
  const list = new Function(fn + '\nreturn buildCandidates;')()('ceramic panther');
  const by = Object.fromEntries(list);
  assert.equal(by['estatesales-city'], 'https://www.estatesales.net/MI/Novi');
  assert.equal(by['craigslist-gms'], 'https://detroit.craigslist.org/search/gms');
  assert.equal(by['craigslist-gms-rss'], 'https://detroit.craigslist.org/search/gms?format=rss');
  assert.equal(by.gsalr, 'https://gsalr.com/');
  assert.equal(by.yardsalesearch, 'https://www.yardsalesearch.com/');
  const other = new Function(fn + '\nreturn buildCandidates;')()('anything else');
  for (const k of ['estatesales-city', 'craigslist-gms', 'craigslist-gms-rss', 'gsalr', 'yardsalesearch']) assert.equal(Object.fromEntries(other)[k], by[k], k + ' does not depend on the query');
});
