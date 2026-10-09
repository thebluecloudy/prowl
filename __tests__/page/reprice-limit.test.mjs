// Page v6.64: "Wrong item? Re-price" when the price step has no answer. The placeholder "Checking sold prices…" used to
// stay as the Fair price, and Share drew it on the card; a daily limit read "could not be checked just now". Worker v93
// gives a free visitor 5 price lookups a day, so the limit is easy to reach. Runs the page's own show / priceIt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
function grab(name) {
  const i = SRC.indexOf('  function ' + name + '(');
  assert.ok(i > 0, name);
  let d = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') d++;
    else if (SRC[k] === '}' && !--d) return SRC.slice(i, k + 1);
  }
  throw new Error(name);
}
function card(answer) {
  const dom = new JSDOM('<div id="O"></div><input id="H">', { runScripts: 'outside-only' });
  const w = dom.window;
  w.ANSWER = answer;
  w.eval(`var O=document.getElementById('O'),H=document.getElementById('H'),P={value:''},API='x',RESEARCH_ON=true;
    function OH(){return {}} function lsG(){return ''} window.prowlAff=function(u){return u}; function guideLink(){} function researchIt(){}
    function poshBox(){return document.createElement('div')} function shareCard(r){window.SHARED=r.fair}
    window.fetch=function(){var a=window.ANSWER;return Promise.resolve({ok:a.status===200,status:a.status,json:function(){return Promise.resolve(a.body)}})};
    ` + grab('shortQ') + grab('priceIt') + grab('show'));
  /* a priced card is showing; the visitor types what it really is and taps Re-price */
  w.eval(`show({item:'Hull cookie jar',fair:'$40-60',basis:'sold',search:'hull jar'},'data:image/jpeg;base64,AAAA');`);
  w.document.getElementById('H').value = 'McCoy owl cookie jar';
  [...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Wrong item? Re-price').click();
  return new Promise((r) => setTimeout(() => r(w), 60));
}
const text = (w) => w.document.getElementById('O').textContent;
const note = (w) => [...w.document.querySelectorAll('.apr-note')].map((n) => n.textContent).join(' / ');
const shareBtn = (w) => [...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Share this find');

test('a daily limit: no stand-in price, no Share, and the note says why', async () => {
  const w = await card({ status: 429, body: { error: 'daily limit' } });
  assert.doesNotMatch(text(w), /Checking sold prices/);
  assert.equal(shareBtn(w), undefined, 'nothing to share without a price');
  assert.equal(note(w), 'You have used today’s price lookups. They reset tomorrow.');
  assert.ok([...w.document.querySelectorAll('button')].some((b) => b.textContent === 'Wrong item? Re-price'), 'Re-price is still there');
});

test('busy now: the note says busy, not a limit', async () => {
  const w = await card({ status: 429, body: { error: 'busy now' } });
  assert.doesNotMatch(text(w), /Checking sold prices/);
  assert.equal(note(w), 'Prowl is busy right now. Try again in a little while.');
});

test('an answer that failed: no stand-in price, and no "estimate" when there is none', async () => {
  const w = await card({ status: 502, body: { error: 'price unavailable' } });
  assert.doesNotMatch(text(w), /Checking sold prices/);
  assert.equal(shareBtn(w), undefined);
  assert.equal(note(w), 'Sold prices could not be checked just now.');
});

test('a price comes back: shown, and Share carries it', async () => {
  const w = await card({ status: 200, body: { fair: '$70-90', basis: 'sold', why: 'Sold at $75 and $85.' } });
  assert.match(text(w), /\$70-90/);
  shareBtn(w).click();
  assert.equal(w.SHARED, '$70-90');
});
