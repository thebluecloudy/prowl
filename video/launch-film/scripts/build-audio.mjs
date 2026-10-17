// Builds assets/soundtrack.wav: all music and every sound effect synthesised here, no samples.
// Cue times come from ../timing.js (the same file the picture reads), so each sound starts on
// the exact frame of the action it belongs to. Mastered to about -14 LUFS with a true-peak ceiling.
//
//   node scripts/build-audio.mjs            -> assets/soundtrack.wav (+ prints loudness)
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
new Function(fs.readFileSync(join(root, "timing.js"), "utf8"))();
const TM = globalThis.PROWL_TIMING;
const C = TM.cues;

const SR = 48000, DUR = 20, N = SR * DUR;
const fr = (f) => f / TM.FPS;                 // frame -> seconds
const S = (sec) => Math.round(sec * SR);      // seconds -> sample
const BEAT = 0.6, BAR = 2.4;
const TAU = Math.PI * 2;

// ---------- deterministic noise ----------
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const white = () => rand() * 2 - 1;

// ---------- buses ----------
const bus = () => [new Float32Array(N), new Float32Array(N)];
const music = bus(), sfx = bus(), send = bus();
function mix(dst, mono, startSec, gain = 1, pan = 0, rev = 0) {
  const s0 = S(startSec);
  const a = (pan + 1) * Math.PI / 4, gl = Math.cos(a) * gain, gr = Math.sin(a) * gain;
  for (let i = 0; i < mono.length; i++) {
    const j = s0 + i; if (j < 0) continue; if (j >= N) break;
    const v = mono[i];
    dst[0][j] += v * gl; dst[1][j] += v * gr;
    if (rev) { send[0][j] += v * gl * rev; send[1][j] += v * gr * rev; }
  }
}
// stereo version (array of [L,R])
function mix2(dst, L, R, startSec, gain = 1, rev = 0) {
  const s0 = S(startSec);
  for (let i = 0; i < L.length; i++) {
    const j = s0 + i; if (j < 0) continue; if (j >= N) break;
    dst[0][j] += L[i] * gain; dst[1][j] += R[i] * gain;
    if (rev) { send[0][j] += L[i] * gain * rev; send[1][j] += R[i] * gain * rev; }
  }
}

// ---------- filters ----------
function biquad(x, type, fcFn, Q = 0.707) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b1, b2, a1, a2;
  const coef = (fc) => {
    fc = Math.min(Math.max(fc, 20), SR * 0.45);
    const w0 = TAU * fc / SR, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
    let B0, B1, B2; const A0 = 1 + al;
    if (type === "lp") { B0 = (1 - cs) / 2; B1 = 1 - cs; B2 = (1 - cs) / 2; }
    else if (type === "hp") { B0 = (1 + cs) / 2; B1 = -(1 + cs); B2 = (1 + cs) / 2; }
    else { B0 = al; B1 = 0; B2 = -al; } // band-pass (0 dB peak)
    b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = -2 * cs / A0; a2 = (1 - al) / A0;
  };
  const varying = typeof fcFn === "function";
  if (!varying) coef(fcFn);
  for (let i = 0; i < x.length; i++) {
    if (varying && (i & 31) === 0) coef(fcFn(i / SR));
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const gen = (sec, fn) => { const n = Math.max(1, S(sec)), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = fn(i / SR, i); return a; };
const noise = (sec) => gen(sec, () => white());
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

// ---------- instruments ----------
// soft electric piano: a few sine partials with their own decays and a gentle tine
function epiano(m, dur, vel) {
  const f = mtof(m), tau = 1.9 * Math.pow(220 / f, 0.35), rel = 0.25;
  return gen(dur + 1.6, (t) => {
    const att = Math.min(1, t / 0.006);
    const off = t > dur ? Math.exp(-(t - dur) / rel) : 1;
    const e1 = Math.exp(-t / tau), e2 = Math.exp(-t / (tau * 0.35)), e3 = Math.exp(-t / 0.05);
    const trem = 1 + 0.05 * Math.sin(TAU * 4.6 * t);
    return vel * att * off * trem * (Math.sin(TAU * f * t) * e1 + 0.28 * Math.sin(TAU * 2 * f * t + 0.3) * e2 + 0.06 * Math.sin(TAU * 7.1 * f * t) * e3);
  });
}
// warm pad: detuned soft saws, low-passed, slow swell
function pad(ms, t0, t1, vel, att = 0.9, rel = 1.0, cutoff = 1100) {
  const len = t1 - t0 + rel + 0.1;
  const L = new Float32Array(S(len)), R = new Float32Array(S(len));
  ms.forEach((m, k) => {
    [-1, 1].forEach((side) => {
      const f = mtof(m) * Math.pow(2, side * (4 + k) / 1200);
      let ph = rand();
      for (let i = 0; i < L.length; i++) {
        const t = i / SR;
        ph += f / SR; ph -= Math.floor(ph);
        let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(TAU * h * ph) / h;
        const env = Math.min(1, t / att) * (t > t1 - t0 ? Math.exp(-(t - (t1 - t0)) / (rel / 3)) : 1);
        (side < 0 ? L : R)[i] += v * env * vel * 0.18;
      }
    });
  });
  return [biquad(L, "lp", cutoff, 0.6), biquad(R, "lp", cutoff, 0.6)];
}
function bass(m, dur, vel) {
  const f = mtof(m);
  return gen(dur + 0.4, (t) => {
    const env = Math.min(1, t / 0.012) * (t > dur ? Math.exp(-(t - dur) / 0.08) : Math.exp(-t / 1.4));
    const v = Math.sin(TAU * f * t) + 0.22 * Math.sin(TAU * 2 * f * t) + 0.06 * Math.sin(TAU * 3 * f * t);
    return Math.tanh(v * 1.2) * env * vel;
  });
}
function kick(vel) {
  let ph = 0;
  return gen(0.42, (t) => {
    const f = 46 + 70 * Math.exp(-t / 0.035); ph += f / SR;
    return Math.sin(TAU * ph) * Math.exp(-t / 0.16) * vel + white() * 0.02 * Math.exp(-t / 0.004) * vel;
  });
}
function hat(vel, decay = 0.035) { return biquad(gen(0.12, (t) => white() * Math.exp(-t / decay) * vel), "hp", 7500, 0.8); }
function rim(vel) { return biquad(gen(0.08, (t) => white() * Math.exp(-t / 0.018) * vel), "bp", 1900, 3); }
function bell(m, vel, decay = 1.4, ratio = 3.5) {
  const f = mtof(m);
  return gen(decay * 3, (t) => {
    const idx = 1.6 * Math.exp(-t / (decay * 0.25));
    return Math.sin(TAU * f * t + idx * Math.sin(TAU * f * ratio * t)) * Math.exp(-t / decay) * Math.min(1, t / 0.002) * vel;
  });
}

// ---------- the score: 100 BPM, D major, minimal ----------
const CH = [
  [50, 54, 57, 61, 64],  // Dmaj9
  [47, 50, 54, 57, 61],  // Bm9
  [43, 47, 50, 54, 57],  // Gmaj9
  [45, 50, 52, 54, 59],  // A6/9sus
  [50, 54, 57, 61, 64],
  [47, 50, 54, 57, 61],
  [43, 47, 50, 54, 57],
  [45, 50, 52, 57, 59]   // Asus, leaning into the landing
];
const ROOT = [38, 35, 31, 33, 38, 35, 31, 33];
for (let b = 0; b < 8; b++) {
  const t0 = b * BAR, ch = CH[b], last = b === 7;
  // piano: chord on 1, a lift on the and of 2, softer chord on 3, a pickup on the and of 4
  const hits = last ? [[0, ch, 0.42]] : [[0, ch, 0.5], [1.5, ch.slice(3), 0.32], [2, ch.slice(1), 0.34], [3.5, [ch[4] + 2], 0.22]];
  hits.forEach(([bt, notes, v], k) => notes.forEach((m, i) => {
    if (b === 0 && bt > 1.9) return; // the opening bar stays almost still
    mix(music, epiano(m + 12, last ? 1.1 : 0.9, v * (b === 0 ? 0.8 : 1) * (1 - i * 0.06)), t0 + bt * BEAT + i * 0.012, 0.42, (i - 2) * 0.22, 0.32);
  }));
  // pad under everything
  const [pl, pr] = pad(ch, t0, last ? 18.0 : t0 + BAR, b === 0 ? 0.5 : 0.62, b === 0 ? 1.4 : 0.6, 0.9, last ? 1600 : 1100);
  mix2(music, pl, pr, t0, 0.5, 0.35);
  if (b >= 1 && !last) {
    mix(music, bass(ROOT[b], 1.05, 0.5), t0, 0.62, 0);
    mix(music, bass(ROOT[b] + (b % 2 ? 7 : 0), 0.8, 0.38), t0 + 2 * BEAT, 0.62, 0);
    // soft kick on 1 and 3, hats on the off-beats, a rim on 2 and 4 from bar 3
    mix(music, kick(0.55), t0, 0.36, 0);
    mix(music, kick(0.38), t0 + 2 * BEAT, 0.36, 0);
    for (let e = 0; e < 8; e++) if (e % 2) mix(music, hat(0.16 + (e === 3 || e === 7 ? 0.05 : 0)), t0 + e * BEAT / 2, 0.5, 0.35, 0.05);
    if (b >= 2) [1, 3].forEach((bt) => mix(music, rim(0.22), t0 + bt * BEAT, 0.5, -0.25, 0.15));
  }
}
// the landing: a warm low chord at 18.0 with a long glow
{
  const tL = fr(C.logoLand);
  const low = [26, 38, 45, 50, 54, 57, 64];
  low.forEach((m, i) => mix(music, epiano(m + (m < 40 ? 12 : 0), 1.6, 0.42 * (1 - i * 0.05)), tL + i * 0.018, 0.5, (i - 3) * 0.18, 0.45));
  const [pl, pr] = pad([38, 45, 50, 54, 57, 61], tL - 0.05, 19.55, 0.85, 0.08, 0.9, 1500);
  mix2(music, pl, pr, tL - 0.05, 0.55, 0.45);
  mix(music, gen(2.1, (t) => Math.sin(TAU * 36.7 * t) * Math.min(1, t / 0.02) * Math.exp(-t / 1.1) * (t > 1.5 ? Math.exp(-(t - 1.5) / 0.12) : 1)), tL, 0.3, 0);
  // shimmer that hangs over the logo
  [74, 78, 81, 86].forEach((m, i) => mix(music, gen(1.9, (t) => Math.sin(TAU * mtof(m) * t) * (1 + 0.4 * Math.sin(TAU * (3 + i) * t)) * Math.min(1, t / 0.5) * Math.exp(-Math.max(0, t - 1.2) / 0.18) * 0.05), tL + 0.05, 0.6, (i - 1.5) * 0.4, 0.6));
}

// ---------- sound effects, each on its frame ----------
const SFX = (arr, f, gain, pan = 0, rev = 0.12) => mix(sfx, arr, fr(f), gain, pan, rev);
// the mark breathes (two soft air swells)
[0, 36].forEach((f) => SFX(biquad(gen(0.9, (t) => white() * Math.sin(Math.PI * Math.min(1, t / 0.9)) ** 2), "bp", 700, 0.7), f, 0.07, 0, 0.2));
// soft footfalls where the paws land (felt pads)
TM.footfalls().forEach(({ f, leg }) => {
  const near = leg.charAt(0) === "r", g = (near ? 0.11 : 0.07) * (f < 180 ? 1.2 : 0.8) * (f > 1050 ? 0.6 : 1);
  SFX(biquad(gen(0.09, (t) => (white() * 0.7 + Math.sin(TAU * 95 * t)) * Math.exp(-t / 0.022)), "lp", 900, 0.7), f, g, -0.35, 0.05);
});
// the mark unfolds into the window: a paper flip whoomp and a little crackle
{
  const a = C.unfold[0], b = C.unfold[1], len = fr(b - a) + 0.3, mid = 0.55;
  SFX(biquad(gen(len, (t) => white() * Math.exp(-((t - mid) ** 2) / 0.05)), "bp", (t) => 500 + 2600 * smooth(t / len), 0.9), a, 0.32, 0.3, 0.2);
  for (let i = 0; i < 26; i++) { const tt = rand() * len * 0.8; SFX(biquad(gen(0.012, (t) => white() * Math.exp(-t / 0.002)), "hp", 3000), a + Math.round(tt * 60), 0.05 * rand(), 0.2 + rand() * 0.4, 0.05); }
}
// headline changes: a soft air brush
[36, 216, C.glide[0], C.fold[0], C.melt[0]].forEach((f) => SFX(biquad(gen(0.5, (t) => white() * Math.sin(Math.PI * Math.min(1, t / 0.5)) ** 3), "bp", (t) => 1800 - 1200 * t, 0.8), f, 0.06, -0.5, 0.15));
// typing: one key tick per letter
C.keys.forEach((f, i) => {
  const p = 2400 + rand() * 900;
  const k = gen(0.05, (t) => (white() * 0.6 * Math.exp(-t / 0.004) + Math.sin(TAU * p * t) * 0.5 * Math.exp(-t / 0.012) + Math.sin(TAU * 180 * t) * 0.4 * Math.exp(-t / 0.01)));
  SFX(biquad(k, "hp", 300), f, 0.34 * (0.8 + 0.4 * rand()), 0.35, 0.08);
});
// Hunt button
SFX(gen(0.12, (t) => Math.sin(TAU * (240 - 900 * t) * t) * Math.exp(-t / 0.03) + white() * 0.25 * Math.exp(-t / 0.006)), C.huntPress, 0.5, 0.35, 0.1);
// the hunt line: a gentle rising shimmer, plus a plink for each chip it reaches
{
  const a = C.huntLine[0], b = C.huntLine[1], len = fr(b - a) + 0.25;
  [0, 7, 12, 16].forEach((iv, k) => {
    let ph = 0;
    SFX(gen(len, (t) => {
      const f = mtof(74 + iv) * Math.pow(2, 1.0 * t / len); ph += f / SR;
      const env = Math.min(1, t / 0.25) * (t > len - 0.3 ? Math.max(0, (len - t) / 0.3) : 1);
      return Math.sin(TAU * ph) * env * (0.6 + 0.4 * Math.sin(TAU * (9 + k * 1.7) * t));
    }), a, 0.035, (k - 1.5) * 0.4, 0.5);
  });
  SFX(biquad(gen(len, (t) => white() * Math.min(1, t / 0.3) * Math.max(0, 1 - t / len)), "bp", (t) => 2500 + 5000 * t / len, 2.5), a, 0.05, 0.3, 0.4);
  const scale = [74, 76, 78, 81, 83, 86, 88, 90];
  C.chips.forEach((f, i) => SFX(bell(scale[i], 1, 0.35, 2.0), f, 0.22, 0.1 + i * 0.07, 0.35));
}
// result cards land: light taps
function tap(g = 1) {
  return gen(0.2, (t) => Math.sin(TAU * 520 * t) * Math.exp(-t / 0.035) * 0.6 + Math.sin(TAU * 130 * t) * Math.exp(-t / 0.05) * 0.7 + white() * 0.35 * Math.exp(-t / 0.006)).map((v) => v * g);
}
C.cards.forEach((f, i) => SFX(tap(1), f, 0.3, 0.2 + i * 0.15, 0.12));
// glide down the day's finds
SFX(biquad(gen(1.3, (t) => white() * Math.sin(Math.PI * Math.min(1, t / 1.3)) ** 2), "bp", (t) => 1400 - 700 * t, 0.7), C.glide[0], 0.12, 0.2, 0.2);
// a card opens: a swell up, a soft settle
SFX(biquad(gen(fr(C.open[1] - C.open[0]), (t) => white() * (t / fr(C.open[1] - C.open[0])) ** 2), "bp", (t) => 600 + 3500 * t, 0.8), C.open[0], 0.14, 0.2, 0.2);
SFX(tap(0.7), C.open[1], 0.4, 0.15, 0.15);
// live badge blip, condition flag ticks
SFX(bell(81, 1, 0.12, 1.0), C.live, 0.24, 0.3, 0.2); SFX(bell(86, 1, 0.14, 1.0), C.live + 4, 0.2, 0.3, 0.2);
C.flags.forEach((f, i) => SFX(gen(0.08, (t) => Math.sin(TAU * (i ? 1320 : 1180) * t) * Math.exp(-t / 0.018) + white() * 0.2 * Math.exp(-t / 0.004)), f, 0.4, 0.3, 0.12));
// heart pop: a bubble, a click, a little sparkle
SFX(gen(0.16, (t) => Math.sin(TAU * (380 + 1300 * Math.exp(-t / 0.025)) * t) * Math.exp(-t / 0.05) + white() * 0.3 * Math.exp(-t / 0.003)), C.heart, 0.55, 0.25, 0.15);
[88, 93, 95, 100].forEach((m, i) => SFX(bell(m, 1, 0.25, 1.5), C.heart + 3 + i * 3, 0.04, 0.1 + i * 0.12, 0.4));
SFX(biquad(gen(0.35, (t) => white() * Math.sin(Math.PI * Math.min(1, t / 0.35)) ** 2), "bp", 2200, 1), C.toast, 0.05, 0.1, 0.15);
// fold: two paper creases
function crease(len) { return biquad(gen(len, (t) => white() * (0.5 + 0.5 * (rand() > 0.85 ? 1 : 0)) * Math.sin(Math.PI * Math.min(1, t / len)) ** 2), "bp", (t) => 1500 + 2500 * t / len, 1.2); }
{ const FD = C.fold[1] - C.fold[0];
  SFX(crease(0.22), C.fold[0] + Math.round(0.5 * FD), 0.18, 0.25, 0.15);
  SFX(crease(0.22), C.fold[0] + Math.round(0.72 * FD), 0.17, 0.3, 0.15); }
// paper whoosh: the envelope arcs out and arrives
{
  const a = C.fly[0], len = fr(C.fly[1] - a) + 0.1;
  const w = gen(len, (t) => white() * Math.exp(-((t - len * 0.55) ** 2) / 0.018));
  const f = biquad(w, "bp", (t) => 500 + 2200 * Math.sin(Math.PI * Math.min(1, t / len)), 0.8);
  const L = new Float32Array(f.length), R = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) { const u = i / f.length, p = 0.2 + 0.6 * Math.sin(Math.PI * u); const ang = (p + 1) * Math.PI / 4; L[i] = f[i] * Math.cos(ang); R[i] = f[i] * Math.sin(ang); }
  mix2(sfx, L, R, fr(a), 0.42, 0.25);
}
// it arrives: a two-note mail chime, then the 3 new pill
SFX(bell(74, 1, 0.5, 2.0), C.fly[1], 0.35, 0.2, 0.4); SFX(bell(81, 1, 0.6, 2.0), C.fly[1] + 6, 0.3, 0.25, 0.4);
SFX(gen(0.1, (t) => Math.sin(TAU * (900 + 700 * t / 0.1) * t) * Math.exp(-t / 0.03)), C.newPill, 0.28, 0.2, 0.2);
// the email unfolds into a fresh find
SFX(biquad(gen(0.6, (t) => white() * Math.sin(Math.PI * Math.min(1, t / 0.6)) ** 2), "bp", (t) => 3000 - 2000 * t, 0.9), C.unfoldMail[0], 0.13, 0.2, 0.2);
SFX(tap(0.8), C.unfoldMail[1], 0.45, 0.15, 0.15);
// melt: a slow liquid glide down
{
  const a = C.melt[0], len = fr(C.melt[1] - a) + 0.2;
  let ph = 0;
  SFX(gen(len, (t) => { const f = 320 * Math.pow(0.4, t / len); ph += f / SR; return Math.sin(TAU * ph + 2 * Math.sin(TAU * 7 * t)) * Math.sin(Math.PI * Math.min(1, t / len)); }), a, 0.07, -0.2, 0.3);
  SFX(biquad(gen(len, (t) => white() * Math.sin(Math.PI * Math.min(1, t / len))), "lp", (t) => 1800 - 1200 * t / len), a, 0.06, -0.2, 0.2);
}
// glow swell into the landing
{
  const a = C.wash[0], len = fr(C.logoLand - a);
  SFX(biquad(gen(len + 0.05, (t) => white() * (t / len) ** 3), "bp", (t) => 800 + 5000 * (t / len) ** 2, 0.9), a, 0.16, 0, 0.4);
  [62, 69, 74].forEach((m, i) => { let ph = 0; SFX(gen(len + 0.05, (t) => { const f = mtof(m) * Math.pow(2, (t / len) * 0.25); ph += f / SR; return Math.sin(TAU * ph) * (t / len) ** 2; }), a, 0.035, (i - 1) * 0.5, 0.5); });
}
// tagline settles: a soft bell
SFX(bell(86, 1, 1.1, 2.0), C.tagline, 0.25, -0.1, 0.5); SFX(bell(93, 1, 0.9, 2.0), C.tagline + 1, 0.13, 0.15, 0.5);

// ---------- reverb (8-line feedback delay network) ----------
function reverb(inL, inR, rt60 = 2.3, damp = 0.35) {
  const lens = [1433, 1601, 1867, 2053, 2251, 2399, 2617, 2903].map((l) => Math.round(l * 1.4));
  const bufs = lens.map((l) => new Float32Array(l)), idx = lens.map(() => 0), lp = lens.map(() => 0);
  const g = lens.map((l) => Math.pow(10, (-3 * l / SR) / rt60));
  const outL = new Float32Array(N), outR = new Float32Array(N);
  const pre = S(0.018);
  for (let i = 0; i < N; i++) {
    const xL = i >= pre ? inL[i - pre] : 0, xR = i >= pre ? inR[i - pre] : 0;
    const o = bufs.map((b, k) => b[idx[k]]);
    let sum = 0; for (let k = 0; k < 8; k++) sum += o[k];
    const h = (2 / 8) * sum;
    let yl = 0, yr = 0;
    for (let k = 0; k < 8; k++) {
      lp[k] = lp[k] + (1 - damp) * ((o[k] - h) - lp[k]);
      const v = lp[k] * g[k] + (k % 2 ? xR : xL) * 0.35;
      bufs[k][idx[k]] = v; idx[k] = (idx[k] + 1) % lens[k];
      if (k % 2) yr += o[k]; else yl += o[k];
    }
    outL[i] = yl * 0.25; outR[i] = yr * 0.25;
  }
  return [outL, outR];
}
const [rL, rR] = reverb(send[0], send[1]);

// ---------- report: where each effect's transient lands, and how far it sits over the music ----------
if (process.argv.includes("--report")) {
  const named = [["key", C.keys[0]], ["key", C.keys[7]], ["hunt", C.huntPress], ["chip", C.chips[0]], ["chip", C.chips[7]],
    ["card", C.cards[0]], ["card", C.cards[2]], ["open", C.open[1]], ["live", C.live], ["flag", C.flags[0]], ["flag", C.flags[1]],
    ["heart", C.heart], ["arrive", C.fly[1]], ["pill", C.newPill], ["unfold", C.unfoldMail[1]], ["land", C.logoLand], ["tagline", C.tagline]];
  const db = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
  for (const [name, f] of named) {
    const s0 = S(fr(f)), w = S(0.08);
    let pk = 0, at = 0, rms = 0;
    for (let i = s0 - S(0.03); i < s0 + w; i++) { const v = Math.max(Math.abs(sfx[0][i]), Math.abs(sfx[1][i])); if (v > pk) { pk = v; at = i; } }
    for (let i = s0; i < s0 + w; i++) rms += music[0][i] ** 2 + music[1][i] ** 2;
    rms = Math.sqrt(rms / (2 * w));
    const isMusic = name === "land" || name === "tagline";
    console.log(`${name.padEnd(8)} frame ${String(f).padStart(4)}  peak at ${((at - s0) / SR * 1000).toFixed(1).padStart(5)} ms  sfx ${db(pk)} dB  music rms ${db(rms)} dB${isMusic ? " (music cue)" : ""}`);
  }
}

// ---------- mix, master ----------
const L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i++) {
  L[i] = music[0][i] * 1.0 + sfx[0][i] * 1.0 + rL[i] * 0.55;
  R[i] = music[1][i] * 1.0 + sfx[1][i] * 1.0 + rR[i] * 0.55;
}
// master EQ: clear the sub below 30 Hz, lift presence above 2 kHz a little
{
  const hl = biquad(biquad(L, "hp", 30, 0.7), "hp", 30, 0.7), hr = biquad(biquad(R, "hp", 30, 0.7), "hp", 30, 0.7);
  const pl = biquad(hl, "hp", 2200, 0.6), pr = biquad(hr, "hp", 2200, 0.6);
  for (let i = 0; i < N; i++) { L[i] = hl[i] + 0.35 * pl[i]; R[i] = hr[i] + 0.35 * pr[i]; }
}
// gentle fade on the very end so nothing clicks at 20.000 s
for (let i = 0; i < N; i++) { const t = i / SR; if (t > 19.55) { const g = Math.max(0, 1 - (t - 19.55) / 0.45); L[i] *= g * g; R[i] *= g * g; } if (t < 0.004) { L[i] *= t / 0.004; R[i] *= t / 0.004; } }

function writeWav(path, l, r, gain = 1) {
  const n = l.length, buf = Buffer.alloc(44 + n * 6);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 6, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34); buf.write("data", 36); buf.writeUInt32LE(n * 6, 40);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const d = (rand() - rand()) / 8388608; // TPDF dither at 24-bit
      let v = Math.round(Math.max(-1, Math.min(1, (c ? r[i] : l[i]) * gain + d)) * 8388607);
      buf.writeIntLE(v, 44 + i * 6 + c * 3, 3);
    }
  }
  fs.writeFileSync(path, buf);
}
function measure(path) {
  const r = String(execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i "${path}" -af ebur128=peak=true -f null - 2>&1 | tail -14`]));
  const I = Number((r.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]);
  const TP = Number((r.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  return { I, TP, raw: r };
}
// look-ahead peak limiter (ceiling in linear), with 4x oversampled peak estimate
function limit(l, r, ceil) {
  const look = S(0.003), rel = Math.exp(-1 / S(0.09));
  const n = l.length, need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (i + 1 < n) for (let k = 1; k < 4; k++) { const u = k / 4; p = Math.max(p, Math.abs(l[i] * (1 - u) + l[i + 1] * u) * 1.08, Math.abs(r[i] * (1 - u) + r[i + 1] * u) * 1.08); }
    need[i] = p > ceil ? ceil / p : 1;
  }
  // minimum over the look-ahead window, then smooth release
  const gmin = new Float32Array(n); let g = 1;
  for (let i = 0; i < n; i++) { let m = 1; for (let k = 0; k <= look && i + k < n; k += 8) m = Math.min(m, need[i + k]); gmin[i] = m; }
  const ol = new Float32Array(n), or = new Float32Array(n);
  for (let i = 0; i < n; i++) { g = gmin[i] < g ? gmin[i] : 1 - (1 - g) * rel; if (g > 1) g = 1; ol[i] = l[i] * g; or[i] = r[i] * g; }
  return [ol, or];
}

const tmp = join(root, "assets", ".pre.wav"), out = join(root, "assets", "soundtrack.wav");
const target = -14, ceil = Math.pow(10, -1.6 / 20);
let gain = 1, cur = [L, R];
for (let pass = 0; pass < 4; pass++) {
  const gl = cur[0].map((v) => v * gain), gr = cur[1].map((v) => v * gain);
  const [ll, lr] = limit(gl, gr, ceil);
  writeWav(tmp, ll, lr);
  const m = measure(tmp);
  console.log(`pass ${pass}: gain ${(20 * Math.log10(gain)).toFixed(2)} dB -> ${m.I} LUFS, true peak ${m.TP} dBFS`);
  if (Math.abs(m.I - target) < 0.15) break;
  gain *= Math.pow(10, (target - m.I) / 20);
}
fs.renameSync(tmp, out);
console.log("wrote", out);
