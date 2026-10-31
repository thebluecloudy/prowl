// Page v6.64: "Wrong item? Re-price" when the price step has no answer. The placeholder "Checking sold prices…" used to
// stay as the Fair price, and Share drew it on the card; a daily limit read "could not be checked just now". Worker v93
// gives a free visitor 5 price lookups a day, so the limit is easy to reach. Runs the page's own show / priceIt.
// v7.76: Re-price became "Wrong? Fix the maker and check again" (the photos stay and Check again sends them with the
// words), so the price step is driven directly here, as a check's answer drives it.
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
  w.eval(`var O=document.getElementById('O'),H=document.getElementById('H'),P={value:''},API='x',RESEARCH_ON=true,TRAY=['data:image/jpeg;base64,AAAA'];
    function OH(){return {}} function lsG(){return ''} var GEN=0;function photoShow(){} function againRow(){} function fixIt(){} window.prowlAff=function(u){return u}; function guideLink(){} function researchIt(){} function pckKeep(){}
    function poshBox(){return document.createElement('div')} function shareCard(r){window.SHARED=r.fair}
    window.fetch=function(){var a=window.ANSWER;return Promise.resolve({ok:a.status===200,status:a.status,json:function(){return Promise.resolve(a.body)}})};
    ` + grab('shortQ') + grab('priceIt') + grab('show'));
  /* a check's answer is showing while its price is looked up */
  w.eval(`var nj={item:'McCoy owl cookie jar (maker you entered)',search:'McCoy owl cookie jar',basis:'pending',fair:'Checking sold prices\u2026'};show(nj,'data:image/jpeg;base64,AAAA');priceIt(nj,'data:image/jpeg;base64,AAAA');`);
  return new Promise((r) => setTimeout(() => r(w), 60));
}
const text = (w) => w.document.getElementById('O').textContent;
const note = (w) => [...w.document.querySelectorAll('.apr-note')].map((n) => n.textContent).join(' / ');
const shareBtn = (w) => [...w.document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Share this find');   /* v8.29: the button reads Share */

test('a daily limit: no stand-in price, no Share, and the note says why', async () => {
  const w = await card({ status: 429, body: { error: 'daily limit' } });
  assert.doesNotMatch(text(w), /Checking sold prices/);
  assert.equal(shareBtn(w), undefined, 'nothing to share without a price');
  assert.equal(note(w), 'You have used today’s price lookups. They reset tomorrow.');
  assert.ok([...w.document.querySelectorAll('button')].some((b) => b.textContent === 'Wrong? Fix the maker and check again'), 'the way to correct it is still there');
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
  assert.match(text(w), /\$70 – \$90/);   /* v8.29: shown as a range with a dash */
  shareBtn(w).click();
  assert.equal(w.SHARED, '$70-90');
});
