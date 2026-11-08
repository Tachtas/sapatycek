// Uji module sambungan & sesi (src/lib/koneksi.ts) lewat interface-nya, dengan
// PABRIK KONEKSI PALSU dan TIMER PALSU — jadi sambung/putus/galat token bisa
// dibangkitkan, dan jeda sambung ulang bisa DIUKUR tanpa menunggu detik nyata.
//
// Dijaga di sini, semuanya pernah jadi keluhan nyata operator:
//   (a) koneksi yang putus (jaringan kedip, HP tidur) harus menyambung lagi
//       SENDIRI, dengan jeda yang makin panjang lalu mentok 30 detik,
//   (b) token yang hampir habis diperpanjang SEBELUM menyambung, bukan sesudah,
//   (c) token yang ditolak walau belum terlihat kedaluwarsa: coba perpanjang
//       dulu; hanya kalau gagal operator diminta masuk ulang — dan tidak
//       bolak-balik (penjaga 20 detik),
//   (d) langganan membaca view, bukan tabel privat, dan satu jalur baca melayani
//       semua pemberitahuan,
//   (e) snapsh hanya berisi cek outlet ini untuk hari ini, terbaru dulu.
import { buatKoneksi, SNAPSH_KOSONG, KUERI_LANGGANAN } from '/tmp/koneksi-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}
const tunggu = () => new Promise((r) => setImmediate(r));

/** Dunia uji: pabrik koneksi palsu + timer palsu + pembaca kejadian. */
function buatDunia({
  adaToken = true,
  email = 'tachtasandangsjb@gmail.com',
  diizinkan = true,
  kedaluwarsa = false,
  segeraHabis = false,
  perpanjangBerhasil = true,
  bolehCobaLagi = true,
} = {}) {
  const jejak = { pabrik: [], token: [], sesi: [], status: [], masukUlang: 0, tandai: 0, perpanjang: 0, kueri: null, klaim: [], langgananDibaca: 0 };
  const timer = [];
  let token = adaToken ? 'token-lama' : undefined;
  // Token yang baru diperpanjang TIDAK kedaluwarsa lagi — sama seperti di
  // produksi, di sana kedaluwarsanya dibaca dari token yang tersimpan.
  let kedaluwarsaKini = kedaluwarsa;
  let bangun = null; // koneksi yang sedang dipakai

  const catatStatus = (s, g) => jejak.status.push([s, g]);
  const db = {
    cekAman: { baris: [], onInsert: (f) => (db.cekAman._p = f), onUpdate: (f) => (db.cekAman._u = f), onDelete: (f) => (db.cekAman._d = f), iter: () => db.cekAman.baris },
    penjualanAman: { baris: [], onInsert: (f) => (db.penjualanAman._p = f), onUpdate: (f) => (db.penjualanAman._u = f), onDelete: () => {}, iter: () => db.penjualanAman.baris },
    salesmanAman: { baris: [], onInsert: (f) => (db.salesmanAman._p = f), onUpdate: (f) => (db.salesmanAman._u = f), onDelete: (f) => (db.salesmanAman._d = f), iter: () => db.salesmanAman.baris },
    cekFotoAman: { baris: [], onInsert: (f) => (db.cekFotoAman._p = f), onUpdate: (f) => (db.cekFotoAman._u = f), onDelete: () => {}, iter: () => db.cekFotoAman.baris },
  };
  const langganan = {
    onApplied(f) { langganan._a = f; return langganan; },
    subscribe(q) { jejak.kueri = q; if (langganan._a) langganan._a(); return langganan; },
  };

  const pabrik = () => {
    const b = {
      _uri: null, _db: null, _token: undefined,
      withUri(u) { b._uri = u; return b; },
      withDatabaseName(d) { b._db = d; return b; },
      withToken(t) { b._token = t; jejak.token.push(t); return b; },
      onConnect(f) { b._c = f; return b; },
      onDisconnect(f) { b._d = f; return b; },
      onConnectError(f) { b._e = f; return b; },
      build() {
        jejak.pabrik.push({ uri: b._uri, db: b._db });
        bangun = {
          db,
          reducers: { klaimAkun: (p) => { jejak.klaim.push(p); return Promise.resolve(); } },
          subscriptionBuilder: () => langganan,
          nyambung() { b._c(bangun); },
          putus() { b._d(); },
          galat(e) { b._e({}, e); },
        };
        return bangun;
      },
    };
    return b;
  };

  const koneksi = buatKoneksi({
    pabrik,
    uri: 'https://maincloud.spacetimedb.com',
    dbName: 'sapaty-pos',
    outlet: 'Braka',
    tanggal: '2026-11-08',
    token: () => token,
    email: () => email,
    emailDiizinkan: () => diizinkan,
    tokenKedaluwarsa: () => kedaluwarsaKini,
    tokenSegeraHabis: () => segeraHabis,
    perpanjangToken: async () => {
      jejak.perpanjang++;
      if (perpanjangBerhasil) { token = 'token-baru'; kedaluwarsaKini = false; }
      return perpanjangBerhasil;
    },
    bolehCobaLagi: () => bolehCobaLagi,
    tandaiCobaLagi: () => { jejak.tandai++; },
    masukUlang: () => { jejak.masukUlang++; },
    snapshBerubah: () => {},
    statusBerubah: catatStatus,
    sesiBerubah: (s, em) => jejak.sesi.push([s, em]),
    saatTersambung: () => { jejak.tersambung = (jejak.tersambung ?? 0) + 1; },
    saatPutus: () => { jejak.putus = (jejak.putus ?? 0) + 1; },
    jadwalkan: (fn, ms) => { const h = { fn, ms, dibatalkan: false }; timer.push(h); return h; },
    batalkan: (h) => { h.dibatalkan = true; },
  });

  return {
    koneksi, jejak, db, timer,
    /** Jalankan timer ke-n (0 = yang paling awal) seolah waktunya tiba. */
    jalankanTimer: async (i = 0) => { const h = timer[i]; await h.fn(); await tunggu(); },
    timerAktif: () => timer.filter((h) => !h.dibatalkan).length,
    setKedaluwarsa: (v) => { kedaluwarsaKini = v; },
    setSegeraHabis: (v) => { segeraHabis = v; },
    setBolehCobaLagi: (v) => { bolehCobaLagi = v; },
    sambungSekarang: () => bangun?.nyambung(),
    putusSekarang: () => bangun?.putus(),
    galatSekarang: (e) => bangun?.galat(e),
  };
}

const barisCek = (id, tanggal, outlet = 'Braka', jam = '09:00:00', nominal = 25000) =>
  ({ id: BigInt(id), tanggal, outlet, jam, nominal: BigInt(nominal), dibayar: 0n, tipe: 'Ecer', salesmanNama: 'Melaty' });

// ---------------------------------------------------------- (gerbang sesi)
{
  const d = buatDunia({ adaToken: false });
  d.koneksi.siapkanSesi();
  cek('tanpa token: belum login', d.jejak.sesi, [['belum_login', '']]);
  cek('tanpa token: tidak menyambung', d.jejak.pabrik.length, 0);
}
{
  const d = buatDunia({ diizinkan: false });
  d.koneksi.siapkanSesi();
  cek('email di luar daftar: ditolak + emailnya dibawa ke kartu', d.jejak.sesi, [['ditolak', 'tachtasandangsjb@gmail.com']]);
}
{
  const d = buatDunia({ kedaluwarsa: true });
  d.koneksi.siapkanSesi();
  cek('token kedaluwarsa: sesi ditandai kedaluwarsa', d.jejak.sesi[0][0], 'kedaluwarsa');
  await tunggu();
  cek('token kedaluwarsa: diperpanjang diam-diam lalu jadi oke', [d.jejak.perpanjang, d.jejak.sesi.map((x) => x[0])], [1, ['kedaluwarsa', 'oke']]);
  cek('token kedaluwarsa: menyambung dengan token BARU', d.jejak.token, ['token-baru']);
}
{
  const d = buatDunia({ kedaluwarsa: true, perpanjangBerhasil: false });
  d.koneksi.siapkanSesi();
  await tunggu();
  cek('perpanjangan gagal: operator diminta masuk ulang', [d.jejak.masukUlang, d.jejak.tandai], [1, 1]);
}

// ---------------------------------------------------------- (sambung & baca)
{
  const d = buatDunia();
  d.koneksi.sambung();
  cek('sambung: pabrik menerima uri & nama db', d.jejak.pabrik, [{ uri: 'https://maincloud.spacetimedb.com', db: 'sapaty-pos' }]);
  d.sambungSekarang();
  await tunggu();
  cek('tersambung: status terhubung', d.jejak.status.at(-1), ['terhubung', false]);
  cek('tersambung: identity diklaim dengan email akun', d.jejak.klaim, [{ email: 'tachtasandangsjb@gmail.com' }]);
  cek('tersambung: langganan membaca VIEW (bukan tabel privat)', d.jejak.kueri, [...KUERI_LANGGANAN]);
  cek('tersambung: layar diberi tahu (antrean HP dikirim)', d.jejak.tersambung, 1);
}
{
  const d = buatDunia();
  d.db.cekAman.baris = [
    barisCek(3, '2026-11-08'),
    barisCek(9, '2026-11-08'),
    barisCek(5, '2026-11-07'),            // hari lain: bukan bagian daftar hari ini
    barisCek(7, '2026-11-08', 'Audi'),    // outlet lain
  ];
  d.db.penjualanAman.baris = [
    { orderNo: 'POS-1', outlet: 'Braka', orderDate: '2026-11-08', total: 25000 },
    { orderNo: 'POS-2', outlet: 'Braka', orderDate: '2026-11-07', total: 999 },
  ];
  d.db.salesmanAman.baris = [{ nama: 'Melaty' }];
  d.db.cekFotoAman.baris = [{ cekid: 'cek-braka-2026-11-08-3', imagesJson: '[]' }];
  d.koneksi.sambung();
  d.sambungSekarang();
  await tunggu();
  const s = d.koneksi.snapsh();
  cek('snapsh: hanya cek outlet+harian, terbaru dulu', s.cek.map((c) => Number(c.id)), [9, 3]);
  cek('snapsh: penjualan hari ini saja', s.penjualan.map((p) => p.orderNo), ['POS-1']);
  cek('snapsh: cek hari lama dihitung terpisah', s.cekLama, 1);
  cek('snapsh: salesman & foto ikut', [s.salesman.length, s.foto.length], [1, 1]);
  // Satu pemberitahuan dari langganan = baca ulang.
  d.db.cekAman.baris = [barisCek(11, '2026-11-08')];
  d.db.cekAman._p();
  cek('satu jalur baca melayani pemberitahuan insert', d.koneksi.snapsh().cek.map((c) => Number(c.id)), [11]);
  cek('snapsh awal tidak pernah bocor (mulai kosong)', SNAPSH_KOSONG.cek.length, 0);
}

// ---------------------------------------------------------- (a) jeda sambung ulang
{
  const d = buatDunia();
  d.koneksi.sambung();
  // Percobaan sambung GAGAL berulang (jaringan belum pulih) — jeda harus
  // bertambah dua kali lipat lalu mentok 30 detik.
  const jeda = [];
  for (let i = 0; i < 6; i++) {
    d.galatSekarang(new Error('jaringan kedip'));
    await tunggu();
    jeda.push(d.timer[i].ms);
    await d.jalankanTimer(i);
    await tunggu();
  }
  cek('percobaan gagal: status terputus + tanda gagal tiap kali',
    d.jejak.status.filter(([s, g]) => s === 'terputus' && g === true).length, 6);
  cek('jeda sambung ulang: 2·4·8·16 lalu MENTOK 30 detik', jeda, [2000, 4000, 8000, 16000, 30000, 30000]);
}
{
  const d = buatDunia();
  d.koneksi.sambung();
  d.sambungSekarang();
  d.putusSekarang();
  await tunggu();
  cek('putus: status terputus', d.jejak.status.at(-1), ['terputus', false]);
  cek('putus: layar diberi tahu', d.jejak.putus, 1);
}
{
  const d = buatDunia();
  d.koneksi.sambung();
  d.sambungSekarang();
  d.putusSekarang();
  await tunggu();
  d.jalankanTimer(0);
  await tunggu();
  cek('sambung ulang: pabrik dipanggil lagi', d.jejak.pabrik.length, 2);
  d.sambungSekarang();
  cek('sambung ulang: status kembali terhubung', d.jejak.status.at(-1), ['terhubung', false]);
  cek('sambung ulang: percobaan dihitung ulang dari nol', d.koneksi.gagal(), false);
}
{
  const d = buatDunia({ segeraHabis: true });
  d.koneksi.sambung();
  d.sambungSekarang();
  d.putusSekarang();
  await tunggu();
  d.jalankanTimer(0);
  await tunggu();
  cek('(b) token hampir habis: diperpanjang SEBELUM menyambung', [d.jejak.perpanjang, d.jejak.token.at(-1)], [1, 'token-baru']);
}
{
  const d = buatDunia();
  d.koneksi.sambung();
  d.sambungSekarang();
  d.putusSekarang();
  await tunggu();
  d.koneksi.tutup();
  cek('tutup: timer sambung ulang dibatalkan (tak ada timer nyangkut)', d.timerAktif(), 0);
}
{
  const d = buatDunia();
  d.koneksi.sambung();
  d.sambungSekarang();
  d.putusSekarang();
  d.putusSekarang(); // pemberitahuan kedua sebelum timer pertama menyala
  await tunggu();
  cek('putus berkali-kali sebelum timer menyala: tetap satu jadwal', d.timer.length, 1);
}

// ---------------------------------------------------------- (c) token ditolak
{
  const d = buatDunia({ perpanjangBerhasil: true });
  d.koneksi.sambung();
  d.galatSekarang(new Error('token ditolak'));
  await tunggu();
  cek('token ditolak: status putus + tanda gagal', d.jejak.status.at(-1), ['terputus', true]);
  cek('token ditolak: diperpanjang diam-diam, tidak minta masuk ulang', [d.jejak.perpanjang, d.jejak.masukUlang], [1, 0]);
  cek('token ditolak: sambung ulang dijadwalkan', d.timer.map((h) => h.ms), [2000]);
}
{
  const d = buatDunia({ perpanjangBerhasil: false });
  d.koneksi.sambung();
  d.galatSekarang(new Error('token ditolak'));
  await tunggu();
  cek('perpanjangan gagal: operator diminta masuk ulang', [d.jejak.masukUlang, d.jejak.tandai], [1, 1]);
  cek('perpanjangan gagal: tidak ada sambung ulang sia-sia', d.timer.length, 0);
}
{
  const d = buatDunia({ perpanjangBerhasil: false, bolehCobaLagi: false });
  d.koneksi.sambung();
  d.galatSekarang(new Error('token ditolak'));
  await tunggu();
  cek('(c) penjaga 20 detik: tidak bolak-balik minta login', [d.jejak.masukUlang, d.jejak.tandai], [0, 0]);
}
{
  const d = buatDunia({ kedaluwarsa: true });
  d.koneksi.sambung();
  cek('token mati: menyambung langsung dibatalkan, pabrik tidak dipanggil', [d.jejak.pabrik.length, d.jejak.sesi.map((x) => x[0])], [0, ['kedaluwarsa']]);
  cek('token mati: operator diarahkan masuk ulang', d.jejak.masukUlang, 1);
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
