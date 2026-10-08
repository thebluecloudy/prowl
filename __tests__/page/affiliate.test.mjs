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

/* v6.59: each program follows its switch in the admin area (worker /aff). Depop is off by default: Rakuten declined. */
const RAN = 'https://click.linksynergy.com/deeplink?id=jh1j/r7*wkQ&mid=53555&murl=';
const DEPOP = ['https://www.depop.com/products/abc-vintage-tee/', 'https://www.depop.com/search/?q=ceramic%20panther', 'https://depop.com/products/x/'];
function affFetch(on) {
  const asked = [];
  const impl = (url) => {
    const u = String(url);
    if (/workers\.dev\/aff$/.test(u)) { asked.push(u); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on }) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { impl, asked };
}

test('Depop is off by default: its links go out plain and no disclosure names it', async () => {
  const p = await page();
  for (const u of DEPOP) assert.equal(p.win.prowlAff(u, 'prowl-live'), u);
  assert.equal(p.win.prowlAffLive('depop.com'), false);
  assert.ok(p.$$('.aff-say').every((el) => !el.hidden && !/Depop/.test(el.textContent)));
  await p.close();
});

test("switched on in the admin area: the worker's answer tags Depop, is remembered, and the disclosure follows", async () => {
  const f = affFetch({ ebay: true, depop: true });
  const p = loadPage({ fetchImpl: f.impl });
  await tick(40);
  assert.equal(f.asked.length, 1);
  for (const u of DEPOP) assert.equal(p.win.prowlAff(u, 'prowl-live'), RAN + encodeURIComponent(u));
  assert.deepEqual(JSON.parse(p.win.localStorage.getItem('prowl.affOn')), { ebay: true, depop: true });
  assert.equal(p.$('.copyr .aff-list').textContent, 'eBay and Depop');
  await p.close();
  // the next visit uses the kept answer before the worker replies
  const q = loadPage({ storage: { 'prowl.affOn': { depop: true } } });
  await tick(30);
  assert.equal(q.win.prowlAff(DEPOP[0]), RAN + encodeURIComponent(DEPOP[0]));
  await q.close();
});

test('eBay switched off: plain eBay links, the popup affiliate URL is ignored, and with nothing on the disclosure goes', async () => {
  const f = affFetch({ ebay: false, depop: false });
  const p = loadPage({ fetchImpl: f.impl });
  await tick(40);
  assert.equal(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-live'), 'https://www.ebay.com/itm/123');
  assert.equal(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-popup', 'https://www.ebay.com/itm/123?campid=5339216838'), 'https://www.ebay.com/itm/123');
  assert.deepEqual([...p.win.prowlAffNames()], []);
  assert.ok(p.$$('.aff-say').length === 2 && p.$$('.aff-say').every((el) => el.hidden), 'footer and Help');
  await p.close();
});

test('a bad or missing /aff answer changes nothing', async () => {
  const f = affFetch({ ebay: 'no', depop: 1 });
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.affOn': 'junk' } });
  await tick(40);
  assert.deepEqual({ ...p.win.PROWL_AFF_ON }, { ebay: true, depop: false });
  await p.close();
});

test('eBay keeps its EPN tag and non-https links are blocked', async () => {
  const p = await page();
  assert.match(p.win.prowlAff('https://www.ebay.com/itm/123', 'prowl-live'), /campid=5339216838&customid=prowl-live/);
  assert.equal(p.win.prowlAff('javascript:alert(1)'), '#');
  assert.equal(p.win.prowlAff('http://www.etsy.com/listing/1'), '#');
  await p.close();
});

test('live tags build each network\'s click URL', async () => {
  const p = await page();
  const A = p.win.PROWL_AFF;
  A['etsy.com'].t = 'https://www.awin1.com/cread.php?awinmid=111&awinaffid=222&ued={url}';
  A['depop.com'].t = 'https://click.linksynergy.com/deeplink?id=RAN&mid=53555&murl={url}';
  A['1stdibs.com'].t = 'https://prf.hn/click/camref:CAM/destination:{url}';
  p.win.PROWL_AFF_ON.depop = true;
  const etsy = 'https://www.etsy.com/listing/1/pyrex?ref=x';
  assert.equal(p.win.prowlAff(etsy), 'https://www.awin1.com/cread.php?awinmid=111&awinaffid=222&ued=' + encodeURIComponent(etsy));
  assert.equal(p.win.prowlAff('https://www.depop.com/products/a/'), 'https://click.linksynergy.com/deeplink?id=RAN&mid=53555&murl=' + encodeURIComponent('https://www.depop.com/products/a/'));
  assert.equal(p.win.prowlAff('https://www.1stdibs.com/x/'), 'https://prf.hn/click/camref:CAM/destination:' + encodeURIComponent('https://www.1stdibs.com/x/'));
  // subdomains count; lookalike hosts do not
  assert.match(p.win.prowlAff('https://uk.etsy.com/listing/9'), /^https:\/\/www\.awin1\.com\//);
  assert.equal(p.win.prowlAff('https://notetsy.com/listing/9'), 'https://notetsy.com/listing/9');
  assert.equal(p.win.prowlAff('https://etsy.com.evil.example/listing/9'), 'https://etsy.com.evil.example/listing/9');
  // a click URL is never wrapped twice
  const wrapped = p.win.prowlAff(etsy);
  assert.equal(p.win.prowlAff(wrapped), wrapped);
  // reverb still a placeholder: untouched
  assert.equal(p.win.prowlAff('https://reverb.com/item/2'), 'https://reverb.com/item/2');
  assert.deepEqual([...p.win.prowlAffNames()], ['eBay', 'Etsy', '1stDibs', 'Depop']);
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
