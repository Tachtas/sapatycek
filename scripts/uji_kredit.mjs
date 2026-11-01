// Uji tafsir kredit: cek kasir vs register (src/lib/kredit.ts).
import { regKredit, bedaBayar } from '/tmp/kredit-uji.mjs';

let lulus = 0, gagal = 0;
function cek(nama, nyata, harap) {
  const n = JSON.stringify(nyata), h = JSON.stringify(harap);
  if (n === h) { lulus++; console.log('  ok   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama); console.log('        nyata: ' + n); console.log('        harap: ' + h); }
}
const cari = (m) => (o) => m[o];

// --- ejaan register ---
cek("POS: 'CREDIT' terbaca kredit (regresi 1 Nov 2026)", regKredit({ paymentMode: 'CREDIT' }), true);
cek("Ollsera: 'Kredit' terbaca kredit", regKredit({ paymentMode: 'Kredit' }), true);
cek("POS: 'CASH' bukan kredit", regKredit({ paymentMode: 'CASH' }), false);
cek("Ollsera: 'Tunai' bukan kredit", regKredit({ paymentMode: 'Tunai' }), false);
cek('mode kosong bukan kredit', regKredit({ paymentMode: '' }), false);
cek('tanpa medan bukan kredit', regKredit({}), false);
cek('null bukan kredit', regKredit(null), false);
cek("paymentType 'kredit' + mode kosong tetap kredit", regKredit({ paymentType: 'kredit' }), true);
cek("paymentType 'CREDIT' + mode kosong tetap kredit", regKredit({ paymentType: 'CREDIT' }), true);
cek('spasi di sekeliling tidak mengganggu', regKredit({ paymentMode: ' CREDIT ' }), true);

// --- beda tafsir ---
cek('kasir centang kredit + register CREDIT -> TIDAK ada beda',
    bedaBayar({ kredit: true, orderNo: 'POS-1' }, cari({ 'POS-1': { paymentMode: 'CREDIT' } })), null);
cek('kasir centang kredit + register Kredit (Ollsera) -> tidak ada beda',
    bedaBayar({ kredit: true, orderNo: 'POS-1' }, cari({ 'POS-1': { paymentMode: 'Kredit' } })), null);
cek('kasir centang kredit + register CASH -> ADA beda',
    bedaBayar({ kredit: true, orderNo: 'POS-1' }, cari({ 'POS-1': { paymentMode: 'CASH' } })),
    { cekKredit: true, regKredit: false });
cek('kasir tidak centang + register CREDIT -> ADA beda',
    bedaBayar({ kredit: false, orderNo: 'POS-1' }, cari({ 'POS-1': { paymentMode: 'CREDIT' } })),
    { cekKredit: false, regKredit: true });
cek('tanpa tautan orderNo -> tidak bisa dibandingkan', bedaBayar({ kredit: true, orderNo: '' }, cari({})), null);
cek('order tidak ketemu -> tidak bisa dibandingkan', bedaBayar({ kredit: true, orderNo: 'X' }, cari({})), null);

console.log('\n' + lulus + ' lulus, ' + gagal + ' gagal');
if (gagal) process.exit(1);
