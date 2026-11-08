<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import {
    Lock,
    Hourglass,
    Ban,
    ListChecks,
    Eraser,
    TriangleAlert,
    Camera,
    X,
    Check,
    Search,
    Trash,
  } from '@lucide/svelte';
  import { DbConnection } from './module_bindings';
  import { antrean, antreTambah, antreBuang } from './lib/antrean.svelte';
  import { rupiah, formatRibuan, uraiCek, hitungRingkasan } from './lib/cek';
  import { buatIntake, type StatusKoneksi } from './lib/intake';
  import { buatKoneksi, type StatusSesi } from './lib/koneksi';
  import { bedaBayar as bedaBayarMurni } from './lib/kredit';
  import AntreanCek from './lib/komponen/AntreanCek.svelte';
  import GaleriBukti from './lib/komponen/GaleriBukti.svelte';
  import SelEdit from './lib/komponen/SelEdit.svelte';
  import { loginGoogle, handleOidcCallback, spacetimeToken, emailLogin, logout, tokenKedaluwarsa, bolehCobaLagi, tandaiCobaLagi, perpanjangToken, tokenSegeraHabis } from './lib/login';

  // Config SpacetimeDB
  const HOST = 'https://maincloud.spacetimedb.com';
  const DB_NAME = 'sapaty-pos';
  const OUTLET = 'Braka'; // Cek kasir HANYA untuk outlet Braka (Audy tidak ada cek)

  // Tanggal otomatis hari ini Asia/Jayapura (WIT, UTC+9)
  const tanggal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jayapura' }).format(new Date());

  // Judul periode di kepala halaman: rekonsiliasi selalu PER HARI, jadi
  // tanggalnya harus terbaca di layar (dulu tidak pernah disebut sama sekali).
  const judulTanggal = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jayapura',
  }).format(new Date(`${tanggal}T05:00:00Z`));

  // Cermin dari module sambungan & sesi (lib/koneksi.ts). Layar tidak menyentuh
  // socket sama sekali: yang dipegang di sini hanya apa yang perlu digambar.
  let conn = $state<any>(null);
  let statusKoneksi = $state<StatusKoneksi>('menghubungkan');
  let gagalKoneksi = $state(false);

  // Data reactive dari SpacetimeDB
  let daftarCek = $state<any[]>([]);
  let daftarPenjualan = $state<any[]>([]);
  let daftarFoto = $state<any[]>([]); // cek_foto_aman (view): bukti gambar per cek (galeri)
  let daftarSalesman = $state<any[]>([]);

  // Input Cek & Bayar (lebar +20%: w-36 & w-32)
  let cepatTeks = $state('');
  let bayarTeks = $state('');
  let inputCepatEl = $state<HTMLInputElement | null>(null);
  let inputBayarEl = $state<HTMLInputElement | null>(null);

  // Cermin baris optimis dari module intake (lib/intake.ts). Baris cek yang baru
  // diketik digambar SEKETIKA dengan id SEMENTARA yang negatif (id server selalu
  // positif, autoIncrement) dan dibuang begitu baris server yang sepadan tiba.
  // Module-nya sengaja TANPA runes supaya bisa diuji langsung di Node, jadi layar
  // cukup mencerminkan apa yang dimilikinya.
  let cekOptimis = $state<any[]>([]);

  const intake = buatIntake({
    conn: () => conn,
    status: () => statusKoneksi,
    outlet: OUTLET,
    tanggal,
    cariNama: cariSalesmanAktif,
    barisBerubah: (o) => { cekOptimis = o; },
    barisBaru: (b) => triggerFlash(b.id),
    barisServer: () => daftarCek,
    terimaCek: () => {
      // Isi kolomnya dikosongkan SEKARANG (state DAN DOM) supaya ketikan yang
      // sama tidak bisa terkirim dua kali selagi Svelte menunggu giliran
      // memperbarui DOM — kolom Cek dibaca apa adanya saat menyimpan.
      cepatTeks = '';
      if (inputCepatEl) inputCepatEl.value = '';
      inputBayarEl?.focus();
    },
    mulaiBayar: () => {
      bayarTeks = '';
      if (inputBayarEl) inputBayarEl.value = '';
      inputCepatEl?.focus();
    },
    antrean: { daftar: () => antrean.daftar, tambah: antreTambah, buang: antreBuang },
    acak: () => crypto.randomUUID?.() ?? String(Date.now() + Math.random()),
    tidur: (ms) => new Promise((selesai) => setTimeout(selesai, ms)),
  });

  // Sambungan & sesi: seluruh urutan menyambung (klaim akun → langganan → baca
  // ulang), ritme sambung ulang, dan perpanjangan token ada di module ini.
  // Pabrik koneksinya disuntikkan supaya jalur sambung-ulang bisa diuji di Node.
  const koneksi = buatKoneksi({
    pabrik: () => DbConnection.builder(),
    uri: HOST,
    dbName: DB_NAME,
    outlet: OUTLET,
    tanggal,
    token: spacetimeToken,
    email: emailLogin,
    emailDiizinkan: (em) => em === EMAIL_DIIZINKAN,
    tokenKedaluwarsa,
    tokenSegeraHabis,
    perpanjangToken,
    bolehCobaLagi,
    tandaiCobaLagi,
    masukUlang: loginGoogle,
    snapshBerubah: (s) => {
      daftarCek = s.cek;
      daftarPenjualan = s.penjualan;
      daftarFoto = s.foto;
      daftarSalesman = s.salesman;
      jmlCekLama = s.cekLama;
      // Baris server yang baru tiba menyerap baris optimis yang sepadan → tidak
      // ada baris kembar di layar, dan id sementara diganti id server.
      intake.rekonsiliasi(s.cek);
    },
    statusBerubah: (s, g) => { statusKoneksi = s; gagalKoneksi = g; },
    sesiBerubah: (s, em) => { sesi = { status: s, email: em }; },
    saatTersambung: (c) => { conn = c; void kirimAntrean(); },
    saatPutus: () => { conn = null; },
    jadwalkan: (fn, ms) => setTimeout(fn, ms),
    batalkan: (h) => clearTimeout(h),
  });

  // Yang digambar layar: baris optimis lebih dulu (paling baru), lalu baris server.
  const cekTampil = $derived([...cekOptimis, ...daftarCek]);

  // Status fokus kursor di bayar untuk sorot baris target
  let isBayarFocused = $state(false);

  let jmlCekLama = $state(0);
  // window.confirm()/alert() DIABAIKAN WebView Android (langsung balik false /
  // tidak tampil), sehingga tombol hapus & sapu cek lama terasa mati.
  // Semua konfirmasi/pemberitahuan memakai dialog di dalam aplikasi.
  let dialog = $state<{ teks: string; hanyaOk?: boolean; jawab?: (ya: boolean) => void } | null>(null);

  function konfirmasi(teks: string): Promise<boolean> {
    return new Promise((selesai) => {
      dialog = { teks, jawab: (ya) => { dialog = null; selesai(ya); } };
    });
  }

  function info(teks: string): Promise<void> {
    return new Promise((selesai) => {
      dialog = { teks, hanyaOk: true, jawab: () => { dialog = null; selesai(); } };
    });
  }

  // Keterangan pelunasan di samping input bayar (permanen tidak hilang setelah 5 detik)
  let pesanPelunasan = $state<{ sales: string; nominal: number; bayar: number; kembali: number } | null>(null);
  let pesanGalat = $state<string | null>(null);
  let timerGalat: any = null;

  // Sorot baris baru (sekali, tidak berdenyut)
  let flashCekId = $state<bigint | null>(null);
  let timerFlash: any = null;

  // Sesi login (SpacetimeAuth / Google)
  let sesi = $state<{ status: StatusSesi; email: string }>({ status: 'belum_login', email: '' });

  // State edit inline (double click). Nilai yang sedang diketik TIDAK disimpan di
  // sini: kolom teksnya milik komponen SelEdit, dan nilainya baru dikirim balik
  // saat kasir menekan Enter / berpindah fokus.
  let selEdit = $state<{ id: bigint; kolom: 'salesman' | 'nominal' | 'dibayar'; awal: string } | null>(null);

  // Filter & tab
  let cariTeks = $state('');
  let filterStatus = $state<'semua' | 'belum_input' | 'beda_bayar' | 'kredit' | 'kurang_bayar'>('semua');
  // Baris cek yang buktinya sedang dibuka (galeri layar penuh). Sisa keadaannya —
  // indeks gambar, pratinjau, gambar besar, kunci gulir, Esc — ada di dalam
  // komponen GaleriBukti.
  let galeriCek = $state<any | null>(null);
  let tabAktif = $state<'cek' | 'tanpa_cek'>('cek');

  // ---- Tema ---------------------------------------------------------------
  // Paletnya hidup di app.css sebagai blok [data-tema='…'] yang menimpa
  // var(--color-*); di sini hanya perlu menempelkan nama tema ke <html>.
  const TEMA = [
    { id: 'kas', nama: 'Buku kas' },
    { id: 'arang', nama: 'Malam arang' },
    { id: 'arsip', nama: 'Arsip biru' },
    { id: 'malam-arsip', nama: 'Malam arsip' },
  ] as const;
  const KUNCI_TEMA = 'cek-tema';

  function bacaTema(): string {
    try {
      const t = localStorage.getItem(KUNCI_TEMA) ?? '';
      if (TEMA.some((x) => x.id === t)) return t;
    } catch {}
    return 'kas';
  }

  // PEMILIH TEMA DIBUANG 5 Nov 2026 (permintaan pemilik): sapatycek dipakai di
  // komputer, dan tombol itu elemen pertama yang bisa difokus di halaman —
  // jadi Tab pertama selalu mendarat di sana, di tengah alur mengetik cek.
  // Paletnya TETAP dibaca dari penyimpanan perangkat supaya tampilan yang sudah
  // dipilih tidak berubah; yang hilang hanya cara menggantinya dari layar.
  let tema = $state(bacaTema());

  $effect(() => {
    document.documentElement.dataset.tema = tema;
  });

  // Paksa kembali ke tab Cek bila daftar tanpa cek jadi kosong
  $effect(() => {
    if (tabAktif === 'tanpa_cek' && ringkasan.penjualanTanpaCek.length === 0) tabAktif = 'cek';
  });

  // KURSOR SELALU DI KOLOM CEK (5 Nov 2026). onMount tidak cukup untuk ini:
  // kolom Cek hanya ada di cabang {:else} status sesi, jadi saat onMount jalan
  // bind:this-nya masih null dan panggilan focus() di sana hilang TANPA galat —
  // kolomnya baru muncul sesudah pemeriksaan sesi selesai, dan tidak ada yang
  // memfokuskannya. Difokuskan SEKALI per elemen: cukup saat kolomnya muncul,
  // dan tidak merebut fokus dari alur yang sengaja memindahkannya ke Bayar.
  let cepatSudahDifokus: HTMLInputElement | null = null;
  $effect(() => {
    const el = inputCepatEl;
    if (!el || el === cepatSudahDifokus) return;
    cepatSudahDifokus = el;
    void tick().then(() => el.focus());
  });

  // Kembali dari aplikasi/tab lain: kalau tidak ada apa pun yang difokus di dalam
  // halaman, kursor lagi-lagi ke kolom Cek. Tidak merebut fokus dari kolom yang
  // sedang dipakai operator, jadi aman disambungkan ke visibilitychange.
  function fokusKeCekBilaKosong() {
    if (!inputCepatEl) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a !== document.documentElement) return;
    inputCepatEl.focus();
  }

  function setPesanPelunasan(sales: string, nominal: number, bayar: number, kembali: number) {
    pesanGalat = null;
    pesanPelunasan = { sales, nominal, bayar, kembali };
    // Permanen: tidak ada setTimeout yang menghapus pesanPelunasan
  }

  // Pelunasan hilang otomatis begitu kasir mulai mengetik cek baru (transaksi
  // baru), atau saat tombol tutup ditekan.
  function tutupPelunasan() {
    pesanPelunasan = null;
  }

  function setPesanGalat(teks: string) {
    clearTimeout(timerGalat);
    pesanGalat = teks;
    timerGalat = setTimeout(() => {
      pesanGalat = null;
    }, 4000);
  }

  function triggerFlash(id: bigint) {
    clearTimeout(timerFlash);
    flashCekId = id;
    timerFlash = setTimeout(() => {
      flashCekId = null;
    }, 1200);
  }

  // Daftar salesman dinamis dari SpacetimeDB (disinkronkan dari ERPNext tabSales Person)
  const daftarSalesmanAktif = $derived(
    daftarSalesman
      .filter((s: any) => s.outlet === OUTLET && s.aktif)
      .map((s: any) => ({ kode: (s.kode || s.nama[0] || '').toLowerCase(), nama: s.nama }))
      .sort((a: any, b: any) => a.nama.localeCompare(b.nama))
  );

  // Cari dari daftar salesman aktif: nama persis -> kode persis -> huruf awal.
  function cariSalesmanAktif(input: string): string {
    const teks = input.trim().toLowerCase();
    if (!teks) return '';
    const nama = daftarSalesmanAktif.find((s) => s.nama.toLowerCase() === teks)?.nama;
    if (nama) return nama;
    const kode = daftarSalesmanAktif.find((s) => s.kode.toLowerCase() === teks)?.nama;
    if (kode) return kode;
    return daftarSalesmanAktif.find((s) => s.kode.toLowerCase() === teks[0])?.nama || '';
  }

  // Target cek terbaru yang belum lunas (bukan kredit). Dari cekTampil, supaya
  // cek yang baru diketik sudah jadi sasaran pembayaran SEKETIKA (dulu barisnya
  // belum ada di sini selama ~2 detik, dan kolom Bayar bisa membayar cek lain).
  const targetBayar = $derived.by(() => {
    return cekTampil.find((c) => !c.kredit && Number(c.dibayar) < Number(c.nominal)) || null;
  });

  const sisaTargetBayar = $derived.by(() => {
    if (!targetBayar) return 0;
    return Math.max(0, Number(targetBayar.nominal) - Number(targetBayar.dibayar));
  });

  // Sambungkan ke SpacetimeDB
  onMount(() => {
    try {
      const d = JSON.parse(sessionStorage.getItem('cek-draf-input') ?? 'null');
      if (d && typeof d.cepat === 'string') { cepatTeks = d.cepat; bayarTeks = d.bayar ?? ''; }
    } catch {}

    if (sesi.status === 'oke') koneksi.sambung();
    // Kursor ke kolom Cek TIDAK dipasang di sini: kolomnya belum tentu ada saat
    // ini (lihat $effect pemfokus di atas — itulah jalur yang benar). Yang
    // dipasang di sini hanya pemulihan saat operator kembali dari aplikasi lain.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') fokusKeCekBilaKosong();
    });
    // Kursor kasir tidak boleh keluar dari pasangan input Cek/Bayar:
    // klik pada area non-interaktif (baris tabel, kartu, celah) tidak
    // memindahkan fokus — hanya klik pada tombol/input/link yang boleh.
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t === inputCepatEl || t === inputBayarEl) return;
      if (t.closest('button, input, select, textarea, a, [contenteditable]')) return;
      e.preventDefault();
    });

    // Coba kirim isi antrean tiap 15 detik selama tersambung.
    const timerAntrean = setInterval(() => { void kirimAntrean(); }, 15000);
    return () => clearInterval(timerAntrean);
  });

  // Timer sambung ulang dibatalkan saat komponen dibuang — dulu tidak ada yang
  // membatalkannya, jadi halaman yang dibongkar meninggalkan timer hidup.
  onDestroy(() => koneksi.tutup());

  // Penanda ketikan terakhir (dipakai saat memutuskan kapan boleh masuk ulang).
  let ketikTerakhir = 0;

  // =========================================================================
  // LOGIKA INPUT CEK TANPA TOMBOL: Otomatis submit saat format lengkap
  // =========================================================================

  // Draf input disimpan sementara: saat sesi habis, halaman dimuat ulang dan
  // angka yang sedang diketik operator tidak boleh hilang.
  const KUNCI_DRAF = 'cek-draf-input';
  function simpanDraf() {
    try { sessionStorage.setItem(KUNCI_DRAF, JSON.stringify({ cepat: cepatTeks, bayar: bayarTeks })); } catch {}
  }

  function onInputCepat() {
    ketikTerakhir = Date.now();
    simpanDraf();
    // Tafsir diambil dari isi kolom yang sedang dilihat kasir, bukan dari state
    // — jadi gerbang auto-submit tidak bergantung urutan bind:value vs oninput.
    const teks = (inputCepatEl?.value ?? cepatTeks).trim();
    // Transaksi baru dimulai → keterangan pelunasan sebelumnya disembunyikan.
    if (teks && pesanPelunasan) pesanPelunasan = null;
    // Gerbang auto-submit DAN yang benar-benar disimpan membaca tafsir yang sama
    // (lib/cek.ts:uraiCek) — dulu gerbangnya regex sendiri di sini, sehingga
    // ketikan seperti "25m1-" memicu submit lalu ditolak parser tanpa pesan.
    if (uraiCek(teks, cariSalesmanAktif).lengkap) kirimCepat();
  }

  function onKeyRightCepat(e: KeyboardEvent) {
    const el = e.target as HTMLInputElement;
    if (el.selectionStart === cepatTeks.length) {
      e.preventDefault();
      inputBayarEl?.focus();
    }
  }

  // Pratinjau tafsir input: operator harus melihat nominal/tipe/salesman
  // SEBELUM menekan Enter — salah tafsir = uang salah di buku.
  const pratinjauCek = $derived(uraiCek(cepatTeks, cariSalesmanAktif));

  // Kode salesman diambil dari papan ketuk supaya operator tidak perlu hafal
  // B=Nabil, C=Sindi, V=Silvia… (sumber salah input terbanyak).
  function pilihSalesman(kode: string) {
    if (!kode) return;
    // Angka nominal yang sudah diketik diambil dari tafsir yang sama dengan
    // gerbang submit — tidak ada regex kedua untuk grammar ini.
    const digit = pratinjauCek.digit ?? '';
    cepatTeks = digit ? digit + kode + '1' : kode;
    ketikTerakhir = Date.now();
    simpanDraf();
    inputCepatEl?.focus();
  }

  async function kirimCepat() {
    // Sumber kebenaran = isi kolom Cek seperti yang dilihat kasir.
    const teksMentah = inputCepatEl?.value ?? cepatTeks;
    const hasil = await intake.simpan(teksMentah);

    if (hasil.jenis === 'kosong') return;
    if (hasil.jenis === 'belum_lengkap') {
      setPesanGalat(hasil.pesan || 'Format: nominal + kode + tipe (mis. 25m1)');
      return;
    }

    // Barisnya sudah masuk daftar (baris optimis), jadi inputnya boleh hilang
    // dari kolom Cek — kolomnya sudah dikosongkan module intake (terimaCek).
    if (hasil.jenis === 'antre') {
      setPesanGalat(`Tersimpan di HP (${hasil.belumTerkirim} belum terkirim) — dikirim otomatis begitu tersambung.`);
      return;
    }

    if (hasil.jenis === 'gagal') {
      setPesanGalat(`Gagal simpan cek: ${hasil.pesan}`);
      cepatTeks = teksMentah;
      inputCepatEl?.focus();
      return;
    }

    // Tersimpan: kalau kolom Bayar sudah diisi, bayar baris itu sekarang.
    if (bayarTeks.trim()) onInputBayar();
  }

  // =========================================================================
  // LOGIKA PEMBAYARAN TANPA TOMBOL: Otomatis bayar saat >= sisa nominal
  // =========================================================================
  function onInputBayar() {
    ketikTerakhir = Date.now();
    simpanDraf();
    const teks = bayarTeks.trim();
    if (!teks || !/^\d+$/.test(teks)) return;

    const bayarRp = Number(teks) * 1000;
    const sisa = sisaTargetBayar;

    if (sisa > 0 && bayarRp >= sisa) {
      kirimBayar();
    }
  }

  function onKeyLeftBayar(e: KeyboardEvent) {
    const el = e.target as HTMLInputElement;
    if (el.selectionStart === 0 && bayarTeks.trim()) {
      e.preventDefault();
      inputCepatEl?.focus();
    }
  }

  async function kirimBayar() {
    // Kolom Bayar dibaca apa adanya; module intake yang menjaga satu pembayaran
    // pada satu waktu, menunggu id server, dan menghitung kembalian.
    const hasil = await intake.bayar(targetBayar, inputBayarEl?.value ?? bayarTeks);

    if (hasil.jenis === 'kosong') return;
    if (hasil.jenis === 'tanpa_target') {
      setPesanGalat('Tidak ada cek yang menunggu pembayaran.');
      return;
    }
    if (hasil.jenis === 'butuh_koneksi') {
      setPesanGalat('Butuh koneksi untuk menghitung pembayaran. Cek baru tetap bisa diinput (disimpan di HP).');
      return;
    }
    if (hasil.jenis === 'tunggu_id') {
      setPesanGalat('Cek yang dituju belum tersimpan di server — isi ulang kolom Bayar.');
      inputBayarEl?.focus();
      return;
    }
    if (hasil.jenis === 'gagal') {
      setPesanGalat(`Gagal bayar: ${hasil.pesan}`);
      inputBayarEl?.focus();
      return;
    }

    // Keterangan pelunasan permanen di samping input bayar.
    setPesanPelunasan(hasil.sales, hasil.nominal, hasil.bayar, hasil.kembali);
  }

  // =========================================================================
  // LOGIKA DOUBLE CLICK EDIT INLINE & CHECKBOX KREDIT
  // =========================================================================
  function mulaiEdit(c: any, kolom: 'salesman' | 'nominal' | 'dibayar') {
    if (c.optimis) return; // barisnya belum ada di server (id sementara)
    let nilai = '';
    if (kolom === 'salesman') {
      nilai = c.salesmanNama || c.salesman;
    } else if (kolom === 'nominal' || kolom === 'dibayar') {
      nilai = String(Number(c[kolom]) / 1000);
    }
    selEdit = { id: c.id, kolom, awal: nilai };
  }

  function batalEdit() {
    selEdit = null;
  }

  async function simpanEdit(c: any, nilaiBaru: string) {
    if (butuhKoneksi("mengubah cek")) return;
    if (!selEdit || selEdit.id !== c.id) return;
    const kolom = selEdit.kolom;
    // Nilainya datang dari komponen sel (Enter / pindah fokus / ketuk penjual),
    // bukan dibaca dari state di sini — jadi satu sel hanya dikirim satu kali.
    const nilai = String(nilaiBaru ?? '');
    selEdit = null;

    let nominal = c.nominal;
    let dibayar = c.dibayar;
    let salesman = c.salesman;
    let salesmanNama = c.salesmanNama;

    if (kolom === 'nominal') {
      const ribuan = Number(nilai.replace(/[^0-9]/g, ''));   // tahan angka maupun teks
      nominal = BigInt(ribuan * 1000);
    } else if (kolom === 'dibayar') {
      const ribuan = Number(nilai.replace(/[^0-9]/g, ''));   // tahan angka maupun teks
      dibayar = BigInt(ribuan * 1000);
    } else if (kolom === 'salesman') {
      const hasil = cariSalesmanAktif(nilai);
      salesmanNama = hasil || nilai.trim();
      salesman = salesmanNama;
    }

    try {
      await conn?.reducers.updateDeklarasiCek({
        id: c.id,
        nominal,
        dibayar,
        tipe: c.tipe,
        kredit: c.kredit,
        salesman,
        salesmanNama,
      });
    } catch (err: any) {
      setPesanGalat(`Gagal update: ${err.message || err}`);
    } finally {
      inputCepatEl?.focus();
    }
  }

  async function toggleKredit(c: any, ceklis: boolean) {
    if (butuhKoneksi("mengubah tanda kredit")) return;
    if (c.optimis) return; // barisnya belum ada di server (id sementara)
    try {
      await conn?.reducers.updateDeklarasiCek({
        id: c.id,
        nominal: c.nominal,
        dibayar: c.dibayar,
        tipe: c.tipe,
        kredit: ceklis,
        salesman: c.salesman,
        salesmanNama: c.salesmanNama,
      });
    } catch (err: any) {
      setPesanGalat(`Gagal ubah kredit: ${err.message || err}`);
    } finally {
      inputCepatEl?.focus();
    }
  }

  async function hapusCek(id: bigint) {
    if (butuhKoneksi("menghapus cek")) return;
    if (!(await konfirmasi('Hapus baris cek ini?'))) return;
    try {
      await conn?.reducers.hapusDeklarasiCek({ id });
    } catch (err: any) {
      setPesanGalat(`Gagal hapus: ${err.message || err}`);
    } finally {
      inputCepatEl?.focus();
    }
  }

  // Ringkasan Rekonsiliasi (dari cekTampil: cek yang baru diketik ikut terhitung
  // SEKETIKA, angka "Selisih" tidak menunggu ~2 detik perjalanan ke server)
  const ringkasan = $derived(hitungRingkasan(cekTampil, daftarPenjualan));

  // ---- Galeri bukti gambar -------------------------------------------------
  // Kunci dari sisi ERP: 'cek-{outlet}-{tanggal}-{id}' (huruf kecil). Data lama
  // ada yang beda huruf besar/kecil, jadi pencocokan dibuat tanpa peduli huruf.
  function kunciFoto(c: any): string {
    // Baris hasil pemulihan arsip membawa cekid apa adanya (id baris SpacetimeDB
    // lama); baris baru tetap dihitung dari id. Keduanya harus sama bentuknya
    // dengan yang dipakai modul (lihat relasi.ts).
    const eksplisit = String((c as any).cekid ?? '').trim();
    if (eksplisit) return eksplisit.toLowerCase();
    return `cek-${OUTLET.toLowerCase()}-${c.tanggal}-${c.id}`.toLowerCase();
  }

  const fotoPerCek = $derived.by(() => {
    const m = new Map<string, { url: string; filename?: string; source?: string }[]>();
    for (const f of daftarFoto) {
      let arr: any[] = [];
      try {
        arr = JSON.parse(f.imagesJson || '[]');
      } catch {
        arr = [];
      }
      if (Array.isArray(arr) && arr.length > 0) m.set(String(f.cekid ?? '').toLowerCase(), arr);
    }
    return m;
  });

  function fotoCek(c: any) {
    return fotoPerCek.get(kunciFoto(c)) ?? [];
  }

  // Buka/tutup galeri bukti. Isinya (indeks, pratinjau, gambar besar, Esc, kunci
  // gulir) milik komponen GaleriBukti; di sini hanya baris mana yang dibuka.
  function bukaGaleri(c: any) {
    if (fotoCek(c).length === 0) return;
    galeriCek = c;
  }

  // Kembalikan fokus ke kolom Cek supaya kasir bisa langsung mengetik lagi.
  // Ditulis begini karena panelnya dibuang dari DOM: tanpa pemfokusan ulang,
  // browser memindahkan fokus ke <body> dan Tab mulai lagi dari awal halaman.
  function tutupGaleri() {
    galeriCek = null;
    inputCepatEl?.focus();
    setTimeout(() => inputCepatEl?.focus(), 30);
  }

  // ---- Beda tafsir pembayaran (cek kasir vs yang diinput ke Ollsera) -------
  // Ollsera menandai kredit pada `payment_mode` = 'Kredit' (payment_type selalu
  // 'Tunai'). Kalau kasir mencentang kredit tapi register tunai — atau
  // sebaliknya — admin harus bisa melihatnya untuk membetulkan di Ollsera.
  const penjualanPerOrder = $derived.by(() => {
    const m = new Map<string, any>();
    for (const p of daftarPenjualan) m.set(p.orderNo, p);
    return m;
  });

  // Logikanya di lib/kredit.ts (fungsi murni + uji di scripts/uji_kredit.*).
  // Ejaan kredit BEDA antar sumber - Ollsera 'Kredit', POS Sapaty 'CREDIT' - dan
  // detektor lama hanya mengenal yang pertama, sehingga penjualan kredit dari POS
  // terbaca sebagai TUNAI. Akibatnya baris yang sebenarnya sepadan dilaporkan
  // sebagai "beda tafsir" (kejadian nyata 1 Nov 2026: 204.000 Silvia, kredit).
  function bedaBayar(c: any): { cekKredit: boolean; regKredit: boolean } | null {
    return bedaBayarMurni(c, (o: string) => penjualanPerOrder.get(o));
  }

  const jmlBedaBayar = $derived(daftarCek.filter((c) => bedaBayar(c) !== null).length);

  // Pesanan POS yang belum ada ceknya (= "belum diinput" oleh kasir).
  const nilaiTanpaCek = $derived(ringkasan.penjualanTanpaCek.reduce((a, b) => a + Number(b.total), 0));

  // Filter daftar cek untuk tabel
  const cekTersaring = $derived.by(() => {
    const q = cariTeks.trim().toLowerCase();
    return cekTampil.filter((c) => {
      if (filterStatus === 'beda_bayar' && bedaBayar(c) === null) return false;
      if (filterStatus === 'kredit' && !c.kredit) return false;
      if (filterStatus === 'belum_input' && (c.orderNo || c.status !== 'Belum Cocok')) return false;
      if (filterStatus === 'kurang_bayar' && (c.kredit || Number(c.dibayar) >= Number(c.nominal))) return false;
      if (q) {
        const match =
          c.salesmanNama.toLowerCase().includes(q) ||
          c.salesman.toLowerCase().includes(q) ||
          c.orderNo.toLowerCase().includes(q) ||
          c.customer.toLowerCase().includes(q) ||
          c.nominal.toString().includes(q);
        if (!match) return false;
      }
      return true;
    });
  });

  // Label koneksi (teks tenang, bukan pil menyala)
  const statusTeks = $derived(
    statusKoneksi === 'terhubung'
      ? 'Tersambung'
      : statusKoneksi === 'menghubungkan'
        ? 'Menyambung…'
        : gagalKoneksi
          ? 'Perlu masuk ulang'
          : 'Terputus'
  );
  const statusNada = $derived(
    statusKoneksi === 'terhubung' ? 'bg-ok' : statusKoneksi === 'menghubungkan' ? 'bg-muted' : 'bg-bad'
  );

  // ==================== GERBANG LOGIN (SpacetimeAuth / Google) ====================
  const EMAIL_DIIZINKAN = 'tachtasandangsjb@gmail.com';
  // Kalau halaman ini callback OIDC, handleOidcCallback() yang mengurus (tukar
  // kode → simpan token → muat ulang). Kalau bukan, tentukan status sesi —
  // urutannya (belum login / ditolak / token kedaluwarsa → perpanjang diam-diam)
  // ada di lib/koneksi.ts, bukan terpencar di komponen ini.
  if (!handleOidcCallback()) koneksi.siapkanSesi();

  // Operasi yang mengubah/menghapus/membayar cek yang SUDAH ada di server
  // butuh koneksi — tidak diantrekan supaya uang tidak terhitung dua kali.
  function butuhKoneksi(aksi: string): boolean {
    if (statusKoneksi === 'terhubung' && conn?.reducers) return false;
    setPesanGalat(`Butuh koneksi untuk ${aksi}. Cek baru tetap bisa diinput (disimpan di HP).`);
    return true;
  }

  // Kirim isi antrean HP ke server (berurutan, berhenti saat gagal) — jalurnya
  // kini di module intake, di sini hanya pesan ke kasir.
  async function kirimAntrean() {
    const terkirim = await intake.kirimAntrean();
    if (terkirim > 0) {
      setPesanGalat(`${terkirim} cek dari HP terkirim.${antrean.daftar.length ? ` Sisa ${antrean.daftar.length} menunggu.` : ''}`);
    }
  }

  // Cek hanya bermakna hari itu; baris hari lama dibuang. Dua langkah:
  // uji (tidak menghapus) dulu, baru jalankan.
  async function bersihkanCekLama() {
    if (!conn?.reducers?.bersihkanCekLama) {
      await info('Reducer belum tersedia — muat ulang halaman.');
      return;
    }
    if (jmlCekLama === 0) {
      await info('Tidak ada cek dari hari lama.');
      return;
    }
    if (!(await konfirmasi(`Ada ${jmlCekLama} baris cek dari hari sebelumnya.\n\nJalankan UJI dulu (tidak menghapus apa pun)?`))) return;
    try {
      await conn.reducers.bersihkanCekLama({ dryRun: true });
      await new Promise((r) => setTimeout(r, 900));
      const log = Array.from((conn.db.syncLog?.iter?.() ?? []) as Iterable<any>)
        .filter((l: any) => String(l.jenis ?? '').startsWith('purge-cek'))
        .sort((a: any, b: any) => Number(a.lastSyncedAt?.microsSinceUnixEpoch ?? 0) - Number(b.lastSyncedAt?.microsSinceUnixEpoch ?? 0))
        .pop();
      const siap = Number(log?.totalRows ?? 0);
      if (!(await konfirmasi(`Uji: ${siap} baris siap dibuang (jejak 'Belum Cocok' ditahan 7 hari).\n\nHapus sekarang?`))) return;
      await conn.reducers.bersihkanCekLama({ dryRun: false });
      await info(`Selesai: ${siap} baris cek hari lama dibuang.`);
    } catch (e) {
      await info('Gagal: ' + String((e as Error)?.message ?? e));
    }
  }

  // Masuk (atau masuk ulang): menandai percobaan lalu pindah ke login Google.
  // Dipakai tombol di ketiga kartu sesi DAN oleh masuk-ulang otomatis di
  // lib/koneksi.ts, yang menjaga agar tidak terjadi lingkaran redirect.
</script>

<!-- Kelas bersama: permukaan dasar + cincin fokus keyboard -->
{#if sesi.status === 'belum_login'}
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm rounded-xl border border-line bg-card p-6">
      <Lock size={20} strokeWidth={1.5} class="text-muted" />
      <div class="mt-4 text-[17px] font-semibold text-ink">Sapaty Cek</div>
      <p class="mt-1 text-[13px] leading-5 text-ink2">
        Halaman ini hanya untuk akun terdaftar. Masuk dengan Google melalui SpacetimeDB.
      </p>
      <button
        type="button"
        onclick={koneksi.masukSekarang}
        class="mt-5 h-11 w-full rounded-lg bg-ink text-[13px] font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Masuk dengan Google
      </button>
    </div>
  </div>
{:else if sesi.status === 'kedaluwarsa'}
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm rounded-xl border border-line bg-card p-6">
      <Hourglass size={20} strokeWidth={1.5} class="text-accent" />
      <div class="mt-4 text-[17px] font-semibold text-ink">Sesi login habis</div>
      <p class="mt-1 text-[13px] leading-5 text-ink2">
        Masa berlaku login SpacetimeAuth sekitar 1 jam — itulah sebabnya indikator jadi kuning dan input cek
        tidak bisa dipakai. Masuk lagi untuk melanjutkan; tidak ada input yang hilang.
      </p>
      <button
        type="button"
        data-ui="masukUlang"
        onclick={koneksi.masukSekarang}
        class="mt-5 h-11 w-full rounded-lg bg-ink text-[13px] font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Masuk lagi dengan Google
      </button>
    </div>
  </div>
{:else if sesi.status === 'ditolak'}
  <div class="min-h-screen flex items-center justify-center p-6">
    <div class="w-full max-w-sm rounded-xl border border-line bg-card p-6">
      <Ban size={20} strokeWidth={1.5} class="text-bad" />
      <div class="mt-4 text-[17px] font-semibold text-ink">Akses ditolak</div>
      <p class="mt-1 text-[13px] leading-5 text-ink2">
        Akun <span class="font-medium text-ink">{sesi.email}</span> tidak diizinkan membuka halaman ini.
      </p>
      <button
        type="button"
        onclick={() => logout()}
        class="mt-5 h-11 w-full rounded-lg border border-line2 bg-raised text-[13px] font-medium text-ink transition-colors hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Ganti akun
      </button>
    </div>
  </div>
{:else}
<div class="mx-auto max-w-6xl px-6 py-6 space-y-5">
  <!-- KEPALA: nama, outlet, PERIODE (rekonsiliasi selalu per hari), status -->
  <header class="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
    <div>
      <div class="flex items-baseline gap-2">
        <span class="text-[17px] font-semibold tracking-tight text-ink">Sapaty Cek</span>
        <span class="text-[13px] text-muted">Rekonsiliasi kasir</span>
      </div>
      <div class="mt-1 flex items-center gap-2 text-[13px]">
        <span class="font-medium text-ink2">{OUTLET}</span>
        <span class="text-ink/20">/</span>
        <span class="font-mono text-muted">{judulTanggal}</span>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-2 text-[12px] text-ink2">
        <span class="h-1.5 w-1.5 rounded-full {statusNada}"></span>
        <span>{statusTeks}</span>
      </div>
    </div>
  </header>

  <!-- SALDO HARI: satu momen yang membawa angka besar, lalu tiga angka ringkas -->
  <section class="rounded-2xl border border-line bg-card p-6">
    <h2 class="text-[13px] font-medium text-muted">Saldo hari</h2>

    <div class="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[15px] text-ink2">
      <span class="whitespace-nowrap">Penjualan POS {rupiah(ringkasan.totalPenjualan)}</span>
      <span class="whitespace-nowrap">− Cek kasir {rupiah(ringkasan.totalCek)}</span>
    </div>
    <div class="mt-4 flex items-baseline gap-3 border-t border-line pt-4">
      <span class="text-[13px] text-muted">Selisih</span>
      <span class="whitespace-nowrap font-mono text-[34px] font-medium leading-none {ringkasan.selisih === 0 ? 'text-ink' : 'text-bad'}">
        {rupiah(ringkasan.selisih)}
      </span>
    </div>
    <p class="mt-3 max-w-lg text-[13px] text-muted">
      Register POS dikurangi cek kasir untuk {judulTanggal}. Nol berarti buku cocok.
    </p>

    <dl class="mt-5 grid divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      <div class="py-3 sm:py-4 sm:pr-6">
        <dt class="text-[13px] text-ink2">Cek diinput</dt>
        <dd class="mt-1.5">
          <div class="font-mono text-[17px] text-ink">{ringkasan.jmlCek} cek</div>
          <div class="mt-1 font-mono text-[12px] text-muted">{rupiah(ringkasan.totalCek)}</div>
          <div class="mt-0.5 font-mono text-[12px] text-muted">
            <span class={ringkasan.jmlBelumCocok > 0 ? 'text-bad' : 'text-ok'}>{ringkasan.jmlCocok} sudah input</span>
            · {ringkasan.jmlBelumCocok} belum input
          </div>
        </dd>
      </div>
      <div class="py-3 sm:py-4 sm:px-6">
        <dt class="text-[13px] text-ink2">Belum diinput (POS)</dt>
        <dd class="mt-1.5">
          <div class="font-mono text-[17px] {ringkasan.penjualanTanpaCek.length > 0 ? 'text-bad' : 'text-ink'}">
            {ringkasan.penjualanTanpaCek.length} order
          </div>
          <div class="mt-1 font-mono text-[12px] text-muted">{rupiah(nilaiTanpaCek)}</div>
          <div class="mt-0.5 text-[12px] text-muted">pesanan tanpa cek</div>
        </dd>
      </div>
      <div class="py-3 sm:py-4 sm:pl-6">
        <dt class="text-[13px] text-ink2">Beda cara bayar</dt>
        <dd class="mt-1.5">
          <div class="font-mono text-[17px] {jmlBedaBayar > 0 ? 'text-bad' : 'text-ink'}">{jmlBedaBayar} cek</div>
          <div class="mt-1 text-[12px] text-muted">cek kasir ≠ input Ollsera</div>
        </dd>
      </div>
    </dl>
  </section>

  <!-- INPUT KASIR: tetap di atas saat menggulir (operator mengetik terus) -->
  <section class="sticky top-0 z-20 space-y-3 rounded-2xl border border-line bg-card p-5">
    <div class="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div>
        <label for="input-cepat" class="mb-1.5 flex items-baseline gap-2 text-[12px] text-muted">
          Cek <span class="text-[11px] text-muted/80">nominal · kode · tipe</span>
        </label>
        <input
          id="input-cepat"
          bind:this={inputCepatEl}
          bind:value={cepatTeks}
          oninput={onInputCepat}
          onkeydown={(e) => {
            if (e.key === 'Enter') kirimCepat();
            else if (e.key === 'ArrowRight') onKeyRightCepat(e);
          }}
          type="text"
          inputmode="text"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          placeholder="25m1"
          class="h-10 w-40 rounded-lg border border-line2 bg-raised px-3 font-mono text-[17px] font-medium text-ink outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted focus:border-accent focus:bg-card focus:ring-2 focus:ring-accent/25"
        />
      </div>

      <div>
        <label for="input-bayar" class="mb-1.5 flex items-baseline gap-2 text-[12px] text-muted">
          Bayar <span class="text-[11px] text-muted/80">ribuan</span>
        </label>
        <input
          id="input-bayar"
          bind:this={inputBayarEl}
          bind:value={bayarTeks}
          oninput={onInputBayar}
          onfocus={() => { isBayarFocused = true; }}
          onblur={() => { isBayarFocused = false; }}
          onkeydown={(e) => {
            // Tab di kolom Bayar kembali ke kolom Cek: kedua kolom ini dipakai
            // bergantian sepanjang hari, jadi Tab menutup lingkarannya — bukan
            // melompat ke papan penjual/tombol di sebelah kanan.
            if (e.key === 'Enter') kirimBayar();
            else if (e.key === 'ArrowLeft') onKeyLeftBayar(e);
            else if (e.key === 'Tab') {
              e.preventDefault();
              inputCepatEl?.focus();
            }
          }}
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          placeholder="50"
          class="h-10 w-36 rounded-lg border border-line2 bg-raised px-3 font-mono text-[17px] font-medium text-ink outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted focus:border-accent focus:bg-card focus:ring-2 focus:ring-accent/25"
        />
      </div>

      <!-- Tiga keterangan TERPISAH supaya tidak saling menghilangkan -->
      <div class="min-w-[16rem] flex-1 space-y-1.5">
        {#if pesanPelunasan}
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-ok/30 bg-ok/8 px-2.5 py-1.5 text-[12px] text-ink2">
            <Check size={14} strokeWidth={2} class="shrink-0 text-ok" />
            <span class="font-medium text-ink">Lunas</span>
            <span>{pesanPelunasan.sales} {rupiah(pesanPelunasan.nominal)}</span>
            <span class="text-ink/20">·</span>
            <span>bayar {rupiah(pesanPelunasan.bayar)}</span>
            <span class="text-ink/20">·</span>
            <span>kembali <span class="font-mono text-ok">{rupiah(pesanPelunasan.kembali)}</span></span>
            <button
              type="button"
              data-ui="tutupPelunasan"
              onclick={tutupPelunasan}
              title="Tutup keterangan pelunasan"
              class="ml-auto rounded p-0.5 text-muted transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        {/if}

        {#if pesanGalat}
          <div class="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/8 px-2.5 py-1.5 text-[12px] text-ink2">
            <TriangleAlert size={14} strokeWidth={1.5} class="mt-0.5 shrink-0 text-bad" />
            <span>{pesanGalat}</span>
          </div>
        {/if}

        {#if targetBayar}
          <div class="text-[12px] text-ink2">
            Target <span class="font-medium text-ink">{targetBayar.salesmanNama}</span>
            · sisa <span class="font-mono text-ink">{rupiah(sisaTargetBayar)}</span>
          </div>
        {:else if !pesanPelunasan}
          <div class="flex items-center gap-2 text-[12px] text-muted">
            <Check size={14} strokeWidth={1.5} class="shrink-0 text-ok" />
            Semua cek hari ini lunas
          </div>
        {/if}
      </div>
    </div>

    <!-- PRATINJAU TAFSIR INPUT (pencegahan salah tafsir sebelum Enter) -->
    {#if pratinjauCek.jenis !== 'kosong'}
      <div
        class="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] {pratinjauCek.jenis === 'siap'
          ? 'border-ok/30 bg-ok/8 text-ink2'
          : pratinjauCek.jenis === 'sebagian'
            ? 'border-line bg-raised/60 text-ink2'
            : 'border-bad/30 bg-bad/8 text-ink2'}"
      >
        {#if pratinjauCek.jenis === 'siap'}
          <Check size={14} strokeWidth={2} class="shrink-0 text-ok" />
          {#if pratinjauCek.kode}
            <span class="rounded border border-line2 bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink">{pratinjauCek.kode}</span>
          {/if}
        {:else if pratinjauCek.jenis === 'salah'}
          <TriangleAlert size={14} strokeWidth={1.5} class="shrink-0 text-bad" />
        {/if}
        <span>{pratinjauCek.teks}</span>
      </div>
    {/if}

    <!-- PAPAN KETUK SALESMAN: kode ketuk ↔ nama (hafalan B/C/V sering keliru) -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[12px] text-muted">Penjual</span>
      {#each daftarSalesmanAktif as s (s.kode + s.nama)}
        <button
          type="button"
          data-ui="pilihSalesman"
          onclick={() => pilihSalesman(s.kode)}
          class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {pratinjauCek.kode === s.kode
            ? 'border-accent bg-accent text-onaccent'
            : 'border-line2 bg-card text-ink2 hover:bg-raised'}"
          title="Isi kolom Cek dengan kode {s.kode.toUpperCase()} untuk {s.nama}"
        >
          <span class="font-mono text-[11px] {pratinjauCek.kode === s.kode ? 'text-onaccent/70' : 'text-muted'}">{s.kode.toUpperCase()}</span>
          <span>{s.nama}</span>
        </button>
      {/each}
    </div>
  </section>

  <!-- ANTREAN HP: cek yang belum terkirim (internet putus) -->
  <AntreanCek daftar={antrean.daftar} kirim={() => kirimAntrean()} buang={(ref) => antreBuang(ref)} />

  <!-- TAB & SARING -->
  <div class="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex items-center gap-1">
      <button
        onclick={() => { tabAktif = 'cek'; }}
        class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {tabAktif === 'cek' ? 'bg-raised text-ink' : 'text-ink2 hover:bg-raised/60'}"
      >
        <ListChecks size={15} strokeWidth={1.5} class={tabAktif === 'cek' ? 'text-accent' : 'text-muted'} />
        Daftar cek
        <span class="font-mono text-[12px] text-muted">{cekTampil.length}</span>
      </button>
      {#if jmlCekLama > 0}
        <button
          type="button"
          data-ui="bersihkanCekLama"
          onclick={bersihkanCekLama}
          title="Cek hanya dipakai pada hari itu — baris hari lama dibersihkan otomatis pukul 08:00 WIT"
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-ink2 transition-colors hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Eraser size={15} strokeWidth={1.5} class="text-muted" />
          Cek lama
          <span class="font-mono text-[12px] text-muted">{jmlCekLama}</span>
        </button>
      {/if}
      {#if ringkasan.penjualanTanpaCek.length > 0}
        <button
          onclick={() => { tabAktif = 'tanpa_cek'; }}
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {tabAktif === 'tanpa_cek' ? 'bg-raised text-ink' : 'text-ink2 hover:bg-raised/60'}"
        >
          <TriangleAlert size={15} strokeWidth={1.5} class="text-bad" />
          Penjualan tanpa cek
          <span class="font-mono text-[12px] text-muted">{ringkasan.penjualanTanpaCek.length}</span>
        </button>
      {/if}
    </div>

    {#if tabAktif === 'cek'}
      <div class="flex flex-wrap items-center gap-2">
        <div class="inline-flex max-w-full items-center overflow-x-auto rounded-lg border border-line bg-card p-0.5">
          {#each ([['semua', 'Semua'], ['belum_input', 'Belum input'], ['beda_bayar', `Beda bayar${jmlBedaBayar ? ' · ' + jmlBedaBayar : ''}`], ['kurang_bayar', 'Kurang bayar'], ['kredit', 'Kredit']] as const) as [v, label] (v)}
            <button
              type="button"
              onclick={() => { filterStatus = v; }}
              class="whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {filterStatus === v ? 'bg-raised text-ink' : 'text-ink2 hover:bg-raised/60'}"
            >
              {label}
            </button>
          {/each}
        </div>
        <div class="relative shrink-0">
          <Search size={14} strokeWidth={1.5} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <input
            bind:value={cariTeks}
            placeholder="Cari"
            class="h-9 w-40 rounded-lg border border-line2 bg-card pl-8 pr-2.5 text-[13px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- TAB 1: DAFTAR CEK -->
  {#if tabAktif === 'cek'}
    <div class="overflow-hidden rounded-2xl border border-line bg-card">
      {#if cekTersaring.length === 0}
        <div class="px-6 py-10 text-center text-[13px] text-muted">
          Belum ada deklarasi cek kasir untuk hari ini
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[13px]">
            <thead class="border-b border-line text-[12px] text-muted">
              <tr>
                <th class="px-3 py-2 font-medium">Jam</th>
                <th class="px-3 py-2 font-medium">Penjual</th>
                <th class="px-3 py-2 text-right font-medium">Nominal (ribu)</th>
                <th class="px-3 py-2 text-right font-medium">Dibayar</th>
                <th class="px-3 py-2 text-right font-medium">Kembalian</th>
                <th class="px-3 py-2 font-medium">Tipe</th>
                <th class="px-3 py-2 text-center font-medium">Kredit</th>
                <th class="px-3 py-2 font-medium">Order POS</th>
                <th class="px-3 py-2 text-center font-medium">Foto</th>
                <th class="px-3 py-2 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {#each cekTersaring as c (c.id)}
                {@const isTarget = isBayarFocused && targetBayar?.id === c.id}
                <tr
                  class="align-top transition-colors {isTarget ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : flashCekId === c.id ? 'animate-row-in' : 'hover:bg-raised/40'}"
                >
                  <td class="px-3 py-2.5 font-mono text-[12px] text-muted">
                    {c.jam.slice(0, 5)}{#if c.optimis}<Hourglass
                        size={11}
                        strokeWidth={1.5}
                        data-ui="barisOptimis"
                        class="ml-1 inline align-[-1px] text-accent"
                        title="Baru diketik — menunggu tersimpan di server"
                      />{/if}
                  </td>

                  <!-- 1. PENJUAL (klik 2x edit -> pilih dari daftar) -->
                  <td
                    class="cursor-pointer px-3 py-2.5"
                    ondblclick={() => mulaiEdit(c, 'salesman')}
                    title="Klik 2x untuk ubah penjual"
                  >
                    {#if selEdit && selEdit.id === c.id && selEdit.kolom === 'salesman'}
                      <span class="font-medium text-accent underline">{c.salesmanNama}</span>
                      <!-- Picker bottom-sheet: pengganti dropdown native (tahan semua browser) -->
                      <div class="fixed inset-0 z-50 bg-scrim/45" onclick={() => batalEdit()}>
                        <div class="absolute left-2 right-2 bottom-2 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-card p-2 shadow-xl" onclick={(e) => e.stopPropagation()}>
                          <div class="px-2 py-1.5 text-[12px] text-muted">Pilih penjual</div>
                          {#each daftarSalesmanAktif as s (s.nama)}
                            <button
                              type="button"
                              onclick={() => simpanEdit(c, s.nama)}
                              class="w-full rounded-lg px-3 py-3 text-left text-[14px] font-medium transition-colors {selEdit?.awal === s.nama ? 'bg-accent text-onaccent' : 'text-ink hover:bg-raised'}"
                            >
                              {s.nama}
                            </button>
                          {/each}
                        </div>
                      </div>
                    {:else}
                      <span class="font-medium text-ink">{c.salesmanNama}</span>
                    {/if}
                  </td>

                  <!-- 2. NOMINAL (klik 2x edit, dalam ribuan) -->
                  <td
                    class="cursor-pointer px-3 py-2.5 text-right font-mono font-medium text-ink"
                    ondblclick={() => mulaiEdit(c, 'nominal')}
                    title="Klik 2x untuk ubah nominal"
                  >
                    {#if selEdit && selEdit.id === c.id && selEdit.kolom === 'nominal'}
                      <SelEdit
                        awal={selEdit.awal}
                        onsimpan={(nilai) => simpanEdit(c, nilai)}
                        onbatal={batalEdit}
                      />
                    {:else}
                      {formatRibuan(c.nominal)}
                    {/if}
                  </td>

                  <!-- 3. DIBAYAR (klik 2x edit, dalam ribuan) -->
                  <td
                    class="cursor-pointer px-3 py-2.5 text-right font-mono"
                    ondblclick={() => mulaiEdit(c, 'dibayar')}
                    title="Klik 2x untuk ubah dibayar"
                  >
                    {#if selEdit && selEdit.id === c.id && selEdit.kolom === 'dibayar'}
                      <SelEdit
                        awal={selEdit.awal}
                        onsimpan={(nilai) => simpanEdit(c, nilai)}
                        onbatal={batalEdit}
                      />
                    {:else if c.kredit}
                      <span class="text-muted">Kredit</span>
                    {:else if Number(c.dibayar) >= Number(c.nominal)}
                      <span class="font-medium text-ok">{formatRibuan(c.dibayar)}</span>
                    {:else if Number(c.dibayar) > 0}
                      <span class="text-ink2">{formatRibuan(c.dibayar)}</span>
                    {:else}
                      <span class="font-medium text-bad">0</span>
                    {/if}
                  </td>

                  <!-- 3b. KEMBALIAN = dibayar - nominal (— kalau belum lunas/kredit) -->
                  <td class="px-3 py-2.5 text-right font-mono {!c.kredit && Number(c.dibayar) > Number(c.nominal) ? 'text-ok' : 'text-muted'}">
                    {!c.kredit && Number(c.dibayar) > Number(c.nominal) ? formatRibuan(Number(c.dibayar) - Number(c.nominal)) : '—'}
                  </td>

                  <td class="px-3 py-2.5 text-[12px] text-ink2">
                    {c.tipe}
                  </td>

                  <!-- 4. KREDIT (checkbox langsung simpan) -->
                  <td class="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={c.kredit}
                      disabled={c.optimis}
                      onchange={(e) => toggleKredit(c, (e.target as HTMLInputElement).checked)}
                      class="h-4 w-4 cursor-pointer rounded border-line2 align-middle accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-default disabled:opacity-40"
                      title={c.optimis ? 'Baris baru — tunggu tersimpan di server' : 'Tandai kredit (tidak ikut ditunggu di kotak bayar)'}
                    />
                  </td>

                  <!-- 5. ORDER POS (termasuk tanda beda cara bayar) -->
                  <td class="px-3 py-2.5">
                    {#if c.orderNo}
                      <div class="font-mono text-[12px] text-ink">{c.orderNo}</div>
                      <div class="mt-0.5 text-[12px] text-muted">{c.customer}</div>
                      {@const beda = bedaBayar(c)}
                      {#if beda}
                        <div
                          class="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-bad"
                          title="Kasir dan Ollsera berbeda cara bayar — betulkan di Ollsera"
                        >
                          <TriangleAlert size={12} strokeWidth={1.5} />
                          cek: {beda.cekKredit ? 'Kredit' : 'Tunai'} · POS: {beda.regKredit ? 'Kredit' : 'Tunai'}
                        </div>
                      {/if}
                    {:else}
                      <span class="text-[12px] font-medium text-bad">Belum cocok POS</span>
                    {/if}
                  </td>

                  <!-- 6. FOTO: kolom sendiri supaya tidak menumpuk di bawah nomor
                       order dan lebar kolom tidak melompat antar baris -->
                  <td class="px-3 py-2.5 text-center">
                    {#if fotoCek(c).length > 0}
                      <button
                        type="button"
                        data-ui="buktiGambar"
                        onclick={() => bukaGaleri(c)}
                        class="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {galeriCek?.id === c.id ? 'border-accent bg-accent text-onaccent' : 'border-line2 bg-card text-ink2 hover:bg-raised'}"
                        title="Buka galeri bukti gambar (layar penuh)"
                        aria-label="Bukti gambar: {fotoCek(c).length} foto"
                      >
                        <Camera size={13} strokeWidth={1.5} />
                        <span class="font-mono">{fotoCek(c).length}</span>
                      </button>
                    {:else}
                      <span class="text-[12px] text-muted">—</span>
                    {/if}
                  </td>

                  <td class="px-3 py-2.5 text-right">
                    {#if !c.optimis}
                      <button
                        onclick={() => hapusCek(c.id)}
                        class="rounded-md p-1 text-ink2 transition-colors hover:bg-bad/8 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                        title="Hapus baris cek"
                        aria-label="Hapus baris cek"
                      >
                        <Trash size={15} strokeWidth={1.5} />
                      </button>
                    {/if}
                  </td>
                </tr>

              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- GALERI BUKTI (layar penuh). Isi & keadaannya di lib/komponen/GaleriBukti.svelte -->
  {#if galeriCek}
    <GaleriBukti baris={galeriCek} foto={fotoCek(galeriCek)} onclose={tutupGaleri} />
  {/if}

  <!-- TAB 2: PENJUALAN TANPA CEK -->
  {#if tabAktif === 'tanpa_cek'}
    <div class="overflow-hidden rounded-2xl border border-line bg-card">
      {#if ringkasan.penjualanTanpaCek.length === 0}
        <div class="flex items-center justify-center gap-2 px-6 py-10 text-[13px] text-ok">
          <Check size={15} strokeWidth={2} />
          Semua transaksi register POS sudah punya pasangan cek kasir
        </div>
      {:else}
        <div class="border-b border-line bg-bad/8 px-3 py-2.5 text-[12px] text-ink2">
          Transaksi berikut tercatat di register POS Ollsera tetapi belum dideklarasikan oleh kasir
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-[13px]">
            <thead class="border-b border-line text-[12px] text-muted">
              <tr>
                <th class="px-3 py-2 font-medium">Waktu</th>
                <th class="px-3 py-2 font-medium">Order</th>
                <th class="px-3 py-2 font-medium">Pelanggan</th>
                <th class="px-3 py-2 font-medium">Pembayaran</th>
                <th class="px-3 py-2 text-right font-medium">Total POS</th>
                <th class="px-3 py-2 font-medium">Kasir POS</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              {#each ringkasan.penjualanTanpaCek as p (p.orderNo)}
                <tr class="transition-colors hover:bg-raised/40">
                  <td class="px-3 py-2.5 font-mono text-[12px] text-muted">{p.orderTime || '—'}</td>
                  <td class="px-3 py-2.5 font-mono text-[12px] text-ink">{p.orderNo}</td>
                  <td class="px-3 py-2.5 text-ink">{p.customerName || '1Ecer'}</td>
                  <td class="px-3 py-2.5 text-ink2">{p.paymentType || 'Tunai'}</td>
                  <td class="px-3 py-2.5 text-right font-mono text-ink">{rupiah(p.total)}</td>
                  <td class="px-3 py-2.5 text-ink2">{p.cashierName || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>

{/if}

{#if dialog}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-scrim/45 p-6" data-ui="dialog">
    <div class="w-full max-w-sm rounded-xl border border-line bg-card p-5 shadow-xl">
      <p class="whitespace-pre-line text-[13px] leading-5 text-ink">{dialog.teks}</p>
      <div class="mt-5 flex justify-end gap-2">
        {#if !dialog.hanyaOk}
          <button
            type="button"
            data-ui="dialogBatal"
            onclick={() => dialog?.jawab?.(false)}
            class="rounded-lg border border-line2 bg-raised px-3.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >Batal</button>
        {/if}
        <button
          type="button"
          data-ui="dialogYa"
          onclick={() => dialog?.jawab?.(true)}
          class="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >{dialog.hanyaOk ? 'OK' : 'Ya'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Sorot baris baru: SEKALI (dulu animate-pulse infinite pada hal yang tidak
     live — denyut tak berhenti di layar kasir). */
  @keyframes row-in {
    from {
      background-color: color-mix(in oklab, var(--color-accent) 16%, transparent);
    }
    to {
      background-color: transparent;
    }
  }

  .animate-row-in {
    animation: row-in 1.2s cubic-bezier(0.22, 1, 0.36, 1) 1;
  }
</style>
