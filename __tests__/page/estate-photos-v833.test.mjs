// Page v8.33 (Matt, 2026-10-31: "the estate sale pictures aren't working"): NEAR ME › Estate sales draws each sale's
// own cover photo (the worker's img, from the sale page's og:image on EstateSales.net's picture host), as the daily
// email does; any other address, or none, gets a quiet placeholder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
function fn(name) {
  const i = PAGE.indexOf('function ' + name + '(');
  assert.ok(i > 0, name);
  let d = 0, j = PAGE.indexOf('{', i);
  for (; j < PAGE.length; j++) { if (PAGE[j] === '{') d++; else if (PAGE[j] === '}' && --d === 0) break; }
  return PAGE.slice(i, j + 1);
}
const ctx = vm.createContext({ esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') });
vm.runInContext(fn('wkRow') + ';this.wkRow=wkRow;', ctx);
const sale = (img) => ({ url: 'https://www.estatesales.net/MI/Plymouth/48170/5132901', name: 'Plymouth estate', city: 'Plymouth', st: 'MI', co: 'Joann', dist: 12.3, hours: 'Fri 9 AM–4 PM', img });

test('v8.33: an estate sale row shows its own cover photo from EstateSales.net', () => {
  const h = ctx.wkRow(sale('https://picturescdn.estatesales.net/5132901/1-1/b7e5f39e.jpg'), false);
  assert.match(h, /<img class="wk-img" src="https:\/\/picturescdn\.estatesales\.net\/5132901\/1-1\/b7e5f39e\.jpg" alt="" loading="lazy"/);
  assert.match(h, /class="wk-row wk-ri"/);
  assert.match(h, /<span class="wk-tx"><b>Plymouth estate<\/b>/);
});

test('v8.33: no photo, or one from anywhere else, gets the placeholder and no <img>', () => {
  for (const u of ['', 'http://picturescdn.estatesales.net/a.jpg', 'https://evil.example/a.jpg', 'https://picturescdn.estatesales.net/a.jpg" onerror="x']) {
    const h = ctx.wkRow(sale(u), true);
    assert.doesNotMatch(h, /<img/, u);
    assert.match(h, /wk-noimg/);
  }
});

test('v8.33: the photo is styled as a thumbnail beside the text, scoped', () => {
  assert.ok(PAGE.includes('.scout-app-wrapper .wk-row.wk-ri{flex-direction:row'));
  assert.ok(PAGE.includes('.scout-app-wrapper .wk-img{flex:0 0 72px'));
});
