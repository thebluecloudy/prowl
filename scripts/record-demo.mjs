// Records a scripted walk through the live Prowl page as high-resolution frames plus scene marks.
// Usage: node scripts/record-demo.mjs <outDir>   (env: DEMO_URL, CHROME, DEMO_HUNT, DEMO_GUIDE, DEMO_MOCK=1)
// Output: <outDir>/frames/*.jpg, <outDir>/frames.json, <outDir>/marks.json, <outDir>/raw.mp4 (silent, 30 fps).
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const OUT = process.argv[2] || "demo-out";
const URL_ = process.env.DEMO_URL || "https://owlandtwigvintage.com/pages/prowl";
const HUNT = process.env.DEMO_HUNT || "haeger panther";
const GUIDE = process.env.DEMO_GUIDE || "haeger panther";
const W = parseInt(process.env.DEMO_W || "1280", 10), H = parseInt(process.env.DEMO_H || "720", 10), DPR = parseFloat(process.env.DEMO_DPR || "1.5"), K = H / 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT + "/frames", { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox", "--hide-scrollbars"] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: DPR, locale: "en-US", timezoneId: "America/Detroit",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});
await ctx.addInitScript(() => {
  /* a visible cursor and click ripple, since screen frames do not include the pointer */
  window.addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.style.cssText = "position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform .02s linear";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7.5 19 2.6-7.6L21 10.8z" fill="#fff" stroke="#1b1b1b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const st = document.createElement("style");
    st.textContent = "@keyframes demoRip{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}";
    document.head.appendChild(st);
    window.addEventListener("mousemove", (e) => { c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)"; }, true);
    window.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      r.style.cssText = "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;width:46px;height:46px;border-radius:50%;border:3px solid #B0522B;z-index:2147483646;pointer-events:none;animation:demoRip .55s ease-out forwards";
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
  });
});
if (process.env.DEMO_MOCK) {
  const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  await ctx.route("**/*", (r) => {
    const u = r.request().url(), m = /workers\.dev\/([a-z]*)\?q=([^&]*)/.exec(u);
    const cors = { "access-control-allow-origin": "*" };
    if (/workers\.dev\/guide/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ guide: { subject: "haeger panther", title: "Haeger Panther: a collector's field guide", summary: "Mock summary text for the layout test that is long enough to pass validation.", glance: [{ label: "Era", value: "1940s" }], sections: [{ h: "How to recognize it", body: "Mock body text that is long enough to count as a real section for testing." }, { h: "Makers, marks and labels", body: "Mock body text that is long enough to count as a real section for testing." }, { h: "What it sells for", body: "Mock body text that is long enough to count as a real section for testing." }], related: ["haeger panther lamp"], sources: [{ title: "Mock", url: "https://example.com" }], made: "2026-10-04" }, cached: true }) });
    if (/workers\.dev\/verdict/.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ verdict: "FAIR", low: 20, high: 40, why: "mock", basis: "listings" }) });
    if (m) { const t = decodeURIComponent(m[2]).replace(/\+/g, " "), src = m[1] || "shopgoodwill"; return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ items: [0, 1, 2, 3, 4, 5].map((i) => ({ title: t + " " + src + " " + i, price: "$" + (20 + i * 9) + ".00", url: "https://www.ebay.com/itm/" + hash(t + src + i), image: "", src })) }) }); }
    if (/workers\.dev|shopify|\/search\//.test(u)) return r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: "{}" });
    return r.continue();
  });
}
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
let n = 0;
cdp.on("Page.screencastFrame", async (ev) => {
  const i = ++n, f = "frames/f" + String(i).padStart(6, "0") + ".jpg";
  writeFileSync(OUT + "/" + f, Buffer.from(ev.data, "base64"));
  frames.push({ t: ev.metadata.timestamp, f });
  try { await cdp.send("Page.screencastFrameAck", { sessionId: ev.sessionId }); } catch (e) {}
});
const marks = {}, now = () => Date.now() / 1000;
const mark = (k) => { marks[k] = now(); console.log("mark", k, marks[k].toFixed(2)); };

/* ---- helpers: human-looking motion ---- */
let mx = 640, my = 360;
async function moveTo(x, y, steps = 28) { await page.mouse.move(x, y, { steps }); mx = x; my = y; }
async function glide(sel, { click = false, dy = 0 } = {}) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox(); if (!b) throw new Error("no box for " + sel);
  await moveTo(b.x + b.width / 2, b.y + b.height / 2 + dy);
  if (click) { await sleep(180); await page.mouse.down(); await sleep(70); await page.mouse.up(); }
}
/* smooth, eased scroll of the page (or of an element) by dy over ms */
async function scrollBy(dy, ms, sel) {
  await page.evaluate(([dy, ms, sel]) => new Promise((res) => {
    const el = sel ? document.querySelector(sel) : null, get = () => (el ? el.scrollTop : window.scrollY), set = (v) => (el ? (el.scrollTop = v) : window.scrollTo(0, v));
    const s0 = get(), t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    (function f(t) { const k = Math.min(1, (t - t0) / ms); set(s0 + dy * ease(k)); if (k < 1) requestAnimationFrame(f); else res(); })(performance.now());
  }), [dy, ms, sel]);
}
async function scrollToTop(ms = 1200) { const y = await page.evaluate(() => window.scrollY); if (y > 5) await scrollBy(-y, ms); }

/* ---- go ---- */
await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("#otp-q", { timeout: 60000 });
await sleep(2500);
const intro = await page.evaluate(() => { const m = document.querySelector("#otp-ms"); return !!(m && m.classList.contains("on")); });
if (intro) { await page.click("#otp-mok"); await sleep(500); }
await moveTo(900, 420, 1);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 });
await sleep(400);

mark("home"); await sleep(9000);
/* the hunt box: type the search */
mark("type"); await glide("#otp-q", { click: true }); await sleep(500);
await page.keyboard.type(HUNT, { delay: 95 }); await sleep(2200); mark("typed");
/* why not just Google it */
mark("why"); await scrollBy(1500 * K, 6000); await glide(".whyp"); await sleep(5000);
await scrollToTop(1500); await sleep(600);
/* hunt */
mark("hunt"); await glide("#otp-sf button.p", { click: true });
const t0 = now();
while (now() - t0 < 30) { const k = await page.evaluate(() => document.querySelectorAll("#otp-res .sgw-card").length); if (k >= 8) break; await sleep(500); }
await sleep(2500); mark("results"); await sleep(5500);
const stepPx = Math.round(520 * K), steps = 9;
for (let i = 0; i < steps; i++) { await scrollBy(stepPx, 2400); await sleep(900); }
mark("blocks_end");
await scrollBy(1700 * K, 7000); await sleep(3000); mark("rows");
/* fair price on a listing */
await scrollBy(-(await page.evaluate(() => window.scrollY)), 1500); await scrollBy(1050 * K, 2200); await sleep(500);
const fp = page.locator("#otp-res .sgw-fp").first();
if (await fp.count()) {
  mark("fair"); await glide("#otp-res .sgw-fp", { click: true });
  const f0 = now();
  while (now() - f0 < 35) { if (await page.locator("#otp-res .sgw-fpr").count()) break; await sleep(500); }
  await sleep(6000); mark("fair_end");
}
/* close results */
await page.evaluate(() => { const c = [...document.querySelectorAll("#otp-res button")].find((b) => /^close$/i.test(b.textContent.trim())); c && c.click(); });
await sleep(700); await scrollToTop(900); await sleep(300);
/* alerts section on the page */
mark("alerts_home"); await scrollBy(await page.evaluate(() => document.querySelector("#otp-alerts").getBoundingClientRect().top - 90), 2600); await sleep(6500);
/* the Den: settings (plans), then local */
mark("den"); await glide("#otp-denBtn", { click: true }); await sleep(1500);
await glide("#otp-denT3", { click: true }); await sleep(1200);
mark("pricing"); await scrollBy(560 * K, 6000, "#otp-denBody"); await sleep(4500);
await scrollBy(700 * K, 6000, "#otp-denBody"); await sleep(3500);
mark("local"); await glide("#otp-denT2", { click: true }); await sleep(1500);
await scrollBy(420 * K, 6000, "#otp-denBody"); await sleep(5000); mark("local_end");
await glide("#otp-denClose", { click: true });
await sleep(800);
/* field guide */
mark("guide"); await scrollBy(await page.evaluate(() => document.querySelector("#otp-guide").getBoundingClientRect().top - 90), 2600); await sleep(800);
await glide("#otp-guideQ", { click: true }); await sleep(400);
await page.keyboard.type(GUIDE, { delay: 95 }); await sleep(900);
await glide("#otp-guideGo", { click: true });
const g0 = now();
while (now() - g0 < 100) { if (await page.locator(".gd-card").count()) break; await sleep(500); }
await sleep(1500); mark("guide_ready");
await scrollBy(await page.evaluate(() => document.querySelector(".gd-card").getBoundingClientRect().top - 70), 1800); await sleep(2500);
await scrollBy(520 * K, 7000); await sleep(2500); await scrollBy(520 * K, 7000); await sleep(2500); mark("guide_end");
await scrollToTop(1800); await sleep(2500); mark("end");

await cdp.send("Page.stopScreencast"); await sleep(500);
await browser.close();

writeFileSync(OUT + "/frames.json", JSON.stringify(frames));
writeFileSync(OUT + "/marks.json", JSON.stringify(marks, null, 1));
/* constant 30 fps video from frames shown for the time until the next frame */
const t00 = frames[0].t, lines = [];
for (let i = 0; i < frames.length; i++) { const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 0.2; lines.push("file '" + frames[i].f + "'", "duration " + d.toFixed(4)); }
lines.push("file '" + frames[frames.length - 1].f + "'");
writeFileSync(OUT + "/list.txt", lines.join("\n"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", OUT + "/list.txt", "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-movflags", "+faststart", OUT + "/raw.mp4"], { stdio: "inherit" });
const rel = {}; for (const k in marks) rel[k] = +(marks[k] - t00).toFixed(2);
writeFileSync(OUT + "/marks_rel.json", JSON.stringify(rel, null, 1));
console.log("marks (seconds into raw.mp4):", JSON.stringify(rel));
