// Antrean cek yang belum terkirim (internet putus). Disimpan di HP, dikirim
// ulang otomatis saat tersambung. Server sudah idempoten terhadap kiriman
// ulang (kunci outlet+tanggal+jam+salesman+nominal+tipe), jadi kirim ganda
// tidak pernah menghasilkan baris kembar.
export type AntreanCek = {
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

const KUNCI = 'cek-antrean';

function baca(): AntreanCek[] {
  try {
    const isi = JSON.parse(localStorage.getItem(KUNCI) ?? '[]');
    return Array.isArray(isi) ? (isi as AntreanCek[]) : [];
  } catch {
    return [];
  }
}

export const antrean = $state<{ daftar: AntreanCek[] }>({ daftar: baca() });

function simpan(): void {
  try {
    localStorage.setItem(KUNCI, JSON.stringify(antrean.daftar));
  } catch {}
}

export function antreTambah(e: AntreanCek): void {
  antrean.daftar = [...antrean.daftar, e];
  simpan();
}

export function antreBuang(ref: string): void {
  antrean.daftar = antrean.daftar.filter((x) => x.ref !== ref);
  simpan();
}

export function antreMuatUlang(): void {
  antrean.daftar = baca();
}
