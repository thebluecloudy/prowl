# Prowl by Owl & Twig: Chrome extension

Toolbar search, right-click search and the `prowl` address-bar keyword for the Prowl marketplace search. A bonus for Prowl Pro members.

- `manifest.json`: version, permissions. The version here is the extension's version.
- `sites.js`: marketplace links and live sources. Keep it in step with `page/prowl.html` when a marketplace is added.
- `member.js` / `content.js`: Pro check (sign-in comes from the Prowl page).
- `popup.*`, `service-worker.js`: the interface.
- Store listing text: `docs/chrome-store-listing.md`. Changes: `CHANGELOG.md`.

## Releasing a new version
1. Change the code, bump `version` in `manifest.json` (e.g. 1.3.0 to 1.3.1) and add a line to `CHANGELOG.md`.
2. Merge to `main`. The `Extension` workflow builds `prowl-extension-X.Y.Z.zip` and publishes a GitHub release `ext-vX.Y.Z` with the zip attached.
3. Upload that zip in the Chrome Web Store developer dashboard (Package, then Upload new package) and submit for review. Once the four secrets below are set, the workflow does this step itself.

A pull request that changes `extension/` without raising the version fails the check, because the Web Store rejects an upload with the same version number.

## Publishing to the Chrome Web Store from GitHub (optional)
The `Extension` workflow can upload the zip and submit it for review on its own. It does this once all four repository
secrets exist (GitHub › Settings › Secrets and variables › Actions). Until then it prints a notice and you upload by hand.

| Secret | What it is |
|---|---|
| `CWS_EXTENSION_ID` | The item ID, the 32-letter ID in the extension's Web Store and developer dashboard URL |
| `CWS_CLIENT_ID` | An OAuth client ID from Google Cloud |
| `CWS_CLIENT_SECRET` | That OAuth client's secret |
| `CWS_REFRESH_TOKEN` | A refresh token for the Chrome Web Store API scope |

How to get them:
1. **Turn on the API.** In Google Cloud (any project, the Prowl one is fine), APIs & Services › Library: enable the
   **Chrome Web Store API**.
2. **Make an OAuth client.**
   - APIs & Services › OAuth consent screen: External; add yourself as a test user, with the account that owns the
     extension.
   - Credentials › Create credentials › OAuth client ID › **Desktop app**.
   - Its client ID and secret are `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET`.
3. **Get a refresh token** (once, on your own computer).
   - Open
     `https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent&redirect_uri=http://localhost&client_id=YOUR_CLIENT_ID`.
   - Approve it, then copy the `code=` value from the address it sends you to. The page itself will not load; that is
     expected.
   - Exchange the code with:
     `curl https://oauth2.googleapis.com/token -d client_id=... -d client_secret=... -d code=... -d grant_type=authorization_code -d redirect_uri=http://localhost`.
   - The answer's `refresh_token` is `CWS_REFRESH_TOKEN`.
   - Put these values only into GitHub secrets, never into a file, chat or commit (`npm run lint` and CI scan for
     secrets).

The workflow never prints them. If Google refuses the refresh token (it expires after 7 days while the consent screen
is in Testing), make a new one, or publish the consent screen so the token lasts.
