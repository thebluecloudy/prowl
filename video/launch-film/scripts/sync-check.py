"""Checks that the audio inside a rendered MP4 sits where the stem put it.

Cross-correlates the MP4's decoded audio with assets/soundtrack.wav around each cue and reports the offset in
milliseconds (and in frames at 60 fps). Every effect was placed on its frame in the stem, so an offset near 0
means picture and sound still line up frame for frame after AAC encoding and muxing.

    python3 scripts/sync-check.py renders/film.mp4
"""
import json, subprocess, sys, wave
import numpy as np

SR = 48000


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def main():
    mp4 = sys.argv[1]
    a = decode(mp4)
    b = decode("assets/soundtrack.wav")
    cues = json.loads(subprocess.run(["node", "-e", """
      new Function(require('fs').readFileSync('timing.js','utf8'))();
      const C = globalThis.PROWL_TIMING.cues;
      console.log(JSON.stringify({key: C.keys[0], hunt: C.huntPress, card: C.cards[0], heart: C.heart,
        arrive: C.fly[1], unfold: C.unfoldMail[1], land: C.logoLand, tagline: C.tagline}));"""],
        capture_output=True, text=True, check=True).stdout)
    worst = 0
    for name, f in cues.items():
        s = int(f / 60 * SR)
        w = int(0.25 * SR)
        x = a[s - w:s + w]
        y = b[s - w:s + w]
        c = np.correlate(x - x.mean(), y - y.mean(), "full")
        lag = (np.argmax(c) - (len(y) - 1)) / SR * 1000
        worst = max(worst, abs(lag))
        print(f"{name:8s} frame {f:5d}  offset {lag:+6.2f} ms ({lag / (1000 / 60):+.2f} frames)")
    print(f"worst offset {worst:.2f} ms")


main()
