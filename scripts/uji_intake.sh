#!/bin/bash
# Uji module intake (src/lib/intake.ts) lewat interface-nya, memakai adapter
# reducer palsu. Dijaga di sini: baris optimis, pembayaran ganda, penungguan id
# server, dan antrean offline — semuanya pernah jadi bug nyata di App.svelte.
set -e
cd "$(dirname "$0")/.."
npx esbuild src/lib/intake.ts --bundle --format=esm --outfile=/tmp/intake-uji.mjs --log-level=error
node scripts/uji_intake.mjs
