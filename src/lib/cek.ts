// Logika murni sapatycek (tanpa DOM/SpacetimeDB) — supaya bisa diuji dan
// dipisahkan dari tampilan. Semua fungsi di sini deterministik.

export function rupiah(n: number | bigint): string {
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

// Satuan ribuan (dipakai kolom ringkas), mis. 45000 -> "45".
export function formatRibuan(n: number | bigint): string {
  return (Number(n) / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

export type TafsirCek = {
  jenis: 'kosong' | 'sebagian' | 'salah' | 'siap';
  /**
   * Grammar cek utuh (nominal + kode + tipe). Ini SATU-SATUNYA gerbang
   * auto-submit — dulu gerbangnya regex terpisah di App.svelte dan bisa
   * berbeda tafsir dengan parser yang menyimpan.
   */
  lengkap: boolean;
  teks: string;
  /** Angka nominal yang sudah diketik (tanpa satuan) — dipakai papan penjual. */
  digit?: string;
  nominal?: number;
  kode?: string;
  tipeDigit?: string;
  tipe?: string;
};

const TIPE_DARI_DIGIT: Record<string, string> = { '1': 'Ecer', '2': 'Obral', '3': 'Grosir' };
const POLA_LENGKAP = /^(\d+)([a-z])(\d)$/;
const POLA_KURANG_TIPE = /^(\d+)([a-z])$/;

/**
 * SATU-SATUNYA grammar input cek: `<nominal ribu><kode salesman><digit tipe>`.
 * Dipakai untuk pratinjau DAN untuk memutuskan boleh-simpan, supaya keduanya
 * tidak bisa berbeda tafsir (pernah: "25m1-" lolos gerbang lama tetapi ditolak
 * parser, sehingga ketikan operator hilang tanpa pesan apa pun).
 * Sengaja longgar terhadap nama: kode tak dikenal tetap dicatat apa adanya —
 * server yang menerjemahkannya, dan input tidak boleh hilang.
 */
export function uraiCek(teksMentah: string, cariNama: (kode: string) => string): TafsirCek {
  const bersih = (teksMentah || '').trim().toLowerCase().replace(/[.\s]/g, '');
  if (!bersih) return { jenis: 'kosong', lengkap: false, teks: '' };

  const utuh = POLA_LENGKAP.exec(bersih);
  if (utuh) {
    const nominal = Number(utuh[1]) * 1000;
    const kode = utuh[2];
    const tipeDigit = utuh[3];
    const tipe = TIPE_DARI_DIGIT[tipeDigit] ?? 'Ecer';
    const dasar = { lengkap: true, digit: utuh[1], nominal, kode, tipeDigit, tipe };
    const nama = cariNama(kode);
    if (!nama) {
      return {
        ...dasar,
        jenis: 'salah',
        teks: `${rupiah(nominal)} · kode ${kode.toUpperCase()} tidak ada di daftar salesman aktif`,
      };
    }
    return { ...dasar, jenis: 'siap', teks: `${rupiah(nominal)} · ${tipe} · ${nama}` };
  }

  if (/^\d+$/.test(bersih)) {
    return {
      jenis: 'sebagian',
      lengkap: false,
      teks: `${rupiah(Number(bersih) * 1000)} · tinggal kode salesman (ketuk di bawah)`,
      digit: bersih,
      nominal: Number(bersih) * 1000,
    };
  }

  const kurang = POLA_KURANG_TIPE.exec(bersih);
  if (!kurang) return { jenis: 'salah', lengkap: false, teks: 'Format: nominal + kode + tipe (mis. 25m1)' };

  const nominal = Number(kurang[1]) * 1000;
  const kode = kurang[2];
  const nama = cariNama(kode);
  return {
    jenis: 'sebagian',
    lengkap: false,
    teks: `${rupiah(nominal)} · ${nama || 'kode ' + kode.toUpperCase() + ' tak dikenal'} · tinggal digit tipe (1 Ecer / 2 Obral / 3 Grosir)`,
    digit: kurang[1],
    nominal,
    kode,
  };
}

/**
 * Baris cek yang sudah TAMPIL di layar tetapi belum tentu ada di server.
 * `id`-nya sementara dan negatif: id server selalu positif (autoIncrement),
 * jadi keduanya tidak mungkin bertabrakan.
 */
export type BarisOptimis = {
  id: bigint;
  tanggal: string;
  jam: string;
  nominal: bigint;
  tipe: string;
};

/**
 * Kunci pencocokan baris optimis ↔ baris server = kunci IDEMPOTENSI reducer
 * `tambah_deklarasi_cek` (outlet+tanggal+jam+salesman+nominal+tipe). `salesman`
 * sengaja TIDAK ikut dibandingkan: server yang menerjemahkan kode huruf menjadi
 * nama, jadi baris yang versi server-nya beda ejaan tidak akan pernah cocok dan
 * tampil dua kali. Sisanya sama persis dengan yang dikirim klien (jam, nominal,
 * tipe), dan dua cek dengan jam sama persis sampai detik tidak mungkin diketik
 * manusia (kalau pun sama, server sudah membuang yang kedua).
 *
 * Satu baris server hanya menyerap SATU baris optimis (`terpakai`), jadi kirim
 * ganda dari antrean HP tidak menghapus dua baris di layar.
 */
export function cocokOptimis(
  optimis: BarisOptimis[],
  server: any[]
): { sisa: BarisOptimis[]; peta: Record<string, string> } {
  const sisa: BarisOptimis[] = [];
  const peta: Record<string, string> = {};
  const terpakai = new Set<string>();
  for (const o of optimis) {
    const s = (server || []).find(
      (c: any) =>
        c &&
        c.id > 0n && // id server selalu positif; id optimis negatif
        !terpakai.has(String(c.id)) &&
        c.tanggal === o.tanggal &&
        c.jam === o.jam &&
        c.tipe === o.tipe &&
        BigInt(c.nominal) === o.nominal
    );
    if (s) {
      terpakai.add(String(s.id));
      peta[String(o.id)] = String(s.id);
    } else {
      sisa.push(o);
    }
  }
  return { sisa, peta };
}

export type Ringkasan = {
  totalCek: number;
  totalDibayar: number;
  totalPenjualan: number;
  selisih: number;
  jmlCek: number;
  jmlCocok: number;
  jmlBelumCocok: number;
  penjualanTanpaCek: any[];
};

/**
 * Status penjualan yang BELUM SELESAI — tidak boleh ikut dicocokkan dengan cek.
 *
 * Sumber kebenarannya modul POS (`sapaty-pos/src/routes/Kasir.svelte`,
 * `PenjualanHariIni.svelte`): 'Proses' = keranjang yang masih hidup, 'Pending' =
 * transaksi DITAHAN yang bisa dilanjutkan kapan saja. Keduanya bukan penjualan:
 * nilai maupun barisnya masih bisa berubah, dan menghitungnya membuat cek kasir
 * tampak kurang atau lebih tanpa sebab yang bisa dijelaskan ke operator.
 *
 * Sengaja berupa DAFTAR PENGECUALIAN, bukan syarat `status === 'Closing'`:
 * status lain berasal dari penjualan yang sudah tuntas — 'Closing' dari POS dan
 * kode 'Z'/'A' dari impor riwayat Ollsera — dan semuanya tetap harus dihitung.
 * Status kosong pun tetap dihitung: menyembunyikan baris dari layar lebih
 * berbahaya daripada menampilkannya.
 */
export const STATUS_BELUM_SELESAI = ['Proses', 'Pending'];

/** Buang penjualan yang belum selesai sebelum dicocokkan. */
export function selesaiSaja(daftar: any[]): any[] {
  return (daftar || []).filter((p) => !STATUS_BELUM_SELESAI.includes(String(p?.status ?? '')));
}

/** Ringkasan harian: cek manual vs register POS, plus pesanan yang belum ada cek. */
export function hitungRingkasan(daftarCek: any[], daftarPenjualan: any[]): Ringkasan {
  const penjualan = selesaiSaja(daftarPenjualan);
  const totalCek = daftarCek.reduce((a, b) => a + Number(b.nominal), 0);
  const totalDibayar = daftarCek.reduce((a, b) => a + Number(b.dibayar), 0);
  const jmlCocok = daftarCek.filter((c) => c.status === 'Cocok' || c.status === 'Cocok Tanpa Bukti Waktu').length;
  const jmlBelumCocok = daftarCek.filter((c) => c.status === 'Belum Cocok').length;
  const totalPenjualan = penjualan.reduce((a, b) => a + Number(b.total), 0);
  const orderNoCek = new Set(daftarCek.map((c) => c.orderNo).filter(Boolean));
  return {
    totalCek,
    totalDibayar,
    totalPenjualan,
    selisih: totalPenjualan - totalCek,
    jmlCek: daftarCek.length,
    jmlCocok,
    jmlBelumCocok,
    penjualanTanpaCek: penjualan.filter((p) => !orderNoCek.has(p.orderNo)),
  };
}
