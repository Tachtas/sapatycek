// Saringan & pencocokan daftar cek — murni, tanpa DOM.
//
// Yang dipindah ke sini dari App.svelte: arti tiap tab saringan, pencocokan teks,
// peta penjualan per nomor order (untuk membandingkan cara bayar), dan peta bukti
// gambar per cek. Ketiganya logika yang dipakai pemilik untuk memutuskan, dan
// ketiganya bisa salah tanpa terlihat — jadi lebih baik diuji daripada dibaca
// ulang di dalam markup.
import { bedaBayar, type BedaBayar } from './kredit';

export type FilterStatus = 'semua' | 'belum_input' | 'beda_bayar' | 'kredit' | 'kurang_bayar';

/** Penjualan register, diindeks per nomor order. */
export function petaPerOrder(daftarPenjualan: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const p of daftarPenjualan || []) m.set(p.orderNo, p);
  return m;
}

/** Beda tafsir cara bayar cek kasir vs register (null = tidak ada beda / tak bisa dibandingkan). */
export function bedaBayarCek(cek: any, peta: Map<string, any>): BedaBayar | null {
  return bedaBayar(cek, (orderNo: string) => peta.get(orderNo));
}

/** Jumlah cek yang cara bayarnya beda dengan register. */
export function hitungBedaBayar(daftarCek: any[], peta: Map<string, any>): number {
  return (daftarCek || []).filter((c) => bedaBayarCek(c, peta) !== null).length;
}

/** Nilai pesanan POS yang belum punya cek. */
export function nilaiTanpaCek(penjualanTanpaCek: any[]): number {
  return (penjualanTanpaCek || []).reduce((a, b) => a + Number(b.total), 0);
}

const teks = (v: unknown) => String(v ?? '').toLowerCase();

/** Apakah satu baris cek lolos tab saringan yang sedang aktif? */
export function lolosSaring(c: any, filter: FilterStatus, peta: Map<string, any>): boolean {
  if (filter === 'beda_bayar') return bedaBayarCek(c, peta) !== null;
  if (filter === 'kredit') return Boolean(c.kredit);
  // "Belum input" = belum ada pasangan POS DAN statusnya masih belum cocok.
  if (filter === 'belum_input') return !c.orderNo && c.status === 'Belum Cocok';
  // "Kurang bayar" = cek tunai yang dibayarnya belum menutup nominalnya.
  if (filter === 'kurang_bayar') return !c.kredit && Number(c.dibayar) < Number(c.nominal);
  return true;
}

/**
 * Cocokkan dengan kotak Cari: nama penjual, kode penjual, nomor order, pelanggan,
 * atau angka nominalnya.
 */
export function cocokCari(c: any, cari: string): boolean {
  const q = String(cari ?? '').trim().toLowerCase();
  if (!q) return true;
  return (
    teks(c.salesmanNama).includes(q) ||
    teks(c.salesman).includes(q) ||
    teks(c.orderNo).includes(q) ||
    teks(c.customer).includes(q) ||
    String(c.nominal ?? '').includes(q)
  );
}

/** Daftar cek untuk digambar di tabel. */
export function saringCek(
  daftar: any[],
  filter: FilterStatus,
  cari: string,
  peta: Map<string, any>
): any[] {
  return (daftar || []).filter((c) => lolosSaring(c, filter, peta) && cocokCari(c, cari));
}

// ---------------------------------------------------------------- bukti gambar
// Kunci dari sisi ERP: 'cek-{outlet}-{tanggal}-{id}' (huruf kecil). Baris hasil
// pemulihan arsip membawa `cekid` apa adanya (id baris SpacetimeDB lama) dan itu
// yang dipakai. Bentuknya HARUS sama dengan yang dipakai modul SpacetimeDB-nya
// (relasi.ts) — kalau salah, bukti gambar hilang dari layar tanpa error.
export function kunciFoto(c: any, outlet: string): string {
  const eksplisit = String(c?.cekid ?? '').trim();
  if (eksplisit) return eksplisit.toLowerCase();
  return `cek-${outlet.toLowerCase()}-${c?.tanggal}-${c?.id}`.toLowerCase();
}

/** Bukti gambar per kunci cek, dari baris view `cek_foto_aman`. */
export function petaFoto(daftarFoto: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const f of daftarFoto || []) {
    let arr: any[] = [];
    try {
      arr = JSON.parse(f?.imagesJson || '[]');
    } catch {
      arr = []; // imagesJson rusak = tidak ada gambar, bukan galat halaman
    }
    if (Array.isArray(arr) && arr.length > 0) m.set(String(f?.cekid ?? '').toLowerCase(), arr);
  }
  return m;
}

/** Bukti gambar satu baris cek. */
export function fotoUntuk(c: any, peta: Map<string, any[]>, outlet: string): any[] {
  return peta.get(kunciFoto(c, outlet)) ?? [];
}
