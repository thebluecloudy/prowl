// Page v7.28 (the owner, 2026-10-19: Found on the Prowl in the Den "is showing new parts it should only show the
// vintage stuff"). Products are the store's own, as /products.json gives them (2026-10-19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

let n = 0;
const P = (title, product_type, vendor, tags, available = true) => ({ id: ++n, title, handle: 'h' + n, product_type, vendor, tags,
  created_at: new Date(Date.UTC(2026, 6, 1) + n * 864e5).toISOString(), images: [{ src: 'https://cdn.shopify.com/x' + n + '.jpg' }],
  variants: [{ price: '20.00', available }] });
const STUDIO = [
  P('Scented Soy Candle, 9oz', 'Home Decor', 'Printify', ['Home & Living', 'Made in USA', 'candles']),
  P('Skull Castle Woven Blanket', 'Home Decor', 'Printify', ['vintage throw', 'woven blanket']),
  P('Mythic Fox Rider T-Shirt', 'T-Shirt', 'Printify', ['graphic tee', 'vintage art']),
  P('Owl on Nest — STL Digital Download', 'Digital Download', 'Owl & Twig Vintage', ['3D printing', 'digital download', 'STL']),
  P('Prowl Pro', 'Digital Subscription', 'Owl & Twig Vintage', ['digital', 'not-vintage', 'prowl-pro']),
  P('Sticker with a Vintage tag', 'Paper products', 'Printify', ['Vintage']),
];
const VINTAGE = [
  P('Vintage Ceramic Hippo', '', 'Etsy', ['Estate', 'MCM', 'RH', 'Vintage']),
  P("Domino's Pizza Lava Lamp", 'Lighting', 'Owl and Twig Vintage', ['Estate', 'Lava Lamp', 'Vintage']),
  P('Albrecht Dürer, First English Edition', 'Books', 'Owl and Twig Vintage', ['Books', 'Estate', 'Vintage']),
  P('Blenko 6212 Decanter', 'Barware & Decanters', 'Owl and Twig Vintage', ['Estate', 'MCM', 'Vintage']),
  P('1950s Porcelain Angels', 'Figurines', 'Owl and Twig Vintage', ['estate', 'vintage']),
];
const SOLD = P('Sold Bitossi Vase', 'Vases', 'Owl and Twig Vintage', ['Estate', 'Vintage'], false);

test('Found on the Prowl shows only vintage finds', async () => {
  const p = loadPage({ fetchImpl: (u) => String(u).indexOf('/products.json') === 0
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ products: STUDIO.concat(VINTAGE, [SOLD]) }) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') }) });
  await tick(300);
  p.$('#otp-denBtn').click();
  p.$('#otp-denT4').click();
  await tick(50);
  const titles = [...p.doc.querySelectorAll('#otp-foundTrack .fc-title')].map((e) => e.textContent);
  const shown = new Set(titles);
  assert.deepEqual([...shown].sort(), VINTAGE.map((x) => x.title).sort());
  assert.equal(titles.length, VINTAGE.length * 2, 'the marquee doubles its cards');
  assert.ok(p.$('#otp-foundStrip').classList.contains('show'));
  assert.deepEqual(p.errors, []);
  await p.close();
});
