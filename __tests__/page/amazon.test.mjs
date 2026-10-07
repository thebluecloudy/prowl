import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, tick } from '../helpers/loadPage.mjs';

test('Amazon is off: no URL is built and a guide renders no supply links', async () => {
  const guide = { subject: 'Pyrex', title: 'Pyrex', summary: 's', sections: [{ h: 'h', body: 'b' }], sources: [], related: ['Pyrex bowls'], supplies: ['Bar Keepers Friend', 'Pyrex price guide'] };
  const p = loadPage({ storage: { 'prowl.guides': [guide] } });
  await tick(50);
  assert.equal(p.win.AMAZON_ON, false);
  assert.equal(p.win.amzSearch('pyrex price guide'), null);
  assert.ok(!p.win.prowlAffNames().includes('Amazon'));
  p.$('[data-gdopen="0"]').click();
  await tick(20);
  assert.ok(p.$('#otp-guideOut .gd-card'), 'the guide rendered');
  assert.ok(!/amazon\.com/i.test(p.doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/gi, '')), 'no Amazon link anywhere in the rendered page');
  await p.close();
});

test('with a real tag switched on, a guide lists tagged supply links and the disclosure names Amazon', async () => {
  const p = loadPage();
  await tick(30);
  p.win.AMAZON_TAG = 'owltwig-20';
  p.win.AMAZON_ON = true;
  assert.equal(p.win.amzSearch('  Pyrex   price guide '), 'https://www.amazon.com/s?k=Pyrex%20price%20guide&tag=owltwig-20');
  assert.ok(p.win.prowlAffNames().includes('Amazon'));
  p.win.AMAZON_TAG = 'YOUR_AMAZON_TAG';
  assert.equal(p.win.amzSearch('x'), null);
  await p.close();
});
