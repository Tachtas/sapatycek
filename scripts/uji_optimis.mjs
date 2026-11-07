// Uji cocokOptimis: baris cek yang baru diketik (id sementara NEGATIF) harus
// diserap baris server yang sepadan, dan TIDAK menyerobot baris lain.
//
// Dijaga di sini: (a) dua cek kembar dari antrean HP tidak menghapus dua baris
// optimis sekaligus, (b) baris server dengan jam/tipe/nominal berbeda tidak
// dianggap pasangan, (c) id server selalu positif — baris dengan id 0 (belum
// ditugaskan) bukan baris server.
import { cocokOptimis } from '/tmp/cek-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}

const optimis = (id, jam, nominal, tipe = 'Ecer', tanggal = '2026-11-07') =>
  ({ id, tanggal, jam, nominal, tipe });
const server = (id, jam, nominal, tipe = 'Ecer', tanggal = '2026-11-07') =>
  ({ id, tanggal, jam, nominal, tipe, salesman: 'Neman' });

// 1. baris server tiba → baris optimis dibuang, pemetaannya tercatat
cek('server tiba → optimis diserap, peta id terisi',
    (() => { const r = cocokOptimis([optimis(-1n, '10:00:01', 25000n)], [server(41n, '10:00:01', 25000n)]);
             return [r.sisa.length, r.peta['-1']]; })(),
    [0, '41']);

// 2. belum tiba → baris optimis tetap tampil
cek('server belum tiba → baris optimis tetap ada',
    cocokOptimis([optimis(-1n, '10:00:01', 25000n)], []).sisa.length,
    1);

// 3. baris server lain (nominal beda) tidak menyerobot
cek('nominal beda → tidak dianggap pasangan',
    cocokOptimis([optimis(-1n, '10:00:01', 25000n)], [server(41n, '10:00:01', 50000n)]).sisa.length,
    1);

// 4. jam & tipe ikut menentukan
cek('jam beda → tidak dianggap pasangan',
    cocokOptimis([optimis(-1n, '10:00:01', 25000n)], [server(41n, '10:00:02', 25000n)]).sisa.length,
    1);
cek('tipe beda → tidak dianggap pasangan',
    cocokOptimis([optimis(-1n, '10:00:01', 25000n, 'Obral')], [server(41n, '10:00:01', 25000n)]).sisa.length,
    1);
cek('outlet lain tidak dicampur (tanggal beda)',
    cocokOptimis([optimis(-1n, '10:00:01', 25000n)], [server(41n, '10:00:01', 25000n, 'Ecer', '2026-11-06')]).sisa.length,
    1);

// 5. INTI: satu baris server hanya menyerap SATU baris optimis
cek('kiriman ganda: satu baris server tidak menghapus dua baris optimis',
    cocokOptimis(
      [optimis(-1n, '10:00:01', 25000n), optimis(-2n, '10:00:01', 25000n)],
      [server(41n, '10:00:01', 25000n)],
    ).sisa.length,
    1);

// 6. dua baris server untuk dua baris optimis → keduanya diserap, peta lengkap
cek('dua pasangan: keduanya diserap',
    (() => { const r = cocokOptimis(
                [optimis(-1n, '10:00:01', 25000n), optimis(-2n, '10:00:05', 30000n)],
                [server(41n, '10:00:01', 25000n), server(42n, '10:00:05', 30000n)]);
              return [r.sisa.length, r.peta['-1'], r.peta['-2']]; })(),
    [0, '41', '42']);

// 7. hanya yang pasangannya ada yang dibuang
cek('satu tiba, satu belum → sisanya tetap tampil',
    (() => { const r = cocokOptimis(
                [optimis(-1n, '10:00:01', 25000n), optimis(-2n, '10:00:05', 30000n)],
                [server(42n, '10:00:05', 30000n)]);
              return [r.sisa.map((o) => String(o.id)), r.peta['-2']]; })(),
    [['-1'], '42']);

// 8. id 0 (baris yang belum ditugaskan server) bukan baris server
cek('id server 0 tidak dianggap pasangan',
    cocokOptimis([optimis(-1n, '10:00:01', 25000n)], [server(0n, '10:00:01', 25000n)]).sisa.length,
    1);

// 9. tanpa baris optimis → tidak ada kerja, tapi tidak pecah
cek('tanpa baris optimis → sisa & peta kosong',
    (() => { const r = cocokOptimis([], [server(41n, '10:00:01', 25000n)]);
             return [r.sisa.length, Object.keys(r.peta).length]; })(),
    [0, 0]);

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
