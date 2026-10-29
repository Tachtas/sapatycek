#!/bin/bash
# Gerbang rilis sapatycek. Build Vite tidak memeriksa nama yang dipakai tapi
# tidak diimpor (TS di-skip di Svelte) — kelas bug itu hanya muncul sebagai
# layar putih / ReferenceError di HP operator. Jalankan SEBELUM push/deploy.
set -u
cd "$(dirname "$0")/.."
hasil=$(npx svelte-check --threshold error --output human 2>&1)
fatal=$(printf '%s\n' "$hasil" | grep -E "Cannot find name|Unexpected token|is not defined" || true)
if [ -n "$fatal" ]; then
  echo "GAGAL — ada nama tak dikenal / sintaks rusak:"
  printf '%s\n' "$fatal"
  exit 1
fi
printf '%s\n' "$hasil" | tail -1
echo "OK — tidak ada nama tak dikenal."
