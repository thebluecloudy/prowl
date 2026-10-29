// Page v8.14: a shelf scan sends the visitor's own hunts (up to 30, never the samples) so worker v188 can check
// every hunt with Jev. The send line sits in the photo script, outside prowl-js (a strict IIFE), so prowl-js
// hands the list over as window.prowlHunts().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const HTML = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const MARK = "if(SHELF){try{var sh=typeof window.prowlHunts==='function'?window.prowlHunts():[];if(sh&&sh.length)pb.hunts=sh.slice(0,30);}catch(e){}}";

test('the shelf send adds the hunts once, capped at 30, samples left out', () => {
  assert.equal(HTML.split(MARK).length - 1, 1);
  const v = /var PROWL_VERSION='v8\.(\d+)'/.exec(HTML);
  assert.ok(v && Number(v[1]) >= 14, 'page v8.14 or later');
});

test('window.prowlHunts gives the photo script the visitor\'s own hunts', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['Brad Keeler', 'Pyrex Butterprint', 'Hull pottery owl'] } } });
  await tick(60);
  const got = p.win.prowlHunts();
  assert.deepEqual(Array.from(got), ['Brad Keeler', 'Hull pottery owl'], 'the Pyrex Butterprint sample chip is left out');
  await p.close();
});
