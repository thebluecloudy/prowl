// Loads page/prowl.html (the Shopify page body) into jsdom with the browser
// APIs the page touches stubbed, so behaviour can be tested without a browser.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom';

const PAGE = fileURLToPath(new URL('../../page/prowl.html', import.meta.url));

// scripts: { url: code } serves those external scripts (page v7.21: the main script is a src= in what the deploy sends);
// any other URL jsdom would fetch (the stylesheet link, images) is skipped. A url mapped to null fails to load.
class Scripts extends ResourceLoader {
  constructor(map) { super(); this.map = map; }
  fetch(url, opts) {
    if (Object.prototype.hasOwnProperty.call(this.map, url)) return this.map[url] == null ? Promise.reject(new Error('offline')) : Promise.resolve(Buffer.from(this.map[url]));
    return null;
  }
}
export function loadPage({ url = 'https://www.owlandtwigvintage.com/pages/prowl', storage = {}, fetchImpl, reducedMotion = false, beforeLoad, html, scripts } = {}) {
  const body = html == null ? readFileSync(PAGE, 'utf8') : html;   // html: another copy of the page, e.g. what the deploy sends
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  const opened = [];
  let closed = false;
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + body + '</body></html>', {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    ...(scripts ? { resources: new Scripts(scripts) } : {}),
    virtualConsole: vc,
    beforeParse(win) {
      for (const k of Object.keys(storage)) win.localStorage.setItem(k, typeof storage[k] === 'string' ? storage[k] : JSON.stringify(storage[k]));
      win.open = (u) => { opened.push(u); return null; };
      const fx = fetchImpl || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') }));
      // after close() nothing resolves, so no callback runs against a torn-down window
      win.fetch = (...a) => (closed ? new Promise(() => {}) : fx(...a));
      win.matchMedia = (q) => ({
        matches: reducedMotion && /prefers-reduced-motion:\s*reduce/.test(q),
        media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      });
      win.IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
      win.scrollTo = () => {};
      win.Element.prototype.scrollIntoView = function () {};
      win.Element.prototype.scrollTo = function (o) { if (o && typeof o.top === 'number') this.scrollTop = o.top; };
      win.Element.prototype.setPointerCapture = function () {};
      win.Element.prototype.releasePointerCapture = function () {};
      Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
      if (beforeLoad) beforeLoad(win);
    },
  });
  const win = dom.window;
  async function close() { closed = true; await new Promise((r) => setTimeout(r, 30)); win.close(); }
  return { dom, win, doc: win.document, opened, errors, close, $: (s) => win.document.querySelector(s), $$: (s) => [...win.document.querySelectorAll(s)] };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
