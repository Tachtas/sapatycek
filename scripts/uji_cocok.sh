#!/bin/bash
# Uji pencocokan per penjual (cek kasir vs penjualan sapatypos).
# Jalankan: bash scripts/uji_cocok.sh
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/cek.ts --bundle --format=esm --outfile=/tmp/cek-uji.mjs --log-level=error
node scripts/uji_cocok.mjs
