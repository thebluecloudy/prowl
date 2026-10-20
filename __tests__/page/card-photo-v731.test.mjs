// Page v7.31 (the owner, on a ShopGoodwill camo backpack in Daily: no picture on the card, but the popup had it): a
// card whose photo is missing or does not load takes the listing's first photo from /item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const URL1 = 'https://shopgoodwill.com/item/246813579';
const PHOTO = 'https://shopgoodwillimages.azureedge.net/production/1/backpack.jpg';

function open(item) {
  const asked = [];
  const fetchImpl = (u) => {
    const s = String(u);
    if (/\/item\?url=/.test(s)) { asked.push(s); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(item) }); }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
  return { p: loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: [] } } }), asked };
}
function card(p, img) {
  const cell = p.doc.createElement('div');
  cell.className = 'sgw-cell';
  cell.setAttribute('data-u', URL1);
  cell.innerHTML = '<a class="sgw-card" href="#">' + img + '<div class="sgw-t">Brookwood USA Camouflage Backpack</div></a>';
  p.$('.scout-app-wrapper').appendChild(cell);
  return cell;
}

test('a card with no photo gets the listing photo from /item, once', async () => {
  const { p, asked } = open({ title: 'Brookwood USA Camouflage Backpack', images: [PHOTO, 'https://x/2.jpg'] });
  await tick(60);
  const a = card(p, '<img alt="" data-np="1">'), b = card(p, '<img alt="" data-np="1">');
  await tick(60);
  assert.equal(a.querySelector('img').getAttribute('src'), PHOTO);
  assert.equal(b.querySelector('img').getAttribute('src'), PHOTO);
  assert.equal(asked.length, 1, 'one /item call for the listing');
  assert.match(asked[0], /item\?url=https%3A%2F%2Fshopgoodwill\.com%2Fitem%2F246813579$/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a card whose photo fails to load gets the listing photo instead', async () => {
  const { p } = open({ title: 'x', images: [PHOTO] });
  await tick(60);
  const c = card(p, '<img src="https://shopgoodwillimages.azureedge.net/broken.jpg" alt="">');
  await tick(20);
  const im = c.querySelector('img');
  im.dispatchEvent(new p.win.Event('error'));
  await tick(60);
  assert.equal(im.getAttribute('src'), PHOTO);
  im.dispatchEvent(new p.win.Event('error'));   /* the new photo failing too does not loop */
  await tick(20);
  assert.equal(im.getAttribute('src'), PHOTO);
  await p.close();
});

test('no photo in /item, or a non-https one, leaves the card as it was', async () => {
  for (const images of [[], ['http://insecure/x.jpg'], undefined]) {
    const { p } = open({ title: 'x', images });
    await tick(60);
    const c = card(p, '<img alt="" data-np="1">');
    await tick(60);
    assert.equal(c.querySelector('img').getAttribute('src'), null);
    await p.close();
  }
});
