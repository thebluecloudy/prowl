// Page v7.19 (Matt, 2026-10-18): Pounce without a form ("why can't it just find the items?") and with a price range
// (worker v122), an ended listing offers to watch for the next one, and a Pounce note opens the find itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';
import { waitFor } from '../helpers/flockFixture.mjs';

const HUNT = 'Padilla';
const SIGNED = { 'prowl.alertTok': 'tok-0123456789abcdef', 'prowl.alertEmail': 'a@b.co' };
const MATCH = { hunt: 'padilla', title: 'Padilla studio pottery vase', price: '$85', url: 'https://www.ebay.com/itm/234567890123', image: 'https://i.ebayimg.com/2.jpg', match: 'yes', p: 0.9, reason: 'Signed Padilla studio vase.', at: '2026-10-18T01:00:00.000Z' };

function worker(calls, quarries, matches) {
  return (u, o) => {
    const url = String(u), body = (o && o.body) || '';
    calls.push({ url, body });
    if (/alerts\/status/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ on: true, email: 'a@b.co', hunts: [HUNT], pro: false, free: 3, quarries, quarryMax: 1, quarryMatches: matches || [], push: null }) });
    if (/alerts\/quarry/.test(url)) {
      const b = JSON.parse(body);
      if (!b.notUrl) quarries = { padilla: { spec: b.spec, any: b.spec ? 0 : 1, lo: b.lo || 0, hi: b.hi || 0, avoid: [], min: 0, max: 0, photo: '', maybe: 0 } };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, quarries, max: 1, matches: matches || [] }) });
    }
    if (/\/item\?/.test(url)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ src: 'ebay', title: MATCH.title, price: MATCH.price, images: [MATCH.image], url: MATCH.url }) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
  };
}
const storage = (extra) => Object.assign({ 'prowl.v36': { seen: true, hunts: [HUNT], lock: [0] }, owlTwigSgwTerms: [] }, SIGNED, extra || {});
async function pounceBox(p) {
  await tick(1500);
  p.$('#otp-acct').click();
  await tick(80);
  return p.$('#otp-denSettings .pnc');
}
const quarryPosts = (calls) => calls.filter((c) => /alerts\/quarry/.test(c.url)).map((c) => JSON.parse(c.body));

test('one tap on Pounce watches a hunt with no form to fill', async () => {
  const calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls, {}) });
  const sec = await pounceBox(p);
  const quick = sec.querySelector('[data-pnc="quick"]');
  assert.ok(quick, 'a Pounce button on the hunt');
  assert.ok(sec.querySelector('[data-pnc="edit"]'), 'Describe it is still there');
  quick.click();
  await tick(60);
  const sent = quarryPosts(calls);
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].hunt, sent[0].spec, sent[0].any], ['padilla', '', 1]);
  const box = p.$('#otp-denSettings .pnc');
  assert.match(box.textContent, /Any Padilla it finds/);
  assert.match(box.textContent, /Pounce is watching every new listing for this hunt\./);
  assert.ok(box.querySelector('[data-pnc="edit"]'), 'Edit to narrow it');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a quarry can carry a price range, with or without words', async () => {
  const calls = [];
  const p = loadPage({ storage: storage(), fetchImpl: worker(calls, { padilla: { spec: '', any: 1, lo: 0, hi: 0, avoid: [], min: 0, max: 0, photo: '', maybe: 0 } }) });
  const sec = await pounceBox(p);
  sec.querySelector('[data-pnc="edit"]').click();
  await tick(30);
  const set = (k, v) => { const i = p.$(`#otp-denSettings [data-pk="${k}"]`); i.value = v; i.dispatchEvent(new p.win.Event('input', { bubbles: true })); };
  assert.ok(p.$('#otp-denSettings [data-pk="lo"]') && p.$('#otp-denSettings [data-pk="hi"]'), 'Min price and Max price boxes');
  set('lo', '40');
  set('hi', '300');
  p.$('#otp-denSettings [data-pnc="save"]').click();
  await tick(60);
  const b = quarryPosts(calls)[0];
  assert.deepEqual([b.spec, b.any, b.lo, b.hi], ['', 1, 40, 300]);
  assert.match(p.$('#otp-denSettings .pnc').textContent, /Any Padilla it finds · \$40 to \$300/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('an ended listing: Watch for the next one makes the cleaned title a favorite hunt', async () => {
  const calls = [];
  const fetchImpl = (u, o) => /\/item\?/.test(String(u))
    ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ src: 'ebay', title: 'Vintage Viking Glass Epic Swung Vase Persimmon', price: '$130.00', images: ['https://i.ebayimg.com/v.jpg'], url: 'https://www.ebay.com/itm/987654321098', gone: true }) })
    : worker(calls, {})(u, o);
  const p = loadPage({ fetchImpl, storage: { 'prowl.v36': { seen: true, hunts: ['catalin bracelet'] }, 'prowl.finds': [{ title: 'Viking swung vase', price: '$130.00', url: 'https://www.ebay.com/itm/987654321098', image: 'https://i.ebayimg.com/v.jpg', src: 'ebay', hunt: 'viking', at: 1 }], ...SIGNED } });
  await tick(40);
  p.$('#otp-dock .db[data-m="flock"]').click();
  p.$('#otp-flock .fl-seg [data-fv="saved"]').click();
  await waitFor(() => p.$('#otp-flockRow .fl-card .sgw-card img'));
  p.$('#otp-flockRow .fl-card .sgw-card img').dispatchEvent(new p.win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitFor(() => p.$('#otp-sheetB [data-ppwatch]'));
  assert.match(p.$('#otp-sheetB .pp-end').textContent, /This one got away\./);
  p.$('#otp-sheetB [data-ppwatch]').click();
  const hunts = JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts;
  const added = hunts.find((h) => /viking/i.test(h) && /swung vase/i.test(h));
  assert.ok(added, 'the cleaned title is a hunt now: ' + hunts.join(' | '));
  assert.doesNotMatch(added, /vintage/i, 'cleaned like Search this on Prowl');
  const btn = p.$('#otp-sheetB [data-ppwatch]');
  assert.equal(btn.disabled, true);
  assert.match(btn.textContent, /Watching for it/);
  assert.match(p.$('#otp-toast').textContent, /Watching for .*Prowl email/);
  btn.click();
  assert.equal(JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts.length, hunts.length, 'a second tap adds nothing');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('a Pounce note opens the find in the popup with its hunt, reason and Not it', async () => {
  const calls = [];
  const p = loadPage({
    url: 'https://www.owlandtwigvintage.com/pages/prowl?pounce=' + encodeURIComponent(MATCH.url),
    storage: storage(),
    fetchImpl: worker(calls, { padilla: { spec: '', any: 1, avoid: [], min: 0, max: 0, lo: 0, hi: 0, photo: '', maybe: 0 } }, [MATCH]),
  });
  await waitFor(() => p.$('#otp-sheetB .pp-pnc'), { timeout: 12000 });
  assert.equal(p.$('#otp-sheetB .pp-t').textContent, MATCH.title);
  const badge = p.$('#otp-sheetB .pp-pnc');
  assert.match(badge.textContent, /Pounce match for padilla/);
  assert.match(badge.textContent, /Signed Padilla studio vase\./);
  badge.querySelector('[data-ppnot]').click();
  await tick(60);
  const not = quarryPosts(calls).find((b) => b.notUrl);
  assert.deepEqual([not.hunt, not.notUrl], ['padilla', MATCH.url]);
  assert.match(p.$('#otp-sheetB .pp-pnc').textContent, /Marked not it\./);
  assert.deepEqual(p.errors, []);
  await p.close();
});
