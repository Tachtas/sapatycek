#!/bin/bash
# Gerbang rilis sapatycek. Build Vite tidak memeriksa nama yang dipakai tapi
# tidak diimpor (TS di-skip di Svelte) — kelas bug itu hanya muncul sebagai
# layar putih / ReferenceError di HP operator. Jalankan SEBELUM push/deploy.
set -u
cd "$(dirname "$0")/.."
hasil=$(npx svelte-check --threshold error --output human 2>&1)
fatal=$(printf '%s\n' "$hasil" | grep -E "Cannot find name|Cannot find module|Unexpected token|is not defined" || true)
if [ -n "$fatal" ]; then
  echo "GAGAL — nama/modul tak dikenal atau sintaks rusak:"
  printf '%s\n' "$fatal"
  exit 1
fi
printf '%s\n' "$hasil" | tail -1
echo "OK — tidak ada nama/modul tak dikenal."

# Bundel harus benar-benar bisa dibangun — error parse/penggabungan nama
# (mis. impor ganda) tidak tertangkap pemeriksaan nama di atas.
if ! npm run build >/tmp/periksa-build.log 2>&1; then
  echo "GAGAL — build rusak:"
  tail -12 /tmp/periksa-build.log
  exit 1
fi
echo "OK — build lolos."

# UJI LOGIKA MURNI (1 Nov 2026): uji_cocok.sh sudah lama ada tapi TIDAK pernah
# dijalankan gerbang ini, jadi ia tidak menjaga apa pun - kelas bug yang sudah
# dikunci di dalamnya bisa lolos ke HP operator tanpa satu pun peringatan.
# Yang dijaga di sana: cek kasir dicocokkan HANYA dengan penjualan yang sudah
# selesai ('Proses' = keranjang hidup, 'Pending' = ditahan tidak boleh dihitung).
if ! bash scripts/uji_cocok.sh >/tmp/periksa-cocok.log 2>&1; then
  echo "GAGAL — uji pencocokan cek tidak lulus:"
  tail -14 /tmp/periksa-cocok.log
  exit 1
fi
tail -1 /tmp/periksa-cocok.log | sed 's/^/OK — uji pencocokan: /'
