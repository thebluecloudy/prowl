// Page v8.07 (Matt, 2026-10-28, security and trust plan: "Privacy policy and contact/about page, linked from the Den
// ABOUT tab: who runs Prowl, where, and how to reach a human"): About names a person to write to and links the privacy
// policy; the footer line under every screen links Privacy and Contact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadPage, tick } from '../helpers/loadPage.mjs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');

test('Den About says who runs Prowl, how to reach a person and where the privacy policy is', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const help = p.$('.ab-help');
  assert.ok(help, 'the About line is there');
  assert.match(p.$('.ab-lead').textContent, /Owl & Twig Vintage, a family shop in Michigan/);
  const hrefs = [...help.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, ['mailto:hello@owlandtwigvintage.com', '/pages/contact', '/policies/privacy-policy']);
  assert.match(help.textContent, /a person writes back/);
  assert.match(help.textContent, /data deleted/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the footer links Privacy and Contact next to the affiliate line', async () => {
  const p = loadPage({ storage: { 'prowl.v36': { seen: true, hunts: [] } } });
  await tick(30);
  const c = p.$('.copyr');
  assert.match(c.textContent, /small commission/);
  assert.deepEqual([...c.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]), [['Privacy', '/policies/privacy-policy'], ['Contact', '/pages/contact']]);
  await p.close();
});

test('no trust seals or "secure" badges', () => {
  assert.doesNotMatch(PAGE, /trust seal|ssl secured|100% secure|verified secure|norton|mcafee/i);
});
