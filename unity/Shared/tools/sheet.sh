#!/usr/bin/env bash
# Contact sheet of a Unity film: scrub the open scene's FilmDirector to each time, capture the film camera with its HUD,
# tile the frames. Usage: sheet.sh <project dir> <out.png> <t1> <t2> ... (up to 9 times; 3 per row)
set -e
U="$LOCALAPPDATA/Unity/bin/unity.exe"; P="$1"; OUT="$2"; shift 2
mkdir -p "$P/Screenshots"; i=0; inputs=(); layout=()
for t in "$@"; do
  "$U" command --project-path "$P" --timeout 300 script.eval --code "var d = UnityEngine.Object.FindFirstObjectByType<AnimationStudio.Film.FilmDirector>(); d.time = ${t}f; d.Evaluate(${t}f); return 0;" --no-banner >/dev/null
  "$U" command --project-path "$P" --timeout 600 capture game_view --source camera --overlay true --width 640 --height 360 --output-path "Screenshots/s$i.png" --no-banner >/dev/null
  inputs+=(-i "$P/Screenshots/s$i.png"); i=$((i+1))
done
n=$i; cols=3; [ $n -lt 3 ] && cols=$n
for ((k=0;k<n;k++)); do x=$(( (k%cols)*640 )); y=$(( (k/cols)*360 )); layout+=("${x}_${y}"); done
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "xstack=inputs=$n:layout=$(IFS='|'; echo "${layout[*]}"):fill=black" "$OUT"
echo "$OUT"
