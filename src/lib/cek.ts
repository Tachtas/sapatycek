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

// ---------------------------------------------------------------- per penjual
// Cek kasir ditulis PER PENJUAL (`25m1` = 25rb, kode penjual, tipe), tapi
// ringkasan di atas hanya membandingkan TOTAL HARI. Akibatnya satu penjual bisa
// kurang tanpa ketahuan selama penjual lain lebih - justru lubang yang aplikasi
// ini ada untuk menutup. Fungsi ini mencocokkan keduanya per penjual.
//
// Kunci pencocokan = NAMA penjual, bukan kode huruf: cek menyimpan kodenya di
// `salesman` dan namanya di `salesmanNama`, sedangkan penjualan sapatypos
// menyimpan NAMA di `salesman`. Keduanya berasal dari daftar Sales Person yang
// sama, jadi namanya sebanding.
export type BarisPenjual = {
  kunci: string;
  nama: string;
  cek: number;
  dibayar: number;
  penjualan: number;
  order: number;
  selisih: number;
  /** '' = ada di kedua sisi · 'cek'/'penjualan' = hanya di satu sisi */
  hanya: '' | 'cek' | 'penjualan';
};

const normNama = (s: any) => String(s ?? '').trim().toLowerCase();

export function cocokPerPenjual(daftarCek: any[], daftarPenjualan: any[]): BarisPenjual[] {
  const peta = new Map<string, BarisPenjual>();
  const ambil = (nama: any, kode: any) => {
    const namaTeks = String(nama ?? '').trim() || String(kode ?? '').trim();
    // Baris tanpa penjual tetap dikelompokkan supaya jumlahnya tidak menghilang
    // dari layar - kalau tidak, total harian dan total per penjual bisa berbeda
    // tanpa ada yang menjelaskan sebabnya.
    const kunci = normNama(namaTeks) || '(tanpa penjual)';
    let b = peta.get(kunci);
    if (!b) {
      b = { kunci, nama: namaTeks || '(tanpa penjual)', cek: 0, dibayar: 0, penjualan: 0, order: 0, selisih: 0, hanya: '' };
      peta.set(kunci, b);
    }
    return b;
  };

  for (const c of daftarCek) {
    const b = ambil(c?.salesmanNama, c?.salesman);
    b.cek += Number(c?.nominal) || 0;
    b.dibayar += Number(c?.dibayar) || 0;
  }
  for (const p of selesaiSaja(daftarPenjualan)) {
    const b = ambil(p?.salesman, '');
    b.penjualan += Number(p?.total) || 0;
    b.order += 1;
  }

  return [...peta.values()]
    .map((b) => ({
      ...b,
      selisih: b.penjualan - b.cek,
      hanya: b.cek === 0 ? ('penjualan' as const) : b.penjualan === 0 ? ('cek' as const) : ('' as const),
    }))
    .sort((a, b) => Math.abs(b.selisih) - Math.abs(a.selisih) || a.nama.localeCompare(b.nama));
}
