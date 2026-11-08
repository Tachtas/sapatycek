// Uji saringan & pencocokan daftar cek (src/lib/saring.ts) — murni, tanpa DOM.
//
// Dijaga di sini: arti tiap tab saringan. Tab ini yang dipakai pemilik untuk
// memutuskan ("belum diinput", "kurang bayar", "beda tafsir"), jadi salah arti
// berarti salah keputusan — bukan sekadar daftar yang kurang rapi.
import {
  bedaBayarCek,
  cocokCari,
  fotoUntuk,
  hitungBedaBayar,
  kunciFoto,
  nilaiTanpaCek,
  petaFoto,
  petaPerOrder,
  saringCek,
} from '/tmp/saring-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}

// --- data uji ---------------------------------------------------------------
const baris = (id, tambah = {}) => ({
  id, tanggal: '2026-11-08', jam: '09:00:00', nominal: 25000, dibayar: 0,
  salesman: 'm', salesmanNama: 'Melaty', orderNo: '', customer: '',
  status: 'Belum Cocok', kredit: false, ...tambah,
});
const jual = (orderNo, mode, total = 25000) =>
  ({ orderNo, paymentMode: mode, paymentType: 'Tunai', total });

const peta = petaPerOrder([
  jual('POS-1', 'Tunai'),        // cocok dengan cek tunai
  jual('POS-2', 'Kredit'),       // register kredit
  jual('POS-3', 'CREDIT'),       // ejaan POS Sapaty
  jual('POS-4', 'Tunai'),
]);

// --- tiap tab saringan ------------------------------------------------------
const daftar = [
  baris(1),                                              // belum input, tunai, belum bayar
  baris(2, { orderNo: 'POS-1', status: 'Cocok' }),        // sudah ada pasangan
  baris(3, { orderNo: 'POS-2', status: 'Cocok', kredit: false }), // cek tunai, register kredit → beda tafsir
  baris(4, { orderNo: 'POS-3', status: 'Cocok', kredit: true }),  // dua-duanya kredit → tidak beda
  baris(5, { kredit: true }),                             // kredit, belum ada pasangan
  baris(6, { dibayar: 25000, status: 'Cocok' }),          // sudah dibayar penuh
  baris(7, { dibayar: 10000, status: 'Cocok' }),          // kurang bayar
];
const ids = (f, cari = '') => saringCek(daftar, f, cari, peta).map((c) => Number(c.id));

cek('tab semua: semua baris tampil', ids('semua'), [1, 2, 3, 4, 5, 6, 7]);
// Catatan semantik (bukan bug, tapi mudah salah dibaca): "belum input" menuntut
// DUA hal sekaligus — tanpa pasangan POS **dan** status masih 'Belum Cocok'.
// Baris yang sudah dibayar penuh tetapi statusnya 'Cocok' tetap TIDAK muncul.
cek('tab belum input: tanpa pasangan POS DAN masih berstatus Belum Cocok', ids('belum_input'), [1, 5]);
cek('tab belum input: yang sudah cocok tidak ikut walau belum dibayar', ids('belum_input').includes(7), false);
cek('tab kredit: hanya yang dicentang kredit', ids('kredit'), [4, 5]);
// Catatan semantik: "kurang bayar" = tiap cek TUNAI yang dibayarnya belum menutup
// nominalnya — termasuk yang belum punya pasangan POS sama sekali.
cek('tab kurang bayar: semua cek tunai yang belum lunas', ids('kurang_bayar'), [1, 2, 3, 7]);
cek('tab kurang bayar: yang sudah lunas tidak ikut', ids('kurang_bayar').includes(6), false);
cek('tab kurang bayar: kredit tidak pernah ikut', ids('kurang_bayar').includes(5), false);
cek('tab beda tafsir: cek tunai vs register kredit', ids('beda_bayar'), [3]);
cek('tab beda tafsir: ejaan POS "CREDIT" tidak dianggap beda', ids('beda_bayar').includes(4), false);

// --- pencarian --------------------------------------------------------------
cek('cari: nama penjual tanpa peduli huruf besar', ids('semua', 'MELATY').length, 7);
cek('cari: kode penjual', ids('semua', 'm').length, 7);
cek('cari: nomor order', ids('semua', 'pos-2'), [3]);
cek('cari: pelanggan', ids('semua', 'toko maju'), []);
cek('cari: angka nominal', ids('semua', '2500').length, 7);
cek('cari: tidak ketemu = daftar kosong', ids('semua', 'zzz'), []);
cek('cari + tab berlaku bersamaan', ids('kredit', 'pos-3'), [4]);
cek('baris dengan kolom kosong tidak melempar galat', cocokCari({}, 'a'), false);

// --- beda tafsir & ringkasan ------------------------------------------------
cek('beda tafsir: tanpa nomor order tak bisa dibandingkan', bedaBayarCek(baris(1), peta), null);
cek('beda tafsir: order tak ada di register = null', bedaBayarCek(baris(1, { orderNo: 'POS-9' }), peta), null);
cek('hitung beda tafsir', hitungBedaBayar(daftar, peta), 1);
cek('nilai pesanan tanpa cek', nilaiTanpaCek([{ total: 25000 }, { total: 1000 }]), 26000);
cek('nilai pesanan tanpa cek: kosong = 0', nilaiTanpaCek([]), 0);

// --- bukti gambar -----------------------------------------------------------
const foto = (cekid, imagesJson) => ({ cekid, imagesJson });
const petaF = petaFoto([
  foto('cek-braka-2026-11-08-1', JSON.stringify([{ url: 'a.jpg', filename: 'a.jpg' }])),
  foto('Cek-Braka-2026-11-08-2', JSON.stringify([{ url: 'b.jpg' }])),
  foto('cek-braka-2026-11-08-3', '{rusak'),      // JSON rusak: diabaikan, bukan galat
  foto('cek-braka-2026-11-08-4', '[]'),          // kosong: tidak masuk peta
]);
cek('kunci foto dari id', kunciFoto(baris(1), 'Braka'), 'cek-braka-2026-11-08-1');
cek('kunci foto dari cekid eksplisit (baris hasil arsip)', kunciFoto(baris(9, { cekid: 'Cek-Braka-2026-11-08-2' }), 'Braka'), 'cek-braka-2026-11-08-2');
cek('bukti gambar ketemu walau beda huruf besar/kecil', fotoUntuk(baris(2), petaF, 'Braka').length, 1);
cek('imagesJson rusak = tanpa gambar', fotoUntuk(baris(3), petaF, 'Braka'), []);
cek('imagesJson kosong = tanpa gambar', fotoUntuk(baris(4), petaF, 'Braka'), []);
cek('baris tanpa bukti = daftar kosong', fotoUntuk(baris(77), petaF, 'Braka'), []);

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
