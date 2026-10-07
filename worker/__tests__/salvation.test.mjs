/* v80 Salvation Army: the Browse-page parser against markup captured from the live site, Pacific end times, and the
   wiring into the routes, uptime checks and metrics. Run: node --test worker/__tests__/salvation.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { routeKey } from "../metrics.js";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const FIXTURE = readFileSync(new URL("./fixtures/salvation-browse.html", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constOf = (name) => (new RegExp("const " + name + " = ([^;,]+)[;,]").exec(INDEX) || [])[1];
function load(nowIso) {
  const RealDate = Date;
  const fixed = RealDate.parse(nowIso);
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }
  const names = ["hibidText", "money", "timeLeft", "salvationEnd", "salvationNormalize"];
  return new Function("Date", "SALVATION_BASE", "SALVATION_LIMIT", names.map(indexFn).join("\n") + "\nreturn { " + names.join(", ") + " };")(
    FakeDate, JSON.parse(constOf("SALVATION_BASE")), Number(constOf("SALVATION_LIMIT")));
}

test("end times are US Pacific, daylight time and standard time", () => {
  const { salvationEnd } = load("2026-10-07T19:36:00Z");
  assert.equal(new Date(salvationEnd("10/07/2026 12:45:25")).toISOString(), "2026-10-07T19:45:25.000Z");   // PDT, UTC-7
  assert.equal(new Date(salvationEnd("12/01/2026 09:00:00")).toISOString(), "2026-12-01T17:00:00.000Z");   // PST, UTC-8
  assert.equal(salvationEnd("soon"), null);
});

test("parses the captured Browse page: title, link, photo, bid, bids, time left", () => {
  const { salvationNormalize } = load("2026-10-07T19:36:00Z");
  const items = salvationNormalize(FIXTURE);
  const blu = items.find((x) => /Blu-ray/.test(x.title));
  assert.deepEqual(blu, {
    title: "SEALED Blu-ray Lot: 40 Titles [B2516]",
    price: "$61.00",
    url: "https://shopthesalvationarmy.com/Listing/Details/588443092/SEALED-Bluray-Lot-40-Titles-B2516",
    image: "https://shopsalvationarmyblob.blob.core.windows.net/assets/media/4963b99d-c4f6-4834-a0f5-61f1f36de4c6_fullsize.jpg",
    src: "salvation",
    bids: 6,
    time_left: "7h 24m",   // 20:00 PDT is 03:00 UTC the next day
  });
  const lamp = items.find((x) => /Stained Glass/.test(x.title));
  assert.equal(lamp.title, 'Victoria Supply Company 27" Stained Glass Table Lamp [A596]', "entities decoded");
  assert.equal(lamp.price, "$1,210.99", "thousands separator read");
  assert.equal(lamp.bids, 2);
});

test("fixed-price cards have no bid count; ended listings are dropped", () => {
  const { salvationNormalize } = load("2026-10-07T19:36:00Z");
  const items = salvationNormalize(FIXTURE);
  const fixed = items.find((x) => x.title === "Ceramic Panther TV Lamp");
  assert.equal(fixed.price, "$45.00");
  assert.equal("bids" in fixed, false);
  assert.ok(!items.some((x) => x.title === "Already Ended Lot"));
});

test("a page that is not the Browse page reads as a failure, not as zero results", () => {
  const { salvationNormalize } = load("2026-10-07T19:36:00Z");
  assert.equal(salvationNormalize("<html><title>Attention Required! | Cloudflare</title></html>"), null);
  assert.deepEqual(salvationNormalize('<div class="galleryContainer clearfix"></div>'), []);
});

test("wired in: route, cache, uptime checks, metrics, where-to-look", () => {
  assert.match(INDEX, /"\/salvation": "salvation"/);
  assert.match(INDEX, /isSalvation \? await salvationCall\(term\)/);
  assert.match(INDEX, /isSalvation \? SALVATION_CACHE_SECONDS/);
  assert.match(INDEX, /\["vinted", "grailed", "salvation"\]/);
  assert.match(INDEX, /salvation: \[\(t\) => salvationCall\(t\), \(x\) => salvationNormalize\(x\)\]/);
  assert.match(INDEX, /^  salvation: "Salvation Army:/m);
  assert.equal(routeKey("/salvation"), "live:salvation");
  assert.equal(routeKey("/__salvationtest"), null);
  const health = readFileSync(new URL("../../.github/workflows/scraper-health.yml", import.meta.url), "utf8");
  assert.match(health, /\/salvation\?q=/);
});

test("no affiliate tagging and no alert-email source yet", () => {
  assert.doesNotMatch(/const AL_SOURCES = \[[^\]]*\]/.exec(INDEX)[0], /salvation/);
});
