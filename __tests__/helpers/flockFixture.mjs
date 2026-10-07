// A fetch stub that answers every live-search call with a few listings,
// so the Flock feed has something to show.
export function liveFetch({ perSource = 3, only = null, me = null } = {}) {
  const calls = [];
  const impl = (url) => {
    calls.push(String(url));
    const u = new URL(String(url), 'https://www.owlandtwigvintage.com/');
    if (u.pathname.startsWith('/apps/prowl/')) {
      // the Shopify app proxy: /me says whether the store has this visitor signed in
      const body = u.pathname.endsWith('/me') && me ? JSON.stringify(me) : '';
      return Promise.resolve({ ok: !!body, status: body ? 200 : 404, json: () => Promise.resolve(body ? JSON.parse(body) : null), text: () => Promise.resolve(body) });
    }
    const q = u.searchParams.get('q') || 'x';
    const src = u.pathname.replace(/\//g, '') || 'shopgoodwill';
    const host = src === 'shopgoodwill' ? 'shopgoodwill.com/item' : src === 'ebay' ? 'www.ebay.com/itm' : `www.${src}.com/listing`;
    const items = [];
    for (let i = 0; i < (only && only !== src ? 0 : perSource); i++) {
      items.push({
        title: `${q} find ${src} ${i}`,
        price: `$${10 + i}.00`,
        url: `https://${host}/${encodeURIComponent(q)}-${i}`,
        image: `https://img.example.com/${src}/${i}.jpg`,
        src: src === 'shopgoodwill' ? '' : src,
        ...(src === 'shopgoodwill' ? { bids: i, time_left: '2d 4h' } : {}),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items }), text: () => Promise.resolve('') });
  };
  return { impl, calls };
}

export async function waitFor(fn, { timeout = 4000, step = 25 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}
