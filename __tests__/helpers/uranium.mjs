// Page v8.04: Uranium's colours are variables (--u-rgb, --u-hi, ...) so Cockpit can recolour its layout. Tests that read
// Uranium's rules as text resolve them back: resolveU(page) gives Uranium's green, resolveU(page, 'cockpit') the red.
export function uVars(page, hud) {
  const root = /:root\{(--u-rgb:[^}]*)\}/.exec(page);
  if (!root) throw new Error('no :root --u- defaults');
  const out = {};
  const take = (body) => { for (const m of body.matchAll(/(--u-[a-z0-9]+):([^;}]+)/g)) out[m[1]] = m[2].trim(); };
  take(root[1]);
  if (hud) {
    const h = new RegExp('\\[data-theme=uranium\\]\\[data-hud=' + hud + '\\]\\{([^}]*)\\}').exec(page);
    if (!h) throw new Error('no ' + hud + ' block');
    take(h[1]);
  }
  return out;
}
export function resolveU(page, hud) {
  const v = uVars(page, hud);
  return page.replace(/var\((--u-[a-z0-9]+)\)/g, (m, k) => (k in v ? v[k] : m));
}
