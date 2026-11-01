// Tafsir "kredit" untuk penjualan register. Fungsi murni supaya bisa diuji.
//
// Kenapa perlu: ejaannya BEDA antar sumber.
//   - Ollsera menulis payment_mode = 'Kredit' (dan payment_type selalu 'Tunai')
//   - POS Sapaty menulis payment_mode = 'CREDIT' / 'CASH' (huruf besar, Inggris)
//
// Detektor lama hanya mengenal 'kredit', sehingga penjualan kredit dari POS
// Sapaty terbaca sebagai TUNAI: kasir mencentang kredit, aplikasi mengira
// register tunai, lalu baris itu muncul sebagai "beda tafsir" padahal tidak ada
// yang beda. Kejadian nyata 1 Nov 2026 (penjualan 204.000 Silvia, kredit).

export type RingkasPenjualan = { orderNo?: unknown; paymentMode?: unknown; paymentType?: unknown };

/** Apakah register menandai penjualan ini kredit? Menerima kedua ejaan. */
export function regKredit(p: RingkasPenjualan | null | undefined): boolean {
  const mode = String(p?.paymentMode ?? '').trim().toLowerCase();
  const tipe = String(p?.paymentType ?? '').trim().toLowerCase();
  return (
    mode.startsWith('kredit') || mode.startsWith('credit') ||
    tipe.startsWith('kredit') || tipe.startsWith('credit')
  );
}

export type BedaBayar = { cekKredit: boolean; regKredit: boolean };

/**
 * Beda tafsir antara centang kasir dan register. null = tidak ada beda.
 * Butuh tautan orderNo; tanpa tautan tidak ada yang bisa dibandingkan.
 */
export function bedaBayar(
  cek: { kredit?: unknown; orderNo?: unknown } | null | undefined,
  cariPenjualan: (orderNo: string) => RingkasPenjualan | null | undefined
): BedaBayar | null {
  const orderNo = String(cek?.orderNo ?? '').trim();
  if (!orderNo) return null;
  const p = cariPenjualan(orderNo);
  if (!p) return null;
  const reg = regKredit(p);
  const cekK = Boolean(cek?.kredit);
  if (cekK === reg) return null;
  return { cekKredit: cekK, regKredit: reg };
}
