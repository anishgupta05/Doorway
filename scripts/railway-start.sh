#!/bin/sh
# Boot script for Railway. Seeds the volume on first run, then serves the viewer and the room-builder API.
set -e
mkdir -p /app/runs
if [ -z "$(ls -A /app/runs 2>/dev/null)" ]; then
  echo "seeding /app/runs from the built-in rooms"
  cp -R /app/runs-seed/. /app/runs/
fi
export PORT="${PORT:-8080}"
# The improvement loop renders rooms by opening this same server in headless Chromium.
export VIEWER_URL="http://127.0.0.1:${PORT}"
cd /app/apps/viewer
exec npx vite preview --host 0.0.0.0 --port "$PORT" --strictPort
