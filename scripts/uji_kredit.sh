#!/bin/bash
# Uji tafsir kredit (src/lib/kredit.ts).
# Dijaga di sini: ejaan kredit BEDA antar sumber - Ollsera 'Kredit', POS Sapaty
# 'CREDIT' - dan detektor yang hanya mengenal satu ejaan membuat penjualan kredit
# POS terbaca sebagai tunai.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/kredit.ts --bundle --format=esm --outfile=/tmp/kredit-uji.mjs --log-level=error
node scripts/uji_kredit.mjs
