#!/bin/bash
# Uji module sambungan & sesi (src/lib/koneksi.ts) lewat interface-nya, dengan
# pabrik koneksi palsu dan timer palsu — jadi putus/galat token bisa
# dibangkitkan dan jeda sambung ulang bisa DIUKUR tanpa menunggu detik nyata.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/koneksi.ts --bundle --format=esm --outfile=/tmp/koneksi-uji.mjs --log-level=error
node scripts/uji_koneksi.mjs
