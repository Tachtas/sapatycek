// Intake cek: satu module untuk dua jalur tulis yang selama ini berbagi enam
// variabel di App.svelte — ketik cek (kirimCepat) dan ketik bayar (kirimBayar).
//
// Yang disembunyikan di sini (dulu tersebar di App):
//   - baris optimis (id sementara NEGATIF) + penyerapannya oleh baris server,
//   - peta id sementara -> id server (dipakai pembayaran),
//   - penungguan id server sesudah cek diketik (dulu loop 130x60ms di dalam
//     jalur pembayaran, jadi rantai kedua bisa membayar baris yang sama dua kali),
//   - penjaga satu pembayaran pada satu waktu,
//   - antrean HP saat internet putus + kirim ulang berurutan.
//
// Sengaja TANPA runes: module ini diuji langsung di Node lewat
// scripts/uji_intake.mjs dengan adapter reducer PALSU, jadi dua adapter memang
// ada (SpacetimeDB di produksi, palsu di uji) — bukan seam hipotetis.
import { uraiCek, cocokOptimis } from './cek';

export type StatusKoneksi = 'menghubungkan' | 'terhubung' | 'terputus';

export type HasilSimpan =
  | { jenis: 'kosong' | 'belum_lengkap'; pesan?: string }
  | { jenis: 'tersimpan' }
  | { jenis: 'antre'; belumTerkirim: number }
  | { jenis: 'gagal'; pesan: string };

export type HasilBayar =
  | { jenis: 'lunas'; sales: string; nominal: number; bayar: number; kembali: number }
  | { jenis: 'kosong' }
  | { jenis: 'tanpa_target' }
  | { jenis: 'tunggu_id' }
  | { jenis: 'butuh_koneksi' }
  | { jenis: 'gagal'; pesan: string };

export type BarisAntrean = {
  ref: string;
  outlet: string;
  tanggal: string;
  jam: string;
  salesman: string;
  salesmanNama: string;
  nominal: string;
  tipe: string;
  at: number;
};

export type Deps = {
  /** Sambungan hidup (boleh null sebelum tersambung). */
  conn: () => any;
  status: () => StatusKoneksi;
  outlet: string;
  tanggal: string;
  /** Kode huruf -> nama penjual aktif ('' kalau tak dikenal). */
  cariNama: (kode: string) => string;
  /** Cermin baris optimis untuk layar. */
  barisBerubah: (optimis: any[]) => void;
  /** Baris baru diketik — dipakai layar untuk menyorotnya sekali. */
  barisBaru: (baris: any) => void;
  /** Baris cek yang sudah ada di server (dipakai saat menunggu id server). */
  barisServer: () => any[];
  /** Cek diterima: layar mengosongkan kolom Cek dan memindah kursor ke Bayar. */
  terimaCek: () => void;
  /** Pembayaran mulai dikirim: layar mengosongkan kolom Bayar, kursor ke Cek. */
  mulaiBayar: () => void;
  /** Antrean offline yang tahan mati (localStorage di produksi). */
  antrean: {
    daftar: () => BarisAntrean[];
    tambah: (e: BarisAntrean) => void;
    buang: (ref: string) => void;
  };
  /** Acak untuk ref antrean (crypto.randomUUID di produksi). */
  acak: () => string;
  /** Tunggu (uji memakai versi tanpa waktu nyata). */
  tidur: (ms: number) => Promise<void>;
};

export type Intake = {
  /** Baris optimis saat ini (cermin yang sama dengan barisBerubah). */
  optimis: () => any[];
  /** Peta id sementara -> id server. */
  peta: () => Record<string, string>;
  simpan: (teks: string) => Promise<HasilSimpan>;
  bayar: (target: any | null, teks: string) => Promise<HasilBayar>;
  /** Dipanggil sesudah daftar baris server berubah. */
  rekonsiliasi: (server: any[]) => void;
  kirimAntrean: () => Promise<number>;
};

// Batas penungguan id server: 130 x 60ms ≈ 8 detik (perjalanan tulis nyata ~2s).
const PUTARAN_TUNGGU = 130;
const JEDA_TUNGGU_MS = 60;

export function buatIntake(deps: Deps): Intake {
  let cekOptimis: any[] = [];
  // id sementara -> id server, dipakai menjaga pembayaran.
  const optimisKeServer: Record<string, string> = {};
  let urutOptimis = 0n;

  // SATU pembayaran pada satu waktu; penjaganya di sini, bukan di layar, supaya
  // rantai kedua dari ketikan berikutnya tidak bisa membayar baris yang sama.
  let sedangBayar = false;
  let sedangSimpan = false;
  let sedangKirimAntrean = false;

  function barisOptimis(jam: string, salesman: string, nominal: bigint, tipe: string, id: bigint): any {
    return {
      id, // negatif & menurun = id sementara
      optimis: true,
      cekid: '',
      outlet: deps.outlet,
      tanggal: deps.tanggal,
      jam,
      salesman,
      salesmanNama: salesman,
      nominal,
      dibayar: 0n,
      tipe,
      kredit: false,
      status: 'Belum Cocok',
      orderNo: '',
      customer: '',
      shortUrl: '',
    };
  }

  function pasangBarisOptimis(baris: any): void {
    cekOptimis = [...cekOptimis, baris];
    deps.barisBerubah(cekOptimis);
    deps.barisBaru(baris);
  }

  function buangBarisOptimis(id: bigint): void {
    cekOptimis = cekOptimis.filter((o) => o.id !== id);
    deps.barisBerubah(cekOptimis);
  }

  /** Payload reducer tambah_deklarasi_cek — bentuknya sama untuk semua jalur. */
  const payloadTambah = (e: {
    outlet: string;
    tanggal: string;
    jam: string;
    salesman: string;
    salesmanNama: string;
    nominal: bigint;
    tipe: string;
  }) => ({ ...e, kredit: false, dibayar: 0n });

  async function simpan(teksMentah: string): Promise<HasilSimpan> {
    const tafsir = uraiCek(teksMentah, deps.cariNama);
    if (tafsir.jenis === 'kosong') return { jenis: 'kosong' };
    if (sedangSimpan) return { jenis: 'kosong' };
    if (!tafsir.lengkap) return { jenis: 'belum_lengkap', pesan: tafsir.teks };

    const nominal = BigInt(tafsir.nominal ?? 0);
    const kode = tafsir.kode ?? '';
    const tipe = tafsir.tipe ?? 'Ecer';
    const salesmanNama = deps.cariNama(kode) || kode.toUpperCase();
    const jam = new Date().toTimeString().slice(0, 8);
    const baris = barisOptimis(jam, salesmanNama, nominal, tipe, --urutOptimis);

    // Internet putus: cek tetap dicatat (disimpan di HP) dan dikirim ulang
    // otomatis saat tersambung. Barisnya tetap tampil supaya operator melihat
    // inputnya; server idempoten, jadi kiriman ulang tidak pernah dobel.
    if (deps.status() !== 'terhubung' || !deps.conn()?.reducers?.tambahDeklarasiCek) {
      deps.terimaCek();
      pasangBarisOptimis(baris);
      deps.antrean.tambah({
        ref: deps.acak(),
        outlet: deps.outlet,
        tanggal: deps.tanggal,
        jam,
        salesman: salesmanNama,
        salesmanNama,
        nominal: String(nominal),
        tipe,
        at: Date.now(),
      });
      return { jenis: 'antre', belumTerkirim: deps.antrean.daftar().length };
    }

    pasangBarisOptimis(baris);
    deps.terimaCek();
    sedangSimpan = true;
    try {
      await deps.conn().reducers.tambahDeklarasiCek(
        payloadTambah({
          outlet: deps.outlet,
          tanggal: deps.tanggal,
          jam,
          salesman: salesmanNama,
          salesmanNama,
          nominal,
          tipe,
        })
      );
      return { jenis: 'tersimpan' };
    } catch (e: any) {
      // Barisnya tidak jadi ada di server — jangan biarkan menggantung di layar.
      buangBarisOptimis(baris.id);
      return { jenis: 'gagal', pesan: String(e?.message ?? e) };
    } finally {
      sedangSimpan = false;
    }
  }

  function rekonsiliasi(server: any[]): void {
    if (cekOptimis.length === 0) return;
    const { sisa, peta } = cocokOptimis(cekOptimis, server);
    for (const k of Object.keys(peta)) optimisKeServer[k] = peta[k];
    if (sisa.length !== cekOptimis.length) {
      cekOptimis = sisa;
      deps.barisBerubah(cekOptimis);
    }
  }

  /** Tunggu id server untuk baris yang baru diketik; null = batal tersimpan. */
  async function tungguIdServer(awal: any): Promise<any | null> {
    for (let i = 0; i < PUTARAN_TUNGGU; i++) {
      await deps.tidur(JEDA_TUNGGU_MS);
      const idServer = optimisKeServer[String(awal.id)];
      if (idServer) {
        const juga = deps.barisServer().find((c: any) => String(c.id) === idServer);
        if (juga) return juga;
      }
      if (!cekOptimis.some((o) => o.id === awal.id)) return null; // batal tersimpan
    }
    return null;
  }

  async function bayar(target: any | null, teksBayar: string): Promise<HasilBayar> {
    // Satu pembayaran pada satu waktu: rantai kedua — dari ketikan berikutnya
    // atau dari simpan() setelah cek tersimpan — tidak boleh membayar baris yang
    // sama dua kali. Dulu penjaganya baru dipasang SESUDAH baris cek baru
    // menunggu id server, jadi rantai kedua lolos dan nominalnya masuk dua kali.
    if (sedangBayar) return { jenis: 'kosong' };
    if (deps.status() !== 'terhubung' || !deps.conn()?.reducers) return { jenis: 'butuh_koneksi' };

    const teks = String(teksBayar ?? '').trim();
    const angkaAwal = Number(teks.replace(/[^0-9]/g, ''));
    if (!teks || !angkaAwal) return { jenis: 'kosong' };
    if (!target) return { jenis: 'tanpa_target' };

    sedangBayar = true;
    try {
      // Baris yang baru diketik belum punya id server (id sementara negatif).
      // TUNGGU id itu — jangan meluncur ke baris lain: nominal yang diketik
      // operator jelas ditujukan untuk baris yang baru ia isi.
      let baris = target;
      if (target.id < 0n) {
        const ketemu = await tungguIdServer(target);
        if (!ketemu || String(ketemu.id) !== (optimisKeServer[String(target.id)] ?? '')) {
          return { jenis: 'tunggu_id' };
        }
        baris = ketemu;
      }

      // Nominal dibaca ULANG sesudah penungguan: operator bisa menambah digit
      // selagi barisnya menunggu id server.
      const angkaKini = Number(String(teksBayar ?? '').replace(/[^0-9]/g, '')) || angkaAwal;
      const bayarPenuh = BigInt(angkaKini * 1000); // input bayar selalu ribuan
      const tagihan = Number(baris.nominal) - Number(baris.dibayar);
      const bayarRp = Number(bayarPenuh);

      // Kolom Bayar dikosongkan & kursor balik ke Cek SEKETIKA sebelum perjalanan
      // tulis (perilaku lama), bukan sesudahnya.
      deps.mulaiBayar();

      await deps.conn().reducers.catatBayarCek({
        cekId: baris.id,
        outlet: deps.outlet,
        tanggal: deps.tanggal,
        nominalBayar: bayarPenuh,
      });

      return {
        jenis: 'lunas',
        sales: baris.salesmanNama || 'Sales',
        nominal: Number(baris.nominal),
        bayar: bayarRp,
        kembali: Math.max(0, bayarRp - tagihan),
      };
    } catch (e: any) {
      return { jenis: 'gagal', pesan: String(e?.message ?? e) };
    } finally {
      sedangBayar = false;
    }
  }

  async function kirimAntrean(): Promise<number> {
    if (sedangKirimAntrean) return 0;
    if (deps.status() !== 'terhubung' || !deps.conn()?.reducers?.tambahDeklarasiCek) return 0;
    const daftar = deps.antrean.daftar();
    if (daftar.length === 0) return 0;

    sedangKirimAntrean = true;
    let terkirim = 0;
    try {
      for (const e of [...daftar]) {
        try {
          await deps.conn().reducers.tambahDeklarasiCek(
            payloadTambah({
              outlet: e.outlet,
              tanggal: e.tanggal,
              jam: e.jam,
              salesman: e.salesman,
              salesmanNama: e.salesmanNama,
              nominal: BigInt(e.nominal),
              tipe: e.tipe,
            })
          );
          deps.antrean.buang(e.ref);
          terkirim++;
        } catch {
          break; // sisanya dicoba lagi pada putaran berikutnya
        }
      }
    } finally {
      sedangKirimAntrean = false;
    }
    return terkirim;
  }

  return {
    optimis: () => cekOptimis,
    peta: () => ({ ...optimisKeServer }),
    simpan,
    bayar,
    rekonsiliasi,
    kirimAntrean,
  };
}
