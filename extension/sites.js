// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
//
// The marketplace searches the Prowl page builds, minus Craigslist: Craigslist
// only searches one region, and Prowl keeps the reader's city, so Craigslist
// stays on the Prowl page. When Prowl gains or loses a marketplace, update
// this list to match.

export const PROWL = 'https://owlandtwigvintage.com/pages/prowl';
const E = encodeURIComponent;

export function cleanTerm(t) {
  return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function prowlUrl(q) {
  return q ? `${PROWL}?q=${E(q)}` : PROWL;
}

const plain = (id, name, base, tail = '') => ({ id, name, url: (q) => base + E(q) + tail });

export const SITES = [
  plain('ebay', 'eBay', 'https://www.ebay.com/sch/i.html?_nkw='),
  plain('etsy', 'Etsy', 'https://www.etsy.com/search?q='),
  plain('mercari', 'Mercari', 'https://www.mercari.com/search/?keyword='),
  plain('mercarijp', 'Mercari Japan', 'https://jp.mercari.com/search?keyword='),
  plain('poshmark', 'Poshmark', 'https://poshmark.com/search?query='),
  { id: 'depop', name: 'Depop', url: (q) => depopAff('https://www.depop.com/search/?q=' + E(q)) },   // 1.6.2: earns through Rakuten
  plain('grailed', 'Grailed', 'https://www.grailed.com/shop?query='),
  plain('rubylane', 'Ruby Lane', 'https://www.rubylane.com/search?q='),
  plain('chairish', 'Chairish', 'https://www.chairish.com/search?q='),
  plain('1stdibs', '1stDibs', 'https://www.1stdibs.com/search/?q='),
  plain('reverb', 'Reverb', 'https://reverb.com/marketplace?query='),
  plain('whatnot', 'Whatnot', 'https://www.whatnot.com/search?query=', '&referringSource=typed'),
  plain('vinted', 'Vinted', 'https://www.vinted.com/catalog?search_text='),
  {
    id: 'bonanza', name: 'Bonanza',
    url: (q) => 'https://www.bonanza.com/items/search?' +
      'q%5Bcountry_to_filter%5D=&q%5Bship_country%5D=1&q%5Bshipping_in_price%5D=0&' +
      'q%5Bsort_by%5D=relevancy&q%5Btranslate_term%5D=true&q%5Bsearch_term%5D=' + E(q),
  },
  plain('ecrater', 'eCrater', 'https://www.ecrater.com/search.php?keywords='),
  plain('abebooks', 'AbeBooks', 'https://www.abebooks.com/servlet/SearchResults?kn='),
  plain('aptdeco', 'AptDeco', 'https://www.aptdeco.com/catalog?q='),
  plain('offerup', 'OfferUp', 'https://offerup.com/search?q='),
  // On a computer Facebook opens in the browser and searches around your
  // Facebook location, so no city is needed here.
  plain('facebook', 'Facebook Marketplace', 'https://www.facebook.com/marketplace/search/?query='),
  plain('ebaysold', 'eBay Sold', 'https://www.ebay.com/sch/i.html?_nkw=', '&LH_Sold=1&LH_Complete=1'),
  {
    id: 'shopgoodwill', name: 'ShopGoodwill',
    url: (q) => 'https://shopgoodwill.com/categories/listing?st=' + E(q) +
      '&sg=&c=&s=&lp=0&hp=999999&sbn=&spo=false&snpo=false&socs=false&sd=false&sca=false' +
      '&cadb=7&scs=false&sis=false&col=1&p=1&ps=40&desc=false&ss=0&UseBuyerPrefs=true' +
      '&sus=false&cln=1&catIds=&pn=&wc=false&mci=false&hmt=false&layout=grid&ihp=true',
  },
  plain('salvation', 'Salvation Army', 'https://shopthesalvationarmy.com/Browse?FullTextQuery='),
  plain('estatesales', 'EstateSales.net', 'https://www.estatesales.net/search/'),
  plain('hibid', 'HiBid', 'https://hibid.com/lots?q='),
  plain('liveauction', 'LiveAuctioneers', 'https://www.liveauctioneers.com/search/?keyword='),
  plain('heritage', 'Heritage Auctions', 'https://www.ha.com/c/search-results.zx?N=0&Ntt='),
  // Invaluable wants + for spaces.
  { id: 'invaluable', name: 'Invaluable', url: (q) => 'https://www.invaluable.com/search?keyword=' + E(q).replace(/%20/g, '+') },
];

// Prowl page features reached from the extension.
export const dailyUrl = () => `${PROWL}?daily=1`;
export const photoUrl = () => `${PROWL}?photo=1`;
export const guideUrl = (q) => `${PROWL}?guide=${E(q)}`;

export function soldUrl(q) {
  return SITES.find((s) => s.id === 'ebaysold').url(q);
}

// Amazon Associates. Off until Matthew has the tracking ID and the traffic to keep it (Amazon drops
// associates with fewer than 3 sales in 180 days). While off, the menu item does not exist and no
// Amazon URL is ever built. Amazon is new goods: menu only, never a marketplace.
export const AFF = { amz: 'YOUR_AMAZON_TAG', amzEnabled: false,
  // 1.6.2: Depop pays through Rakuten (merchant 53555). Applied only to links the user clicks, and disclosed in the
  // popup and the store listing. Same link as the Prowl page and the alert emails.
  depop: 'https://click.linksynergy.com/deeplink?id=jh1j/r7*wkQ&mid=53555&murl=' };
export function depopAff(u) {
  return /^https:\/\/(www\.)?depop\.com\//.test(String(u || '')) && typeof AFF.depop === 'string' && AFF.depop.indexOf('https://') === 0 ? AFF.depop + encodeURIComponent(u) : u;
}
export function amazonOn() {
  return AFF.amzEnabled === true && typeof AFF.amz === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(AFF.amz) && AFF.amz.indexOf('YOUR_') !== 0;
}
export function amazonUrl(q) {
  if (!amazonOn()) return null;
  return `https://www.amazon.com/s?k=${E(q)}&tag=${encodeURIComponent(AFF.amz)}`;
}

export function imagesUrl(q) {
  return `https://www.google.com/search?tbm=isch&q=${E(q)}`;
}

export function lensUrl(imageUrl) {
  return `https://lens.google.com/uploadbyurl?url=${E(imageUrl)}`;
}

// Live listings come from Prowl's own search server, the same one the
// Prowl page uses. Only the search words are sent. ai=0 asks it to skip its
// AI sorting, so nothing about a search touches an AI service.
export const LIVE = [
  { id: 'shopgoodwill', name: 'ShopGoodwill', path: '/' },
  { id: 'ebay', name: 'eBay', path: '/ebay' },
  { id: 'etsy', name: 'Etsy', path: '/etsy' },
  { id: 'chairish', name: 'Chairish', path: '/chairish' },
  { id: 'poshmark', name: 'Poshmark', path: '/poshmark' },
  { id: 'depop', name: 'Depop', path: '/depop' },
  { id: 'vinted', name: 'Vinted', path: '/vinted' },
  { id: 'grailed', name: 'Grailed', path: '/grailed' },
];
const LIVE_API = 'https://prowl.thebluecloud.workers.dev';

export async function fetchLive(src, q) {
  const r = await fetch(`${LIVE_API}${src.path}?q=${E(q)}&ai=0`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data.items) ? data.items : [];
}
