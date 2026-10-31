// Page v8.29 (the owner's Photo Check brief): the photo check in three states. Capture (the form), analyzing (while
// /appraise is out, the form hidden, the photos kept), results (the answer, the form hidden, a way back). Any error goes
// back to the form with the message; closing mid-check and a late answer break nothing. The answer reads name, how
// sure, the fair price, then Hunt this on Prowl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const CSS = PAGE.match(/<style id="prowl-css">([\s\S]*?)<\/style>/)[1];
const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const ANSWER = { item: 'Royal Haeger 616 orange winking Egyptian cat, 1950s', fair: '$90-140', basis: 'sold', sure: 'MEDIUM', verdict: 'WORTH A LOOK',
  why: 'eBay sold $95 and $130 for the same cat.', condition: 'good, light wear', flaws: 'none visible', search: 'Royal Haeger 616 cat', left: 0, free: 1,
  looks: [{ url: 'https://www.ebay.com/itm/999', title: 'Royal Haeger cat 616', price: '$99', image: 'https://i.ebayimg.com/x.jpg' }] };
const res = (status, j) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(JSON.parse(JSON.stringify(j))), text: () => Promise.resolve(JSON.stringify(j)) });

/* appraise(): what /appraise answers, a promise; the rest of the page's fetches get nothing */
function setup(appraise) {
  const fetchImpl = (u) => /\/appraise$/.test(String(u)) ? appraise() : res(200, { items: [] });
  const beforeLoad = (win) => {
    let n = 0;
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/' + (++n);
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  return loadPage({ storage: DEN, fetchImpl, beforeLoad });
}
async function open(p) { p.$('#otp-cam').click(); await waitFor(() => p.$('#otp-photo').classList.contains('on')); }
async function addPhoto(p) {
  const k = p.$$('#otp-aprTray .apr-th').length;
  p.win.prowlPhotoFile(new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'piece.jpg', { type: 'image/jpeg' }));
  await waitFor(() => p.$$('#otp-aprTray .apr-th').length === k + 1);
}
const shown = (p, id) => !p.$(id).hidden;

test('every ID the brief lists is on the page, in the new capture / analyzing blocks', () => {
  const p = setup(() => res(200, ANSWER));
  for (const id of ['otp-photo', 'otp-photoClose', 'otp-apr', 'otp-aprT', 'otp-aprP', 'otp-aprH', 'otp-aprB', 'otp-aprF', 'otp-aprB2', 'otp-aprF2', 'otp-aprTray',
    'otp-aprRun', 'otp-aprOut', 'otp-aprRecent', 'otp-aprLeft', 'otp-photoCapture', 'otp-photoAnalyzing', 'otp-aprStatus', 'otp-aprTrayNote']) assert.ok(p.$('#' + id), id);
  assert.equal(p.$('#otp-aprF').getAttribute('capture'), 'environment');
  assert.ok(p.$('#otp-aprF2').multiple);
  assert.equal(p.$('#otp-aprOut').getAttribute('aria-live'), 'polite');
  assert.equal(p.$('#otp-photo').getAttribute('role'), 'dialog');
  assert.equal(p.$('#otp-aprT').textContent, 'At a sale? Check a photo.');
  assert.equal(p.$('#otp-photoAnalyzing .photo-analyzing-title').textContent, 'Checking this piece…');
  assert.equal(p.$('#otp-aprStatus').textContent, 'Identifying · looking up sales · estimating a fair range');
  assert.equal(p.$('#otp-aprTrayNote').textContent, 'Add up to 3 angles. A mark close-up helps a lot.');
  assert.ok(p.$('#otp-photoCapture').contains(p.$('#otp-aprB')) && p.$('#otp-photoCapture').contains(p.$('#otp-aprRun')));
  assert.ok(!p.$('#otp-photoCapture').contains(p.$('#otp-aprOut')), 'the answer is outside the form');
  return p.close();
});

test('the drawer opens on capture; Check it and the tray note wait for a photo', async () => {
  const p = setup(() => res(200, ANSWER));
  await tick(30); await open(p);
  assert.ok(shown(p, '#otp-photoCapture'));
  assert.ok(!shown(p, '#otp-photoAnalyzing'));
  assert.equal(p.$('#otp-aprRun').hidden, true, 'no Check it without a photo');
  assert.equal(p.$('#otp-aprTrayNote').hidden, true);
  assert.equal(p.$('#otp-aprB').textContent, 'Take a photo');
  await addPhoto(p);
  assert.equal(p.$('#otp-aprRun').hidden, false);
  assert.equal(p.$('#otp-aprRun').textContent, 'Check it');
  assert.equal(p.$('#otp-aprTrayNote').hidden, false);
  p.$('#otp-aprTray .apr-clr').click();
  assert.equal(p.$('#otp-aprTrayNote').hidden, true, 'Start over hides it again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('analyzing while /appraise is out (the form hidden, the photos kept); then the answer: name, price, Hunt this on Prowl in that order', async () => {
  let answer;
  const p = setup(() => new Promise((r) => { answer = r; }));
  await tick(30); await open(p);
  await addPhoto(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  assert.ok(shown(p, '#otp-photoAnalyzing'), 'analyzing');
  assert.ok(!shown(p, '#otp-photoCapture'), 'the form is hidden');
  assert.equal(p.$('#otp-photoAnalyzing').getAttribute('role'), 'status');
  assert.equal(p.$$('#otp-aprTray .apr-th').length, 2, 'the photos stay');
  answer(res(200, ANSWER));
  await waitFor(() => p.$('#otp-aprOut .apr-card'));
  assert.ok(!shown(p, '#otp-photoAnalyzing'));
  assert.ok(!shown(p, '#otp-photoCapture'));
  const card = p.$('#otp-aprOut .apr-card');
  assert.ok(card.classList.contains('apr-hero'));
  assert.equal(card.firstElementChild.tagName, 'IMG', 'the photo first');
  assert.equal(p.$$('#otp-aprOut .apr-hs .apr-ht').length, 2, 'both photos, tappable');
  p.$$('#otp-aprOut .apr-ht')[1].click();
  assert.equal(card.firstElementChild.getAttribute('src'), p.$$('#otp-aprOut .apr-ht img')[1].getAttribute('src'));
  assert.equal(p.$('#otp-aprOut .apr-nm').textContent, 'Royal Haeger 616 orange winking Egyptian cat');
  assert.equal(p.$('#otp-aprOut .apr-meta').textContent, '1950s');
  assert.equal(p.$('#otp-aprOut .apr-conf').textContent, 'Medium confidence');
  assert.equal(p.$('#otp-aprOut .apr-fv').textContent, '$90 – $140');
  assert.equal(p.$('#otp-aprOut .apr-basis').textContent, 'Based on recent sold comps');
  assert.equal(p.$('#otp-aprOut .apr-call').textContent, 'Worth a look');
  const all = p.$$('#otp-aprOut *');
  const at = (s) => all.indexOf(p.$('#otp-aprOut ' + s));
  const hunt = p.$('#otp-aprOut .apr-hunt');
  assert.equal(hunt.textContent, 'Hunt this on Prowl');
  assert.ok(at('.apr-nm') < at('.apr-conf') && at('.apr-conf') < at('.apr-fv') && at('.apr-fv') < at('.apr-hunt'), 'name, how sure, price, Hunt');
  assert.ok(at('.apr-hunt') < at('.apr-cond') && at('.apr-cond') < at('.apr-looks'), 'then condition, then the comps');
  assert.deepEqual(p.$$('#otp-aprOut .apr-cond li').map((l) => l.textContent), ['Good, light wear', 'No flaws visible']);
  assert.equal(p.$('#otp-aprLeft').textContent.indexOf('0 free photo checks left today'), 0, 'the quota line still updates');
  /* the way back */
  const again = p.$$('#otp-aprOut .apr-again button').map((b) => b.textContent);
  assert.deepEqual(again, ['Check another piece', 'Fix it and check again']);
  p.$$('#otp-aprOut .apr-again button')[1].click();
  assert.ok(shown(p, '#otp-photoCapture'), 'Fix it opens the form');
  assert.equal(p.$$('#otp-aprTray .apr-th').length, 2, 'with the photos');
  assert.equal(p.$('#otp-aprRun').textContent, 'Check again');
  assert.equal(p.doc.activeElement, p.$('#otp-aprH'));
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Check another piece empties the tray and opens the form', async () => {
  const p = setup(() => res(200, ANSWER));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  await waitFor(() => p.$('#otp-aprOut .apr-again'));
  p.$('#otp-aprOut .apr-again button').click();
  assert.ok(shown(p, '#otp-photoCapture'));
  assert.equal(p.$('#otp-aprTray').hidden, true);
  assert.equal(p.$('#otp-aprOut').children.length, 0);
  assert.equal(p.$('#otp-aprRun').hidden, true);
  await p.close();
});

test('Hunt this on Prowl fills the main search and closes the drawer', async () => {
  const p = setup(() => res(200, ANSWER));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  const hunt = await waitFor(() => p.$('#otp-aprOut .apr-hunt'));
  hunt.click();
  assert.equal(p.$('#otp-q').value, 'Royal Haeger 616 cat');
  assert.ok(!p.$('#otp-photo').classList.contains('on'), 'the drawer closes');
  await p.close();
});

for (const [status, body, msg] of [[500, { error: 'ai 500' }, /Could not check this photo right now/], [429, { error: 'daily limit' }, /used today's photo checks/], [429, { error: 'free limit', limit: 1 }, /today’s 1 free photo check/]]) {
  test('an error (' + status + ' ' + body.error + ') goes back to the form with the message, the photos kept', async () => {
    const p = setup(() => res(status, body));
    await tick(30); await open(p); await addPhoto(p);
    p.$('#otp-aprRun').click();
    await waitFor(() => !p.$('#otp-aprRun').disabled && shown(p, '#otp-photoCapture'));
    assert.ok(!shown(p, '#otp-photoAnalyzing'));
    assert.match(p.$('#otp-aprOut').textContent, msg);
    assert.ok(p.$('#otp-aprOut [role="alert"]'));
    assert.equal(p.$$('#otp-aprTray .apr-th').length, 1);
    assert.equal(p.$('#otp-aprRun').hidden, false, 'Check again is there');
    assert.deepEqual(p.errors, []);
    await p.close();
  });
}

test('no network: back to the form with the message', async () => {
  const p = setup(() => Promise.reject(new TypeError('Failed to fetch')));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  await waitFor(() => shown(p, '#otp-photoCapture') && /Could not check this photo/.test(p.$('#otp-aprOut').textContent));
  assert.ok(!shown(p, '#otp-photoAnalyzing'));
  await p.close();
});

test('closing mid-check works; the late answer lands without an error, and opening again shows it', async () => {
  let answer;
  const p = setup(() => new Promise((r) => { answer = r; }));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  assert.ok(shown(p, '#otp-photoAnalyzing'));
  p.$('#otp-photoClose').click();
  await waitFor(() => p.$('#otp-photo').hidden, { timeout: 2000 });
  await open(p);
  assert.ok(shown(p, '#otp-photoAnalyzing'), 'still checking when opened again');
  p.$('#otp-photoClose').click();
  answer(res(200, ANSWER));
  await waitFor(() => p.$('#otp-aprOut .apr-card'));
  await tick(30);
  assert.deepEqual(p.errors, []);
  await open(p);
  assert.ok(p.$('#otp-aprOut .apr-nm'), 'the answer is shown');
  assert.ok(!shown(p, '#otp-photoCapture') && !shown(p, '#otp-photoAnalyzing'));
  await p.close();
});

test('the scan line is CSS only, scoped, and still under reduced motion', () => {
  assert.match(CSS, /\.scout-app-wrapper \.photo-scan-line\{[^}]*animation:aprscan/);
  assert.match(CSS, /@keyframes aprscan\{0%,100%\{transform:translateY\(8px\)\}50%\{transform:translateY\(108px\)\}\}/);
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\.scout-app-wrapper \.photo-scan-line\{animation:none;/);
  const rules = CSS.split('\n').filter((l) => /photo-(capture|analyzing|scan)|apr-(hero|nm|conf|fair|fv|again|cond)\b/.test(l) && /\{/.test(l) && !/^@keyframes/.test(l));
  assert.ok(rules.length > 5);
  for (const r of rules) assert.match(r, /^(@media[^{]*\{)?\.scout-app-wrapper /, r);
});

test('the owner\'s mockups: an empty dashed tray until a photo is in; the header\'s back chevron only on an answer, back to the form with the photos', async () => {
  const p = setup(() => res(200, ANSWER));
  await tick(30); await open(p);
  assert.equal(p.$('#otp-aprTrayPh').hidden, false, 'Photos will appear here.');
  assert.equal(p.$('#otp-aprTrayPh').textContent.trim(), 'Photos will appear here.');
  assert.equal(p.$('#otp-photoBack').hidden, true);
  await addPhoto(p);
  assert.equal(p.$('#otp-aprTrayPh').hidden, true);
  p.$('#otp-aprRun').click();
  await waitFor(() => p.$('#otp-aprOut .apr-nm'));
  assert.equal(p.$('#otp-photoBack').hidden, false, 'the back chevron on the answer');
  assert.equal(p.$('#otp-photoBack').getAttribute('aria-label'), 'Back to the photo form');
  p.$('#otp-photoBack').click();
  assert.ok(shown(p, '#otp-photoCapture'));
  assert.equal(p.$('#otp-photoBack').hidden, true);
  assert.equal(p.$$('#otp-aprTray .apr-th').length, 1, 'the photos stay');
  assert.equal(p.$('#otp-aprRun').textContent, 'Check again');
  assert.deepEqual(p.errors, []);
  await p.close();
});

/* v8.29 review fixes */
const req = (o) => { try { return JSON.parse(o && o.body); } catch (e) { return {}; } };

test('focus follows the state: analyzing, the answer\'s heading, the back chevron to Check again, Check another piece to Take a photo', async () => {
  let answer;
  const p = setup(() => new Promise((r) => { answer = r; }));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').focus();
  p.$('#otp-aprRun').click();
  assert.equal(p.doc.activeElement, p.$('#otp-photoAnalyzing'), 'the analyzing block');
  assert.equal(p.$('#otp-photoAnalyzing').getAttribute('tabindex'), '-1');
  answer(res(200, ANSWER));
  await waitFor(() => p.$('#otp-aprOut .apr-nm'));
  assert.equal(p.doc.activeElement, p.$('#otp-aprOut .apr-nm'), 'the answer\'s heading');
  p.$('#otp-photoBack').click();
  assert.equal(p.doc.activeElement, p.$('#otp-aprRun'), 'Check again');
  await p.close();
  const q = setup(() => res(200, ANSWER));
  await tick(30); await open(q); await addPhoto(q);
  q.$('#otp-aprRun').click();
  await waitFor(() => q.$('#otp-aprOut .apr-again'));
  q.$('#otp-aprOut .apr-again button').click();
  assert.equal(q.doc.activeElement, q.$('#otp-aprB'), 'Take a photo');
  await q.close();
});

test('an error hands the focus to its alert; a late answer with the drawer closed takes no focus', async () => {
  const p = setup(() => res(500, { error: 'ai 500' }));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  const w = await waitFor(() => p.$('#otp-aprOut .apr-warn'));
  assert.equal(p.doc.activeElement, w);
  await p.close();
  let answer;
  const q = setup(() => new Promise((r) => { answer = r; }));
  await tick(30); await open(q); await addPhoto(q);
  q.$('#otp-aprRun').click();
  q.$('#otp-photoClose').click();
  const before = q.doc.activeElement;
  answer(res(200, ANSWER));
  await waitFor(() => q.$('#otp-aprOut .apr-nm'));
  assert.notEqual(q.doc.activeElement, q.$('#otp-aprOut .apr-nm'));
  assert.equal(q.doc.activeElement, before);
  await q.close();
});

test('analyzing: shown first, then its words; their own photo under the scan line', async () => {
  const p = setup(() => new Promise(() => {}));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  assert.equal(p.$('#otp-photoAnalyzing').hidden, false);
  assert.equal(p.$('#otp-aprStatus').textContent, '', 'not yet: set once it is on screen');
  await tick(100);
  assert.equal(p.$('#otp-aprStatus').textContent, 'Identifying · looking up sales · estimating a fair range');
  const img = p.$('#otp-photoAnalyzing .photo-analyzing-visual img');
  assert.ok(img);
  assert.equal(img.getAttribute('src'), p.$('#otp-aprTray .apr-th img').getAttribute('src'));
  assert.equal(img.getAttribute('alt'), '');
  assert.match(CSS, /\.scout-app-wrapper \.photo-ana-img\{[^}]*object-fit:cover/);
  await p.close();
});

test('a recent check opened while new photos wait: no Fix it, and Check another piece keeps those photos', async () => {
  const kept = [{ at: Date.now(), th: 'data:image/jpeg;base64,/9j/old', r: { item: 'McCoy owl cookie jar', fair: '$40-60', basis: 'sold', sure: 'HIGH', search: 'McCoy owl', looks: [] } }];
  const p = loadPage({ storage: Object.assign({ 'prowl.photoChecks': kept }, DEN), fetchImpl: () => res(200, { items: [] }), beforeLoad: (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/new';
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  } });
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRecent .apr-rc').click();
  assert.equal(p.$('#otp-aprOut .apr-nm').textContent, 'McCoy owl cookie jar');
  assert.equal(p.doc.activeElement, p.$('#otp-aprOut .apr-nm'));
  assert.deepEqual(p.$$('#otp-aprOut .apr-again button').map((b) => b.textContent), ['Check another piece']);
  assert.ok(!p.$$('#otp-aprOut button').some((b) => /Fix/.test(b.textContent)), 'no Fix button anywhere');
  assert.equal(p.$('#otp-aprOut .apr-lensn'), null, 'no hint pointing at Fix it');
  p.$('#otp-aprOut .apr-again button').click();
  assert.ok(shown(p, '#otp-photoCapture'));
  assert.equal(p.$$('#otp-aprTray .apr-th').length, 1, 'the waiting photo stays');
  assert.equal(p.$('#otp-aprRun').hidden, false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('leaving while the price is still coming: not shown, but kept in Your last photo checks', async () => {
  let price;
  const fetchImpl = (u, o) => {
    if (!/\/appraise$/.test(String(u))) return res(200, { items: [] });
    if (req(o).mode === 'price') return new Promise((r) => { price = r; });
    return res(200, { item: 'Hull Little Red Riding Hood cookie jar, 1940s', basis: 'estimate', sure: 'MEDIUM', condition: 'good', flaws: 'none visible', search: 'Hull Little Red Riding Hood' });
  };
  const p = loadPage({ storage: DEN, fetchImpl, beforeLoad: (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/1';
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  } });
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  await waitFor(() => p.$('#otp-aprOut .apr-fv.apr-pend') && price);
  p.$('#otp-photoBack').click();
  assert.ok(shown(p, '#otp-photoCapture'));
  price(res(200, { fair: '$150-250', basis: 'sold', why: 'eBay sold $180.', verdict: 'WORTH A LOOK' }));
  await waitFor(() => (JSON.parse(p.win.localStorage.getItem('prowl.photoChecks') || '[]')[0] || {}).r);
  const k = JSON.parse(p.win.localStorage.getItem('prowl.photoChecks'))[0].r;
  assert.equal(k.fair, '$150-250');
  assert.ok(shown(p, '#otp-photoCapture'), 'the answer did not come back over the form');
  assert.equal(p.$('#otp-aprOut .apr-nm'), null);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('Save says Saved, to a screen reader too', async () => {
  const p = setup(() => res(200, ANSWER));
  await tick(30); await open(p); await addPhoto(p);
  p.$('#otp-aprRun').click();
  const sv = await waitFor(() => p.$('#otp-aprOut .apr-sv'));
  assert.equal(sv.getAttribute('aria-label'), 'Save to your favorite hunts');
  sv.click();
  assert.equal(sv.textContent, 'Saved');
  assert.equal(sv.getAttribute('aria-label'), 'Saved to your favorite hunts');
  await p.close();
});

test('the low-confidence advice and the Lens hint name the button on screen', () => {
  assert.ok(PAGE.includes("fj.why='Not sure? Tap Fix it and check again, type the maker, and add a close-up of the mark. Or try Check with Google Lens.'"));
  assert.ok(!PAGE.includes('Type the maker or what it is above'));
  assert.ok(!PAGE.includes('Type that in Maker or words and tap Check again'));
});

test('v8.30: the empty-tray box is written the way Shopify stores it (a line break before its icon), so the deploy check matches', () => {
  /* v8.29's deploy failed its md5 check: Shopify put a line break between <div id="otp-aprTrayPh"> and its empty <i> icon */
  const src = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.ok(src.includes('<div class="apr-trayph" id="otp-aprTrayPh">\n<i class="apr-ico apr-i-img"'));
});
