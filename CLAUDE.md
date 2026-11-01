# Prowl: read this first

Several people and Claude sessions (Matt, Hark, other Claude sessions) work on this repo at once, and none of them
sees the others' conversations. The repo is the only shared memory, so:

1. **Read `docs/STATUS.md` before starting.** It says what is live, what is in flight on which branch, and which
   version numbers are taken.
2. **Update `docs/STATUS.md` in every PR** (the owner's rule: an .md every time). Move your change into "Live" or
   "In flight", bump the live versions, and drop anything you finished. `__tests__/status-doc.test.mjs` fails when
   the live versions in it don't match the code.
3. **Take the next free version number** from main *and* every open PR or branch listed in STATUS.md, write it into
   STATUS.md under "In flight" when you start, and check again just before merging: if someone merged the same
   number first, bump yours.

## The code

- `page/prowl.html`: the Prowl page, one file pasted into the Shopify page body. `PROWL_VERSION` near line 2670.
- `worker/index.js` (+ `admin.js`): the Cloudflare Worker at prowl.thebluecloud.workers.dev. `WORKER_VERSION` near the
  top, with one header comment line per version.
- Tests: `__tests__/` (page, jsdom via `__tests__/helpers/loadPage.mjs`) and `worker/__tests__/` (node:test).
- The fuller rules and history: `docs/project-instructions.md` (older parts predate the worker; the rules still hold).

## Rules that break real users if missed

- **localStorage keys never change.** New keys only; old saved data must keep loading. Backup import accepts every
  older version.
- **Page script is ES5:** `var`, `function`, string concatenation. No `let`/`const`/arrows/async/optional chaining.
- **No Liquid openers** (curly-brace-percent or double curly braces) anywhere in the page, comments included.
- **CSS stays scoped** under `.scout-app-wrapper` (and the few other scoped roots already there).
- **Shopify caps the page at 512 KB without comments.** `node scripts/slim-page.mjs page/prowl.html` prints the room
  left; record it in STATUS.md. Under ~2 KB left means trim before adding.
- **The main stylesheet and the main script are served by the worker** (v6.92 / v111 and v7.21 / v124). Both stay
  inline in the repo page (`<style id="prowl-css">`, `<script id="prowl-js">`); after changing either, run
  `node scripts/build-page-css.mjs` to rewrite `worker/page-css.js` and `worker/page-js.js` (a test fails until you
  do). Almost every page change touches the script, so run it every time, and again after merging main into your
  branch (the hash line in `worker/page-js.js` always conflicts: take either side, then rebuild). See `page/README.md`,
  Main stylesheet on the worker and Main script on the worker.
- **No member PII leaves the system** (no emails in third-party payloads such as ntfy, no PII in the admin views).
  Never commit secrets.
- **Owner-only features** check `isOwner()` in the worker (header `X-Prowl-Owner`) and `fbOwnerKey()` on the page.

## Handing things to Matt (his rule, 2026-11-01)

Anything Matt has to paste somewhere (the privacy policy, page copy, settings text, a snippet for Shopify or
Cloudflare): never send it as a download only. Publish it as a private claude.ai Artifact page that has
- a **Copy** button (clipboard, with a select-all fallback) and the full text in a box he can select by hand, and
- a **direct link** that opens the exact place it goes (e.g. Shopify privacy policy:
  `https://admin.shopify.com/store/tz7xkc-du/settings/legal`; Cloudflare worker settings: Workers & Pages › prowl ›
  Settings › Variables and Secrets),
then give him the Artifact link with two or three short steps. Update the same Artifact for a newer version rather than
making a new one when it is the same document. Never ask him to paste secrets into a chat.

## Checks and shipping

- `npm run lint` and `npm test` must be clean before a push. `npm run lint` starts with a secret scan
  (`scripts/scan-secrets.mjs`); the PR `build` check runs it too.
- Conventional Commits (`feat:`, `fix:`, `chore:`…), with the page/worker version in the title.
- Merging to main deploys both: the page by `.github/workflows/deploy-page.yml` (md5-checks the live page), the worker
  by Cloudflare Workers Builds. Never edit the live page by hand.
- **Never merge to main unless the `build` check is green on the PR's latest commit and the branch is up to date with
  main.** Merge main in first if it moved, then wait for `build` to pass again. No direct pushes to main. GitHub does
  not enforce this for us (the repo is private on the free plan, so the branch rule Matt set is saved but not
  enforced), and every merge goes live at once, so each AI holds to it by hand.
