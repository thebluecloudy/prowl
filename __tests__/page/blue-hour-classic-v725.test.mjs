// Page v7.25: the Classic look has its own Blue hour. Before, Classic's dark (labelled Blue hour) and Midnight were the
// same near-black, so the four modes showed as three. The settings and help text name all four.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../page/prowl.html', import.meta.url), 'utf8');
const CSS = PAGE.slice(PAGE.indexOf('<style id="prowl-css">'), PAGE.indexOf('</style>', PAGE.indexOf('<style id="prowl-css">')));

test('Classic Blue hour is navy, and Midnight is left alone', () => {
  const m = /\[data-theme=dark\]:not\(\[data-dark=midnight\]\) \.scout-app-wrapper:not\(\.k2\)\{([^}]*)\}/.exec(CSS);
  assert.ok(m, 'a Classic Blue hour rule in the served stylesheet');
  assert.match(m[1], /--bg:#0B1430/);
  assert.match(m[1], /--cd:#12204A/);
  assert.match(m[1], /background-color:#0B1430/);
  assert.match(CSS, /\[data-theme=dark\]\{color-scheme:dark;\s*--bg:#070706/, 'Midnight keeps the near-black');
});

test('the theme copy names all the modes (five since v8.04 Cockpit)', () => {
  assert.match(PAGE, /Light, Blue hour, Midnight, Uranium \(a retro blacklight mode\) or Cockpit \(red night lighting\)\. Cycles through all five\./);
  assert.match(PAGE, /cycles Light, Blue hour, Midnight, <b[^>]*>Uranium<\/b>, a retro blacklight mode, and <b[^>]*>Cockpit<\/b>, red night lighting\./);
  assert.doesNotMatch(PAGE, /Cycles through all three/);
});
