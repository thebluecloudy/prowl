/* Admin page builders: CSP-safe markup (nonces, no inline handlers or style attributes, no external
   resources), a script that parses and never feeds HTML strings to the DOM, and the routes/controls the
   dashboard depends on. Layout is checked separately with Playwright.
   Run: node --test worker/__tests__/admin-page.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loginPage, adminPage } from "../admin-page.js";

const NONCE = "r4nd0mN0nce_x-1";
const page = adminPage(NONCE, "v78");
const scriptOf = html => { const m = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(html); return m ? m[1] : null; };
const markupOf = html => html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/g, "$1</script>").replace(/(<style\b[^>]*>)[\s\S]*?<\/style>/g, "$1</style>");
const tags = (html, name) => html.match(new RegExp("<" + name + "\\b[^>]*>", "g")) || [];
const SCRIPT = scriptOf(page);

test("dashboard: one style and one script, both carrying the nonce", () => {
  assert.equal(tags(page, "style").length, 1);
  assert.equal(tags(page, "script").length, 1);
  assert.deepEqual(tags(page, "style"), ['<style nonce="' + NONCE + '">']);
  assert.deepEqual(tags(page, "script"), ['<script nonce="' + NONCE + '">']);
  assert.ok(page.startsWith("<!doctype html>"));
  assert.match(page, /<title>Prowl admin<\/title>/);
  assert.match(page, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
});

test("dashboard script parses", () => {
  assert.ok(SCRIPT && SCRIPT.length > 1000);
  assert.doesNotThrow(() => new Function(SCRIPT));
});

test("no inline event handlers, style attributes or javascript: URLs in the markup", () => {
  for (const html of [page, loginPage(NONCE, "Nope"), loginPage(NONCE)]) {
    const mk = markupOf(html);
    assert.doesNotMatch(mk, /<[^>]*\son[a-z]+\s*=/i, "inline handler");
    assert.doesNotMatch(mk, /<[^>]*\sstyle\s*=/i, "style attribute");
    assert.doesNotMatch(html, /javascript:/i);
  }
});

test("script never parses HTML strings: no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval", () => {
  for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "setAttribute(\"style\"", ".onclick", ".onload"]) {
    assert.equal(SCRIPT.includes(bad), false, bad);
  }
  // listing links and images only get through the https check
  assert.match(SCRIPT, /function https\(u\)/);
  assert.match(SCRIPT, /\^https:/);
  assert.match(SCRIPT, /href: u\b/);
  assert.match(SCRIPT, /src: img\b/);
});

test("no external resources or web fonts; ASCII-only output", () => {
  for (const html of [page, loginPage(NONCE, "x")]) {
    const mk = markupOf(html);
    assert.doesNotMatch(mk, /\s(src|href)="(https?:)?\/\//i);
    assert.doesNotMatch(html, /@import|@font-face|url\(\s*["']?https?:/i);
    assert.doesNotMatch(html, /[^\x00-\x7f]/, "non-ASCII character");
  }
  assert.deepEqual(markupOf(page).match(/href="[^"]*"/g).sort(), ['href="#main"', 'href="/admin"']);
});

test("version and nonce are escaped", () => {
  const p = adminPage('a"b<c', "<b>v78</b>");
  assert.ok(p.includes('<style nonce="a&quot;b&lt;c">'));
  assert.ok(p.includes('<script nonce="a&quot;b&lt;c">'));
  assert.equal(p.includes("<b>v78</b>"), false);
  assert.ok(p.includes("&lt;b&gt;v78&lt;/b&gt;"));
});

test("a $ in the version is copied literally, not read as a replacement pattern", () => {
  const p = adminPage(NONCE, "v$&$'$`9");
  assert.ok(p.includes('<html data-version="v$&amp;$&#39;$`9"'));
  assert.ok(p.includes('<span class="ver" id="ver">v$&amp;$&#39;$`9</span>'));
  assert.equal(tags(p, "script").length, 1);
});

/* Pull one top-level declaration out of the page script and run it on its own. */
const pick = (name, kind = "function") => {
  const line = SCRIPT.split("\n").find(l => l.startsWith(kind === "function" ? "function " + name + "(" : "const " + name + " ="));
  assert.ok(line, name);
  return new Function(line + "\nreturn " + name + ";")();
};

test("member ids typed or linked in any case become the server's lower-case form", () => {
  const normId = pick("normId");
  assert.equal(normId("M-1A2B3C4D"), "M-1a2b3c4d");
  assert.equal(normId(" m-1a2b3c4d "), "M-1a2b3c4d");
  assert.equal(normId("M-1a2b3c4"), "");
  assert.equal(normId("M-1a2b3c4dz"), "");
  assert.equal(normId(""), "");
  // a malformed #hash must not stop the page from routing
  assert.match(SCRIPT, /try \{ hs = decodeURIComponent\(/);
});

test("Diagnose: shadow-mode AI answers ('tagged') are normal; real AI problems get plain words", () => {
  const fine = pick("AI_FINE", "const");
  for (const s of ["ok", "tagged", "empty", "off for this member"]) assert.ok(fine.test(s), s);
  for (const s of ["no key", "daily cap", "jev failed", "AI check failed", "off"]) {
    assert.equal(fine.test(s), false, s);
    assert.ok(SCRIPT.includes(JSON.stringify(s) + ": \"") || SCRIPT.includes(" " + s + ": \""), "plain words for " + s);
  }
});

test("sparklines share one document listener, so the minute-by-minute refresh does not pile them up", () => {
  assert.equal((SCRIPT.match(/D\.addEventListener\("pointerdown"/g) || []).length, 1);
  assert.match(SCRIPT, /if \(!el\.isConnected\) SPARKS\.delete\(el\)/);
});

test("dashboard has the five tabs, their panels and the member detail view", () => {
  for (const t of ["overview", "members", "diagnose", "errors", "searches"]) {
    assert.match(page, new RegExp('role="tab"[^>]*data-tab="' + t + '"'));
    assert.match(page, new RegExp('id="v-' + t + '" role="tabpanel"'));
  }
  assert.match(page, /role="tablist"/);
  assert.match(page, /id="mdetail" hidden/);
  assert.match(page, /id="mback"/);
});

test("member filters match the server's filter names; find form explains the email is not kept", () => {
  const filters = (page.match(/data-filter="([a-z]+)"/g) || []).map(x => x.slice(13, -1));
  assert.deepEqual(filters, ["all", "pro", "trial", "free", "late", "mailoff", "paused", "issues"]);
  assert.match(page, /<label for="find-email">Find a member by email<\/label>/);
  assert.match(page, /id="find-email" type="email"[^>]*autocomplete="off"/);
  assert.match(page, /not stored, logged or shown/);
  // the field is cleared before the lookup is sent
  const i = SCRIPT.indexOf('inp.value = ""'), j = SCRIPT.indexOf('api("/admin/api/find"');
  assert.ok(i > 0 && j > i);
});

test("sign out is a plain form post; searches offer 1/7/30 days", () => {
  assert.match(page, /<form method="post" action="\/admin\/logout"><button class="btn btn-s" type="submit">Sign out<\/button><\/form>/);
  assert.deepEqual((page.match(/data-days="(\d+)"/g) || []).map(x => x.slice(11, -1)), ["1", "7", "30"]);
});

test("script calls every admin API route, same-origin, with the admin header on POSTs", () => {
  for (const r of ['"/admin/api/overview"', '"/admin/api/members?filter="', '"/admin/api/member?id="', '"/admin/api/member/action"',
    '"/admin/api/find"', '"/admin/api/diagnose"', '"/admin/api/healthcheck"', '"/admin/api/errors?limit=100"', '"/admin/api/searches?days="']) {
    assert.ok(SCRIPT.includes(r), r);
  }
  assert.match(SCRIPT, /credentials: "same-origin"/);
  assert.match(SCRIPT, /o\.headers\["X-Prowl-Admin"\] = "1"/);
  assert.match(SCRIPT, /o\.headers\["Content-Type"\] = "application\/json"/);
  assert.match(SCRIPT, /r\.status === 401\) \{ signedOut\(\)/);
  // every member action the server knows about has a button
  for (const a of ["signin-link", "refresh-pro", "recheck-today", "resend-today", "mail-on", "mail-off", "unpause", "signout-all", "clear-seen", "delete"]) {
    assert.ok(SCRIPT.includes('a: "' + a + '"'), a);
  }
});

test("sessionStorage is only touched inside try/catch", () => {
  const lines = SCRIPT.split("\n").filter(l => l.includes("sessionStorage"));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.match(l, /try \{ (return )?sessionStorage\.(get|set)Item/);
});

test("login page: one password field posting to /admin/login, escaped message, CSP-safe", () => {
  const p = loginPage(NONCE, 'Wrong key <img src=x onerror="alert(1)"> & more');
  assert.ok(p.startsWith("<!doctype html>"));
  assert.match(p, /<title>Prowl admin<\/title>/);
  assert.deepEqual(tags(p, "style"), ['<style nonce="' + NONCE + '">']);
  assert.equal(tags(p, "script").length, 0);
  assert.match(p, /<form class="card lcard" method="post" action="\/admin\/login">/);
  assert.equal(tags(p, "input").length, 1);
  assert.match(p, /<input id="key" name="key" type="password" autocomplete="current-password"/);
  assert.match(p, /<button class="btn btn-p" type="submit">Sign in<\/button>/);
  assert.match(p, /Use the admin key from Cloudflare \(ADMIN_KEY, or OWNER_KEY\)/);
  assert.ok(p.includes('role="alert">Wrong key &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more</p>'));
  assert.equal(p.includes("<img"), false);
  assert.doesNotMatch(loginPage(NONCE), /role="alert"/);
  assert.doesNotMatch(loginPage(NONCE, ""), /role="alert"/);
  assert.ok(loginPage(NONCE, "caf" + String.fromCharCode(233)).includes("caf&#233;"));
});

test("dark mode, focus outlines, tabular numbers and the fixed status colours are in the stylesheet", () => {
  assert.match(page, /@media \(prefers-color-scheme:dark\)/);
  assert.match(page, /:focus-visible\{outline:3px solid/);
  assert.match(page, /table\{[^}]*font-variant-numeric:tabular-nums/);
  for (const c of ["#0ca30c", "#fab219", "#ec835a", "#d03b3b", "#2a78d6", "#6da7ec", "#FAF6EE", "#2A140C", "#C2491F", "#0B1430", "#12204A", "#9DB7EA"]) assert.ok(page.includes(c), c);
  assert.match(page, /\[hidden\]\{display:none!important\}/);
});
