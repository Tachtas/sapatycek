// Uji binding hasil generate ulang: sambung ke modul, berlangganan 4 tabel
// yang dipakai sapatycek, lalu baca jumlah barisnya. Halaman ini hanya untuk
// pembuktian (tanpa login), bukan bagian aplikasi.
import { DbConnection } from './src/module_bindings';

const log = (t: string) => {
  document.body.insertAdjacentText('beforeend', t + '\n');
};

try {
  const conn = DbConnection.builder()
    .withUri('https://maincloud.spacetimedb.com')
    .withDatabaseName('sapaty-pos')
    .onConnect((c: any) => {
      log('OK tersambung, identity=' + String(c.identity).slice(0, 12));
      c.db.cek.onInsert(() => {});
      c.db.penjualan.onInsert(() => {});
      c.subscriptionBuilder()
        .onApplied(() => {
          const cek = Array.from(c.db.cek.iter());
          const pj = Array.from(c.db.penjualan.iter());
          log('OK langganan aktif: cek=' + cek.length + ' penjualan=' + pj.length);
          // Bentuk API yang dipakai App.svelte setelah binding di-generate ulang
          log('tabel: cek=' + (typeof c.db.cek?.iter) + ' penjualan=' + (typeof c.db.penjualan?.iter) +
              ' staff=' + (typeof c.db.staff?.iter) + ' salesman=' + (typeof c.db.salesman?.iter));
          log('reducer app: bayar=' + (typeof c.reducers.catatBayarCek) + ' tambah=' + (typeof c.reducers.tambahDeklarasiCek) +
              ' update=' + (typeof c.reducers.updateDeklarasiCek) + ' hapus=' + (typeof c.reducers.hapusDeklarasiCek));
          log('contoh cek: ' + JSON.stringify((cek[0] as any)?.salesman ?? null) + ' / ' + String((cek[0] as any)?.tanggal ?? ''));
          log('SELESAI');
        })
        .onError((_ctx: any, err: any) => log('GAGAL langganan: ' + err))
        .subscribe(['SELECT * FROM cek', 'SELECT * FROM penjualan', 'SELECT * FROM staff', 'SELECT * FROM salesman']);
    })
    .onConnectError((_ctx: any, err: any) => log('GAGAL sambung: ' + err))
    .build();
  log('builder jalan, menunggu…');
} catch (e) {
  log('GAGAL bangun koneksi: ' + String(e));
}

// batas waktu uji
setTimeout(() => log('BATAS WAKTU'), 25000);
