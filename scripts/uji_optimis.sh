#!/bin/bash
# Uji pencocokan baris cek optimis dengan baris server (src/lib/cek.ts).
# Dijaga di sini: baris cek yang baru diketik tampil seketika (id sementara
# negatif) dan dibuang tepat saat baris server yang sepadan tiba — tanpa
# menghapus baris lain dan tanpa pernah menganggap baris dengan id 0 sebagai
# baris server.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/cek.ts --bundle --format=esm --outfile=/tmp/cek-uji.mjs --log-level=error
node scripts/uji_optimis.mjs
