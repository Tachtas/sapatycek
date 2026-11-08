#!/bin/bash
# Uji SATU grammar input cek (src/lib/cek.ts:uraiCek).
# Dijaga di sini: gerbang auto-submit dan parser yang menyimpan dulu dua regex
# terpisah, sehingga "25m1-" lolos gerbang tetapi ditolak parser — kirimCepat()
# kembali tanpa pesan dan ketikan operator hilang. Sekarang keduanya membaca
# satu hasil uraiCek, dan `lengkap` adalah satu-satunya gerbang.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/cek.ts --bundle --format=esm --outfile=/tmp/cek-uji.mjs --log-level=error
node scripts/uji_urai.mjs
