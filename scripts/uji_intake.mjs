// Uji module intake (src/lib/intake.ts) lewat interface-nya saja — adapter
// reducer PALSU, jadi seam-nya nyata (SpacetimeDB di produksi, palsu di sini).
//
// Dijaga di sini, semua pernah jadi bug nyata di App.svelte:
//   (a) baris cek yang diketik tampil seketika dan diserap baris server,
//   (b) dua rantai pembayaran tidak boleh membayar satu baris dua kali,
//   (c) pembayaran baris yang belum punya id server harus menunggu baris ITU,
//       bukan meluncur ke cek lain yang nominalnya kebetulan sama,
//   (d) internet putus: cek masuk antrean dan tetap tampil di layar,
//   (e) antrean dikirim berurutan dan berhenti pada kegagalan pertama.
import { buatIntake } from '/tmp/intake-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}

const TANGGAL = '2026-11-08';
const NAMA = (k) => ({ m: 'Melaty', s: 'Sjb', n: 'Neman' }[k] ?? '');

/** Dunia uji: adapter reducer palsu + baris server yang bisa ditumbuhkan. */
function buatDunia({ status = 'terhubung', gagalSimpan = false, gagalBayar = false, lambatBayar = 0, gantungSimpan = false, gagalUbah = false } = {}) {
  const panggilan = { tambah: [], bayar: [], ubah: [], hapus: [], sapu: [] };
  let log = [];
  const antreanDaftar = [];
  const server = [];
  let idServer = 0;
  let statusKini = status;
  let bayarBerjalan = 0;
  let bayarPuncak = 0;
  let cermin = [];
  const peristiwa = [];

  const conn = {
    reducers: {
      async tambahDeklarasiCek(p) {
        panggilan.tambah.push(p);
        // Gantung: reducer tidak pernah menjawab (perjalanan tulis belum selesai),
        // jadi baris server tidak pernah tiba.
        if (gantungSimpan) return new Promise(() => {});
        if (gagalSimpan) throw new Error('reducer menolak');
        // Server membalas dengan baris berid positif (idempoten: baris kembar
        // tidak ditambah, tapi di uji ini cukup satu baris).
        server.push({
          id: BigInt(++idServer),
          outlet: p.outlet, tanggal: p.tanggal, jam: p.jam, salesman: p.salesman,
          salesmanNama: p.salesmanNama, nominal: p.nominal, dibayar: 0n, tipe: p.tipe,
          kredit: false, status: 'Belum Cocok', orderNo: '', customer: '',
        });
      },
      async updateDeklarasiCek(p) {
        panggilan.ubah.push(p);
        if (gagalUbah) throw new Error('ubah ditolak');
      },
      async hapusDeklarasiCek(p) {
        panggilan.hapus.push(p);
      },
      async bersihkanCekLama(p) {
        panggilan.sapu.push(p);
      },
      async catatBayarCek(p) {
        bayarBerjalan++;
        bayarPuncak = Math.max(bayarPuncak, bayarBerjalan);
        if (lambatBayar) await new Promise((r) => setTimeout(r, lambatBayar));
        panggilan.bayar.push(p);
        bayarBerjalan--;
        if (gagalBayar) throw new Error('bayar ditolak');
      },
    },
  };

  const intake = buatIntake({
    conn: () => conn,
    status: () => statusKini,
    outlet: 'Braka',
    tanggal: TANGGAL,
    cariNama: NAMA,
    barisBerubah: (o) => { cermin = o; },
    barisBaru: () => {},
    barisServer: () => server,
    terimaCek: () => { peristiwa.push('terimaCek'); },
    mulaiBayar: () => { peristiwa.push('mulaiBayar'); },
    antrean: {
      daftar: () => antreanDaftar,
      tambah: (e) => antreanDaftar.push(e),
      buang: (ref) => { const i = antreanDaftar.findIndex((x) => x.ref === ref); if (i >= 0) antreanDaftar.splice(i, 1); },
    },
    acak: () => 'ref-' + (antreanDaftar.length + 1),
    tidur: () => Promise.resolve(),
    bacaLogPurge: () => log,
  });
  return {
    intake,
    panggilan,
    server,
    antrean: antreanDaftar,
    cermin: () => cermin,
    peristiwa: () => [...peristiwa],
    setStatus: (s) => { statusKini = s; },
    setGagalUbah: (v) => { gagalUbah = v; },
    setLog: (l) => { log = l; },
    puncakBayar: () => bayarPuncak,
    /** Baris server seperti yang dilihat layar (diurut seperti refreshData). */
    rekonsiliasi: () => intake.rekonsiliasi(server),
  };
}

// ---------------------------------------------------------------- (a) simpan
{
  const d = buatDunia();
  const hasil = await d.intake.simpan('25m1');
  cek('simpan utuh: hasil tersimpan', hasil, { jenis: 'tersimpan' });
  cek('simpan utuh: reducer dipanggil sekali', d.panggilan.tambah.length, 1);
  const p = d.panggilan.tambah[0];
  cek('simpan utuh: payload reducer lengkap', [p.outlet, p.tanggal, p.salesman, p.salesmanNama, Number(p.nominal), p.tipe, p.kredit, Number(p.dibayar)],
    ['Braka', TANGGAL, 'Melaty', 'Melaty', 25000, 'Ecer', false, 0]);
  cek('simpan utuh: baris optimis tampil sebelum server menjawab', d.intake.optimis().length, 1);
  cek('simpan utuh: id baris optimis negatif', d.intake.optimis()[0].id < 0n, true);
  d.rekonsiliasi();
  cek('simpan utuh: baris optimis diserap baris server', d.intake.optimis().length, 0);
  cek('simpan utuh: layar diberi tahu untuk mengosongkan kolom Cek', d.peristiwa(), ['terimaCek']);
}
{
  const d = buatDunia();
  cek('simpan belum lengkap: ditolak', (await d.intake.simpan('25')).jenis, 'belum_lengkap');
  cek('simpan belum lengkap: reducer tidak dipanggil', d.panggilan.tambah.length, 0);
  cek('simpan belum lengkap: tidak ada baris di layar', d.intake.optimis().length, 0);
  cek('simpan belum lengkap: kolom Cek TIDAK dikosongkan', d.peristiwa(), []);
}
{
  const d = buatDunia({ gagalSimpan: true });
  const hasil = await d.intake.simpan('25m1');
  cek('simpan gagal: hasil gagal', hasil.jenis, 'gagal');
  cek('simpan gagal: baris optimis dibuang dari layar', d.intake.optimis().length, 0);
}
{
  const d = buatDunia({ status: 'terputus' });
  const hasil = await d.intake.simpan('25m1');
  cek('offline: masuk antrean', [hasil.jenis, hasil.belumTerkirim], ['antre', 1]);
  cek('offline: baris tetap tampil di layar', d.intake.optimis().length, 1);
  cek('offline: layar diberi tahu untuk mengosongkan kolom Cek', d.peristiwa(), ['terimaCek']);
  cek('offline: reducer tidak dipanggil', d.panggilan.tambah.length, 0);
  cek('offline: antrean menyimpan nominal sebagai teks', d.antrean[0].nominal, '25000');
}

// ---------------------------------------------------------------- (b)(c) bayar
{
  const d = buatDunia();
  await d.intake.simpan('25m1');
  d.rekonsiliasi(); // baris server tiba: baris optimis diserap, id server dipetakan
  const baris = d.server[0];
  // Dua rantai pembayaran berbarengan pada baris yang sama.
  const hasil = await Promise.all([d.intake.bayar(baris, '30'), d.intake.bayar(baris, '30')]);
  cek('bayar ganda: hanya satu panggilan ke server', d.panggilan.bayar.length, 1);
  cek('bayar ganda: satu lunas, satu kosong', hasil.map((h) => h.jenis), ['lunas', 'kosong']);
  cek('bayar ganda: tidak ada dua pembayaran berjalan', d.puncakBayar(), 1);
}
{
  const d = buatDunia({ gantungSimpan: true });
  void d.intake.simpan('25m1'); // reducer menggantung: barisnya belum ada di server
  await new Promise((r) => setImmediate(r));
  const optimis = d.intake.optimis()[0];
  cek('prasyarat: baris optimis tampil walau reducer menggantung', optimis?.id < 0n, true);
  // Cek LAIN di server dengan nominal sama persis — jangan sampai tersasar.
  d.server.push({
    id: 99n, outlet: 'Braka', tanggal: TANGGAL, jam: '00:00:00', salesman: 'Melaty',
    salesmanNama: 'Melaty', nominal: 25000n, dibayar: 0n, tipe: 'Ecer', kredit: false,
  });
  d.rekonsiliasi();
  const hasil = await d.intake.bayar(optimis, '30');
  cek('bayar baris yang belum tersimpan: menunggu, tidak menyerobot', hasil.jenis, 'tunggu_id');
  cek('bayar baris yang belum tersimpan: server tidak dipanggil', d.panggilan.bayar.length, 0);
}
{
  const d = buatDunia();
  await d.intake.simpan('25m1');
  const optimis = d.intake.optimis()[0];
  // Baris server tiba (seperti sesudah langganan menyusul ~2 detik).
  d.rekonsiliasi();
  const hasil = await d.intake.bayar(optimis, '30');
  cek('bayar baris baru: memakai id SERVER', String(d.panggilan.bayar[0].cekId), '1');
  cek('bayar baris baru: kembalian dihitung', [hasil.jenis, hasil.bayar, hasil.kembali], ['lunas', 30000, 5000]);
}
{
  const d = buatDunia();
  d.server.push({ id: 7n, outlet: 'Braka', tanggal: TANGGAL, jam: '09:00:00', salesman: 'Sjb', salesmanNama: 'Sjb', nominal: 40000n, dibayar: 10000n, tipe: 'Ecer', kredit: false });
  const hasil = await d.intake.bayar(d.server[0], '50');
  cek('bayar baris lama: memakai id baris itu', String(d.panggilan.bayar[0].cekId), '7');
  cek('bayar baris lama: nominal selalu ribuan', Number(d.panggilan.bayar[0].nominalBayar), 50000);
  cek('bayar baris lama: kembali = bayar - sisa tagihan', hasil.kembali, 20000);
  cek('bayar baris lama: kolom Bayar dikosongkan sebelum tulis', d.peristiwa(), ['mulaiBayar']);
}
{
  const d = buatDunia({ status: 'terputus' });
  cek('bayar tanpa koneksi: ditolak', (await d.intake.bayar({ id: 1n }, '30')).jenis, 'butuh_koneksi');
  cek('bayar tanpa koneksi: server tidak dipanggil', d.panggilan.bayar.length, 0);
}
{
  const d = buatDunia({ gagalBayar: true });
  d.server.push({ id: 5n, outlet: 'Braka', tanggal: TANGGAL, jam: '09:00:00', salesman: 'Sjb', salesmanNama: 'Sjb', nominal: 40000n, dibayar: 0n, tipe: 'Ecer', kredit: false });
  cek('bayar gagal: pesan diteruskan', (await d.intake.bayar(d.server[0], '40')).jenis, 'gagal');
}

// ---------------------------------------------------------------- (e) antrean
{
  const d = buatDunia({ status: 'terputus' });
  await d.intake.simpan('25m1');
  await d.intake.simpan('30s1');
  d.setStatus('terhubung');
  const terkirim = await d.intake.kirimAntrean();
  cek('antrean tersambung lagi: dua cek terkirim', terkirim, 2);
  cek('antrean tersambung lagi: antrean kosong', d.antrean.length, 0);
  cek('antrean tersambung lagi: payload sama bentuknya dgn jalur online',
    d.panggilan.tambah.map((p) => [Number(p.nominal), p.kredit, Number(p.dibayar)]),
    [[25000, false, 0], [30000, false, 0]]);
}
{
  const d = buatDunia({ status: 'terputus' });
  await d.intake.simpan('25m1');
  await d.intake.simpan('30s1');
  d.setStatus('terhubung');
  let tolak = true;
  const intakeGagal = buatIntake({
    conn: () => ({ reducers: { async tambahDeklarasiCek() { if (tolak) throw new Error('putus lagi'); } } }),
    status: () => 'terhubung',
    outlet: 'Braka', tanggal: TANGGAL, cariNama: NAMA,
    barisBerubah: () => {}, barisBaru: () => {}, barisServer: () => [],
    antrean: { daftar: () => d.antrean, tambah: () => {}, buang: () => {} },
    acak: () => 'x', tidur: () => Promise.resolve(),
  });
  cek('antrean gagal di tengah: berhenti, tidak menghapus apa pun',
    [await intakeGagal.kirimAntrean(), d.antrean.length], [0, 2]);
  tolak = false;
  cek('antrean dicoba lagi: dua terkirim', await intakeGagal.kirimAntrean(), 2);
}

// ---------------------------------------------------------------- (f) ubah & hapus
{
  const d = buatDunia();
  d.server.push({
    id: 12n, outlet: 'Braka', tanggal: TANGGAL, jam: '09:00:00', salesman: 'm',
    salesmanNama: 'Melaty', nominal: 25000n, dibayar: 5000n, tipe: 'Ecer', kredit: false,
  });
  const baris = d.server[0];
  const hasil = await d.intake.ubah(baris, { nominal: 40000n });
  cek('ubah: reducer menerima SELURUH nilai, bukan hanya tambalan',
    [hasil.jenis, d.panggilan.ubah.length, String(d.panggilan.ubah[0].nominal), String(d.panggilan.ubah[0].dibayar), d.panggilan.ubah[0].tipe, d.panggilan.ubah[0].kredit],
    ['ok', 1, '40000', '5000', 'Ecer', false]);
  await d.intake.ubah(baris, { kredit: true, salesmanNama: 'Neman', salesman: 'Neman' });
  cek('ubah kredit: hanya kolom yang diubah, sisanya tetap',
    [d.panggilan.ubah[1].kredit, d.panggilan.ubah[1].salesmanNama, String(d.panggilan.ubah[1].nominal)],
    [true, 'Neman', '25000']);
  const hasilHapus = await d.intake.hapus(baris);
  cek('hapus: reducer menerima id barisnya', [hasilHapus.jenis, String(d.panggilan.hapus[0].id)], ['ok', '12']);
}
{
  const d = buatDunia();
  await d.intake.simpan('25m1');
  const optimis = d.intake.optimis()[0];
  cek('ubah baris optimis: ditolak (belum ada di server)', (await d.intake.ubah(optimis, { nominal: 1n })).jenis, 'belum_di_server');
  cek('ubah baris optimis: reducer tidak dipanggil', d.panggilan.ubah.length, 0);
  cek('hapus baris optimis: ditolak', (await d.intake.hapus(optimis)).jenis, 'belum_di_server');
}
{
  const d = buatDunia({ status: 'terputus' });
  const hasil = await d.intake.ubah({ id: 1n, optimis: false }, { nominal: 1n });
  cek('ubah tanpa koneksi: ditolak dengan alasan, TIDAK diantrekan',
    [hasil.jenis, hasil.aksi, d.panggilan.ubah.length], ['butuh_koneksi', 'mengubah cek', 0]);
  cek('hapus tanpa koneksi: ditolak', (await d.intake.hapus({ id: 1n })).aksi, 'menghapus cek');
}
{
  const d = buatDunia();
  d.setGagalUbah(true);
  const hasil = await d.intake.ubah(d.server[0] ?? { id: 5n }, { nominal: 1n });
  cek('ubah gagal: pesan dari server diteruskan', hasil.jenis, 'gagal');
}

// ---------------------------------------------------------------- (g) sapu cek lama
{
  const d = buatDunia();
  cek('sapu: tersedia saat tersambung', d.intake.adaSapu(), true);
  const uji = await d.intake.bersihkanCekLama(true);
  cek('sapu uji: reducer menerima dryRun true', [uji.jenis, d.panggilan.sapu[0].dryRun], ['ok', true]);
  const jalan = await d.intake.bersihkanCekLama(false);
  cek('sapu jalan: reducer menerima dryRun false', [jalan.jenis, d.panggilan.sapu[1].dryRun], ['ok', false]);
}
{
  const kosong = buatIntake({
    conn: () => ({ reducers: {} }),
    status: () => 'terhubung',
    outlet: 'Braka', tanggal: TANGGAL, cariNama: NAMA,
    barisBerubah: () => {}, barisBaru: () => {}, barisServer: () => [],
    terimaCek: () => {}, mulaiBayar: () => {},
    antrean: { daftar: () => [], tambah: () => {}, buang: () => {} },
    acak: () => 'x', tidur: () => Promise.resolve(), bacaLogPurge: () => [],
  });
  cek('sapu: bundel lama tanpa reducer = tidak tersedia', kosong.adaSapu(), false);
  cek('sapu: ditolak dengan alasan yang jelas', (await kosong.bersihkanCekLama(true)).jenis, 'reducer_tidak_ada');
}
{
  const d = buatDunia();
  d.setLog([
    { jenis: 'purge-cek', totalRows: 7, lastSyncedAt: { microsSinceUnixEpoch: 100 } },
    { jenis: 'lain', totalRows: 999, lastSyncedAt: { microsSinceUnixEpoch: 200 } },
    { jenis: 'purge-cek', totalRows: 3, lastSyncedAt: { microsSinceUnixEpoch: 150 } },
  ]);
  cek('jejak uji: diambil yang TERBARU, dan hanya jenis purge-cek', d.intake.logPurgeTerakhir(), 3);
  d.setLog([]);
  cek('jejak uji: kosong = 0', d.intake.logPurgeTerakhir(), 0);
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
