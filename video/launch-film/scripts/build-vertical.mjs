// Writes the vertical cut (1080x1920) as its own HyperFrames project, ../launch-film-vertical, from this project's
// index.html (1920x1080), so both cuts share one source: the same story, panther, timing and soundtrack. Only the
// frame size and the layout table (LAYOUT in index.html) differ. assets/ and timing.js are symlinks back here.
// Edit index.html, then run:  node scripts/build-vertical.mjs
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = fs.readFileSync(join(root, "index.html"), "utf8");

const swaps = [
  ['<meta name="viewport" content="width=1920, height=1080" />', '<meta name="viewport" content="width=1080, height=1920" />'],
  ["<title>Prowl launch film</title>", "<title>Prowl launch film (vertical)</title>"],
  ['data-width="1920" data-height="1080"', 'data-width="1080" data-height="1920"'],
  ['<script src="timing.js"></script>', '<script>window.PROWL_FORMAT = "portrait";</script>\n    <script src="timing.js"></script>'],
  [
    "  </head>",
    `    <style>
      /* vertical frame: sizes and the copy column; positions of moving parts come from LAYOUT in the script */
      html, body { width: 1080px; height: 1920px; }
      .full { width: 1080px; height: 1920px; }
      .blk { left: 80px; width: 920px; }
      .sub { width: 860px; }
      #endc .ln { width: 1080px; }
      #wordmark { top: 1012px; }
      #tagline { top: 1164px; }
      #avail { top: 1254px; }
    </style>
  </head>`,
  ],
];
for (const [from, to] of swaps) {
  if (!html.includes(from)) throw new Error(`build-vertical: index.html no longer contains: ${from}`);
  html = html.replace(from, to);
}
html = html.replace("<!doctype html>", "<!doctype html>\n<!-- Generated from ../launch-film/index.html by scripts/build-vertical.mjs. Do not edit; edit that file and rebuild. -->");
const out = join(root, "..", "launch-film-vertical");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(join(out, "index.html"), html);
fs.copyFileSync(join(root, "hyperframes.json"), join(out, "hyperframes.json"));
const meta = JSON.parse(fs.readFileSync(join(root, "meta.json"), "utf8"));
fs.writeFileSync(join(out, "meta.json"), JSON.stringify({ ...meta, id: meta.id + "-vertical", name: meta.name + " (vertical)" }, null, 2) + "\n");
for (const link of ["assets", "timing.js"]) {
  const p = join(out, link);
  if (!fs.existsSync(p)) fs.symlinkSync(join("..", "launch-film", link), p);
}
console.log("wrote", out);
