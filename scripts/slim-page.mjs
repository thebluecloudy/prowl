// What goes to Shopify: the page without its comments. Shopify caps a page body at 512 KB and the page in the repo,
// with its comments, is past that; the repo copy keeps every comment. JavaScript comments come out at the positions
// acorn (a real parser) reports, so strings, regular expressions and template literals are never touched; a block
// comment that held a line break becomes one line break (it ends a statement just as the comment did), any other
// becomes a space. CSS comments come out by a small scanner that steps over quoted strings and url(...). JSON-LD and
// src= scripts and the HTML itself are left exactly as they are. Anything it cannot read with certainty throws, so
// a deploy stops instead of sending a guess.
import * as acorn from "acorn";

export const SHOPIFY_MAX_BYTES = 512 * 1024;   // Shopify's "Content is too big (maximum is 512 KB)"

export function slimJs(code) {
  const cuts = [];
  let multiline = false;   /* a string or template literal that spans lines: then its lines are left exactly as they are */
  acorn.parse(code, { ecmaVersion: "latest", sourceType: "script",
    onComment: (block, text, start, end) => cuts.push([start, end, block]),
    onToken: (t) => { if ((t.type.label === "template" || t.type.label === "string") && /[\n\r\u2028\u2029]/.test(code.slice(t.start, t.end))) multiline = true; } });
  let out = "", at = 0;
  for (const [start, end, block] of cuts) {
    out += code.slice(at, start);
    if (block) out += /[\n\r\u2028\u2029]/.test(code.slice(start, end)) ? "\n" : " ";
    at = end;
  }
  out += code.slice(at);
  return multiline ? out : dropBlankLines(out);
}

export function slimCss(css) {
  let out = "", i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) { if (css[j] === "\\") j++; if (css[j] === "\n") throw new Error("CSS string not closed on its line near " + JSON.stringify(css.slice(i, i + 60))); j++; }
      if (j >= n) throw new Error("CSS string not closed near " + JSON.stringify(css.slice(i, i + 60)));
      out += css.slice(i, j + 1); i = j + 1; continue;
    }
    if (/^url\(\s*[^\s'")]/i.test(css.slice(i, i + 6)) && /[\s:,(]/.test(css[i - 1] || " ")) {
      const j = css.indexOf(")", i);
      if (j < 0) throw new Error("CSS url( not closed near " + JSON.stringify(css.slice(i, i + 60)));
      out += css.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const j = css.indexOf("*/", i + 2);
      if (j < 0) throw new Error("CSS comment not closed near " + JSON.stringify(css.slice(i, i + 60)));
      const before = out[out.length - 1] || " ", after = css[j + 2] || " ";
      /* a comment between two name characters would join them; nothing in the page does that, so it is a stop */
      if (/[\w-]/.test(before) && /[\w-]/.test(after)) throw new Error("CSS comment between two names near " + JSON.stringify(css.slice(Math.max(0, i - 30), j + 32)));
      i = j + 2; continue;
    }
    out += c; i++;
  }
  return dropBlankLines(out);
}

function dropBlankLines(s) { return s.replace(/[ \t]+$/gm, "").replace(/\n{2,}/g, "\n"); }

/* the page: every classic inline script and every style block, the rest as it is */
export function slimPage(html) {
  return html
    .replace(/(<script(\s[^>]*)?>)([\s\S]*?)(<\/script>)/gi, (m, open, attrs, code, close) => {
      attrs = attrs || "";
      if (/\ssrc\s*=/i.test(attrs)) return m;
      const type = (/\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1];
      if (type && !/^(text|application)\/(java|ecma)script$/i.test(type)) return m;   /* JSON-LD and anything else: as is */
      return open + slimJs(code) + close;
    })
    .replace(/(<style(\s[^>]*)?>)([\s\S]*?)(<\/style>)/gi, (m, open, attrs, css, close) => open + slimCss(css) + close);
}

if (import.meta.url === "file://" + process.argv[1]) (async () => {   /* not awaited at the top: page-css.mjs imports this module */
  const { readFileSync } = await import("node:fs");
  const { deployBody } = await import("./page-css.mjs");
  const file = process.argv[2] || "page/prowl.html";
  const raw = readFileSync(file, "utf8"), slim = slimPage(raw);
  const a = Buffer.byteLength(raw, "utf8"), b = Buffer.byteLength(slim, "utf8");
  const c = Buffer.byteLength((await deployBody(raw)).body.replace(/\s+$/, ""), "utf8");
  console.log(file + ": " + a + " bytes, " + b + " without comments, " + c + " sent with the stylesheet as a link (Shopify's limit " + SHOPIFY_MAX_BYTES + ", " + (SHOPIFY_MAX_BYTES - c) + " to spare)");
  process.exit(c > SHOPIFY_MAX_BYTES ? 1 : 0);
})();
