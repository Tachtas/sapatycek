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
  teks: string;
  /** Terisi hanya saat jenis === 'siap' */
  nominal?: number;
  tipe?: string;
  kode?: string;
};

const TIPE_DARI_DIGIT: Record<string, string> = { '1': 'Ecer', '2': 'Obral', '3': 'Grosir' };

/**
 * Parser SINTAS (dipakai saat menyimpan): `<nominal ribu><kode salesman><digit tipe>`.
 * Sengaja longgar terhadap nama: kode tak dikenal tetap dicatat apa adanya —
 * server yang menerjemahkannya, dan input tidak boleh hilang.
 */
export function parseCek(teksMentah: string): { nominal: number; kode: string; tipeDigit: string } | null {
  const bersih = (teksMentah || '').trim().toLowerCase().replace(/[.\s]/g, '');
  const m = bersih.match(/^(\d+)([a-z])(\d)$/);
  if (!m) return null;
  return { nominal: Number(m[1]) * 1000, kode: m[2], tipeDigit: m[3] };
}

/**
 * Tafsir input cepat kasir untuk DITAMPILKAN (memanfaatkan parser sintaks di atas).
 * `cariNama` menerjemahkan kode huruf menjadi nama salesman aktif ('' bila tak ada).
 */
export function uraiCek(teksMentah: string, cariNama: (kode: string) => string): TafsirCek {
  const bersih = (teksMentah || '').trim().toLowerCase().replace(/[.\s]/g, '');
  if (!bersih) return { jenis: 'kosong', teks: '' };

  if (/^\d+$/.test(bersih)) {
    return { jenis: 'sebagian', teks: `${rupiah(Number(bersih) * 1000)} · tinggal kode salesman (ketuk di bawah)` };
  }

  const m = bersih.match(/^(\d+)([a-z])(\d)?$/);
  if (!m) return { jenis: 'salah', teks: 'Format: nominal + kode + tipe (mis. 25m1)' };

  const nominal = Number(m[1]) * 1000;
  const kode = m[2];
  const nama = cariNama(kode);
  if (!m[3]) {
    return {
      jenis: 'sebagian',
      teks: `${rupiah(nominal)} · ${nama || 'kode ' + kode.toUpperCase() + ' tak dikenal'} · tinggal digit tipe (1 Ecer / 2 Obral / 3 Grosir)`,
    };
  }
  const tipe = TIPE_DARI_DIGIT[m[3]] ?? 'Ecer';
  if (!nama) {
    return { jenis: 'salah', teks: `${rupiah(nominal)} · kode ${kode.toUpperCase()} tidak ada di daftar salesman aktif` };
  }
  return { jenis: 'siap', teks: `${rupiah(nominal)} · ${tipe} · ${nama}`, nominal, tipe, kode };
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

/** Ringkasan harian: cek manual vs register POS, plus pesanan yang belum ada cek. */
export function hitungRingkasan(daftarCek: any[], daftarPenjualan: any[]): Ringkasan {
  const totalCek = daftarCek.reduce((a, b) => a + Number(b.nominal), 0);
  const totalDibayar = daftarCek.reduce((a, b) => a + Number(b.dibayar), 0);
  const jmlCocok = daftarCek.filter((c) => c.status === 'Cocok' || c.status === 'Cocok Tanpa Bukti Waktu').length;
  const jmlBelumCocok = daftarCek.filter((c) => c.status === 'Belum Cocok').length;
  const totalPenjualan = daftarPenjualan.reduce((a, b) => a + Number(b.total), 0);
  const orderNoCek = new Set(daftarCek.map((c) => c.orderNo).filter(Boolean));
  return {
    totalCek,
    totalDibayar,
    totalPenjualan,
    selisih: totalPenjualan - totalCek,
    jmlCek: daftarCek.length,
    jmlCocok,
    jmlBelumCocok,
    penjualanTanpaCek: daftarPenjualan.filter((p) => !orderNoCek.has(p.orderNo)),
  };
}
