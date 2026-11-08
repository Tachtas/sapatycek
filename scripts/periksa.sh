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

# SEJAK 5 Nov 2026 PEMERIKSA TIPE BENAR-BENAR BERJALAN. Sebelumnya
# svelte.config.js tidak ada, jadi svelte-check menolak memeriksa seluruh
# berkas .svelte (dua galat config palsu) dan hasilnya selalu "0 errors" apa
# pun isi kodenya — pagar di atas pun tidak menjaga apa pun. Karena itu galat
# tipe sekarang digagalkan di sini: tanpa langkah ini perbaikan itu tidak
# menjaga apa pun. Diverifikasi dengan menanam galat tipe sengaja.
jumlah_galat=$(printf '%s\n' "$hasil" | grep -oE 'found [0-9]+ error' | grep -oE '[0-9]+' | head -1)
if [ "${jumlah_galat:-0}" != "0" ]; then
  echo "GAGAL — svelte-check melaporkan ${jumlah_galat} galat tipe:"
  printf '%s\n' "$hasil" | grep -A3 "Error:" | head -30
  exit 1
fi
echo "OK — tidak ada galat tipe."

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
if ! bash scripts/uji_kredit.sh >/tmp/periksa-kredit.log 2>&1; then
  echo "GAGAL - uji tafsir kredit tidak lulus:"
  tail -14 /tmp/periksa-kredit.log
  exit 1
fi
tail -1 /tmp/periksa-kredit.log | sed 's/^/OK - uji kredit: /'

if ! bash scripts/uji_cocok.sh >/tmp/periksa-cocok.log 2>&1; then
  echo "GAGAL — uji pencocokan cek tidak lulus:"
  tail -14 /tmp/periksa-cocok.log
  exit 1
fi
tail -1 /tmp/periksa-cocok.log | sed 's/^/OK — uji pencocokan: /'

# UJI SATU GRAMMAR INPUT CEK (8 Nov 2026). Gerbang auto-submit dan parser yang
# menyimpan dulu dua regex terpisah: "25m1-" lolos gerbang lalu ditolak parser,
# jadi ketikan operator hilang tanpa pesan. Sekarang keduanya membaca uraiCek.
if ! bash scripts/uji_urai.sh >/tmp/periksa-urai.log 2>&1; then
  echo "GAGAL — uji grammar input cek tidak lulus:"
  tail -14 /tmp/periksa-urai.log
  exit 1
fi
tail -1 /tmp/periksa-urai.log | sed 's/^/OK — uji grammar cek: /'

# UJI BARIS OPTIMIS (7 Nov 2026). Baris cek yang baru diketik tampil seketika
# (id sementara negatif) dan harus diserap baris server yang sepadan — kalau
# tidak, layar menampilkan cek kembar atau barisnya hilang.
if ! bash scripts/uji_optimis.sh >/tmp/periksa-optimis.log 2>&1; then
  echo "GAGAL — uji baris optimis tidak lulus:"
  tail -14 /tmp/periksa-optimis.log
  exit 1
fi
tail -1 /tmp/periksa-optimis.log | sed 's/^/OK — uji baris optimis: /'

# UJI MODULE INTAKE (8 Nov 2026). Jalur tulis cek & bayar pindah dari App.svelte
# ke lib/intake.ts; ujinya memakai adapter reducer PALSU, jadi seam-nya nyata.
# Dijaga di sana: pembayaran tidak dobel, penungguan id server tidak menyerobot
# cek lain yang nominalnya sama, dan antrean offline berhenti pada gagal pertama.
if ! bash scripts/uji_intake.sh >/tmp/periksa-intake.log 2>&1; then
  echo "GAGAL — uji module intake tidak lulus:"
  tail -14 /tmp/periksa-intake.log
  exit 1
fi
tail -1 /tmp/periksa-intake.log | sed 's/^/OK — uji intake: /'

# UJI SAMBUNGAN & SESI (8 Nov 2026). Urutan menyambung, ritme sambung ulang, dan
# perpanjangan token pindah dari App.svelte ke lib/koneksi.ts. Pabrik koneksi dan
# timer-nya palsu di uji, jadi putus/galat token bisa dibangkitkan dan jeda
# sambung ulang bisa diukur tanpa menunggu detik nyata.
if ! bash scripts/uji_koneksi.sh >/tmp/periksa-koneksi.log 2>&1; then
  echo "GAGAL — uji sambungan & sesi tidak lulus:"
  tail -14 /tmp/periksa-koneksi.log
  exit 1
fi
tail -1 /tmp/periksa-koneksi.log | sed 's/^/OK — uji koneksi: /'

# UJI SARINGAN & PENCOCOKAN (8 Nov 2026). Arti tiap tab saringan ("belum input",
# "kurang bayar", "beda tafsir") pindah dari App.svelte ke lib/saring.ts. Itu tab
# yang dipakai pemilik untuk memutuskan, jadi salah arti = salah keputusan.
if ! bash scripts/uji_saring.sh >/tmp/periksa-saring.log 2>&1; then
  echo "GAGAL — uji saringan tidak lulus:"
  tail -14 /tmp/periksa-saring.log
  exit 1
fi
tail -1 /tmp/periksa-saring.log | sed 's/^/OK — uji saringan: /'
