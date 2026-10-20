// Page v7.10 (Matt, 2026-10-17, on an Etsy astronaut figurine): the popup says when a listing is on sale (worker
// v119 hands over eBay's was/off), flags a repair or damage the seller mentions, and links to what it sold for on eBay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

async function popup(item, url) {
  const fetchImpl = (u) => {
    const s = String(u);
    if (/\/item\?url=/.test(s)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(item) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(60);
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', url);
  cell.innerHTML = '<a class="sgw-card" href="#"><img alt=""></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  cell.querySelector('a').click();
  await tick(80);
  return p;
}
const ETSY = { title: 'Marilyn Consco Vintage Astronaut Girl in Pink Skirt MCM midcentury', price: '$448.00', images: ['https://i.etsystatic.com/1.jpg'],
  description: 'Phasers on !<br><br>She’s too cute, and reflects the atomic age craze.<br><br>One arm has a repair.', condition: '', aspects: [{ n: 'Shop', v: 'MCMmrsclaus' }], url: 'https://www.etsy.com/listing/1234567890' };

test('a repair in the description is flagged, quoted, and told to Fair price first', async () => {
  const p = await popup(ETSY, ETSY.url);
  const f = p.$('#otp-sheetB .pp-flag');
  assert.ok(f, 'flagged');
  assert.match(f.querySelector('b').textContent, /Mentions a repair/);
  assert.equal(f.querySelector('q').textContent, 'One arm has a repair');
  assert.match(p.$('#otp-sheetB .pp-fp').getAttribute('data-d'), /^Mentions a repair: One arm has a repair\. /);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('"no chips, cracks or repairs" is not a flag', async () => {
  const p = await popup(Object.assign({}, ETSY, { description: 'Lovely glaze. No chips, cracks or repairs. Measures 5 inches.' }), ETSY.url);
  assert.equal(p.$('#otp-sheetB .pp-flag'), null);
  await p.close();
});

test('damage alone says damage', async () => {
  const p = await popup(Object.assign({}, ETSY, { description: 'Small chip on the base, see photo 4.' }), ETSY.url);
  assert.match(p.$('#otp-sheetB .pp-flag b').textContent, /Mentions damage/);
  await p.close();
});

test('an eBay sale shows the old price and how much is off, and Fair price is told', async () => {
  const it = { title: 'Royal Haeger panther', price: '$358.40', was: '$448.00', off: '20% off', images: [], description: '', condition: 'Used', aspects: [], url: 'https://www.ebay.com/itm/123456789012' };
  const p = await popup(it, it.url);
  const pr = p.$('#otp-sheetB .pp-p');
  assert.match(pr.textContent, /^\$358\.40 \$448\.00 20% off$/);
  assert.equal(pr.querySelector('s.sale-was').textContent, '$448.00');
  assert.match(p.$('#otp-sheetB .pp-fp').getAttribute('data-d'), /^On sale, was \$448\.00 \(20% off\)\. /);
  await p.close();
});

test('What it sold for on eBay opens eBay sold listings for the cleaned title', async () => {
  const p = await popup(ETSY, ETSY.url);
  const a = p.$('#otp-sheetB .pp-sold');
  assert.ok(a);
  assert.match(a.textContent, /What it sold for on eBay/);
  const u = new URL(a.getAttribute('href'));
  assert.equal(u.hostname, 'www.ebay.com');
  assert.equal(u.searchParams.get('LH_Sold'), '1');
  assert.equal(u.searchParams.get('LH_Complete'), '1');
  assert.match(u.searchParams.get('_nkw'), /Consco/i);
  assert.equal(a.getAttribute('target'), '_blank');
  await p.close();
});

// v7.29 (the owner, on a "Brad Keeler Style" flamingo): the card's Possible reproduction tag shows in the popup, with why
async function reproPopup(item, tagged) {
  const fetchImpl = (u) => /\/item\?url=/.test(String(u))
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(item) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(60);
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', item.url);
  cell.innerHTML = '<a class="sgw-card" href="#"><img alt=""><div class="sgw-m">eBay' + (tagged ? '<br><span class="sgw-repro">Possible reproduction</span>' : '') + '</div></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  cell.querySelector('a').click();
  await tick(80);
  return p;
}
const FLAMINGO = { title: 'Vtg 1950s Ceramic Brad Keeler Style Pink Flamingo Figurine 10” MCM Beachy FL', price: '$50.00', images: [],
  description: '', condition: 'Used', aspects: [{ n: 'Type', v: 'Figurine' }], url: 'https://www.ebay.com/itm/123456789012' };

test('a card tagged Possible reproduction says so in the popup, with the title words that make it one, and tells Fair price', async () => {
  const p = await reproPopup(FLAMINGO, true);
  const f = p.$('#otp-sheetB .pp-repro');
  assert.ok(f, 'shown');
  assert.match(f.querySelector('b').textContent, /Possible reproduction/);
  assert.match(f.textContent, /“Brad Keeler Style” for a piece made to look like a maker’s work, usually not by them/);
  assert.match(f.textContent, /maker’s mark in the photos/);
  assert.match(p.$('#otp-sheetB .pp-fp').getAttribute('data-d'), /^Possible reproduction: Sellers use/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the reason quotes "reproduction" or "reissue" when the title says it, and falls back to what the check looks for', async () => {
  let p = await reproPopup({ ...FLAMINGO, title: 'Shawnee corn king pitcher reissue' }, true);
  assert.match(p.$('#otp-sheetB .pp-repro').textContent, /The title says “reissue”: not an original/);
  await p.close();
  p = await reproPopup({ ...FLAMINGO, title: 'McCoy pink flamingo planter' }, true);
  assert.match(p.$('#otp-sheetB .pp-repro').textContent, /reads like a reproduction, a reissue or a lookalike/);
  await p.close();
});

test('an untagged card has no reproduction note', async () => {
  const p = await reproPopup(FLAMINGO, false);
  assert.equal(p.$('#otp-sheetB .pp-repro'), null);
  await p.close();
});

// v7.29 (the owner: "flag that it is international / german so that you know this before thinking about bidding")
test('a listing from outside the US says where it ships from, and Fair price is told', async () => {
  const p = await reproPopup({ ...FLAMINGO, from: { cc: 'DE', name: 'Germany' } }, false);
  const f = p.$('#otp-sheetB .pp-intl');
  assert.ok(f, 'shown');
  assert.match(f.querySelector('b').textContent, /Ships from Germany/);
  assert.match(f.textContent, /customs and import fees/);
  assert.match(p.$('#otp-sheetB .pp-fp').getAttribute('data-d'), /^Ships from Germany \(international\)\. /);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a US listing, or one with no country, has no ships-from note', async () => {
  for (const from of [{ cc: 'US', name: 'United States' }, undefined, { cc: 'Germany' }]) {
    const p = await reproPopup({ ...FLAMINGO, from }, false);
    assert.equal(p.$('#otp-sheetB .pp-intl'), null, JSON.stringify(from));
    await p.close();
  }
});
