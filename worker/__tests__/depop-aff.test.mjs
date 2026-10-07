/* v84: Depop earns through Rakuten. The alert emails' "Also search" list carries a tagged Depop link, and footers
   with links say so. Run: node --test worker/__tests__/depop-aff.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
const RAN = "https://click.linksynergy.com/deeplink?id=jh1j/r7*wkQ&mid=53555&murl=";
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  const nl = INDEX.indexOf("\n", m.index), line = INDEX.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}
const constOf = (name) => { const m = new RegExp("^const " + name + " = [^\\n]*;", "m").exec(INDEX); assert.ok(m, name); return m[0]; };
const X = new Function(constOf("DEPOP_URL") + "\n" + constOf("DEPOP_AFF") + "\n" + indexFn("depopAff") +
  "\nconst AL_ALSO = " + /const AL_ALSO = (\[[\s\S]*?\n\]);/.exec(INDEX)[1] + ";\nreturn { depopAff, AL_ALSO, DEPOP_AFF };")();

test("depopAff wraps Depop links in the Rakuten deep link and leaves everything else alone", () => {
  assert.equal(X.DEPOP_AFF, RAN);
  const u = "https://www.depop.com/search/?q=ceramic%20panther";
  assert.equal(X.depopAff(u), RAN + encodeURIComponent(u));
  assert.equal(X.depopAff("https://depop.com/products/x/"), RAN + encodeURIComponent("https://depop.com/products/x/"));
  for (const v of ["https://www.etsy.com/listing/1", "https://depop.com.evil.example/x", "http://www.depop.com/x", ""]) assert.equal(X.depopAff(v), v);
});

test("every alert email's Also search list has a tagged Depop link", () => {
  const d = X.AL_ALSO.find((a) => a[0] === "Depop");
  assert.ok(d, "Depop is in the list");
  assert.equal(d[1]("hull pottery"), RAN + encodeURIComponent("https://www.depop.com/search/?q=hull%20pottery"));
  assert.ok(X.AL_ALSO.filter((a) => a[0] !== "Depop").every((a) => a[1]("x").indexOf("linksynergy") === -1), "no other site is tagged");
});

test("footers with links carry the commission line", () => {
  assert.match(INDEX, /^const AL_AFF_NOTE = "Some links \(eBay, Depop\) earn Owl & Twig a small commission, at no cost to you\.";/m);
  assert.match(INDEX, /links \+ '<br>Or just reply &quot;unsubscribe&quot; to this email\.<br>' \+ AL_AFF_NOTE \+ '<br>'/);
  assert.match(INDEX, /sub \? AL_AFF_NOTE : ""/);
  assert.match(INDEX, /const WORKER_VERSION = "v84";/);
});
