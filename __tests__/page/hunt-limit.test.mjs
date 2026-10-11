// Page v6.83/v6.84: the Den keeps 5 hunts of your own on Free and up to 100 with Prowl Pro. The sample hunts do not
// count, nothing already saved is removed, and every way of adding a hunt (Den box, home "+ add a hunt", Flock's
// "+ Add to hunts", the Photo screen) asks first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const OWN = ['catalin bracelet', 'rookwood vase', 'pyrex snowflake', 'hull bow knot', 'roseville pinecone'];
const hunts = (p) => JSON.parse(p.win.localStorage.getItem('prowl.v36')).hunts;
async function den(storage) {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [...OWN] }, ...storage } });
  await tick(60);
  p.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  return p;
}
function addInDen(p, v) { p.$('#otp-newTerm').value = v; p.$('#otp-addTerm').click(); }

test('Free: a 6th hunt of your own is turned away with the reason and the way to Pro; the 5 stay', async () => {
  const p = await den({});
  addInDen(p, 'fiesta pitcher');
  assert.deepEqual(hunts(p), OWN, 'nothing added');
  assert.match(p.$('#otp-toast').textContent, /Your Den holds 5 hunts on Free\. Remove one to add fiesta pitcher, or Prowl Pro holds up to 100/);
  /* remove one and there is room again */
  p.$$('#otp-denList li').find((li) => /rookwood vase/.test(li.textContent)).querySelector('.rm').click();
  await tick(20);
  assert.deepEqual(hunts(p), OWN.filter((h) => h !== 'rookwood vase'));
  addInDen(p, 'fiesta pitcher');
  assert.ok(hunts(p).includes('fiesta pitcher'), 'room after removing one');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the starter samples do not count, and a hunt already saved can always be locked again', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: ['Pyrex Butterprint', 'Fire-King jadeite', 'McCoy pottery', 'Hull pottery', ...OWN.slice(0, 4)] } } });
  await tick(60);
  assert.equal(p.win.prowlAddHunt('roseville pinecone'), true, 'the 5th of your own goes in');
  assert.equal(p.win.prowlAddHunt('fiesta pitcher'), false, 'the 6th does not');
  assert.equal(p.win.prowlAddHunt('McCoy pottery'), true, 'one already in the Den is just locked');
  assert.equal(p.win.prowlAddHunt('Blenko glass'), true, 'a starter sample is not one of your own');
  assert.ok(!hunts(p).includes('fiesta pitcher'));
  await p.close();
});

test('Prowl Pro (and the owner) keeps up to 100; a Den already over the Free limit keeps every hunt', async () => {
  const p = await den({ 'prowl.alertPro': '1', 'prowl.alertTok': 'tok-0123456789abcdef' });
  addInDen(p, 'fiesta pitcher');
  assert.ok(hunts(p).includes('fiesta pitcher'), 'Pro adds a 6th');
  await p.close();
  const many = Array.from({ length: 9 }, (_, i) => 'hunt ' + i);
  const q = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: many } } });
  await tick(60);
  assert.equal(q.win.prowlAddHunt('one more'), false);
  q.$('#otp-dock .db[data-m="den"]').click();
  await tick(30);
  assert.deepEqual(q.$$('#otp-denList .tt').map((x) => x.firstChild.textContent), many, 'all 9 saved hunts stay in the Den');
  await q.close();
});

test('the plan table, FAQ and its structured data say the same limits', () => {
  const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
  assert.match(PAGE, /\['Hunts saved in your Den',HUNTS_FREE\+' of your own','Up to '\+HUNTS_PRO\]/);
  assert.match(PAGE, /var HUNTS_FREE=5,HUNTS_PRO=100;/);
  const faq = 'Your Den keeps 5 hunts of your own for free, or up to 100 with Prowl Pro.';
  assert.equal(PAGE.split(faq).length - 1, 2, 'in the visible FAQ and in the FAQPage JSON-LD');
});
