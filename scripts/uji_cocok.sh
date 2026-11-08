#!/bin/bash
# Uji pencocokan cek kasir vs penjualan register untuk ringkasan hari.
# Jalankan: bash scripts/uji_cocok.sh
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/cek.ts --bundle --format=esm --outfile=/tmp/cek-uji.mjs --log-level=error
node scripts/uji_cocok.mjs
