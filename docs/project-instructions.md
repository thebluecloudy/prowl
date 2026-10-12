# Prowl — Project Instructions

## What this project is

Prowl is a free multi-marketplace vintage search launcher for Owl & Twig Vintage, embedded at **owlandtwigvintage.com/pages/prowl** (Shopify Page ID: `gid://shopify/Page/137091285246`, handle `prowl`, template suffix `no-title`). It is a single self-contained HTML file (inline `<style>`, markup, and `<script>`) that lives in the **Shopify page body** and is deployed via the GraphQL Admin API `pageUpdate` mutation. It searches 23 marketplaces (Goodwill, FB Marketplace, Craigslist, eBay, Etsy, Mercari, HiBid, EstateSales.net, Vinted, AbeBooks, ThriftBooks, Biblio, etc.) by opening pre-built search URLs in new tabs. All user data lives in localStorage — no backend, no account, no build step. Positioned for **collectors**, not resellers.

Any React/TypeScript/Zustand preferences in general profiles do **NOT** apply here. This is a legacy-compatible vanilla JS file. Do not convert it to TypeScript, React, modules, or introduce any framework, bundler, or npm dependency.

## Hard guardrails

### Architecture
- **One file, always.** Style + HTML + script stay in a single block in the repo. No external JS/CSS files, no CDN libraries, no import/export. The one exception is made at deploy time, not in the file: since v6.92 the deploy sends the main `<style id="prowl-css">` block as a link to the worker (`scripts/page-css.mjs`), because the body hit Shopify's 512 KB cap. Edit the CSS in the page as always, then run `node scripts/build-page-css.mjs`.
- **Vanilla JS, conservative syntax.** Match the existing style: `var`, classic `function`, string concatenation. No JSX, no async/await unless already present, no optional chaining (older mobile browsers matter for thrifters).
- **Shopify-safe.** Never emit `{ {`, `} }`, `{ %`, or `% }` (without the spaces) in code or comments — Liquid will try to parse them and break the page. Keep the duplicate-section cleanup (`document.querySelectorAll('.scout-app-wrapper')...remove()`) and the `[id$="custom_liquid_4XkmDr"]` hide rule intact.
- **Shopify sanitizer strips inline event handlers.** All handlers must use `addEventListener`. Share links need real `href` attributes, not JS-only click handlers.
- **CSS stays scoped.** All styles live under `.scout-app-wrapper`, `.scout-seo`, `.side-drawer`, etc. Never add global selectors that could bleed into the Shopify theme. Keep the theme-override resets (`appearance:none`, `text-transform:none`, list resets).
- **Theme file writes are blocked on the MAIN theme via API** — all Prowl code lives in the page body, not theme files.

### Data contract (never break)
- **localStorage keys are frozen:** `owlTwigSearches`, `owlTwigSearchLog`, `owlTwigOmniExcluded`, `owlTwigFbHub`, `owlTwigClHub`, `owlTwigDimWindow`, `owlTwigFinds`. Renaming or restructuring any of these wipes real users' saved lists. Any schema change requires a read-time migration that preserves old data.
- **Backup/restore must stay backward compatible.** `importData()` must always accept (a) a bare v1 array of terms and (b) the v2 object `{v, list, searchLog, omniExcluded, fbHub, clHub, dimWindow}`. New fields are additive with defaults; export bumps the version number.
- **Default terms only seed an empty store.** Never overwrite an existing `owlTwigSearches` with `defaultTerms`.
- **Never send an empty `body`** in a `pageUpdate` mutation — it wipes the page immediately with no undo. Always query the current body before any mutation.

### Behavior
- **Popup stagger is intentional.** Multi-tab opens use `setTimeout` at 150–200ms intervals to dodge popup blockers. Never open tabs in a tight loop.
- **No auto-fire search on page load.** Popup blockers suppress tabs opened without a user gesture. URL prefill (`?q=`, `?term=`, hash variants) populates the input; the user must tap Search.
- **Blast-open-all-tabs is the preferred UX** — the stepper/one-at-a-time paradigm was tried and reverted.
- **Omni always excludes** `ebaysold` and `owltwig` (plus user exclusions and the Books-only group). Price Check always opens the live search then eBay Sold comps.
- **Modes are mutually exclusive** (omni / multi / edit / price). `setMode()` must keep the toggle buttons, hint banners, placeholder text, drawer, and header label in sync.
- **Adding a marketplace touches all of these — treat as a checklist:** `platforms` array, `platformNames`, `platformIcons`, `contentIds`, `getBase()`, a new `.tabcontent` div with filter input + launch button + grid, `omniPresets` assignments, and (if regional) a hub bar. Miss one and grids or the drawer silently break.
- **Facebook city-slug regional sourcing is a differentiating feature.** Don't replace it with generic category URLs globally; the FB mobile app dropping the city slug is handled with a note, not by removing the feature.

### Safety & content
- **Escape all dynamic HTML.** Anything rendered from product data or user input goes through `esc()` (the page's escaper) or DOM APIs (`textContent`, `createElement`). The found-strip is the only sanctioned innerHTML render and its title is escaped — keep it that way.
- **Preserve the business layer:** the SEO section, JSON-LD schema block, Vintage Vault CTA, share buttons, Ko-fi link, and byline are revenue/discovery features, not decoration. Don't remove or reorder them without being asked.
- **`isVintageProduct()` filter list (`studioTags`)** gates what appears in the found strip. Only modify when explicitly asked; it hides non-vintage studio products from the showcase.
- **Collector positioning only.** Copy, features, and SEO frame the tool for collectors — never "how resellers use it" framing.

## Deployment workflow (every push)

1. Fetch the live page body first — backups frequently lag behind live. Check `updatedAt`, then grep for known markers.
2. Apply edits to the full body (partial updates not supported — `pageUpdate` requires the complete `body` string plus `id` every time).
3. `npm run lint`: every inline `<script>` parses, JSON-LD is valid, no Liquid openers (`scripts/check-page.mjs`), worker and extension files parse.
4. Scan for Liquid tokens — none present.
5. `npm test`: the jsdom page tests in `__tests__/` (loader `__tests__/helpers/loadPage.mjs`: `runScripts:'dangerously'`, localStorage, `window.open` capture, stubbed `fetch`/`clipboard`/`matchMedia`) plus the worker tests in `worker/__tests__/`. CI (`.github/workflows/blank.yml`) runs both on every PR.
6. Push via `pageUpdate`, verify `updatedAt` in the response.
7. SEO metafields go separately via `metafieldsSet` (`namespace: "global"`, keys `title_tag`/`description_tag`, type `single_line_text_field`, `ownerId` = page GID) — never through `pageUpdate`.

## Verification — run before delivering any change

**Syntax & structure**
- [ ] `npm run lint` and `npm test` — clean.
- [ ] No Liquid tokens anywhere in the file.
- [ ] File is one self-contained block, no external references (except the existing Shopify CDN icon and `/products.json` fetch).

**Functional smoke test** (DevTools console clean)
- [ ] Fresh load (cleared localStorage): default terms render under correct categories; Goodwill tab active.
- [ ] Each mode toggle on/off: correct hint, correct button highlight, other modes deactivate.
- [ ] Add a term, filter for it, star it (moves to ⭐ Hot List on every platform grid), Daily Prowl button appears with count, Edit mode removes it.
- [ ] Multi mode: Select All → launch button shows count → Open Selected staggers tabs → Clear resets.
- [ ] Omni: drawer ⚡ toggles change tab count in hint and header label.
- [ ] FB and Craigslist hub chips persist across reload; "All" opens multiple regions staggered.
- [ ] Price mode opens live search then eBay Sold.
- [ ] Dim window: searched term dims, Reset clears, "Off" disables.
- [ ] URL prefill populates input with pulse animation, no auto-fire. **NOT IMPLEMENTED as of v5.2 — see README.**
- [ ] Edition URLs (`?edition=records/books/toys/furniture`) apply presets, switch platform, retitle page. **NOT IMPLEMENTED as of v5.2.**

**Data round-trip**
- [ ] Export backup → clear localStorage → import: full state restores.
- [ ] Import a plain v1 JSON array (base64) — still works.
- [ ] Reload — all settings persist.

**Regression scan**
- [ ] Diff against previous version: no localStorage key names, `addEventListener`-wired function names, or element IDs changed unintentionally.
- [ ] Mobile viewport (~390px): 2-column grid intact, drawer opens/closes, no horizontal scroll.

## Key IDs & resources

| Resource | Value |
|---|---|
| Prowl page | `gid://shopify/Page/137091285246` (handle `prowl`, template `no-title`) |
| Field Guide page | `gid://shopify/Page/139125850366` |
| Vintage Vault page | `gid://shopify/Page/137164095742` |
| Blog | `gid://shopify/Blog/103504707838` (handle `news` — NOT `collector-guides`) |
| Live theme (MAIN) | `gid://shopify/OnlineStoreTheme/160661078270` ("Owl & Twig — v21 FIX RTE WRAPPER") |
| ⚠️ Do NOT edit | Theme `160487866622` (v17, UNPUBLISHED) |
| Field Guide PDF | `cdn.shopify.com/s/files/1/0807/8537/5486/files/Vintage_Collectors_Toolkit.pdf?v=1783648812` |
| Page editor | https://admin.shopify.com/store/owlandtwigvintage/pages/137091285246 |

## Working style

- Deliver changes as the **complete updated file**, not fragments.
- Call out any change affecting saved user data, popup behavior, or the marketplace list explicitly at the top of the response.
- When uncertain whether a change risks the data contract or Shopify rendering, flag it and propose the safe alternative before proceeding.
- Terse, mobile-first, approval-based workflow ("Ok go" = push immediately, no re-asking). "Ultrawork" = maximum effort and depth.
