// Renders index.html to MP4 through the HyperFrames producer with the engine's
// sub-frame motion blur switched on. The `hyperframes render` CLI does not expose
// motionBlur, so this mirrors what the CLI does (createRenderRequest -> job ->
// executeRenderJob) and adds it to the job config.
//
//   HF_DIR=<dir with node_modules/hyperframes> node scripts/render.mjs [out.mp4] [--samples=8] [--shutter=180] [--draft]
//     [--project=../launch-film-vertical]   (the 1080x1920 cut; default this project, 1920x1080)
//
// Every output frame is the average of `samples` screenshots spread over the
// shutter window (180 deg = half a frame, centred on the frame time).
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { readdirSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : dflt;
};
const out = resolve(args.find((a) => !a.startsWith("--")) || "renders/prowl-launch.mp4");
const samples = Number(flag("samples", "8"));
const shutter = Number(flag("shutter", "180"));
const draft = args.includes("--draft");
const projectDir = flag("project") ? resolve(flag("project")) : resolve(new URL("..", import.meta.url).pathname);

const hfDist = join(process.env.HF_DIR || resolve(projectDir, "node_modules"), "node_modules/hyperframes/dist");
// The producer loader lives in a hashed chunk; find it by its export.
const loaderFile = readdirSync(hfDist).find((f) => /^producer-[A-Z0-9]+\.js$/.test(f));
const { loadProducer } = await import(pathToFileURL(join(hfDist, loaderFile)).href);
const producer = await loadProducer();

const engineConfig = producer.resolveConfig({ browserGpuMode: "software" });
const request = producer.createRenderRequest({
  projectDir,
  outputPath: out,
  engineConfig,
  options: {
    fps: { num: 60, den: 1 },
    quality: draft ? "draft" : "high",
    format: "mp4",
    crf: draft ? 23 : 14,
    workers: Number(flag("workers", "4")),
    strictness: "best-effort",
  },
});
const job = producer.createRenderJob(producer.renderConfigFromRequest(request, { logger: producer.createConsoleLogger("warn") }));
if (samples > 1) job.config.motionBlur = { samplesPerFrame: samples, shutterAngle: shutter, shutterPhase: -shutter / 2 };

const t0 = Date.now();
let last = -1;
await producer.executeRenderJob(job, projectDir, out, (j, msg) => {
  const p = Math.floor(j.progress || 0);
  if (p !== last && p % 5 === 0) {
    last = p;
    console.log(`${p}% ${msg || ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
});
console.log(`done: ${out} in ${((Date.now() - t0) / 1000).toFixed(0)}s, motion blur ${samples} samples @ ${shutter} deg`);
