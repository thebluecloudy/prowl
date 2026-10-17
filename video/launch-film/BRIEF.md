---
workflow: general-video
flow: automation
storyboard: no
message: "Prowl hunts 28 marketplaces for you, so the hard-to-find piece finds you."
destination: launch film
aspect: "16:9"
length: 20s
language: en
---

# Prowl launch film

Owner's brief (2026-10-17), kept in their words where it matters.

## Intent

A 20-second launch film for Prowl, a vintage sourcing app for busy collectors and resellers. Hook, then three
features in order (Capture, Connect, Resurface), then the logo. One idea runs through the whole film: a prowling
panther never leaves the screen, walks through every scene, and at the end curls into the loop of the Prowl logo,
ending as the tail. Every scene transforms into the next: nothing fades and nothing cuts.

## Format

1920x1080, 60 fps, exactly 1200 frames, MP4 (H.264, AAC). Real film-style motion blur: at least 8 sub-frames per
output frame, blended (the engine's sub-frame motion blur, see `scripts/render.mjs`).

## Look

Premium and calm, lots of empty space. Cream `#FAF6EE` with warm ink `#1C1815`; the end on uranium green `#39ff14`
over deep night `#040414` with mint text `#8affb8`. Bricolage Grotesque for headlines, Space Grotesk for UI and body.
Nothing on screen smaller than about 28 px. The camera always drifts; 3D-tilted window, soft contact shadows, depth
blur away from the focal plane.

## Sound

All music and every effect made in code (`scripts/build-audio.mjs`): soft warm minimal music at 100 BPM, scene
changes on the beat, a sound for every action on its exact frame, mastered to about -14 LUFS with no clipping.

## Customizations

- Scene plan on the beat grid (36 frames a beat): hook 0-3.0, capture 3.0-7.8, connect 7.8-13.2,
  resurface 13.2-16.8, logo 16.8-20.0. All cue frames live in `timing.js`, shared by picture and sound.
- Copy written for the film: "28 marketplaces. One prowl." / "Start a hunt in seconds." / "Look over your finds
  every day." / "The rare piece finds you." / end tagline "The hunt comes to you." with "Available now".

## Notes

- One continuous composition rather than sub-compositions: the panther, the camera and the morphs (mark -> window
  -> email -> find -> mark) run across every scene boundary, so splitting would cut what must stay continuous.
- Quality loop: at least five render / critique / fix rounds, logged in `REVIEW.md`.
