// Uji pencocokan cek kasir vs penjualan register untuk RINGKASAN HARI.
//
// Dijaga di sini: penjualan yang BELUM SELESAI tidak boleh ikut dicocokkan.
// 'Proses' = keranjang yang masih hidup, 'Pending' = transaksi ditahan; keduanya
// masih bisa berubah nilainya, jadi menghitungnya membuat cek kasir tampak
// kurang atau lebih tanpa sebab yang bisa dijelaskan ke operator.
//
// Filternya ada DI DALAM hitungRingkasan() (lewat selesaiSaja()), bukan di
// pemanggil, supaya tidak ada pemanggil yang bisa lupa.
//
// (Pencocokan per penjual — cocokPerPenjual — dibuang 8 Nov 2026: tidak pernah
// dipakai layar, dan selisih per penjual adalah urusan pemilik, bukan layar
// kasir yang dipakai untuk menginput.)
import { hitungRingkasan, selesaiSaja } from '/tmp/cek-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}

const cek1 = (salesmanNama, nominal, tambah = {}) =>
  Object.assign({ salesmanNama, salesman: '', nominal, dibayar: 0 }, tambah);
const jualS = (salesman, total, status) => ({ salesman, total, orderNo: 'POS-' + status, status });

// --- selesaiSaja: daftar PENGECUALIAN, bukan syarat 'Closing' ---
cek('selesaiSaja membuang Proses & Pending, sisanya utuh',
  selesaiSaja([{ status: 'Proses' }, { status: 'Closing' }, { status: 'Pending' }, { status: 'Z' }, {}]).length,
  3);
cek('status kosong tetap dihitung (baris tidak disembunyikan)',
  selesaiSaja([{}, { status: '' }, { status: null }]).length, 3);
cek('kode riwayat Ollsera tetap dihitung',
  selesaiSaja([{ status: 'Z' }, { status: 'A' }]).length, 2);
cek('daftar kosong aman', selesaiSaja([]).length, 0);

// --- hitungRingkasan memakai filter itu di dalamnya ---
cek('totalPenjualan hanya dari yang selesai',
  hitungRingkasan([], [jualS('Neman', 200000, 'Closing'), jualS('Neman', 500000, 'Proses')]).totalPenjualan,
  200000);
cek('penjualanTanpaCek tidak memuat yang belum selesai',
  hitungRingkasan([], [jualS('Neman', 200000, 'Closing'), jualS('Jasri', 500000, 'Proses')])
    .penjualanTanpaCek.map((p) => p.salesman),
  ['Neman']);
cek('selisih = penjualan selesai - cek kasir',
  hitungRingkasan([cek1('Melaty', 80000)], [jualS('Melaty', 100000, 'Closing'), jualS('Melaty', 900000, 'Pending')]).selisih,
  20000);
cek('cek yang sudah punya pasangan POS tidak dihitung "tanpa cek"',
  hitungRingkasan([Object.assign(cek1('Melaty', 80000), { orderNo: 'POS-x', status: 'Cocok' })],
    [Object.assign(jualS('Melaty', 80000, 'Closing'), { orderNo: 'POS-x' })]).penjualanTanpaCek.length,
  0);

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
