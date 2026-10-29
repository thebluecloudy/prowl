// Page v8.15: shelf scan shows every pick the worker sends (up to 8) and a "Buy the whole shelf" card when worker v191
// sends `all`. Matt, 2026-10-29: "Can't we see more than one? You should buy this whole shelf."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const SHELF = {
  shelf: Array.from({ length: 5 }, (_, i) => ({ item: 'likely L.E. Smith Bittersweet vase ' + (i + 1), where: 'spot ' + i, fair: '$90-$150', payUpTo: '$40' })),
  all: { why: 'matched Bittersweet swung glass', fair: '$400-$650', payUpTo: '$150' }
};

test('page v8.15 carries the whole-shelf card style', () => {
  assert.match(HTML, /var PROWL_VERSION='v8\.15'/);
  assert.match(HTML, /\.sh-card\.sh-all\{/);
});

test('shelfShow renders 5 picks plus Buy the whole shelf, with money-only pay lines', () => {
  const i = HTML.indexOf('function shelfShow(j){'), body = HTML.slice(i, HTML.indexOf('\n  O.addEventListener', i));
  const doc = new (require_jsdom())('<div id="o"></div>').window.document;
  const O = doc.getElementById('o');
  new Function('document', 'O', body + '; shelfShow(arguments[2]);')(doc, O, SHELF);
  const cards = O.querySelectorAll('.sh-card');
  assert.equal(cards.length, 6);
  assert.ok(cards[0].classList.contains('sh-all'));
  assert.equal(cards[0].querySelector('b').textContent, 'Buy the whole shelf');
  assert.match(cards[0].textContent, /All of it sells for \$400-\$650 · Pay up to \$150 for everything/);
  assert.equal(O.querySelector('h3').textContent, '5 worth a closer look');
  assert.ok(!/to pay to pay|\$40 to pay/.test(O.textContent));
});

import { createRequire } from 'node:module';
function require_jsdom() { return createRequire(import.meta.url)('jsdom').JSDOM; }
