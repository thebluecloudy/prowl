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
