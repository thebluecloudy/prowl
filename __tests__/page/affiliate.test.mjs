import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

async function page() { const p = loadPage(); await tick(30); return p; }

test('placeholders mean clean links: nothing is tagged until the real IDs are in', async () => {
  const p = await page();
  for (const u of ['https://www.etsy.com/listing/1/x', 'https://reverb.com/item/2', 'https://www.1stdibs.com/furniture/3']) {
    assert.equal(p.win.prowlAff(u, 'prowl-live'), u);
  }
  assert.deepEqual([...p.win.prowlAffNames()], ['eBay']);
  assert.equal(p.$('.copyr .aff-list').textContent, 'eBay');
  await p.close();
});

/* v6.59: each program follows its switch in the admin area (worker /aff). v6.62: Depop had no affiliate program (Rakuten
   closed the publisher account). v6.67: Depop is back through Rakuten Advertising, off until the owner turns it on with
   both IDs; the publisher ID field is new (ranid), so an ID kept from v6.60 (pub) tags nothing. */
const DEPOP = ['https://www.depop.com/products/abc-vintage-tee/', 'https://www.depop.com/search/?q=ceramic%20panther', 'https://depop.com/products/x/'];
function affFetch(on) {
  const asked = [], out = { asked, ids: null };
  const impl = (url) => {
    const u = String(url);
    if (/workers\.dev\/aff$/.test(u)) { asked.push(u); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(out.ids ? { on, ids: out.ids } : { on }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  out.impl = impl;
  return out;
}

test('v6.67: Depop is off by default: plain links, no disclosure, and an old kept answer (v6.60 pub) changes nothing', async () => {
  const p = await page();
  for (const u of DEPOP) assert.equal(p.win.prowlAff(u, 'prowl-live'), u);
  assert.equal(p.win.prowlAffLive('depop.com'), false);
  assert.equal(p.win.PROWL_AFF_ON.depop_rak, false);
  assert.equal('depop' in p.win.PROWL_AFF_ON, false, 'the old key is not read: old pages and extension 1.6.3 act on it');
  assert.ok(p.$$('.aff-say').every((el) => !el.hidden && !/Depop/.test(el.textContent)));
  /* the rendered page links no Rakuten URL: only the template in the script knows the host */
  assert.ok(p.$$('a[href]').every((a) => !/linksynergy/.test(a.getAttribute('href'))));
  await p.close();
  /* a browser that kept v6.46-v6.61's answer (Depop on, the old publisher ID), and a worker answer under the old key */
  const f = affFetch({ ebay: true, depop: true });
  f.ids = { depop: { pub: 'Abc123/x*Y', mid: '53555', ranid: 'Abc123/x*Y' } };
  const q = loadPage({ fetchImpl: f.impl, storage: { 'prowl.affOn': { ebay: true, depop: true }, 'prowl.affIds': { depop: { pub: 'Abc123/x*Y' } } } });
  await tick(40);
  for (const u of DEPOP) assert.equal(q.win.prowlAff(u, 'prowl-live'), u, 'no ranid, no tag');
  assert.equal(q.$('.copyr .aff-list').textContent, 'eBay');
  await q.close();
});

test('v6.67: Depop on with both IDs: its links go through the Rakuten deep link, and the disclosure names Depop', async () => {
  const f = affFetch({ ebay: true, depop_rak: true });
  f.ids = { depop_rak: { mid: '53555', ranid: 'Abc123/x*Y' } };
  const p = loadPage({ fetchImpl: f.impl });
  await tick(40);
  for (const u of DEPOP) assert.equal(p.win.prowlAff(u, 'prowl-live'), 'https://click.linksynergy.com/deeplink?id=Abc123/x*Y&mid=53555&murl=' + encodeURIComponent(u));
  assert.deepEqual([...p.win.prowlAffNames()], ['eBay', 'Depop']);
  assert.equal(p.$('.copyr .aff-list').textContent, 'eBay and Depop');
  /* lookalike hosts are not Depop, and a click URL is never wrapped twice */
  assert.equal(p.win.prowlAff('https://depop.com.evil.example/x'), 'https://depop.com.evil.example/x');
  const w = p.win.prowlAff(DEPOP[0]);
  assert.equal(p.win.prowlAff(w), w);
  await p.close();
});

test('v6.67: Depop on but an ID missing or in the wrong form: plain links', async () => {
  for (const ids of [{ mid: '53555', ranid: '' }, { mid: '', ranid: 'Abc123/x*Y' }, { mid: '53555', ranid: 'a&murl=https://evil.example' },
    { mid: '53555', ranid: 'Abc"><b>' }, { mid: '5a555', ranid: 'Abc123/x*Y' }, { mid: '53555', ranid: 'Abc 123' },
    { mid: '53555', ranid: '3912345' }]) {   /* all digits: Rakuten's Site ID, not the id= of its links */
    const f = affFetch({ ebay: true, depop_rak: true });
    f.ids = { depop_rak: ids };
    const p = loadPage({ fetchImpl: f.impl });
    await tick(40);
    for (const u of DEPOP) assert.equal(p.win.prowlAff(u, 'prowl-live'), u, JSON.stringify(ids));
    assert.deepEqual([...p.win.prowlAffNames()], ['eBay']);
    await p.close();
  }
});

test('eBay switched off: plain eBay links, the popup affiliate URL is ignored, and with nothing on the disclosure goes', async () => {
  const f = affFetch({ ebay: false });
  const p = loadPage({ fetchImpl: f.impl });
  await tick(40);
  assert.equal(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-live'), 'https://www.ebay.com/itm/123');
  assert.equal(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-popup', 'https://www.ebay.com/itm/123?campid=5339216838'), 'https://www.ebay.com/itm/123');
  assert.deepEqual([...p.win.prowlAffNames()], []);
  assert.ok(p.$$('.aff-say').length === 2 && p.$$('.aff-say').every((el) => el.hidden), 'footer and Help');
  await p.close();
});

test('a bad or missing /aff answer changes nothing', async () => {
  const f = affFetch({ ebay: 'no', etsy: 1 });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.affOn': 'junk', 'prowl.affIds': 'junk' } });
  await tick(40);
  assert.deepEqual({ ...p.win.PROWL_AFF_ON }, { ebay: true, depop_rak: false, etsy: false, reverb: false, '1stdibs': false, amazon: false });
  assert.equal(p.win.prowlAffId('ebay', 'camp'), '5339216838');
  await p.close();
});

test('eBay keeps its EPN tag and non-https links are blocked', async () => {
  const p = await page();
  assert.match(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-live'), /campid=5339216838&customid=prowl-live/);
  assert.equal(p.win.prowlAff('javascript:alert(1)'), '#');
  assert.equal(p.win.prowlAff('http://www.etsy.com/listing/1'), '#');
  await p.close();
});

test("v6.60: IDs from the admin area build each network's click URL, only while the program is on", async () => {
  const f = affFetch({ ebay: true, etsy: true, reverb: false, '1stdibs': true, amazon: false });
  f.ids = { ebay: { camp: '2222222222' }, etsy: { mid: '6220', aff: '1234567' }, reverb: { mid: '7777', aff: '1234567' }, '1stdibs': { camref: '1l3vabc' } };
  const p = loadPage({ fetchImpl: f.impl });
  await tick(40);
  const etsy = 'https://www.etsy.com/listing/1/pyrex?ref=x';
  assert.equal(p.win.prowlAff(etsy), 'https://www.awin1.com/cread.php?awinmid=6220&awinaffid=1234567&ued=' + encodeURIComponent(etsy));
  assert.equal(p.win.prowlAff('https://www.1stdibs.com/x/'), 'https://prf.hn/click/camref:1l3vabc/destination:' + encodeURIComponent('https://www.1stdibs.com/x/'));
  assert.match(p.win.prowlAff('https://www.ebay.com/itm/1', 'prowl-live'), /campid=2222222222&customid=prowl-live/, 'the eBay campaign comes from the IDs');
  // subdomains count; lookalike hosts do not
  assert.match(p.win.prowlAff('https://uk.etsy.com/listing/9'), /^https:\/\/www\.awin1\.com\//);
  assert.equal(p.win.prowlAff('https://notetsy.com/listing/9'), 'https://notetsy.com/listing/9');
  assert.equal(p.win.prowlAff('https://etsy.com.evil.example/listing/9'), 'https://etsy.com.evil.example/listing/9');
  // a click URL is never wrapped twice
  const wrapped = p.win.prowlAff(etsy);
  assert.equal(p.win.prowlAff(wrapped), wrapped);
  // Reverb has IDs but is switched off: untouched
  assert.equal(p.win.prowlAff('https://reverb.com/item/2'), 'https://reverb.com/item/2');
  assert.deepEqual([...p.win.prowlAffNames()], ['eBay', 'Etsy', '1stDibs']);
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.affIds')).etsy, { mid: '6220', aff: '1234567' }, 'kept for the next visit');
  await p.close();
});

test('v6.60: IDs in the wrong form are ignored, so a program with them stays plain', async () => {
  const f = affFetch({ ebay: true, etsy: true });
  f.ids = { etsy: { mid: '6220"><b>', aff: '1234567' }, ebay: { camp: 'javascript:1' } };
  const p = loadPage({ fetchImpl: f.impl });
  await tick(40);
  assert.equal(p.win.prowlAff('https://www.etsy.com/listing/1'), 'https://www.etsy.com/listing/1');
  assert.equal(p.win.prowlAff('https://www.ebay.com/itm/1', 'prowl-live'), 'https://www.ebay.com/itm/1');
  assert.deepEqual([...p.win.prowlAffNames()], []);
  await p.close();
});

test('no-program marketplaces pass through untouched', async () => {
  const p = await page();
  for (const u of ['https://www.mercari.com/item/m1', 'https://poshmark.com/listing/p', 'https://shopgoodwill.com/item/9', 'https://www.grailed.com/listings/1', 'https://www.vinted.com/items/1']) {
    assert.equal(p.win.prowlAff(u), u);
  }
  await p.close();
});

test("the popup's eBay affiliate URL wins over generic tagging; anything else is ignored", async () => {
  const p = await page();
  const aff = 'https://www.ebay.com/itm/123?mkevt=1&mkcid=1&campid=5339216838&toolid=10049';
  assert.equal(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-popup', aff), aff);
  assert.match(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-popup', 'https://evil.example/x'), /campid=5339216838&customid=prowl-popup/);
  await p.close();
});

/* v6.64: the Den's saved research shows "Sold before" eBay links; they go through the router like the appraiser's
   (they were plain, so a sale from the Den earned nothing). The saved copy stays plain, so a shared note links plainly. */
test('v6.64: Den "Sold before" eBay links are tagged when drawn; other sites and the saved copy stay plain', async () => {
  const ebay = 'https://www.ebay.com/itm/123456789012', other = 'https://www.worthpoint.com/worthopedia/black-panther-lamp';
  const note = { item: 'Black panther TV lamp', rows: [['What', 'A 1950s ceramic TV lamp']], src: [], at: 1,
    solds: [{ title: 'Panther TV lamp, green eyes', price: '$45.00', url: ebay, date: 'Sep 2026', where: 'eBay' },
      { title: 'Panther lamp', price: '$60.00', url: other }] };
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] }, 'prowl.research': [note] } });
  await tick(30);
  p.$('#otp-dock .db[data-m="den"]').click();   /* the Den draws saved research when it opens */
  await tick(30);
  const links = p.$$('#otp-denRes .dx-sold a').map((a) => a.getAttribute('href'));
  assert.equal(links.length, 2);
  assert.notEqual(links[0], ebay, 'tagged');
  assert.equal(links[0], p.win.prowlAff(ebay, 'prowl-den'));
  assert.match(links[0], /campid=5339216838/);
  assert.equal(links[1], other, 'not an affiliate site: as it was');
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.research'))[0].solds[0].url, ebay, 'stored plain');
  await p.close();
});
