/* v212: Owl & Twig's morning briefing in the admin (Matt, 2026-11-01: "how do i get it on my prowl dashboard?").
   The worker reads the shop's own orders (Etsy orders reach Shopify through the DPL integration) with its read_orders
   token, works out the numbers here, and asks Muse for three short notes on them. Built once per Detroit day, on the
   first admin open, and kept in KV until the next day, so it costs one Shopify read and one AI call a day.
   Prowl Pro subscriptions are left out: this is the shop's sales, not Prowl's. No customer names or emails are read. */

export const BRIEF_DAYS = 60;          // 30 days and the 30 before
export const BRIEF_PAGES = 4;          // up to 400 orders read
export const BRIEF_KEY = "shopbrief2:";   // v215: 2 = with the site visits
const DAY = 86400000;
const PRO_RE = /^prowl pro\b/i;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = n => Math.round(n * 100) / 100;

/* Detroit calendar day of a time, "YYYY-MM-DD" */
export function detroitDay(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/* Orders as Shopify's GraphQL gives them -> the numbers the card shows. Cancelled and test orders are skipped; a
   line item's sale is its discounted total (before refunds). Category is the product type, "Other" when unknown. */
export function briefStats(orders, nowMs) {
  const today = detroitDay(nowMs), yday = detroitDay(nowMs - DAY);
  const cut30 = nowMs - 30 * DAY, cut60 = nowMs - 60 * DAY, cut7 = nowMs - 7 * DAY;
  const s = { now: { sales: 0, orders: 0 }, prev: { sales: 0, orders: 0 }, yday: { sales: 0, orders: 0 }, cats: {}, items: [], lastOrderMs: 0, typesKnown: true };
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o || o.cancelledAt || o.test) continue;
    const t = Date.parse(o.createdAt || "");
    if (!Number.isFinite(t) || t < cut60 || t > nowMs + DAY) continue;
    let sale = 0;
    const lines = o.lineItems && Array.isArray(o.lineItems.nodes) ? o.lineItems.nodes : [];
    const kept = [];
    for (const li of lines) {
      if (!li || PRO_RE.test(String(li.title || ""))) continue;
      const amt = num(li.discountedTotalSet && li.discountedTotalSet.shopMoney && li.discountedTotalSet.shopMoney.amount);
      const type = li.product === undefined ? null : String((li.product && li.product.productType) || "").trim() || "Other";
      if (type === null) s.typesKnown = false;
      kept.push({ title: String(li.title || "").slice(0, 120), type: type || "Other", amt: amt });
      sale += amt;
    }
    if (!kept.length) continue;   // a Prowl Pro order only
    if (t > s.lastOrderMs) s.lastOrderMs = t;
    const bucket = t >= cut30 ? s.now : s.prev;
    bucket.sales += sale; bucket.orders += 1;
    if (detroitDay(t) === yday) { s.yday.sales += sale; s.yday.orders += 1; }
    if (t >= cut30) for (const k of kept) { const c = s.cats[k.type] || (s.cats[k.type] = { sales: 0, items: 0 }); c.sales += k.amt; c.items += 1; }
    if (t >= cut7) for (const k of kept) s.items.push({ title: k.title, type: k.type, amt: round2(k.amt), day: detroitDay(t) });
  }
  const cats = Object.keys(s.cats).map(k => ({ type: k, sales: round2(s.cats[k].sales), items: s.cats[k].items })).sort((a, b) => b.sales - a.sales);
  const change = (a, b) => b > 0 ? Math.round((a - b) / b * 1000) / 10 : null;
  return {
    day: today, yesterday: yday,
    sales30: round2(s.now.sales), orders30: s.now.orders, salesPrev: round2(s.prev.sales), ordersPrev: s.prev.orders,
    salesChange: change(s.now.sales, s.prev.sales), ordersChange: change(s.now.orders, s.prev.orders),
    salesYday: round2(s.yday.sales), ordersYday: s.yday.orders,
    daysSinceOrder: s.lastOrderMs ? Math.floor((nowMs - s.lastOrderMs) / DAY) : null,
    categories: cats.slice(0, 8), week: s.items.sort((a, b) => b.amt - a.amt).slice(0, 10), typesKnown: s.typesKnown
  };
}

export function briefPrompt(st) {
  return "You write a 7 AM briefing for the owners of Owl & Twig Vintage, a small family shop selling mid-century vintage " +
    "(art glass, pottery, decor), mostly on Etsy. Using ONLY the numbers below, write exactly three notes for today. " +
    "1) Top performers: what sold yesterday and this week, and which categories lead. 2) On the site: what visitors " +
    "read (guides, products, Prowl), where they came from, and whether visits turn into cart adds; most sales happen on " +
    "Etsy, so say which guides draw people and what to link or list from them. If there is no site data, write about " +
    "slow movers instead. 3) What to buy or list next, based on what is selling and what people read about. Each note 1-3 plain sentences with real numbers, dollars rounded, no hype, no exclamation marks, no emoji. " +
    "If yesterday had no sales, say so plainly. Do not invent data you were not given (there is no cost or inventory data). " +
    'Answer with only a JSON array: [{"kind":"Top performers","text":"..."},{"kind":"On the site","text":"..."},{"kind":"Buy and list next","text":"..."}]\n\n' +
    "Numbers (USD, Detroit time, item sales before refunds, Prowl Pro left out):\n" + JSON.stringify({
      yesterday: { date: st.yesterday, sales: st.salesYday, orders: st.ordersYday },
      last30days: { sales: st.sales30, orders: st.orders30 }, previous30days: { sales: st.salesPrev, orders: st.ordersPrev },
      salesChangePct: st.salesChange, daysSinceLastOrder: st.daysSinceOrder,
      categoriesLast30days: st.categories, soldLast7days: st.week.map(w => ({ title: w.title, category: w.type, sale: w.amt })),
      site: st.site ? { visitsThisWeek: st.site.thisWeek, visitsLastWeek: st.site.lastWeek, visitsLast30days: st.site.visits30, byPageKind: st.site.kinds, topGuides: st.site.guides.slice(0, 8), topProducts: st.site.products.slice(0, 4), cameFrom: st.site.refs } : null
    });
}

/* the model's answer -> three {kind, text}; null when it is not usable */
export function briefNotes(text) {
  const s = String(text || ""), i = s.indexOf("["), j = s.lastIndexOf("]");
  if (i < 0 || j <= i) return null;
  let a; try { a = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
  if (!Array.isArray(a)) return null;
  const out = a.filter(x => x && typeof x.text === "string" && x.text.trim()).slice(0, 3)
    .map(x => ({ kind: String(x.kind || "Note").replace(/\s+/g, " ").trim().slice(0, 40), text: x.text.replace(/\s+/g, " ").trim().slice(0, 600) }));
  return out.length === 3 ? out : null;
}

/* Notes worked out without the AI, used when it is off or fails */
export function briefFallback(st) {
  const $ = n => "$" + Math.round(n).toLocaleString("en-US");
  const top = st.categories[0], ch = st.salesChange;
  const n1 = st.ordersYday ? "Yesterday: " + st.ordersYday + (st.ordersYday === 1 ? " order, " : " orders, ") + $(st.salesYday) + "."
    : "No sales yesterday" + (st.daysSinceOrder != null ? "; the last order was " + st.daysSinceOrder + (st.daysSinceOrder === 1 ? " day ago." : " days ago.") : ".");
  const n2 = "Last 30 days: " + $(st.sales30) + " on " + st.orders30 + " orders" + (ch != null ? ", " + (ch >= 0 ? "up " : "down ") + Math.abs(Math.round(ch)) + "% on the 30 days before." : ".");
  const n3 = top ? top.type + " leads the last 30 days with " + $(top.sales) + " from " + top.items + (top.items === 1 ? " piece." : " pieces.") : "No category data yet.";
  return [{ kind: "Yesterday", text: n1 }, { kind: "Sales trend", text: n2 }, { kind: "Top category", text: n3 }];
}

const ORDER_Q = "query b($q: String!, $after: String) { orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) { " +
  "pageInfo { hasNextPage endCursor } nodes { createdAt cancelledAt test lineItems(first: 30) { nodes { title discountedTotalSet { shopMoney { amount } } %P } } } } }";

/* v215: what people do on the site, from Shopify's own visit numbers (ShopifyQL sessions; needs read_reports on the
   worker's Shopify app). Weekly visits and cart adds, the pages people land on (guides, products, Prowl, home), and
   where they came from. Shopify does not see clicks out to Etsy, so a guide that sends people to Etsy shows as a visit
   with no cart add. */
export const SITE_Q = {
  weeks: "FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions, sessions_that_completed_checkout TIMESERIES week SINCE -56d UNTIL today",
  pages: "FROM sessions SHOW sessions, online_store_visitors, sessions_with_cart_additions GROUP BY landing_page_path SINCE -30d UNTIL today ORDER BY sessions DESC LIMIT 40",
  refs: "FROM sessions SHOW sessions GROUP BY referrer_source, referrer_name SINCE -30d UNTIL today ORDER BY sessions DESC LIMIT 10"
};
export function pageKind(path) {
  const p = String(path || "");
  if (/^\/blogs\//.test(p)) return p.split("/").length > 3 ? "guide" : "guides list";
  if (/^\/products\//.test(p)) return "product";
  if (/^\/pages\/prowl/.test(p)) return "prowl";
  if (p === "/" || p === "") return "home";
  if (/^\/collections/.test(p)) return "collection";
  return "other";
}
/* "/blogs/guides/hen-on-nest-collectors-guide" -> "Hen on nest collectors guide" */
export function pageName(path) {
  const p = String(path || ""), k = pageKind(p);
  if (k === "home") return "Home page";
  if (k === "prowl") return /prowl-app/.test(p) ? "Prowl (app)" : "Prowl";
  const slug = p.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() || p;
  const t = decodeURIComponent(slug).replace(/[-_]+/g, " ").trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 90);
}
const sqlRows = j => {
  const r = j && j.data && j.data.shopifyqlQuery;
  if (!r) { const m = j && j.errors && j.errors[0] && j.errors[0].message ? String(j.errors[0].message) : "no answer"; const e = new Error(m); e.access = /access|scope|permission|read_reports/i.test(m); throw e; }
  if (r.parseErrors && r.parseErrors.length) throw new Error("ShopifyQL: " + String(r.parseErrors[0]).slice(0, 120));
  const rows = r.tableData && Array.isArray(r.tableData.rows) ? r.tableData.rows : [];
  return rows.filter(x => x && typeof x === "object");
};
export function siteStats(weeks, pages, refs) {
  const w = weeks.map(r => ({ week: String(r.week || "").slice(0, 10), visits: num(r.sessions), visitors: num(r.online_store_visitors), carts: num(r.sessions_with_cart_additions), checkouts: num(r.sessions_that_completed_checkout) }))
    .filter(r => r.week).sort((a, b) => a.week < b.week ? -1 : 1);
  const P = pages.map(r => ({ path: String(r.landing_page_path || "").slice(0, 200), visits: num(r.sessions), visitors: num(r.online_store_visitors), carts: num(r.sessions_with_cart_additions) }))
    .filter(r => r.visits > 0).map(r => Object.assign(r, { kind: pageKind(r.path), name: pageName(r.path) }));
  const by = {};
  for (const r of P) { const b = by[r.kind] || (by[r.kind] = { kind: r.kind, visits: 0, carts: 0 }); b.visits += r.visits; b.carts += r.carts; }
  const last = w[w.length - 1] || null, prev = w[w.length - 2] || null;
  return {
    weeks: w, thisWeek: last, lastWeek: prev,
    visits30: P.reduce((a, r) => a + r.visits, 0),
    kinds: Object.keys(by).map(k => by[k]).sort((a, b) => b.visits - a.visits),
    guides: P.filter(r => r.kind === "guide").slice(0, 12).map(r => ({ name: r.name, path: r.path, visits: r.visits, carts: r.carts })),
    products: P.filter(r => r.kind === "product").slice(0, 6).map(r => ({ name: r.name, path: r.path, visits: r.visits, carts: r.carts })),
    refs: refs.map(r => ({ from: String(r.referrer_name || r.referrer_source || "direct").slice(0, 40) || "direct", source: String(r.referrer_source || "").slice(0, 20), visits: num(r.sessions) })).filter(r => r.visits > 0).slice(0, 8)
  };
}
export const SITE_RETRY_MS = 15 * 60000;
export async function siteVisits(env, deps, renew) {
  const Q = "query s($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { rows } } }";
  const ask = (q, r) => deps.gql(env, Q, { q: q }, r).then(sqlRows);
  const weeks = await ask(SITE_Q.weeks, !!renew);   // first, alone: a renewed token is then shared by the other two
  const [pages, refs] = await Promise.all([ask(SITE_Q.pages), ask(SITE_Q.refs)]);
  return siteStats(weeks, pages, refs);
}

/* deps: { kvGet, kvPut, gql(env, query, vars) -> json, ai(env, prompt) -> {status, content} | null }.
   A shop without read_products still works: product types read as unknown and the card says so. */
export async function shopBrief(env, deps, nowMs, fresh) {
  const day = detroitDay(nowMs), key = BRIEF_KEY + day;
  if (!fresh) {
    const c = await deps.kvGet(env, key, null);
    if (c && c.stats) {
      /* v217: the visits part failed earlier today (most often the read_reports permission not yet approved): try it
         again at most every 15 minutes with a fresh Shopify token, so it shows the same day it is approved */
      if (c.siteErr && nowMs - Number(c.siteTry || Date.parse(c.at) || 0) > SITE_RETRY_MS) {
        c.siteTry = nowMs;
        try { c.stats.site = await siteVisits(env, deps, true); c.siteErr = ""; } catch (e) { c.siteErr = e && e.access ? "needs read_reports" : String(e && e.message || "failed").slice(0, 120); }
        await deps.kvPut(env, key, c);
      }
      return Object.assign({ cached: true }, c);
    }
  }
  const since = new Date(nowMs - BRIEF_DAYS * DAY).toISOString().slice(0, 10);
  const read = async (withType) => {
    const all = []; let after = null;
    for (let p = 0; p < BRIEF_PAGES; p++) {
      const j = await deps.gql(env, ORDER_Q.replace("%P", withType ? "product { productType }" : ""), { q: "created_at:>=" + since, after: after });
      if (!j || j.errors || !j.data || !j.data.orders) {
        const msg = j && j.errors && j.errors[0] && j.errors[0].message ? String(j.errors[0].message) : "no answer";
        const e = new Error(msg); e.access = /access|scope|permission/i.test(msg); throw e;
      }
      all.push(...j.data.orders.nodes);
      if (!j.data.orders.pageInfo.hasNextPage) break;
      after = j.data.orders.pageInfo.endCursor;
    }
    return all;
  };
  let orders;
  try { orders = await read(true); }
  catch (e) { if (!e.access) throw e; orders = await read(false); }
  const stats = briefStats(orders, nowMs);
  let site = null, siteErr = "";
  try { site = await siteVisits(env, deps); } catch (e) { siteErr = e && e.access ? "needs read_reports" : String(e && e.message || "failed").slice(0, 120); }
  stats.site = site;
  let notes = null, ai = false;
  if (deps.ai) {
    try { const r = await deps.ai(env, briefPrompt(stats)); notes = r && r.status === 200 ? briefNotes(r.content) : null; ai = !!notes; } catch (e) {}
  }
  if (!notes) notes = briefFallback(stats);
  const out = { day: day, at: new Date(nowMs).toISOString(), stats: stats, notes: notes, ai: ai, siteErr: siteErr };
  await deps.kvPut(env, key, out, { expirationTtl: 3 * DAY / 1000 });
  return out;
}
