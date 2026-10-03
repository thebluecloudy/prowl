// Prowl page deploy: sends page/prowl.html to the Shopify page body, then checks it landed.
// Runs in GitHub Actions. Needs SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (Dev Dashboard app,
// scopes read_online_store_pages + write_online_store_pages, installed on the store).
// Never prints the secret or the token.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const SHOP = process.env.SHOPIFY_SHOP || "tz7xkc-du.myshopify.com";
export const PAGE_ID = "gid://shopify/Page/137091285246";
export const API = "2026-07";
export const MIN_BYTES = 200000;      // the real page is ~350 KB; anything this small is a broken file
export const MIN_RATIO = 0.7;         // refuse to replace the live page with something much smaller

const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const trimEnd = (s) => s.replace(/\s+$/, "");

export function checkBody(body) {
  const errs = [];
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes < MIN_BYTES) errs.push("file is only " + bytes + " bytes (minimum " + MIN_BYTES + ")");
  if (body.indexOf("{{") !== -1) errs.push("file contains {{ (Shopify would read it as Liquid)");
  if (body.indexOf("{%") !== -1) errs.push("file contains {% (Shopify would read it as Liquid)");
  if (body.indexOf("scout-app-wrapper") === -1) errs.push("file has no scout-app-wrapper, so it is not the Prowl page");
  if (body.indexOf("<script") === -1) errs.push("file has no <script>");
  return errs;
}

export async function getToken(fetchFn, id, secret) {
  const r = await fetchFn("https://" + SHOP + "/admin/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }).toString(),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok || !j || !j.access_token) throw new Error("token request failed (" + r.status + "): " + ((j && (j.error_description || j.error)) || txt.slice(0, 200)));
  return j.access_token;
}

export async function gql(fetchFn, token, query, variables) {
  const r = await fetchFn("https://" + SHOP + "/admin/api/" + API + "/graphql.json", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok || !j) throw new Error("Shopify API " + r.status + ": " + txt.slice(0, 300));
  if (j.errors && j.errors.length) throw new Error("Shopify API error: " + j.errors.map((e) => e.message).join("; "));
  return j.data;
}

const READ = "query P($id: ID!) { page(id: $id) { id updatedAt body } }";
const WRITE = "mutation U($id: ID!, $body: String!) { pageUpdate(id: $id, page: { body: $body }) { page { id updatedAt } userErrors { field message } } }";

export async function deploy({ fetchFn, file, id, secret, force, backupDir, log }) {
  const raw = readFileSync(file, "utf8");
  const body = trimEnd(raw);
  const errs = checkBody(body);
  if (errs.length) throw new Error("Refusing to deploy:\n- " + errs.join("\n- "));
  const want = md5(body);
  log("File: " + Buffer.byteLength(body, "utf8") + " bytes, md5 " + want);

  const token = await getToken(fetchFn, id, secret);
  const before = (await gql(fetchFn, token, READ, { id: PAGE_ID })).page;
  if (!before || typeof before.body !== "string") throw new Error("could not read the live page");
  const liveBody = trimEnd(before.body);
  const liveBytes = Buffer.byteLength(liveBody, "utf8");
  log("Live: " + liveBytes + " bytes, md5 " + md5(liveBody) + ", updatedAt " + before.updatedAt);

  mkdirSync(backupDir, { recursive: true });
  writeFileSync(backupDir + "/live-before.html", before.body);
  writeFileSync(backupDir + "/live-before.json", JSON.stringify({ updatedAt: before.updatedAt, md5: md5(liveBody), bytes: liveBytes }, null, 2));

  if (md5(liveBody) === want) { log("Live page already matches the file. Nothing sent."); return { status: "same", md5: want }; }
  if (!force && Buffer.byteLength(body, "utf8") < liveBytes * MIN_RATIO) {
    throw new Error("Refusing to deploy: the file is less than " + Math.round(MIN_RATIO * 100) + "% of the live page size. Run the workflow by hand with force on if this is intended.");
  }

  const res = (await gql(fetchFn, token, WRITE, { id: PAGE_ID, body })).pageUpdate;
  if (!res || (res.userErrors && res.userErrors.length)) throw new Error("pageUpdate refused: " + JSON.stringify(res && res.userErrors));
  log("Sent. Shopify updatedAt " + res.page.updatedAt);

  const after = (await gql(fetchFn, token, READ, { id: PAGE_ID })).page;
  const got = md5(trimEnd(after.body || ""));
  if (got !== want) throw new Error("Live page does not match after the update (live md5 " + got + ", file md5 " + want + "). The previous body is in the backup artifact.");
  log("Verified: live page md5 " + got + " matches the file.");
  return { status: "updated", md5: want, updatedAt: after.updatedAt, previous: before.updatedAt };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const lines = [];
  const log = (s) => { console.log(s); lines.push(s); };
  const id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (!id || !secret) { console.error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET must be set as repository secrets."); process.exit(1); }
  deploy({ fetchFn: fetch, file: process.argv[2] || "page/prowl.html", id, secret, force: process.env.FORCE === "true", backupDir: "backup", log })
    .then((r) => { if (summary) appendFileSync(summary, "### Prowl page deploy: " + r.status + "\n\n" + lines.map((l) => "- " + l).join("\n") + "\n"); })
    .catch((e) => { console.error(e.message); if (summary) appendFileSync(summary, "### Prowl page deploy FAILED\n\n" + lines.map((l) => "- " + l).join("\n") + "\n\n**" + e.message + "**\n"); process.exit(1); });
}
