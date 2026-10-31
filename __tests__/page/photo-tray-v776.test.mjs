// Page v7.76 (the owner: "when i do the photo search, the tool searches immediately, but i want to add a picture and
// then add words, or even another picture, and then hit search. or, the ai got it wrong, and i want to go back and add
// a search term or maker, and rerun"). A photo goes into a tray of up to 3; nothing is sent until Check it; after the
// answer the photos stay, and Check again sends them with the corrected words (worker v164: images[], free re-check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const DEN = { 'prowl.v36': { seen: true, hunts: [] } };
const J = (j, status) => Promise.resolve({ ok: !status || status < 400, status: status || 200, json: () => Promise.resolve(j), text: () => Promise.resolve(JSON.stringify(j)) });
function setup(answers) {
  const calls = [];
  const fetchImpl = (u, o) => {
    const url = String(u);
    if (/\/appraise$/.test(url)) {
      const body = JSON.parse(o.body); calls.push(body);
      if (body.mode === 'price') return J({ fair: '$40-60', basis: 'sold', why: 'Sold at $45 and $55.' });
      return J(answers.shift() || { item: 'Haeger console bowl', fair: '$30-50', basis: 'sold', sure: 'HIGH', search: 'Haeger bowl' });
    }
    return J({ items: [] });
  };
  let n = 0;
  const beforeLoad = (win) => {
    win.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    win.HTMLCanvasElement.prototype.toDataURL = function () { return this.width <= 480 ? 'data:image/jpeg;base64,/9j/kept' : 'data:image/jpeg;base64,/9j/' + (++n); };   /* each photo its own; v7.96's kept copy (480px) does not take a number */
    win.Image = class { constructor() { this.width = 1000; this.height = 800; } set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); } get src() { return this._src; } };
  };
  const p = loadPage({ storage: DEN, fetchImpl, beforeLoad });
  return { p, all: calls };
}
const file = (p, name) => new p.win.File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], name, { type: 'image/jpeg' });
async function add(p, name) { p.win.prowlPhotoFile(file(p, name)); await tick(40); }
const thumbs = (p) => p.$$('#otp-aprTray .apr-th img').map((i) => i.getAttribute('src'));
const checks = (all) => all.filter((b) => b.mode !== 'price');

test('a photo waits in the tray; words and more photos can be added; nothing is sent until Check it', async () => {
  const { p, all } = setup([]);
  await tick(30);
  assert.equal(p.$('#otp-aprTray').hidden, true);
  assert.equal(p.$('#otp-aprRun').hidden, true, 'no Check it before a photo');
  await add(p, 'piece.jpg');
  assert.equal(checks(all).length, 0, 'not sent');
  assert.deepEqual(thumbs(p), ['data:image/jpeg;base64,/9j/1']);
  assert.equal(p.$('#otp-aprRun').hidden, false);
  assert.equal(p.$('#otp-aprRun').textContent, 'Check it');
  assert.equal(p.$('#otp-aprB').textContent, 'Add another photo');
  assert.equal(p.$('#otp-aprTray .apr-trayn').textContent, '1 of 3 photos');   /* v8.29: the tip moved to #otp-aprTrayNote */
  assert.equal(p.$('#otp-aprTrayNote').hidden, false);
  await add(p, 'mark.jpg');
  await add(p, 'back.jpg');
  await add(p, 'fourth.jpg');
  assert.equal(thumbs(p).length, 3, 'three at most');
  assert.equal(p.$('#otp-aprB').disabled, true);
  assert.equal(p.$('#otp-aprB2').disabled, true);
  assert.equal(p.$('#otp-aprTray .apr-trayn').textContent, '3 photos: that is the most for one check.');
  p.$('#otp-aprTray [data-ti="2"]').click();
  assert.deepEqual(thumbs(p), ['data:image/jpeg;base64,/9j/1', 'data:image/jpeg;base64,/9j/2'], 'the back removed');
  assert.equal(p.$('#otp-aprTray [data-ti="0"]').getAttribute('aria-label'), 'Remove photo 1');
  assert.equal(p.$('#otp-aprB').disabled, false);
  p.$('#otp-aprH').value = 'Haeger';
  p.$('#otp-aprRun').click();
  await tick(120);
  const c = checks(all);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].images, ['data:image/jpeg;base64,/9j/1', 'data:image/jpeg;base64,/9j/2'], 'both photos, in order');
  assert.equal(c[0].hint, 'Haeger');
  assert.equal(c[0].image, undefined);
  assert.equal(c[0].mode, 'fast');
  assert.match(p.$('#otp-aprOut').textContent, /Haeger console bowl/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the AI got it wrong: fix the words, Check again sends the same photos; Start over empties the tray', async () => {
  const { p, all } = setup([{ item: 'Royal Haeger style bowl', fair: '$20-30', basis: 'sold', sure: 'MEDIUM', search: 'Haeger bowl' }, { item: 'Red Wing console bowl', fair: '$35-55', basis: 'sold', sure: 'HIGH', search: 'Red Wing bowl', again: true }]);
  await tick(30);
  await add(p, 'piece.jpg');
  p.$('#otp-aprRun').click();
  await tick(120);
  assert.equal(p.$('#otp-aprRun').textContent, 'Check again', 'the photos stay for another try');
  assert.equal(thumbs(p).length, 1);
  const fix = p.$$('#otp-aprOut button').find((b) => b.textContent === 'Wrong? Fix the maker and check again');
  assert.ok(fix, 'the way to correct it');
  fix.click();
  assert.equal(p.doc.activeElement, p.$('#otp-aprH'), 'it puts the cursor in Maker or words');
  p.$('#otp-aprH').value = 'Red Wing';
  await add(p, 'mark.jpg');
  p.$('#otp-aprRun').click();
  await tick(120);
  const c = checks(all);
  assert.equal(c.length, 2);
  assert.deepEqual(c[1].images, ['data:image/jpeg;base64,/9j/1', 'data:image/jpeg;base64,/9j/2'], 'the first photo again, with the close-up');
  assert.equal(c[1].hint, 'Red Wing');
  assert.match(p.$('#otp-aprOut').textContent, /Red Wing console bowl/);
  assert.equal(p.$('#otp-aprLeft').textContent, 'That re-check was free: the same photos can be checked again for 30 minutes.');
  p.$('#otp-aprTray .apr-clr').click();
  assert.equal(p.$('#otp-aprTray').hidden, true);
  assert.equal(p.$('#otp-aprRun').hidden, true);
  assert.equal(p.$('#otp-aprOut').textContent, '', 'the answer goes with them');
  await add(p, 'next.jpg');
  assert.equal(p.$('#otp-aprRun').textContent, 'Check it', 'a new piece starts fresh');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the labels and the markup Shopify keeps', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<span>Maker or words</span><input id="otp-aprH"'));
  assert.ok(html.includes('<input id="otp-aprF2" type="file" accept="image/*" multiple hidden>'), 'several photos from the library at once');
  assert.ok(html.includes('\n        <button class="b p apr-go" id="otp-aprRun" type="button" hidden>Check it</button>\n'), 'its own line');
  assert.doesNotMatch(html, /Wrong item\? Re-price/);
});
