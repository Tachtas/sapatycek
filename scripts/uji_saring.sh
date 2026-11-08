#!/bin/bash
# Uji saringan & pencocokan daftar cek (src/lib/saring.ts) — murni, tanpa DOM.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/saring.ts --bundle --format=esm --outfile=/tmp/saring-uji.mjs --log-level=error
node scripts/uji_saring.mjs
