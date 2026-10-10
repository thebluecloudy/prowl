/* v103: estate sales near you from EstateSales.net (with their permission). The city page carries the sales in the
   Angular app's state (NGRX_STATE.feature.cityViewState.filteredSales, as the owner's admin check found on the real
   Novi page) and in schema.org SaleEvent blocks; esParse merges them by sale id. /sales is the owner's only, keeps
   each city 6 hours and serves an older copy when EstateSales.net does not answer.
   Run: node --test worker/__tests__/estatesales.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const consts = INDEX.match(/^const ES_TTL_MS = .*$/m)[0];
const ES = new Function(consts + "\n" + ["esPlace", "esJsonBlocks", "esDate", "esNum", "esParse"].map(indexFn).join("\n") + "\nreturn { esPlace, esParse };")();

/* a page shaped like the real one: 21 script blocks, SaleEvent JSON-LD, and the app state in a JSON block */
const D = (v) => ({ _type: "Date", _value: v });
const state = (id, o) => ({ id, stateCode: "MI", cityName: "Novi", postalCodeNumber: "48377", latitude: 42.48, longitude: -83.47, type: 1, typeName: "EstateSales",
  firstLocalStartDate: D("2026-10-16T09:00:00"), lastLocalEndDate: D("2026-10-18T16:00:00"), saleScheduleName: "Upcoming", distance: 2.1, ...o });
function page() {
  const ld = [
    { "@context": "https://schema.org", "@type": "SaleEvent", name: "Mid-Century Home Full of Pyrex", url: "https://www.estatesales.net/MI/Novi/48377/4400001",
      startDate: "2026-10-16T09:00:00-04:00", endDate: "2026-10-18T16:00:00-04:00", image: "https://picturescdn.estatesales.net/1.jpg",
      location: { "@type": "Place", address: { "@type": "PostalAddress", streetAddress: "123 Elm St", addressLocality: "Novi", addressRegion: "MI", postalCode: "48377" } } },
    { "@context": "https://schema.org", "@type": "SaleEvent", name: "Only In The Search Blocks", url: "https://www.estatesales.net/MI/Wixom/48393/4400009",
      startDate: "2026-10-20T10:00:00-04:00", location: { address: { addressLocality: "Wixom", addressRegion: "MI" }, geo: { latitude: 42.52, longitude: -83.53 } } },
  ];
  const ngrx = { NGRX_STATE: { feature: { cityViewState: { filteredSales: [
    state(4400001),
    state(4400002, { cityName: "Jackson", postalCodeNumber: "49201", latitude: 42.24, longitude: -84.4, typeName: "OnlineOnlyAuctions", firstLocalStartDate: D("2026-10-10T08:00:00") }),
  ] } }, ui: { sales: { saleRows: [] } } } };
  const filler = Array.from({ length: 17 }, (_, i) => `<script>var x${i}=1;</script>`).join("");
  return `<html><head>${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join("")}</head><body>${filler}
    <script id="serverApp-state" type="application/json">${JSON.stringify(ngrx)}</script><script type="application/json">{broken</script></body></html>`;
}

test("esParse merges the app's sales with the SaleEvent blocks by sale id", () => {
  const items = ES.esParse(page(), ES.esPlace("MI", "Novi"));
  assert.equal(items.length, 3);
  const [a, b, c] = items;
  assert.equal(a.id, "4400001");
  assert.equal(a.name, "Mid-Century Home Full of Pyrex", "the name comes from the SaleEvent");
  assert.equal(a.url, "https://www.estatesales.net/MI/Novi/48377/4400001");
  assert.equal(a.addr, "123 Elm St");
  assert.equal(a.lat, 42.48); assert.equal(a.lon, -83.47);
  assert.equal(a.img, "https://picturescdn.estatesales.net/1.jpg");
  assert.equal(a.start, new Date("2026-10-16T09:00:00-04:00").toISOString());
  assert.equal(b.id, "4400002");
  assert.equal(b.name, "Online Only Auctions", "no SaleEvent: the sale type, readable");
  assert.equal(b.url, "https://www.estatesales.net/MI/Jackson/49201/4400002", "its link is built from state, city, ZIP and id");
  assert.equal(b.addr, "", "no address unless the sale shows one");
  assert.equal(b.start, new Date("2026-10-10T08:00:00").toISOString(), "the app's {_type,_value} dates");
  assert.equal(c.id, "4400009"); assert.equal(c.city, "Wixom"); assert.equal(c.lat, 42.52, "a SaleEvent's own geo");
});

test("esParse is safe on other pages: nothing found is an empty list, and outside links are dropped", () => {
  assert.deepEqual(ES.esParse("<html>blocked</html>", ES.esPlace("MI", "Novi")), []);
  assert.deepEqual(ES.esParse(null, null), []);
  const bad = `<script type="application/ld+json">${JSON.stringify({ "@type": "SaleEvent", name: "<b>x</b>", url: "javascript:alert(1)/4400003", image: "http://insecure/1.jpg" })}</script>`;
  const it = ES.esParse(bad, ES.esPlace("MI", "Novi"));
  assert.equal(it.length, 1);
  assert.match(it[0].url, /^https:\/\/www\.estatesales\.net\/MI\/Novi\//, "not the javascript: link");
  assert.equal(it[0].img, "");
  assert.equal(it[0].name, "x", "markup is taken out of names");
});

test("esPlace takes a city and a two-letter state only", () => {
  assert.deepEqual(ES.esPlace("mi", " Grosse  Pointe "), { st: "MI", city: "Grosse Pointe", slug: "Grosse-Pointe", key: "es:MI:grosse-pointe" });
  assert.equal(ES.esPlace("Michigan", "Novi"), null);
  assert.equal(ES.esPlace("MI", "Novi/../admin"), null);
  assert.equal(ES.esPlace("MI", ""), null);
});

/* /sales, with a fake KV and a fake EstateSales.net */
function route({ owner = true, publicOn = false, answer = 200 } = {}) {
  const kv = new Map(), calls = [];
  const deps = {
    json: (body, status) => ({ status: status || 200, body }),
    isOwner: () => owner, ipKey: () => "203.0.113.5", vCount: async () => true,
    kvGet: async (env, k, d) => (kv.has(k) ? JSON.parse(kv.get(k)) : d),
    fetch: async (u) => { calls.push(u); return { status: answer, text: async () => page() }; },
    AbortController, setTimeout, clearTimeout, PROBE_UA: "UA",
  };
  const keys = Object.keys(deps);
  const f = new Function(...keys, consts + "\n" + ["esPlace", "esJsonBlocks", "esDate", "esNum", "esParse", "esFetch", "esSales"].map(indexFn).join("\n") + "\nreturn esSales;")(...keys.map((k) => deps[k]));
  const env = { PROWL_ALERTS: { put: async (k, v) => { kv.set(k, v); } }, SALES_PUBLIC: publicOn ? "on" : "" };
  const go = (q) => f({ headers: { get: () => null } }, env, new URL("https://w.example/sales?" + q), "o");
  return { go, kv, calls };
}

test("/sales: the owner gets the city's sales, fetched once and kept 6 hours", async () => {
  const R = route();
  const r1 = await R.go("st=MI&city=Novi");
  assert.equal(r1.status, 200);
  assert.equal(r1.body.items.length, 3);
  assert.deepEqual(R.calls, ["https://www.estatesales.net/MI/Novi"]);
  await R.go("st=mi&city=novi");
  assert.equal(R.calls.length, 1, "the second look is served from the saved copy");
  assert.equal((await R.go("st=MI&city=")).status, 400);
});

test("/sales is the owner's only unless SALES_PUBLIC=on; a failed fetch serves the older copy", async () => {
  assert.equal((await route({ owner: false }).go("st=MI&city=Novi")).status, 404);
  assert.equal((await route({ owner: false, publicOn: true }).go("st=MI&city=Novi")).status, 200);
  const R = route({ answer: 503 });
  assert.equal((await R.go("st=MI&city=Novi")).status, 502);
  R.kv.set("es:MI:novi", JSON.stringify({ at: Date.now() - 7 * 3600000, items: [{ id: "1" }] }));
  const old = await R.go("st=MI&city=Novi");
  assert.equal(old.status, 200); assert.equal(old.body.stale, 1); assert.deepEqual(old.body.items, [{ id: "1" }]);
});

test("the route is wired", () => {
  assert.match(INDEX, /url\.pathname === "\/sales" && request\.method === "GET"\) return esSales\(request, env, url, origin\);/);
});
