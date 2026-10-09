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

/* v6.59: each program follows its switch in the admin area (worker /aff). v6.62: Depop has no affiliate program at all
   (Rakuten closed the publisher account), so no answer, kept answer or ID can tag a Depop link. */
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

test('v6.62: Depop links always go out plain and no disclosure names Depop, even if an answer or a kept value says on', async () => {
  const p = await page();
  for (const u of DEPOP) assert.equal(p.win.prowlAff(u, 'prowl-live'), u);
  assert.equal(p.win.prowlAffLive('depop.com'), false);
  assert.ok(p.$$('.aff-say').every((el) => !el.hidden && !/Depop/.test(el.textContent)));
  assert.equal('depop' in p.win.PROWL_AFF_ON, false);
  assert.equal('depop' in p.win.PROWL_AFF_IDS, false);
  assert.doesNotMatch(p.doc.documentElement.innerHTML, /linksynergy|jh1j|mid=53555/);
  await p.close();
  /* an old answer from the worker, or one kept in this browser, with Depop on and a publisher ID */
  const f = affFetch({ ebay: true, depop: true });
  f.ids = { depop: { pub: 'Abc123/x*Y' } };
  const q = loadPage({ fetchImpl: f.impl, storage: { 'prowl.affOn': { ebay: true, depop: true }, 'prowl.affIds': { depop: { pub: 'Abc123/x*Y' } } } });
  await tick(40);
  for (const u of DEPOP) assert.equal(q.win.prowlAff(u, 'prowl-live'), u);
  assert.equal(q.$('.copyr .aff-list').textContent, 'eBay');
  await q.close();
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
  assert.deepEqual({ ...p.win.PROWL_AFF_ON }, { ebay: true, etsy: false, reverb: false, '1stdibs': false, amazon: false });
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
