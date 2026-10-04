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
3. Upload that zip in the Chrome Web Store developer dashboard (Package, then Upload new package) and submit for review.

A pull request that changes `extension/` without raising the version fails the check, because the Web Store rejects an upload with the same version number.
