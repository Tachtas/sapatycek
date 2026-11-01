// Uji cocokPerPenjual: cek kasir (per penjual, kode+nominal) vs penjualan
// sapatypos (per order, menyimpan NAMA penjual).
import { cocokPerPenjual, hitungRingkasan, selesaiSaja } from '/tmp/cek-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}

const cek1 = (salesmanNama, nominal, salesman = '', tambah = {}) =>
  Object.assign({ salesmanNama, salesman, nominal, dibayar: 0 }, tambah);
const jual = (salesman, total) => ({ salesman, total, orderNo: 'POS-x' });

// 1. penjual yang pas
cek('penjual pas → selisih 0',
    cocokPerPenjual([cek1('Neman', 300000)], [jual('Neman', 300000)]).map((b) => [b.nama, b.selisih, b.hanya]),
    [['Neman', 0, '']]);

// 2. penjual kurang bawa uang
cek('cek lebih kecil dari penjualan → selisih positif',
    cocokPerPenjual([cek1('Sjb', 80000)], [jual('Sjb', 100000)]).map((b) => b.selisih),
    [20000]);

// 3. INTI: total hari seimbang, tapi satu orang kurang dan satu lebih
const campur = cocokPerPenjual(
  [cek1('Indi', 50000), cek1('Jasri', 150000)],
  [jual('Indi', 100000), jual('Jasri', 100000)],
);
cek('total seimbang (200rb = 200rb) tapi per penjual tidak',
    [campur.reduce((a, b) => a + b.penjualan, 0), campur.reduce((a, b) => a + b.cek, 0),
     campur.filter((b) => b.selisih !== 0).length],
    [200000, 200000, 2]);
cek('yang paling melenceng diurut lebih dulu',
    campur.map((b) => b.nama), ['Indi', 'Jasri']);

// 4. hanya di satu sisi
cek('penjualan tanpa cek → hanya=penjualan',
    cocokPerPenjual([], [jual('Melaty', 90000)]).map((b) => [b.nama, b.hanya]),
    [['Melaty', 'penjualan']]);
cek('cek tanpa penjualan → hanya=cek',
    cocokPerPenjual([cek1('Vita', 40000)], []).map((b) => [b.nama, b.hanya]),
    [['Vita', 'cek']]);

// 5. kode huruf dipakai kalau nama belum diterjemahkan (kode tak dikenal)
cek('kode dipakai bila nama kosong',
    cocokPerPenjual([cek1('', 25000, 'm')], []).map((b) => b.nama),
    ['m']);

// 6. nama dicocokkan tanpa peduli huruf besar/spasi
cek('nama dicocokkan tanpa peduli huruf besar',
    cocokPerPenjual([cek1('NEMAN', 10000)], [jual(' neman ', 10000)]).map((b) => b.selisih),
    [0]);

// 7. baris tanpa penjual tetap tampil (jumlah tidak menghilang dari layar)
cek('penjualan tanpa nama penjual tetap dikelompokkan',
    cocokPerPenjual([], [jual('', 7000)]).map((b) => [b.nama, b.penjualan]),
    [['(tanpa penjual)', 7000]]);

// 8. dibayar dijumlahkan terpisah dari nominal cek
cek('dibayar dihitung terpisah',
    cocokPerPenjual([cek1('Sjb', 100000, '', { dibayar: 60000 })], [jual('Sjb', 100000)])
      .map((b) => [b.cek, b.dibayar]),
    [[100000, 60000]]);

// 9. PENJUALAN BELUM SELESAI tidak boleh ikut dicocokkan
//    ('Proses' = keranjang hidup, 'Pending' = ditahan; lihat sapaty-pos/Kasir.svelte)
const jualS = (salesman, total, status) => ({ salesman, total, orderNo: 'POS-' + status, status });

cek('penjualan "Proses" tidak dihitung — penjualnya tetap tampil karena ada baris cek',
    cocokPerPenjual([cek1('Neman', 0)], [jualS('Neman', 500000, 'Proses')]).map((b) => [b.nama, b.penjualan, b.order]),
    [['Neman', 0, 0]]);
cek('penjualan "Pending" tidak dihitung',
    cocokPerPenjual([], [jualS('Jasri', 250000, 'Pending')]).map((b) => b.nama),
    []);
cek('penjualan selesai ("Closing") tetap dihitung',
    cocokPerPenjual([], [jualS('Indi', 120000, 'Closing')]).map((b) => [b.nama, b.penjualan]),
    [['Indi', 120000]]);
cek('kode riwayat Ollsera ("Z") tetap dihitung — itu penjualan tuntas',
    cocokPerPenjual([], [jualS('Vita', 90000, 'Z')]).map((b) => b.penjualan),
    [90000]);
cek('status kosong tetap dihitung (baris tidak disembunyikan)',
    cocokPerPenjual([], [jualS('Sindi', 7000, '')]).map((b) => b.penjualan),
    [7000]);
cek('campur: hanya yang selesai yang masuk',
    cocokPerPenjual([], [jualS('Neman', 100000, 'Closing'), jualS('Neman', 999000, 'Proses'),
                         jualS('Neman', 111000, 'Pending')]).map((b) => [b.penjualan, b.order]),
    [[100000, 1]]);

cek('selesaiSaja membuang Proses & Pending, sisanya utuh',
    selesaiSaja([{ status: 'Proses' }, { status: 'Closing' }, { status: 'Pending' }, { status: 'Z' }, {}]).length,
    3);
cek('ringkasan: totalPenjualan hanya dari yang selesai',
    hitungRingkasan([], [jualS('Neman', 200000, 'Closing'), jualS('Neman', 500000, 'Proses')]).totalPenjualan,
    200000);
cek('ringkasan: penjualanTanpaCek tidak memuat yang belum selesai',
    hitungRingkasan([], [jualS('Neman', 200000, 'Closing'), jualS('Jasri', 500000, 'Proses')])
      .penjualanTanpaCek.map((p) => p.salesman),
    ['Neman']);

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
