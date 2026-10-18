// The page's main stylesheet, served by the worker instead of sent inside the Shopify page body (capped at 512 KB).
// The repo copy of the page keeps it inline in <style id="prowl-css">, so tests and editing are unchanged; only the
// body sent to Shopify swaps that block for a <link> to the worker. The worker serves the same CSS from
// worker/page-css.js, which `node scripts/build-page-css.mjs` writes from the page (a test fails when they differ).
// The URL carries a hash of the CSS, so the browser can keep it for a year and a new stylesheet is a new URL.
import { createHash } from "node:crypto";
import { slimCss, slimJs, slimPage } from "./slim-page.mjs";

export const CSS_HOST = "https://prowl.thebluecloud.workers.dev";
const BLOCK = /<style id="prowl-css">([\s\S]*?)<\/style>/g;

/* the main stylesheet, without its comments, exactly as the worker serves it */
export function pageCss(html) {
  const all = [...String(html).matchAll(BLOCK)];
  if (all.length !== 1) throw new Error('the page needs exactly one <style id="prowl-css"> (found ' + all.length + ")");
  return slimCss(all[0][1]);
}
export function cssHash(css) { return createHash("sha256").update(css, "utf8").digest("hex").slice(0, 12); }
export function cssUrl(hash) { return CSS_HOST + "/css/prowl." + hash + ".css"; }

/* The link, then a few lines of script for two rare cases: the link is gone (a sanitizer took it out), so the script
   adds it; or the worker did not answer, so the script asks once more. No comments and no Liquid openers in it, since
   it goes to Shopify as it is. */
function linkTag(url) {
  return '<link rel="stylesheet" id="prowl-css" href="' + url + '">' +
    "<script>(function(){try{var u='" + url + "',l=document.getElementById('prowl-css');" +
    "if(!l||l.tagName!=='LINK'){l=document.createElement('link');l.rel='stylesheet';l.id='prowl-css';l.href=u;(document.head||document.documentElement).appendChild(l)}" +
    "l.addEventListener('error',function(){if(document.getElementById('prowl-css-r'))return;var n=document.createElement('link');n.rel='stylesheet';n.id='prowl-css-r';n.href=u+'?r=1';l.parentNode.insertBefore(n,l.nextSibling)})}catch(e){}})();</script>";
}

/* the body for Shopify: the page (already without comments) with its main stylesheet as a link */
export function externalize(slimHtml) {
  const css = pageCss(slimHtml), hash = cssHash(css);
  const html = String(slimHtml).replace(BLOCK, () => linkTag(cssUrl(hash)));
  return { html, css, hash, url: cssUrl(hash) };
}

/* Page v7.21, worker v124: the page's main script goes the same way. The repo page keeps it inline in
   <script id="prowl-js">; the body for Shopify carries <script id="prowl-js" src="…/js/prowl.<hash>.js"> in its place,
   a classic blocking script, so it still runs at the same point in the page, after the markup above it and before the
   scripts below it. The served copy starts with window.PROWL_JS=1, so the line after it can tell whether it ran. */
const JS_BLOCK = /<script id="prowl-js">([\s\S]*?)<\/script>/g;
export const JS_MARK = "window.PROWL_JS=1;\n";
export function pageJs(html) {
  const all = [...String(html).matchAll(JS_BLOCK)];
  if (all.length !== 1) throw new Error('the page needs exactly one <script id="prowl-js"> (found ' + all.length + ")");
  return JS_MARK + slimJs(all[0][1]);
}
export function jsUrl(hash) { return CSS_HOST + "/js/prowl." + hash + ".js"; }
/* When the script did not run (the worker did not answer, or a sanitizer took the src out), ask once more; if that
   fails too, say so at the top of the page with a way to try again. No comments and no Liquid openers in it. */
function scriptTag(url) {
  return '<script id="prowl-js" src="' + url + '"></script>' +
    "<script>(function(){if(window.PROWL_JS)return;try{var s=document.createElement('script');s.id='prowl-js-r';s.src='" + url + "?r=1';" +
    "s.onerror=function(){var d=document.createElement('p');d.id='prowl-js-err';d.setAttribute('role','alert');" +
    "d.style.cssText='margin:12px;padding:14px 16px;border-radius:12px;background:#2b2118;color:#fff;font:600 16px/1.4 system-ui,sans-serif;text-align:center';" +
    "d.innerHTML='Prowl could not load. <a href=\"#\" style=\"color:#ffd27a\">Tap to try again</a>';" +
    "d.querySelector('a').onclick=function(e){e.preventDefault();location.reload()};" +
    "var w=document.querySelector('.scout-app-wrapper');(w&&w.parentNode?w.parentNode:document.body).insertBefore(d,w||document.body.firstChild)};" +
    "(document.head||document.documentElement).appendChild(s)}catch(e){}})();</script>";
}
export function externalizeJs(slimHtml) {
  const js = pageJs(slimHtml), hash = cssHash(js);
  const html = String(slimHtml).replace(JS_BLOCK, () => scriptTag(jsUrl(hash)));
  return { html, js, hash, url: jsUrl(hash) };
}

/* what the deploy sends: the page without comments, its main stylesheet as a link when it has one (an older page file
   without <style id="prowl-css"> goes as it is) */
export async function deployBody(raw) {
  const slim = slimPage(String(raw));
  if (!/<style id="prowl-css">/.test(slim)) return { body: slim, hash: null, url: null, css: "", jsHash: null, jsUrl: null, js: "" };
  const x = externalize(slim);
  if (!/<script id="prowl-js">/.test(x.html)) return { body: x.html, hash: x.hash, url: x.url, css: x.css, jsHash: null, jsUrl: null, js: "" };
  const y = externalizeJs(x.html);   /* v7.21 */
  return { body: y.html, hash: x.hash, url: x.url, css: x.css, jsHash: y.hash, jsUrl: y.url, js: y.js };
}

/* the page deploy waits until the worker holds this stylesheet, so the page never links to CSS the worker does not
   have (the worker deploys from the same push, usually within a minute or two) */
export async function waitForCss(fetchFn, hash, { tries = 40, delayMs = 15000, log = () => {}, js = false } = {}) {
  const what = js ? "main script" : "stylesheet", url = js ? jsUrl(hash) : cssUrl(hash), hdr = js ? "X-Prowl-Js" : "X-Prowl-Css";   /* v7.21 */
  for (let n = 1; n <= tries; n++) {
    let have = "";
    try { const r = await fetchFn(url, { method: "HEAD" }); have = (r.headers && r.headers.get(hdr)) || ""; } catch (e) {}
    if (have === hash) { log("The worker serves " + what + " " + hash + "."); return true; }
    log("Waiting for the worker to serve " + what + " " + hash + " (it has " + (have || "nothing") + "), try " + n + " of " + tries + ".");
    if (n < tries) await new Promise((res) => setTimeout(res, delayMs));
  }
  return false;
}
