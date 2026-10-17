# Review log

Each round: render the full film (1200 frames, 8 sub-frame motion-blur samples), pull a frame every 0.5 s
(`scripts/review.sh`), check the spec and loudness, critique, fix.

## Round 1

Render r1: 1920x1080, 60/1 fps, 1200 frames, 20.000 s, H.264 + AAC 48 kHz. -13.9 LUFS, -2.2 dBTP. 27 min render.

**Found**
- Story: reads end to end (mark -> window -> type -> hunt -> results -> daily -> detail -> save -> email -> find
  -> mark -> logo). The first second is nearly still: the mark's breathing is too small to see.
- Layout: the window's lower 60 % is empty from 3.0 to 6.0 s while the search is typed (dead white area).
- Layout: the panther overlaps the window's bottom-left corner for 13 seconds; two shapes fight at one tangent.
- Layout: the headline block sits higher than the window's centre.
- Type: headline swaps roll for 0.62 s with a 0.06 s stagger, so both headlines are half visible for too long;
  the last sub line ("morning.") is still rolling out at 17.0 s over the melting window.
- Timing: the email is on screen for only 0.6 s (14.4-15.0) before it unfolds; "3 new matches" cannot be read.
- Depth: background blur, window blur behind the open card and contact shadows work. Motion blur shows on the
  flying cards and the legs and stays off slow drifts, as it should.
- Sound: the transient of every effect lands 0-5 ms after its frame in the stem (sample-accurate), but chip
  plinks, the mail chime, flag ticks and the tagline bell were at or below the music's level and would be lost.

**Changed**
- Rebalanced effects (+4 to +9 dB on the quiet ones), re-mastered to -14.0 LUFS.
- Skeleton result cards fill the empty results area and the real cards land on them.
- Window moved up (centre y 452), panther's ground lowered (985) so they no longer overlap; headline block
  centred on the window.
- Headline rolls: 0.5 s with a 0.05 s stagger; Resurface copy leaves at 16.35 s.
- Resurface retimed: fold 13.20-13.65, flight to 14.10, email holds 1.2 s, unfold 15.30-15.90, find holds to 16.8.
- Opening: a slow push-in and a visible breath on the mark.

**Still weak**
- Sync was verified in the stem, not yet in the muxed MP4 (AAC priming could shift it).
- The walk reads partly "in place" while the camera tracks; depends on the floor specks.

## Round 2

Render r2: spec as round 1, -14.0 LUFS, -2.2 dBTP. New `scripts/sync-check.py` cross-correlates the MP4's audio with
the stem at eight cues: **0.00 ms offset at every cue**, so sound is frame-exact in the delivered file.
Checked the fast transitions frame by frame (2.20-2.50, 9.62-9.86, 16.90-17.25) as well as every 0.5 s.

**Found**
- Round 1 fixes landed: skeleton cards fill the results area, the panther no longer crosses the window, the email
  holds for 1.2 s and reads, the Resurface copy is gone before the melt.
- Type: headline swaps still overlap for a moment (old and new lines both half visible in the same mask at 4.0 and
  13.5 s), which reads as a stutter rather than a roll.
- Card open (9.62-9.78): the detail's text column shows inside the small card's rect before the card has grown, on
  top of the neighbouring card.
- Melt (17.0): the ink starts as a hard black bar along the window's bottom edge before it reads as liquid.
- Panther: walks well, but from 3 to 16.8 s it barely moves across the screen; it reads as walking on the spot.
- End copy: "Available now" settles at 19.3 s, a little after the final beat.
- Sound: the mix is heavy below 120 Hz (sub and kick carry a lot of the loudness) and thin from 2 to 8 kHz.

**Changed**
- Headline swaps are now sequential: the old line leaves (0.28 s, ease in), the new one enters 0.2 s later
  (ease out). Tagline and "Available now" enter together and settle on the 19.2 s beat.
- The detail's text column reveals only after the card is half open.
- The ink starts earlier with a deeper wave, so it reads as liquid from the first frame.
- The panther covers about 2.5x more ground across the middle of the film (screen share 0.15 -> 0.28).
- Audio: high-pass at 30 Hz on the master, softer kick and landing sub, a presence lift above 2 kHz.

## Owner's note between rounds 2 and 3

"Make sure you use my panther, don't create a new one." The drawn rig is gone. The panther is now the owner's mark,
traced from `extension/icons/icon-128.png` (the only full copy reachable here; the original PNG sits on Shopify's
CDN, which this sandbox cannot reach, and it is not in Drive or Dropbox) into `assets/panther.js`. It walks by
skinning: the outline stays one shape and the legs, tail and head bend around pivots, so the still pose is the mark
exactly and every frame of the walk is the same silhouette mid-stride. The same path draws the marks inside the app
and the ceramic figurines on the cards. The gait is a slow prowl (26 px/s in icon units) after a brisk few steps out
of the mark; footfall sounds follow the new touchdowns. The round 3 render that had started on the old rig was
stopped and restarted on the new panther.

## Round 3 (first render with the owner's panther)

Render r3: spec as before, -13.9 LUFS, -2.3 dBTP, sync 0.00 ms at every cue.

**Found**
- The traced mark reads as the Prowl panther everywhere: in the tile at the start, stepping out (head in ink outside
  the tile, body still cream inside), walking under the copy, on the figurines and in the end lockup.
- The skinned walk is subtle but alive: the reaching front leg and the hind legs swing, the tail sways, motion blur
  softens the swing; the outline never tears.
- End: at 18.5 s the "Prowl" wordmark rises before the mark has finished its move and clips its lower edge.
- Type: at 13.5 s the old and new headline lines still share one mask for about 0.08 s.
- The walking panther is a touch small for the film's one through-line (about 262 px wide).

**Changed**
- Wordmark enters at 18.6 s (beat 31), after the mark settles.
- Incoming headlines start 0.3 s after the old ones begin to leave, so no mask ever holds two lines.
- Walking scale 2.45 -> 2.7 (about 290 px wide), still clear of the window.
- End mark lands higher (ground 880 at 17.9 s) so the larger tile stays inside the frame.

## Round 4

Render r4: spec as before, -13.9 LUFS, -2.3 dBTP, sync 0.00 ms. Frame strips at 1.80-2.35 and 16.85-18.65.

**Found**
- The flip (2.1-2.35) and the panther leaving the mark (1.8-2.1) are clean; the melt reads as ink rising.
- End lockup: with the larger panther the mark grew to about 414 px and now touches the "Prowl" wordmark.
- At 17.25 s the ink is still rising when the window reaches tile size, so the mark's top edge looks bitten.

**Changed**
- Final mark scale 1.2 -> 1.04 and centre raised to y 366, leaving clear space above the wordmark.
- The ink finishes rising 0.16 s earlier, before the window becomes the tile.

## Round 5 (final)

Render r5 -> `renders/prowl-launch-film.mp4` (not committed; rebuild with `scripts/build-audio.mjs` then
`scripts/render.mjs`). 1920x1080, 60/1 fps, 1200 frames, 20.000 s, H.264 + AAC 48 kHz stereo.
-13.9 LUFS integrated, -2.3 dBFS true peak, LRA 2.0 LU. Sync check: 0.00 ms at all eight cues.

**Found**
- Every round 4 fix landed: the ink is solid before the window becomes the mark (17.20-17.40), the lockup has
  clear space between mark and wordmark, the wordmark rises at 18.6 once the mark has settled, and the tagline and
  "Available now" settle on the 19.2 s beat.
- Story, layout and type hold at every half second; no frame shows two headlines in one mask, nothing below 28 px.
- No new defects.

**Still weak**
- The panther is traced from the 128 px icon; edges are smooth but softer than the original artwork would give.
  With the full-size PNG in the repo, re-run the trace (`assets/panther.js`) for crisper edges.
- The skinned walk is deliberately small (the mark's legs are merged in the silhouette), so the gait reads as a
  low prowl rather than a full stride, and paws slide slightly during the swing.
- The sound was judged by measurement (onsets, levels, spectrum, loudness), not by ear.

## Round 6: the owner's artwork

The owner sent the full panther artwork; it replaced the traced icon (`assets/art/prowl-panther.webp`, drawn on WebGL
through a skinned mesh so the shading, keyline, eye and whiskers bend with each leg). Renders r6-h and r6-v: spec as
round 5, -13.9 LUFS, -2.3 dBTP, sync 0.00 ms.

## Owner's note after round 6, and round 7

"My app doesn't look like that. It's simpler." The window showed an invented UI (black pills, neon chips, a tab bar).
It now draws the real Prowl page (`page/prowl.html`, light theme), measured from the page running in Chromium and
scaled about 1.75x: cream paper with the dot grid, 2-3 px dark-brown outlines (#3b1e12) with a hard drop under them,
the bar with the wordmark and the account and menu buttons, "Find the prey" in Alfa Slab One, the search box with the
camera, the orange gradient Hunt button that sinks onto its shadow, rust marketplace chips, result cards with
uppercase titles and rust prices, the bottom dock (Prowl, Goodwill, Local, Flock, Daily, Den), the orange "Your daily
prowl" band with yellow NEW badges, and the listing popup with its orange header, green LIVE, the app's real flag
("Mentions a repair and damage" with the seller's sentences; the app does not flag reproductions, so that flag is
gone), the pink like heart and the app's toast "Liked. Flock will show you more like this.". The email shows the
real alert subject ("Prowl: 3 new · ceramic panther (3)") from "Prowl by Owl & Twig". The neon green is kept only for
the ending. Timing and sound are unchanged.
