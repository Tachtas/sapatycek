// Sambungan & sesi SpacetimeDB untuk sapatycek.
//
// Yang disembunyikan di sini (dulu ~200 baris di App.svelte): urutan menyambung
// (klaim akun → langganan → baca ulang), ritme sambung ulang, perpanjangan token
// diam-diam, masuk ulang otomatis saat token ditolak, dan pembacaan empat view
// menjadi satu snapsh.
//
// Pabrik koneksinya DISUNTIKKAN (`deps.pabrik`), dan timer-nya juga
// (`deps.jadwalkan`) — jadi uji bisa memalsukan sambung/putus/galat token dan
// MENGUKUR jeda sambung ulang tanpa peramban dan tanpa menunggu detik nyata.
// Itulah satu-satunya alasan seam ini berbayar: dengan satu adapter saja
// (socket SpacetimeDB) memindahkan kode ini tidak menambah apa pun.
import type { StatusKoneksi } from './intake';

export type { StatusKoneksi };

/** Status layar yang ditentukan di sini; keputusan kartu mana yang tampil di App. */
export type StatusSesi = 'belum_login' | 'ditolak' | 'kedaluwarsa' | 'oke';

export type Snapsh = {
  cek: any[];
  penjualan: any[];
  foto: any[];
  salesman: any[];
  /** Baris cek dari hari sebelum hari ini (job sweep_cek 08:00 WIT). */
  cekLama: number;
};

export const SNAPSH_KOSONG: Snapsh = { cek: [], penjualan: [], foto: [], salesman: [], cekLama: 0 };

/** Kueri langganan. `cek_foto` dibaca lewat VIEW-nya (tabel itu diprivatkan). */
export const KUERI_LANGGANAN = [
  'SELECT * FROM cek_aman',
  'SELECT * FROM penjualan_aman',
  'SELECT * FROM salesman_aman',
  'SELECT * FROM cek_foto_aman',
] as const;

export type Deps = {
  /** `DbConnection.builder()` di produksi; palsu di uji. */
  pabrik: () => any;
  uri: string;
  dbName: string;
  /** Cek kasir HANYA untuk outlet Braka (Audy tidak ada cek). */
  outlet: string;
  tanggal: string;

  token: () => string | undefined;
  email: () => string;
  emailDiizinkan: (email: string) => boolean;
  tokenKedaluwarsa: () => boolean;
  tokenSegeraHabis: (menit: number) => boolean;
  perpanjangToken: () => Promise<boolean>;
  bolehCobaLagi: (ms?: number) => boolean;
  tandaiCobaLagi: () => void;
  /** Pindah halaman ke login Google. */
  masukUlang: () => void;

  snapshBerubah: (s: Snapsh) => void;
  statusBerubah: (status: StatusKoneksi, gagal: boolean) => void;
  /** `email` = akun yang sedang dipakai halaman (kartu "Akses ditolak" menampilkannya). */
  sesiBerubah: (status: StatusSesi, email: string) => void;
  /** Sesudah tersambung: kirim antrean cek yang tertinggal di HP. */
  saatTersambung: (conn: any) => void;
  saatPutus: () => void;

  /** setTimeout / clearTimeout di produksi; palsu di uji. */
  jadwalkan: (fn: () => void, ms: number) => any;
  batalkan: (handle: any) => void;
};

export type Koneksi = {
  status: () => StatusKoneksi;
  gagal: () => boolean;
  conn: () => any;
  snapsh: () => Snapsh;
  /** Gerbang awal halaman: tentukan status sesi, sambung sendiri kalau sudah oke. */
  siapkanSesi: () => void;
  sambung: () => void;
  /** Bersihkan timer sambung ulang (saat komponen dibuang). */
  tutup: () => void;
  /** Dipicu tombol "Masuk lagi" — menandai percobaan lalu pindah ke login. */
  masukSekarang: () => void;
};

const JEDA_AWAL_MS = 2000;
const JEDA_MAKS_MS = 30000;
const PERPANJANG_SEBELUM_SAMBUNG_MENIT = 5;

export function buatKoneksi(deps: Deps): Koneksi {
  let conn: any = null;
  let status: StatusKoneksi = 'menghubungkan';
  let gagal = false;
  let snapsh: Snapsh = SNAPSH_KOSONG;
  let timerSambung: any = null;
  let cobaKe = 0;

  function setStatus(s: StatusKoneksi, g = false): void {
    status = s;
    gagal = g;
    deps.statusBerubah(s, g);
  }

  function setSnapsh(s: Snapsh): void {
    snapsh = s;
    deps.snapshBerubah(s);
  }

  /** Baca ulang empat view sekaligus — satu jalur untuk semua pemberitahuan. */
  function baca(): void {
    if (!conn?.db) return;
    try {
      const cek = Array.from(conn.db.cekAman.iter())
        .filter((c: any) => c.outlet === deps.outlet && c.tanggal === deps.tanggal)
        .sort((a: any, b: any) => Number(b.id - a.id));
      const penjualan = Array.from(conn.db.penjualanAman.iter()).filter(
        (p: any) => p.outlet === deps.outlet && p.orderDate === deps.tanggal
      );
      const cekLama = Array.from(conn.db.cekAman.iter()).filter(
        (c: any) => c.tanggal && c.tanggal < deps.tanggal
      ).length;
      setSnapsh({
        cek,
        penjualan,
        cekLama,
        salesman: Array.from(conn.db.salesmanAman.iter()),
        foto: Array.from(conn.db.cekFotoAman.iter()),
      });
    } catch (e) {
      console.error('Error membaca tabel:', e);
    }
  }

  function pasangLangganan(): void {
    if (!conn) return;

    // Setiap perubahan pada salah satu view = baca ulang. Delapan penangan ini
    // dulu ditulis di App.svelte, jadi pengetahuan "apa yang harus dibaca ulang"
    // bocor ke layar.
    // `staff` SENGAJA TIDAK DILANGGAN: isinya email + identitas perangkat,
    // sapatycek tidak memakai satu barisnya, dan satu kueri langganan yang gagal
    // menggagalkan SELURUH batch ini.
    conn.db.cekAman.onInsert(baca);
    conn.db.cekAman.onUpdate(baca);
    conn.db.cekAman.onDelete(baca);
    conn.db.penjualanAman.onInsert(baca);
    conn.db.penjualanAman.onUpdate(baca);
    conn.db.salesmanAman.onInsert(baca);
    conn.db.salesmanAman.onUpdate(baca);
    conn.db.salesmanAman.onDelete(baca);
    conn.db.cekFotoAman.onInsert(baca);
    conn.db.cekFotoAman.onUpdate(baca);

    conn.subscriptionBuilder().onApplied(baca).subscribe([...KUERI_LANGGANAN]);
  }

  function masukUlangOtomatis(): void {
    if (!deps.bolehCobaLagi()) return;
    deps.tandaiCobaLagi();
    deps.masukUlang();
  }

  function jadwalkanSambungUlang(): void {
    if (timerSambung) return;
    const jeda = Math.min(JEDA_MAKS_MS, JEDA_AWAL_MS * 2 ** cobaKe++);
    timerSambung = deps.jadwalkan(() => {
      timerSambung = null;
      void (async () => {
        // Jangan buang waktu menyambung dengan token yang hampir mati.
        if (deps.tokenSegeraHabis(PERPANJANG_SEBELUM_SAMBUNG_MENIT)) {
          await deps.perpanjangToken().catch(() => false);
        }
        sambung();
      })();
    }, jeda);
  }

  function sambung(): void {
    setStatus('menghubungkan');
    // Jangan buang waktu menyambung dengan token mati — langsung masuk ulang.
    if (deps.tokenKedaluwarsa()) {
      deps.sesiBerubah('kedaluwarsa', deps.email());
      masukUlangOtomatis();
      return;
    }

    try {
      deps
        .pabrik()
        .withUri(deps.uri)
        .withDatabaseName(deps.dbName)
        .withToken(deps.token())
        .onConnect((connection: any) => {
          conn = connection;
          setStatus('terhubung');
          cobaKe = 0;
          // Ikatan akun: identity tiap klien OIDC BERBEDA walau emailnya sama
          // (sapatycek vs sapaty-pos = dua identity). Tanpa klaim di sini, tabel
          // staff tidak punya baris untuk identity ini, sehingga reducer yang
          // mensyaratkan staff menolak 'kas: cashier only' padahal akunnya admin.
          const em = deps.email();
          if (em) {
            connection.reducers
              .klaimAkun({ email: em })
              .catch((e: unknown) => console.error('klaimAkun gagal:', e));
          }
          pasangLangganan();
          deps.saatTersambung(connection);
        })
        .onDisconnect(() => {
          conn = null;
          setStatus('terputus');
          deps.saatPutus();
          jadwalkanSambungUlang();
        })
        .onConnectError((_ctx: any, err: unknown) => {
          setStatus('terputus', true);
          deps.saatPutus();
          console.error('Koneksi SpacetimeDB error:', err);
          // Token ditolak walau belum terlihat kedaluwarsa → coba perpanjang,
          // kalau tidak bisa baru minta masuk ulang.
          void (async () => {
            if (await deps.perpanjangToken()) jadwalkanSambungUlang();
            else if (deps.bolehCobaLagi(20000)) masukUlangOtomatis();
          })();
        })
        .build();
    } catch (e) {
      setStatus('terputus');
      console.error(e);
    }
  }

  function siapkanSesi(): void {
    const email = deps.email();
    // Tanpa token/email: sama seperti sesi kosong (email dikosongkan, bukan sisa
    // akun sebelumnya — perilaku lama yang dijaga).
    if (!deps.token() || !email) return deps.sesiBerubah('belum_login', '');
    if (!deps.emailDiizinkan(email)) return deps.sesiBerubah('ditolak', email);

    // Token kedaluwarsa = sama seperti belum login. Ini akar 'indikator kuning
    // dan input mati' yang dulu dialami operator tiap token berumur ~1 jam.
    if (deps.tokenKedaluwarsa()) {
      deps.sesiBerubah('kedaluwarsa', email);
      void (async () => {
        // Perpanjang DIAM-DIAM dulu (tanpa pindah halaman). Hanya kalau gagal
        // operator diarahkan masuk ulang.
        if (await deps.perpanjangToken()) {
          deps.sesiBerubah('oke', email);
          sambung();
        } else {
          masukUlangOtomatis();
        }
      })();
      return;
    }

    deps.sesiBerubah('oke', email);
  }

  return {
    status: () => status,
    gagal: () => gagal,
    conn: () => conn,
    snapsh: () => snapsh,
    siapkanSesi,
    sambung,
    tutup: () => {
      if (timerSambung) deps.batalkan(timerSambung);
      timerSambung = null;
    },
    masukSekarang: () => {
      deps.tandaiCobaLagi();
      deps.masukUlang();
    },
  };
}
