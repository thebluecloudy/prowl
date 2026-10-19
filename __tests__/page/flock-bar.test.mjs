// Page v6.66: on a Flock card the site pill, the heart, Share and the star are one row under the title, in the card's
// flow. They were placed over the bottom of the photo at a fixed distance from the card's foot, and on some phones they
// covered the title and its New badge. Only the ✕ and the price stay on the photo, in its top corners, placed from the
// photo itself (.fl-media), so a label or + Add to hunts above the photo cannot push them onto the title.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { liveFetch, waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(fileURLToPath(new URL('../../page/prowl.html', import.meta.url)), 'utf8');
const ls = (p, k) => JSON.parse(p.win.localStorage.getItem(k) || 'null');
const cards = (p) => p.$$('#otp-flockRow .fl-card');

async function flock(hunts, storage = {}) {
  const f = liveFetch();
  const p = loadPage({ fetchImpl: f.impl, storage: { 'prowl.v36': { seen: true, hunts }, ...storage } });
  p.win.confirm = () => true;
  await tick(50);
  p.$('#otp-dock .db[data-m="flock"]').click();
  await waitFor(() => cards(p).length >= 3, { timeout: 8000 });
  p.calls = f.calls;
  return p;
}

/* Flock redraws as late answers come in (flockRenderSoon, 180ms after the last one), and a redraw that re-sorts the feed
   replaces every card. Wait until no answer has come and nothing in the feed has changed for well past that. */
async function settled(p, quiet = 600) {
  const row = p.$('#otp-flockRow');
  let last = Date.now(), n = p.calls.length;
  const mo = new p.win.MutationObserver(() => { last = Date.now(); });
  mo.observe(row, { childList: true, subtree: true });
  try {
    await waitFor(() => {
      if (p.calls.length !== n) { n = p.calls.length; last = Date.now(); }
      return Date.now() - last >= quiet;
    }, { timeout: 8000 });
  } finally { mo.disconnect(); }
}

test('every card: photo and text first, then one row with the site, the heart, Share and the star', async () => {
  const p = await flock(['Roseville jardiniere', 'Pyrex Butterprint'], { 'prowl.flockSeen': JSON.stringify(['https://seen.example/1']) });
  const all = cards(p);
  for (const c of all) {
    const media = c.querySelector(':scope > .fl-media');
    assert.ok(media, 'the photo box');
    const a = media.querySelector(':scope > .sgw-card');
    assert.ok(a, 'the listing link');
    assert.equal(media.firstElementChild, a, 'the box starts with the photo');
    assert.ok(a.querySelector('img') && a.querySelector('.sgw-t'), 'photo and title in the link');
    assert.equal(a.lastElementChild.className, 'fl-for', 'the hunt line closes the link');
    const bar = media.nextElementSibling;
    assert.equal(bar && bar.className, 'fl-bar', 'the row comes straight after the title and hunt line');
    assert.deepEqual([...bar.children].map((x) => x.className), ['fl-tags', 'fl-acts']);
    assert.ok(bar.querySelector('.fl-tags .fl-site').textContent, 'the site pill');
    assert.deepEqual([...bar.querySelector('.fl-acts').children].map((x) => x.className.split(' ')[0]), ['fl-lk', 'fl-sh', 'sgw-sv'], 'heart, Share, star');
    assert.equal(c.querySelector(':scope > .fl-lk, :scope > .fl-sh, :scope > .sgw-sv, :scope > .fl-tags, :scope > .fl-x'), null, 'nothing loose on the card to be placed from its edges');
    assert.equal(c.querySelectorAll('.sgw-sv').length, 1, 'one star');
    assert.ok(media.querySelector(':scope > .fl-x'), 'the ✕ stays on the photo, placed from it');
    assert.ok(a.querySelector('.sgw-p[data-act="margin"]'), 'the price stays on the photo, placed from it');
  }
  assert.ok(all.some((c) => c.querySelector('.sgw-t .fl-newb')), 'a New card keeps its badge in the title');
  await p.close();
});

test('the buttons in the row still work: star saves, heart likes', async () => {
  const p = await flock(['Roseville jardiniere', 'Pyrex Butterprint'], { 'prowl.alertTok': 'tok', 'prowl.alertEmail': 'a@b.co' });
  const c = cards(p)[0], u = c.getAttribute('data-u');
  c.querySelector('.fl-bar .sgw-sv').click();
  assert.ok((ls(p, 'prowl.finds') || []).some((f) => f.url === u), 'saved');
  assert.ok(c.querySelector('.fl-bar .sgw-sv').classList.contains('on') || p.$('#otp-flockRow .fl-card[data-u="' + u + '"] .fl-bar .sgw-sv.on'), 'the star shows saved');
  const lk = c.querySelector('.fl-bar .fl-lk');
  lk.click();
  await tick(30);
  const now = p.$('#otp-flockRow .fl-card[data-u="' + u + '"] .fl-lk');
  assert.equal(now.getAttribute('aria-pressed'), 'true');
  assert.ok((ls(p, 'prowl.likes') || []).some((x) => x.u === u), 'liked');
  await p.close();
});

test('a "$&" or "$\'" in a hunt stays as typed: the card markup is never copied into the title or the hunt line', async () => {
  const hunt = "Pyrex $' and $& bowl";
  const p = await flock([hunt]);
  for (const c of cards(p)) {
    assert.equal(c.querySelector('.fl-for').textContent, 'for ' + hunt);
    assert.match(c.getAttribute('aria-label'), /\$' and \$& bowl/);
    assert.equal(c.querySelectorAll('.sgw-card').length, 1, 'one listing link');
    assert.equal(c.querySelectorAll('.fl-bar').length, 1, 'one row');
    assert.equal(c.querySelectorAll('.fl-x').length, 1, 'one ✕');
  }
  await p.close();
});

const CSS = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
/* every rule, media blocks flattened (an @media line is cut off its first rule's selector) */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].replace(/^[\s\S]*\{/, '').replace(/^\s*@[^{]*$/, '').trim(), body: m[2] }));
const ROW = /\.fl-(bar|tags|site|auc|acts|lk|sh)\b|\.fl-(card|bar) \.sgw-sv\b/;

test('no style puts the row, the site pill, the heart, Share or the star back over the photo', () => {
  const rows = RULES.filter((r) => ROW.test(r.sel));
  assert.ok(rows.length >= 10, 'found the row styles: ' + rows.length);
  for (const r of rows) {
    /* each selector in a list, so a rule shared with the ✕ (which is on the photo) is judged by its row parts only */
    const parts = r.sel.split(',').filter((x) => ROW.test(x));
    if (!parts.length) continue;
    assert.doesNotMatch(r.body, /position:\s*(absolute|fixed)|(^|;)\s*(bottom|top|left|right|inset):/, parts.join(',') + ' {' + r.body + '}');
    assert.doesNotMatch(r.body, /(^|;)\s*opacity:\s*0(;|$)/, 'the row is always shown, desktop too: ' + parts.join(','));
  }
  const bar = RULES.find((r) => /#otp-flock\.as-feed \.fl-bar$/.test(r.sel));
  assert.ok(bar && /display:flex/.test(bar.body) && /flex:0 0 auto/.test(bar.body), 'the row keeps its height; the photo takes what is left');
  assert.match(bar.body, /flex-wrap:wrap/, 'the pills take their own line before they are cut short');
  /* the shared .sgw-sv rule places the star on result photos; in the row it is put back in the flow */
  assert.ok(RULES.some((r) => /\.fl-bar \.sgw-sv/.test(r.sel) && /position:static/.test(r.body)));
});

/* the card builder on its own, with the page's own esc, sgwCard and flAddBtn, so every place listing text goes in is hit:
   the title (card label, photo link), the hunt (hunt line, Because you liked, + Add to hunts), the price, the auction */
const SRC = PAGE;
function fn(name) {
  const m = new RegExp('^function ' + name + '\\(', 'm').exec(SRC);
  assert.ok(m, name);
  const nl = SRC.indexOf('\n', m.index), line = SRC.slice(m.index, nl);
  if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line;
  let d = 0;
  for (let k = SRC.indexOf('{', m.index); k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}' && !--d) return SRC.slice(m.index, k + 1); }
  throw new Error(name);
}
function build(c, inDen) {
  const dom = new JSDOM('<div id="o"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`var FP=null,SLR={},LIVE_NAME={ebay:'eBay',shopgoodwill:'ShopGoodwill'};window.prowlAff=function(u){return u};
    function svBtn(it){return '<button type="button" class="sgw-sv" data-sv="'+esc(it.url)+'" aria-pressed="false" aria-label="Save this find" title="Save find">☆</button>'}
    function lkBtn(){return '<button type="button" class="sgw-lk" aria-pressed="false">♡</button>'}
    function likeHas(){return false} function flInDen(){return ${inDen ? 'true' : 'false'}} function sgwFind(){return false} function fpHtml(){return ''}
    ` + ['esc', 'slrN', 'slrHtml', 'sgwCard', 'flAddBtn', 'flockCardHtml'].map(fn).join('\n'));
  w.C = c;
  w.document.getElementById('o').innerHTML = w.eval('flockCardHtml(C)');
  return w.document.getElementById('o').firstElementChild;
}

test('"$&" and "$\'" anywhere in the listing or the hunt are kept as typed, at every place they go in', () => {
  const T = "Lamp $' x $& y", H = "Pyrex $' and $& bowl";
  const it = { title: T, price: "$5.00", url: 'https://shopgoodwill.com/item/9', image: 'https://img.example.com/9.jpg', src: '', time_left: "1d $&", bids: 2 };
  for (const [near, inDen] of [[true, false], [true, true], [false, false]]) {
    const c = build({ it, t: H, near }, inDen);
    const q = (s) => c.querySelectorAll(s);
    assert.equal(c.getAttribute('aria-label'), T);
    assert.equal(c.getAttribute('data-h'), H);
    assert.equal(q('.sgw-card').length, 1, 'one photo link');
    assert.equal(q('.fl-media').length, 1);
    assert.equal(q('.fl-bar').length, 1);
    assert.equal(q('.fl-x').length, 1);
    assert.equal(q('.sgw-sv').length, 1);
    assert.equal(c.querySelector('.sgw-t').textContent, T);
    assert.equal(c.querySelector('.fl-for').textContent, 'for ' + H);
    assert.equal(c.querySelector('.sgw-p').getAttribute('aria-label'), 'What you would clear reselling at $5.00');
    assert.equal(c.querySelector('.fl-auc').textContent, "1d $& · 2 bids");
    if (near) assert.equal(c.querySelector('.fl-near').textContent, 'Because you liked ' + H);
    if (!inDen) {
      assert.equal(c.querySelector('.fl-add').getAttribute('data-t'), H);
      assert.equal(c.querySelector('.fl-add').getAttribute('aria-label'), 'Add ' + H + ' to your hunts');
      assert.ok(c.classList.contains('fl-row'));
    } else assert.ok(c.classList.contains('fl-lab'));
  }
});

test('the ✕ and the price are placed from the photo, which has a floor; a card that cannot fit grows instead', () => {
  const css = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (re) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] })).filter((r) => re.test(r.sel));
  assert.ok(rule(/#otp-flock\.as-feed \.fl-media$/).some((r) => /position:relative/.test(r.body)), '.fl-media is what they are placed from');
  for (const r of rule(/#otp-flock\.as-feed .*\.(fl-row|fl-lab|fl-first-new)\b.*\.(sgw-p|fl-x)\b/)) assert.fail('a card-top offset is back: ' + r.sel + '{' + r.body + '}');
  assert.ok(rule(/#otp-flock\.as-feed \.fl-card \.sgw-card img$/).some((r) => /min-height:clamp\(120px/.test(r.body)), 'the photo never collapses');
  assert.ok(rule(/#otp-flock\.as-feed \.fl-card$/).some((r) => /height:auto/.test(r.body) && /min-height:100%/.test(r.body)), 'the phone card grows past the screen rather than squeezing');
});

test('a card taller than the feed: a wheel step or ↓ shows its row first, the next step goes on to the next card', async () => {
  const p = await flock(['Roseville jardiniere', 'Pyrex Butterprint']);
  await settled(p);
  const row = p.$('#otp-flockRow');
  /* jsdom has no layout: a 200px feed of 300px cards (a short screen with larger text). The cards' layout comes from
     their place in the feed, not from the elements themselves, so a redraw that replaces them keeps it */
  let st = 0, H = 300;
  Object.defineProperty(row, 'scrollTop', { get: () => st, set: (v) => { st = v; }, configurable: true });
  Object.defineProperty(row, 'clientHeight', { get: () => 200, configurable: true });
  row.scrollTo = (o) => { st = o.top; };
  const proto = p.win.HTMLElement.prototype;
  for (const [k, at] of [['offsetTop', (i) => i * H], ['offsetHeight', () => H]]) {
    const own = Object.getOwnPropertyDescriptor(proto, k);
    Object.defineProperty(proto, k, {
      configurable: true,
      get() {
        const i = row.contains(this) ? [...row.querySelectorAll('.fl-card,.fl-note')].indexOf(this) : -1;
        return i < 0 ? own.get.call(this) : at(i);
      },
    });
  }
  const key = (k) => row.dispatchEvent(new p.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  key('ArrowDown');
  assert.equal(st, 100, 'down to the first card\'s foot, where its row is');
  key('ArrowDown');
  assert.equal(st, 300, 'then the next card');
  key('ArrowUp');
  assert.equal(st, 0, 'up: the card above, from its top');
  const wheel = (dy) => row.dispatchEvent(new p.win.WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
  wheel(60);
  assert.equal(st, 100, 'a wheel step does the same');
  await tick(260);
  wheel(60);
  assert.equal(st, 300);
  /* a card that fits moves a whole card per step, as before */
  H = 200;
  st = 0;
  key('ArrowDown');
  assert.equal(st, 200);
  key('PageDown');
  assert.equal(st, 400);
  await p.close();
});

test('in Flock on a phone the toast sits over the photo, clear of the tallest row, so Undo never takes a tap meant for the heart', () => {
  const r = RULES.find((x) => /\.scout-app-wrapper\.flock-mode #otp-toast$/.test(x.sel));
  assert.ok(r, 'a Flock toast rule');
  const m = /bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/.exec(r.body);
  assert.ok(m, r.body);
  /* the dock 70, the card's padding 14, a two-line row (two 30px pills, 6 apart) and its 8px margin, the hunt line 18 */
  assert.ok(Number(m[1]) >= 70 + 14 + 66 + 8 + 18, 'bottom ' + m[1]);
  const base = RULES.find((x) => x.sel === '.scout-app-wrapper #otp-toast' && /bottom:/.test(x.body));
  assert.match(base.body, /bottom:104px/, 'elsewhere it stays where it was');
  assert.match(CSS, /@media\(max-width:1023px\)\{\.scout-app-wrapper\.flock-mode #otp-toast\{/, 'phones only: the desktop grid has no row at the foot');
});
