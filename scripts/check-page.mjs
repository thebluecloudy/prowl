// Static checks for the single-file Prowl page: every inline script parses,
// JSON-LD blocks are valid JSON, and no Liquid openers made it into the body
// (Shopify would try to render them). Same Liquid rule as scripts/deploy-page.mjs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || 'page/prowl.html';
const html = readFileSync(file, 'utf8');
let bad = 0, n = 0;
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
for (let m; (m = re.exec(html)); ) {
  const attrs = m[1] || '';
  if (/type\s*=\s*["']?application\/ld\+json/i.test(attrs)) {
    try { JSON.parse(m[2]); } catch (e) { bad++; console.error(`JSON-LD block: ${e.message}`); }
    continue;
  }
  if (/\ssrc\s*=/.test(attrs)) continue;
  n++;
  try { new vm.Script(m[2], { filename: `${file}#script${n}` }); }
  catch (e) { bad++; console.error(`script ${n}: ${e.message}`); }
}
for (const tok of ['{{', '{%']) {
  const i = html.indexOf(tok);
  if (i > -1) { bad++; console.error(`Liquid opener ${tok} at char ${i}: ${JSON.stringify(html.slice(Math.max(0, i - 40), i + 40))}`); }
}
/* Shopify lower-cases attribute names when it saves the page (viewBox becomes viewbox), so a mixed-case name in the
   markup makes the live page differ from the file and the deploy's check after sending fails. Browsers read the
   lower-case name the same way, so the markup is written lower-case. Script and style contents are left alone. */
{
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m, t) => '<' + t + '></' + t + '>');
  for (const tag of markup.match(/<[a-zA-Z][^>]*>/g) || []) {
    const names = tag.replace(/"[^"]*"|'[^']*'/g, '""').match(/\s[A-Za-z_:][-A-Za-z0-9_:.]*(?=\s*=)/g) || [];
    for (const nm of names) if (/[A-Z]/.test(nm)) { bad++; console.error(`mixed-case attribute${nm} (Shopify saves it lower-case; write it lower-case): ${tag.slice(0, 80)}`); }
  }
}
console.log(`${file}: ${n} scripts checked, ${bad ? bad + ' problem(s)' : 'clean'}`);
process.exit(bad ? 1 : 0);
