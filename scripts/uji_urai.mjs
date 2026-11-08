// Uji grammar input cek (uraiCek) — satu-satunya tafsir grammar
// `<nominal ribu><kode penjual><digit tipe>`.
//
// Dijaga di sini: hasil urai yang dipakai gerbang auto-submit (`lengkap`) dan
// yang dipakai saat menyimpan (`nominal`/`kode`/`tipe`) berasal dari satu
// fungsi, jadi keduanya tidak bisa berbeda tafsir lagi. Kasus "25m1-" pernah
// lolos gerbang lama (regex di App.svelte) tetapi ditolak parser (regex di
// lib/cek.ts): submit jalan, simpan tidak, tanpa pesan apa pun.
import { uraiCek } from '/tmp/cek-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}

// Nama penjual yang dikenal uji ini (kode huruf -> nama).
const nama = (k) => ({ m: 'Melaty', s: 'Sjb' }[k] ?? '');
// Ringkas supaya assertion tidak bergantung pada teks pratinjau.
const u = (t) => {
  const h = uraiCek(t, nama);
  return {
    jenis: h.jenis,
    lengkap: h.lengkap,
    digit: h.digit ?? null,
    nominal: h.nominal ?? null,
    kode: h.kode ?? null,
    tipe: h.tipe ?? null,
  };
};

// --- belum utuh: tidak boleh lewat gerbang ---
cek('kosong: ketikan kosong', u(''), { jenis: 'kosong', lengkap: false, digit: null, nominal: null, kode: null, tipe: null });
cek('hanya nominal: tinggal kode penjual', u('25'),
  { jenis: 'sebagian', lengkap: false, digit: '25', nominal: 25000, kode: null, tipe: null });
cek('nominal + kode: tinggal tipe', u('25m'),
  { jenis: 'sebagian', lengkap: false, digit: '25', nominal: 25000, kode: 'm', tipe: null });

// --- utuh: lewat gerbang, dan tafsirnya lengkap ---
cek('utuh 25m1 = Ecer 25.000 Melaty', u('25m1'),
  { jenis: 'siap', lengkap: true, digit: '25', nominal: 25000, kode: 'm', tipe: 'Ecer' });
cek('huruf besar diterima', u('25M2'),
  { jenis: 'siap', lengkap: true, digit: '25', nominal: 25000, kode: 'm', tipe: 'Obral' });
cek('tipe 3 = Grosir', u('25m3'),
  { jenis: 'siap', lengkap: true, digit: '25', nominal: 25000, kode: 'm', tipe: 'Grosir' });
cek('digit tipe asing tetap Ecer', u('25m9'),
  { jenis: 'siap', lengkap: true, digit: '25', nominal: 25000, kode: 'm', tipe: 'Ecer' });
cek('titik & spasi diabaikan', u('2.5 m1'),
  { jenis: 'siap', lengkap: true, digit: '25', nominal: 25000, kode: 'm', tipe: 'Ecer' });
cek('kode tak dikenal TETAP boleh disimpan', u('25x1'),
  { jenis: 'salah', lengkap: true, digit: '25', nominal: 25000, kode: 'x', tipe: 'Ecer' });

// --- kotor: gerbang harus TUTUP (dulu terbuka, ketikan hilang tanpa pesan) ---
cek('sisa tanda "-" tidak lewat gerbang', u('25m1-'),
  { jenis: 'salah', lengkap: false, digit: null, nominal: null, kode: null, tipe: null });
cek('sisa tanda "/" tidak lewat gerbang', u('25m1/'),
  { jenis: 'salah', lengkap: false, digit: null, nominal: null, kode: null, tipe: null });
cek('kode dua huruf tidak lewat gerbang', u('25mm1'),
  { jenis: 'salah', lengkap: false, digit: null, nominal: null, kode: null, tipe: null });
cek('huruf saja tidak lewat gerbang', u('abc'),
  { jenis: 'salah', lengkap: false, digit: null, nominal: null, kode: null, tipe: null });

// --- invarian: lewat gerbang berarti tafsir simpan tersedia ---
const siap = ['25m1', '25x1', '2.5 m1', '25m9'].map(u);
cek('gate dan parse sepakat (lengkap => nominal+kode+tipe ada)',
  siap.every((h) => h.lengkap && h.nominal > 0 && h.kode && h.tipe), true);

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
