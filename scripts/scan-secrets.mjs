#!/usr/bin/env node
/* Secret scan (CI and `npm run lint`): fails when a tracked file holds something shaped like a real credential.
   Prowl's secrets live only in Cloudflare and GitHub (CLAUDE.md: "Never commit secrets"); this catches a slip before
   it is merged. No dependencies. Usage: node scripts/scan-secrets.mjs [file ...]  (no files = every tracked file, and new ones not yet added,
   so `npm run lint` catches a secret before it is ever committed; .gitignore'd files are skipped).
   A match prints the file, the line and the kind, never the value. */
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* Each kind of credential, by its published shape. Names and assignments alone never match: a value has to be there. */
export const RULES = [
  { kind: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: "Google OAuth client secret", re: /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/g },
  { kind: "Shopify token", re: /\bshp(?:at|ss|ca|pa)_[0-9a-fA-F]{32}\b/g },
  { kind: "Stripe live key", re: /\b[sr]k_live_[0-9A-Za-z]{20,}\b/g },
  { kind: "Resend API key", re: /\bre_[0-9A-Za-z]{8}_[0-9A-Za-z]{16,}\b/g },
  { kind: "GitHub token", re: /\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})\b/g },
  { kind: "Slack token", re: /\bxox[abpr]-[0-9A-Za-z-]{10,}\b/g },
  { kind: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "Private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY( BLOCK)?-----/g },
  { kind: "SerpApi key", re: /\bapi_key=[0-9a-f]{64}\b/g },
  { kind: "Cloudflare API token", re: /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[0-9A-Za-z_-]{40}\b/g },
  { kind: "Bearer token", re: /\bBearer\s+eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/g },
];
/* Never scanned: generated bundles that repeat the repo's own sources, and binary files. */
const SKIP = [/^node_modules\//, /\.(png|jpe?g|gif|webp|ico|zip|woff2?|pdf|mp4)$/i, /^package-lock\.json$/];
const MAX_BYTES = 4 * 1024 * 1024;

export function scanText(text, file) {
  const out = [], lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const r of RULES) {
      r.re.lastIndex = 0;
      if (r.re.test(lines[i])) out.push({ file, line: i + 1, kind: r.kind });
    }
  }
  return out;
}

function tracked() {
  try { return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean); }
  catch (e) { console.error("scan-secrets: git ls-files failed; pass files instead"); process.exit(2); }
}

export function scanFiles(files) {
  const found = [];
  for (const f of files) {
    if (SKIP.some((re) => re.test(f))) continue;
    let st; try { st = statSync(f); } catch (e) { continue; }   /* deleted in the working tree */
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const buf = readFileSync(f);
    if (buf.includes(0)) continue;   /* binary */
    found.push(...scanText(buf.toString("utf8"), f));
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {   /* run directly, not imported by a test */
  const files = process.argv.length > 2 ? process.argv.slice(2) : tracked();
  const found = scanFiles(files);
  if (found.length) {
    for (const x of found) console.error("::error file=" + x.file + ",line=" + x.line + "::" + x.kind + " in " + x.file + ":" + x.line + ". Remove it, rotate it, and keep it in Cloudflare or GitHub secrets.");
    console.error("scan-secrets: " + found.length + " possible secret" + (found.length === 1 ? "" : "s") + " found");
    process.exit(1);
  }
  console.log("scan-secrets: " + files.length + " files, no secrets found");
}
