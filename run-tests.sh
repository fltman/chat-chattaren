#!/usr/bin/env bash
# Kör hela testsviten. jsdom behövs bara för DOM-testerna (dev-beroende).
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules/jsdom ]; then
  echo "Installerar jsdom (dev)…"
  npm install --no-save jsdom
fi
node --test test/*.mjs
