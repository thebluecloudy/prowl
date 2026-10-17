#!/usr/bin/env bash
# Pulls a frame every half second from a render into labelled contact sheets, and checks the
# deliverable spec (size, frame rate, frame count, codecs, loudness, true peak).
#   scripts/review.sh renders/film.mp4 out-dir
set -euo pipefail
in="$1"; out="$2"; mkdir -p "$out"; rm -f "$out"/f-*.png "$out"/sheet-*.jpg
for i in $(seq 0 40); do
  t=$(awk "BEGIN{printf \"%.2f\", $i*0.5}"); [ "$i" = 40 ] && t=19.98
  ffmpeg -loglevel error -y -ss "$t" -i "$in" -frames:v 1 \
    -vf "drawtext=text='$t s':x=24:y=24:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10" \
    "$out/f-$(printf %02d "$i").png"
done
# 3 x 3 sheets of 640x360 tiles
n=0; for start in 0 9 18 27 36; do
  ffmpeg -loglevel error -y -start_number "$start" -i "$out/f-%02d.png" -frames:v 1 \
    -vf "scale=640:360,tile=3x3:padding=6:color=black" "$out/sheet-$n.jpg" || true
  n=$((n+1))
done
echo "--- spec"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames,sample_rate,channels -show_entries format=duration -of compact "$in"
ffmpeg -hide_banner -nostats -i "$in" -map 0:a -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|LRA|Peak):" || true
