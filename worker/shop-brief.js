/* v212: Owl & Twig's morning briefing in the admin (Matt, 2026-11-01: "how do i get it on my prowl dashboard?").
   The worker reads the shop's own orders (Etsy orders reach Shopify through the DPL integration) with its read_orders
   token, works out the numbers here, and asks Muse for three short notes on them. Built once per Detroit day, on the
   first admin open, and kept in KV until the next day, so it costs one Shopify read and one AI call a day.
   Prowl Pro subscriptions are left out: this is the shop's sales, not Prowl's. No customer names or emails are read. */

export const BRIEF_DAYS = 60;          // 30 days and the 30 before
export const BRIEF_PAGES = 4;          // up to 400 orders read
export const BRIEF_KEY = "shopbrief:";
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
    "1) Top performers: what sold yesterday and this week, and which categories lead. 2) Slow movers: categories or a " +
    "trend that needs attention (repricing, promoting, renewing listings). 3) What to buy or list next, based on what is " +
    "selling. Each note 1-3 plain sentences with real numbers, dollars rounded, no hype, no exclamation marks, no emoji. " +
    "If yesterday had no sales, say so plainly. Do not invent data you were not given (there is no cost or inventory data). " +
    'Answer with only a JSON array: [{"kind":"Top performers","text":"..."},{"kind":"Slow movers","text":"..."},{"kind":"Buy and list next","text":"..."}]\n\n' +
    "Numbers (USD, Detroit time, item sales before refunds, Prowl Pro left out):\n" + JSON.stringify({
      yesterday: { date: st.yesterday, sales: st.salesYday, orders: st.ordersYday },
      last30days: { sales: st.sales30, orders: st.orders30 }, previous30days: { sales: st.salesPrev, orders: st.ordersPrev },
      salesChangePct: st.salesChange, daysSinceLastOrder: st.daysSinceOrder,
      categoriesLast30days: st.categories, soldLast7days: st.week.map(w => ({ title: w.title, category: w.type, sale: w.amt }))
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

/* deps: { kvGet, kvPut, gql(env, query, vars) -> json, ai(env, prompt) -> {status, content} | null }.
   A shop without read_products still works: product types read as unknown and the card says so. */
export async function shopBrief(env, deps, nowMs, fresh) {
  const day = detroitDay(nowMs), key = BRIEF_KEY + day;
  if (!fresh) { const c = await deps.kvGet(env, key, null); if (c && c.stats) return Object.assign({ cached: true }, c); }
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
  let notes = null, ai = false;
  if (deps.ai) {
    try { const r = await deps.ai(env, briefPrompt(stats)); notes = r && r.status === 200 ? briefNotes(r.content) : null; ai = !!notes; } catch (e) {}
  }
  if (!notes) notes = briefFallback(stats);
  const out = { day: day, at: new Date(nowMs).toISOString(), stats: stats, notes: notes, ai: ai };
  await deps.kvPut(env, key, out, { expirationTtl: 3 * DAY / 1000 });
  return out;
}
