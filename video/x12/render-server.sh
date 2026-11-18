#!/usr/bin/env bash
# Renders the Blender X-12 film on a Linux GPU server: one Blender process per GPU, all sharing one frame folder
# (blender/x12_film.py claims each frame with a .lock file and skips finished ones, so it can be stopped and restarted).
#
# On your machine, pack what the server needs (about 300 MB):
#   tar czf x12-render.tgz blender/x12_film.py video/x12/render-server.sh \
#       video/out/x12-work/bake video/out/x12-work/assets video/out/x12-work/terrain_eroded.npy
# On the server (NVIDIA driver installed), unpack it into an empty folder and run:
#   bash video/x12/render-server.sh            # all GPUs; BLENDER=/path/to/blender to skip the download
# Then bring video/out/x12-work/frames/ back and run: node video/x12/finish.js
set -euo pipefail
cd "$(dirname "$0")/../.."
BLENDER_VERSION=5.2.3
if [ -z "${BLENDER:-}" ]; then
  if [ ! -x "blender-$BLENDER_VERSION-linux-x64/blender" ]; then
    curl -fL "https://download.blender.org/release/Blender5.2/blender-$BLENDER_VERSION-linux-x64.tar.xz" | tar xJ
  fi
  BLENDER="$PWD/blender-$BLENDER_VERSION-linux-x64/blender"
fi
GPUS=$(nvidia-smi --query-gpu=index --format=csv,noheader | wc -l)
echo "rendering on $GPUS GPU(s) with $BLENDER"
mkdir -p video/out/x12-work/logs
rm -f video/out/x12-work/frames/*.lock 2>/dev/null || true   # claims left by a stopped run
for ((g = 0; g < GPUS; g++)); do
  CUDA_VISIBLE_DEVICES=$g X12_DEVICE="${X12_DEVICE:-OPTIX}" "$BLENDER" -b --factory-startup --python-exit-code 1 -P blender/x12_film.py \
    > "video/out/x12-work/logs/gpu$g.log" 2>&1 &
  sleep 20   # stagger the scene builds
done
wait
done_n=$(ls video/out/x12-work/frames/*.png 2>/dev/null | wc -l)
echo "$done_n frames in video/out/x12-work/frames"
