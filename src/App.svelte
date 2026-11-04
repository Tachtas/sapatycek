<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    Lock,
    Hourglass,
    Ban,
    ListChecks,
    Eraser,
    TriangleAlert,
    Camera,
    Image,
    X,
    Check,
    Search,
    Palette,
    Trash,
    ChevronLeft,
    ChevronRight,
  } from '@lucide/svelte';
  import { DbConnection } from './module_bindings';
  import { antrean, antreTambah, antreBuang } from './lib/antrean.svelte';
  import { rupiah, formatRibuan, uraiCek, parseCek, hitungRingkasan } from './lib/cek';
  import { bedaBayar as bedaBayarMurni } from './lib/kredit';
  import AntreanCek from './lib/komponen/AntreanCek.svelte';
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

  let conn = $state<any>(null);
  let statusKoneksi = $state<'menghubungkan' | 'terhubung' | 'terputus'>('menghubungkan');

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

  // Status fokus kursor di bayar untuk sorot baris target
  let isBayarFocused = $state(false);

  let menyimpanCek = $state(false);
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
  let menyimpanBayar = $state(false);
  let pendingCekNominal = $state<number | null>(null);

  // Keterangan pelunasan di samping input bayar (permanen tidak hilang setelah 5 detik)
  let pesanPelunasan = $state<{ sales: string; nominal: number; bayar: number; kembali: number } | null>(null);
  let pesanGalat = $state<string | null>(null);
  let timerGalat: any = null;

  // Sorot baris baru (sekali, tidak berdenyut)
  let flashCekId = $state<bigint | null>(null);
  let timerFlash: any = null;

  // Sesi login (SpacetimeAuth / Google)
  let sesi = $state<{ status: 'belum_login' | 'ditolak' | 'kedaluwarsa' | 'oke'; email: string }>({ status: 'belum_login', email: '' });
  // Koneksi gagal dengan token yang masih muda (bukan soal umur token).
  let gagalKoneksi = $state(false);

  // State edit inline (double click)
  let selEdit = $state<{ id: bigint; kolom: 'salesman' | 'nominal' | 'dibayar'; nilai: string } | null>(null);
  let nilaiAwalEdit = $state('');
  let inputEditEl = $state<HTMLInputElement | null>(null);

  // Filter & tab
  let cariTeks = $state('');
  let filterStatus = $state<'semua' | 'belum_input' | 'beda_bayar' | 'kredit' | 'kurang_bayar'>('semua');
  // Galeri bukti gambar: dibuka saat kursor menyentuh baris cek.
  let galeri = $state<{ cek: any; idx: number } | null>(null);
  let sorot = $state<number | null>(null); // thumbnail yang sedang di-hover (pratinjau)
  let besar = $state(false); // gambar besar dibuka DI HALAMAN (bukan window baru)
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

  let tema = $state(bacaTema());
  let menuTema = $state(false);
  const temaAktif = $derived(TEMA.find((t) => t.id === tema) ?? TEMA[0]);

  $effect(() => {
    document.documentElement.dataset.tema = tema;
  });

  function pilihTema(id: string) {
    tema = id;
    try { localStorage.setItem(KUNCI_TEMA, id); } catch {}
    menuTema = false;
    inputCepatEl?.focus();
  }

  // Paksa kembali ke tab Cek bila daftar tanpa cek jadi kosong
  $effect(() => {
    if (tabAktif === 'tanpa_cek' && ringkasan.penjualanTanpaCek.length === 0) tabAktif = 'cek';
  });

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

  // Target cek terbaru yang belum lunas (bukan kredit)
  const targetBayar = $derived.by(() => {
    return daftarCek.find((c) => !c.kredit && Number(c.dibayar) < Number(c.nominal)) || null;
  });

  const sisaTargetBayar = $derived.by(() => {
    if (pendingCekNominal !== null) return pendingCekNominal;
    if (!targetBayar) return 0;
    return Math.max(0, Number(targetBayar.nominal) - Number(targetBayar.dibayar));
  });

  // Sambungkan ke SpacetimeDB
  onMount(() => {
    try {
      const d = JSON.parse(sessionStorage.getItem('cek-draf-input') ?? 'null');
      if (d && typeof d.cepat === 'string') { cepatTeks = d.cepat; bayarTeks = d.bayar ?? ''; }
    } catch {}

    if (sesi.status === 'oke') hubungkanSpacetimeDB();
    inputCepatEl?.focus();
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

    // Galeri: Esc menutup (gambar besar dulu, baru galeri), panah berpindah gambar.
    document.addEventListener('keydown', (e) => {
      if (!galeri) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (besar) tutupBesar();
        else tutupGaleri();
      } else if (e.key === 'ArrowRight') geserGaleri(1);
      else if (e.key === 'ArrowLeft') geserGaleri(-1);
    });

    // Coba kirim isi antrean tiap 15 detik selama tersambung.
    const timerAntrean = setInterval(() => { void kirimAntrean(); }, 15000);
    return () => clearInterval(timerAntrean);
  });

  // --- Sambung ulang otomatis: koneksi pernah putus (jaringan kedip, HP
  // tidur) dan sebelumnya aplikasi tidak pernah mencoba menyambung lagi.
  let timerSambung: any = null;
  let cobaKe = 0;
  let ketikTerakhir = 0;

  function jadwalkanSambungUlang() {
    if (timerSambung) return;
    const jeda = Math.min(30000, 2000 * 2 ** cobaKe++);
    timerSambung = setTimeout(async () => {
      timerSambung = null;
      if (tokenSegeraHabis(5)) await perpanjangToken().catch(() => false);
      hubungkanSpacetimeDB();
    }, jeda);
  }

  function hubungkanSpacetimeDB() {
    statusKoneksi = 'menghubungkan';
    gagalKoneksi = false;
    // Jangan buang waktu menyambung dengan token mati — langsung masuk ulang.
    if (tokenKedaluwarsa()) {
      sesi = { status: 'kedaluwarsa', email: sesi.email };
      masukUlangOtomatis();
      return;
    }
    try {
      const builder = DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(spacetimeToken())
        .onConnect((connection) => {
          conn = connection;
          statusKoneksi = 'terhubung';
          cobaKe = 0;
          gagalKoneksi = false;
          // Ikatan akun: identity tiap klien OIDC BERBEDA walau emailnya sama
          // (sapatycek vs sapaty-pos = dua identity). Tanpa klaim di sini, tabel
          // staff tidak punya baris untuk identity ini, sehingga reducer yang
          // mensyaratkan staff menolak 'kas: cashier only' padahal akunnya admin.
          const em = emailLogin();
          if (em) {
            connection.reducers.klaimAkun({ email: em }).catch((e: unknown) => {
              console.error('klaimAkun gagal:', e);
            });
          }
          pasangSubscription();
          void kirimAntrean();
        })
        .onDisconnect(() => {
          statusKoneksi = 'terputus';
          jadwalkanSambungUlang();
        })
        .onConnectError((_ctx, err) => {
          statusKoneksi = 'terputus';
          gagalKoneksi = true;
          console.error('Koneksi SpacetimeDB error:', err);
          // Token ditolak walau belum terlihat kedaluwarsa → coba perpanjang,
          // kalau tidak bisa baru minta masuk ulang.
          void (async () => {
            if (await perpanjangToken()) jadwalkanSambungUlang();
            else if (bolehCobaLagi(20000)) masukUlangOtomatis();
          })();
        });

      builder.build();
    } catch (e) {
      statusKoneksi = 'terputus';
      console.error(e);
    }
  }

  function pasangSubscription() {
    if (!conn) return;

    conn.db.cek.onInsert(() => refreshData());
    conn.db.cek.onUpdate(() => refreshData());
    conn.db.cek.onDelete(() => refreshData());

    conn.db.penjualan.onInsert(() => refreshData());
    conn.db.penjualan.onUpdate(() => refreshData());

    conn.db.salesman.onInsert(() => refreshData());
    conn.db.salesman.onUpdate(() => refreshData());
    conn.db.salesman.onDelete(() => refreshData());

    conn.db.cekFotoAman.onInsert(() => refreshData());
    conn.db.cekFotoAman.onUpdate(() => refreshData());

    conn.subscriptionBuilder()
      .onApplied(() => {
        refreshData();
      })
      // `cek_foto` dibaca lewat VIEW `cek_foto_aman`, bukan tabelnya. Tabel itu
      // diprivatkan (5 Nov 2026) supaya tidak lagi terbaca siapa pun yang
      // menyambung; view menyaring per pemanggil. Kalau kembali ke tabel privat,
      // SELURUH batch langganan ini gagal, bukan cuma galeri fotonya.
      // `staff` SENGAJA TIDAK DILANGGAN (5 Nov 2026). Isinya email + identitas
      // perangkat, dan tabel itu diprivatkan; viewnya hanya memberi baris
      // PEMANGGIL sendiri. Yang penting: sapatycek memang TIDAK memakai satu pun
      // barisnya (bacaannya mati), sementara satu kueri langganan yang gagal
      // menggagalkan SELURUH batch ini — jadi menahannya bukan pilihan.
      .subscribe([
        'SELECT * FROM cek',
        'SELECT * FROM penjualan',
        'SELECT * FROM salesman',
        'SELECT * FROM cek_foto_aman',
      ]);
  }

  function refreshData() {
    if (!conn?.db) return;
    try {
      daftarCek = Array.from(conn.db.cek.iter())
        .filter((c: any) => c.outlet === OUTLET && c.tanggal === tanggal)
        .sort((a: any, b: any) => Number(b.id - a.id));

      daftarPenjualan = Array.from(conn.db.penjualan.iter())
        .filter((p: any) => p.outlet === OUTLET && p.orderDate === tanggal);

      // Cek dari hari sebelumnya (dibersihkan otomatis oleh job sweep_cek
      // pukul 08:00 WIT; tombol di bawah untuk menjalankannya sendiri).
      jmlCekLama = Array.from(conn.db.cek.iter()).filter((c: any) => c.tanggal && c.tanggal < tanggal).length;
      daftarSalesman = Array.from(conn.db.salesman.iter());
      daftarFoto = Array.from(conn.db.cekFotoAman.iter());
    } catch (e) {
      console.error('Error membaca tabel:', e);
    }
  }

  // =========================================================================
  // LOGIKA INPUT CEK TANPA TOMBOL: Otomatis submit saat format lengkap
  // =========================================================================
  function cekLengkap(teks: string): boolean {
    const bersih = teks.trim().toLowerCase().replace(/[^0-9a-z]/g, '');
    return /^\d+[a-z]\d$/.test(bersih);
  }

  // Draf input disimpan sementara: saat sesi habis, halaman dimuat ulang dan
  // angka yang sedang diketik operator tidak boleh hilang.
  const KUNCI_DRAF = 'cek-draf-input';
  function simpanDraf() {
    try { sessionStorage.setItem(KUNCI_DRAF, JSON.stringify({ cepat: cepatTeks, bayar: bayarTeks })); } catch {}
  }

  function onInputCepat() {
    ketikTerakhir = Date.now();
    simpanDraf();
    const teks = cepatTeks.trim();
    // Transaksi baru dimulai → keterangan pelunasan sebelumnya disembunyikan.
    if (teks && pesanPelunasan) pesanPelunasan = null;
    if (cekLengkap(teks)) {
      kirimCepat();
    }
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
    const digit = (cepatTeks.match(/^(\d+)/) ?? [])[1] ?? '';
    cepatTeks = digit ? digit + kode + '1' : kode;
    ketikTerakhir = Date.now();
    simpanDraf();
    inputCepatEl?.focus();
  }

  async function kirimCepat() {
    const teks = cepatTeks.trim().toLowerCase();
    if (!teks || menyimpanCek) return;

    // Parser sintaks (bukan pratinjau): kode salesman tak dikenal tetap dicatat,
    // yang penting input operator tidak pernah hilang.
    const tafsir = parseCek(teks);
    if (!tafsir) return;

    const nominal = BigInt(tafsir.nominal);
    const kode = tafsir.kode;
    const tipe = tafsir.tipeDigit === '2' ? 'Obral' : tafsir.tipeDigit === '3' ? 'Grosir' : 'Ecer';

    pendingCekNominal = tafsir.nominal;

    // Pindahkan kursor SEKETIKA (0ms) ke kotak Bayar
    cepatTeks = '';
    inputBayarEl?.focus();

    const salesmanNama = cariSalesmanAktif(kode) || kode.toUpperCase();
    const salesman = salesmanNama;

    const jam = new Date().toTimeString().slice(0, 8);

    // Internet putus: cek tetap dicatat, disimpan di HP dan dikirim ulang
    // otomatis saat tersambung (server idempoten, jadi tidak dobel).
    if (statusKoneksi !== 'terhubung' || !conn?.reducers?.tambahDeklarasiCek) {
      antreTambah({
        ref: (crypto.randomUUID?.() ?? String(Date.now() + Math.random())),
        outlet: OUTLET,
        tanggal,
        jam,
        salesman,
        salesmanNama,
        nominal: String(nominal),
        tipe,
        at: Date.now(),
      });
      setPesanGalat(`Tersimpan di HP (${antrean.daftar.length} belum terkirim) — dikirim otomatis begitu tersambung.`);
      pendingCekNominal = null;
      return;
    }

    menyimpanCek = true;

    try {
      await conn.reducers.tambahDeklarasiCek({
        outlet: OUTLET,
        tanggal,
        jam,
        salesman,
        salesmanNama,
        nominal,
        tipe,
        kredit: false,
        dibayar: 0n,
      });

      await tick();
      if (daftarCek.length > 0) triggerFlash(daftarCek[0].id);

      if (bayarTeks.trim()) {
        onInputBayar();
      }
    } catch (e: any) {
      setPesanGalat(`Gagal simpan cek: ${e.message || e}`);
      cepatTeks = teks;
      inputCepatEl?.focus();
    } finally {
      pendingCekNominal = null;
      menyimpanCek = false;
    }
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
    if (butuhKoneksi("menghitung pembayaran")) return;
    const teks = bayarTeks.trim();
    if (!teks || menyimpanBayar) return;

    if (menyimpanCek) {
      setTimeout(kirimBayar, 50);
      return;
    }

    const nominalAngka = Number(teks.replace(/[^0-9]/g, ''));
    if (!nominalAngka) return;

    // Input bayar selalu dalam ribuan: 50 -> 50.000, 1.100 -> 1.100.000
    const bayarPenuh = BigInt(nominalAngka * 1000);
    const target = targetBayar;
    if (!target) {
      setPesanGalat('Tidak ada cek yang menunggu pembayaran.');
      return;
    }

    const cekId = target.id;
    const salesNama = target.salesmanNama || 'Sales';
    const tagihan = Number(target.nominal) - Number(target.dibayar);
    const bayarRp = Number(bayarPenuh);
    const kembali = bayarRp - tagihan;

    // Kosongkan kotak bayar & kembalikan fokus ke kotak Cek seketika
    bayarTeks = '';
    inputCepatEl?.focus();
    menyimpanBayar = true;

    try {
      await conn?.reducers.catatBayarCek({
        cekId,
        outlet: OUTLET,
        tanggal,
        nominalBayar: bayarPenuh,
      });

      // Keterangan pelunasan permanen di samping input bayar
      setPesanPelunasan(salesNama, Number(target.nominal), bayarRp, Math.max(0, kembali));
    } catch (e: any) {
      setPesanGalat(`Gagal bayar: ${e.message || e}`);
      bayarTeks = teks;
      inputBayarEl?.focus();
    } finally {
      menyimpanBayar = false;
    }
  }

  // =========================================================================
  // LOGIKA DOUBLE CLICK EDIT INLINE & CHECKBOX KREDIT
  // =========================================================================
  async function mulaiEdit(c: any, kolom: 'salesman' | 'nominal' | 'dibayar') {
    let nilai = '';
    if (kolom === 'salesman') {
      nilai = c.salesmanNama || c.salesman;
    } else if (kolom === 'nominal' || kolom === 'dibayar') {
      nilai = String(Number(c[kolom]) / 1000);
    }
    selEdit = { id: c.id, kolom, nilai };
    nilaiAwalEdit = nilai;
    await tick();
    inputEditEl?.focus();
    if (inputEditEl && inputEditEl instanceof HTMLInputElement) inputEditEl.select();
  }

  function batalEdit() {
    selEdit = null;
  }

  async function simpanEdit(c: any) {
    if (butuhKoneksi("mengubah cek")) return;
    if (!selEdit || selEdit.id !== c.id) return;
    const s = selEdit;
    selEdit = null;

    let nominal = c.nominal;
    let dibayar = c.dibayar;
    let salesman = c.salesman;
    let salesmanNama = c.salesmanNama;

    if (s.kolom === 'nominal') {
      const ribuan = Number(String(s.nilai ?? '').replace(/[^0-9]/g, ''));   // tahan angka maupun teks
      nominal = BigInt(ribuan * 1000);
    } else if (s.kolom === 'dibayar') {
      const ribuan = Number(String(s.nilai ?? '').replace(/[^0-9]/g, ''));   // tahan angka maupun teks
      dibayar = BigInt(ribuan * 1000);
    } else if (s.kolom === 'salesman') {
      const hasil = cariSalesmanAktif(s.nilai);
      salesmanNama = hasil || s.nilai.trim();
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

  // Ringkasan Rekonsiliasi
  const ringkasan = $derived(hitungRingkasan(daftarCek, daftarPenjualan));

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

  // Akordion: klik tombol foto → baris itu membuka galeri di bawahnya.
  // Galeri layar penuh: klik tombol foto -> panel menutupi layar.
  function bukaGaleri(c: any, idx = 0) {
    if (fotoCek(c).length === 0) return;
    galeri = { cek: c, idx };
    sorot = null;
    besar = false;
    document.body.style.overflow = 'hidden'; // kunci gulir layar belakang
  }

  // Tutup galeri + kembalikan fokus ke input cek supaya kasir bisa langsung
  // mengetik lagi. Urutan penting: pindahkan fokus SEBELUM panel dibuang dari
  // DOM — kalau node yang sedang difokus dihapus, browser memindahkannya ke <body>.
  function tutupGaleri() {
    galeri = null;
    sorot = null;
    besar = false;
    document.body.style.overflow = '';
    inputCepatEl?.focus();
    setTimeout(() => inputCepatEl?.focus(), 30);
  }

  function bukaBesar(i: number) {
    if (!galeri) return;
    galeri = { ...galeri, idx: i };
    besar = true;
  }

  function tutupBesar() {
    besar = false;
  }

  function geserGaleri(arah: number) {
    if (!galeri) return;
    const jumlah = fotoCek(galeri.cek).length;
    if (!jumlah) return;
    const baru = (galeri.idx + arah + jumlah) % jumlah;
    galeri = { ...galeri, idx: baru };
    sorot = baru;
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
    return daftarCek.filter((c) => {
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
  if (!handleOidcCallback()) {
    // bukan callback: cek sesi login
    const tok = spacetimeToken();
    let email = '';
    try {
      email = emailLogin();
    } catch {}
    if (!tok || !email) sesi = { status: 'belum_login', email: '' };
    else if (email !== EMAIL_DIIZINKAN) sesi = { status: 'ditolak', email };
    // Token kedaluwarsa = sama seperti belum login. Ini akar 'indikator kuning
    // dan input mati' yang dialami operator tiap token berumur ~1 jam.
    else if (tokenKedaluwarsa()) {
      // Perpanjang DIAM-DIAM dulu (tanpa pindah halaman). Hanya kalau gagal
      // operator diarahkan masuk ulang.
      sesi = { status: 'kedaluwarsa', email };
      void (async () => {
        if (await perpanjangToken()) {
          sesi = { status: 'oke', email };
          hubungkanSpacetimeDB();
        } else {
          masukUlangOtomatis();
        }
      })();
    }
    else sesi = { status: 'oke', email };
  }

  // Operasi yang mengubah/menghapus/membayar cek yang SUDAH ada di server
  // butuh koneksi — tidak diantrekan supaya uang tidak terhitung dua kali.
  function butuhKoneksi(aksi: string): boolean {
    if (statusKoneksi === 'terhubung' && conn?.reducers) return false;
    setPesanGalat(`Butuh koneksi untuk ${aksi}. Cek baru tetap bisa diinput (disimpan di HP).`);
    return true;
  }

  // Kirim isi antrean HP ke server (berurutan, berhenti saat gagal).
  let sedangKirimAntrean = false;
  async function kirimAntrean() {
    if (sedangKirimAntrean) return;
    if (statusKoneksi !== 'terhubung' || !conn?.reducers?.tambahDeklarasiCek) return;
    if (antrean.daftar.length === 0) return;
    sedangKirimAntrean = true;
    let terkirim = 0;
    try {
      for (const e of [...antrean.daftar]) {
        try {
          await conn.reducers.tambahDeklarasiCek({
            outlet: e.outlet,
            tanggal: e.tanggal,
            jam: e.jam,
            salesman: e.salesman,
            salesmanNama: e.salesmanNama,
            nominal: BigInt(e.nominal),
            tipe: e.tipe,
            kredit: false,
            dibayar: 0n,
          });
          antreBuang(e.ref);
          terkirim++;
        } catch {
          break; // sisanya dicoba lagi pada putaran berikutnya
        }
      }
    } finally {
      sedangKirimAntrean = false;
    }
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

  function masukGoogle() {
    tandaiCobaLagi();
    loginGoogle();
  }

  // Masuk ulang otomatis sekali (sesi Google biasanya masih hidup, jadi
  // operator tidak perlu mengetik apa pun). Kalau gagal, tombol tetap ada.
  function masukUlangOtomatis() {
    if (!bolehCobaLagi()) return;
    masukGoogle();
  }
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
        onclick={masukGoogle}
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
        onclick={masukGoogle}
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
      <!-- Ganti tema: menempelkan data-tema ke <html>, pilihan disimpan di perangkat -->
      <div class="relative">
        <button
          type="button"
          data-ui="gantiTema"
          onclick={() => (menuTema = !menuTema)}
          aria-haspopup="menu"
          aria-expanded={menuTema}
          title="Ganti tema"
          class="inline-flex items-center gap-1.5 rounded-lg border border-line2 bg-card px-2.5 py-1.5 text-[12px] font-medium text-ink2 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Palette size={14} strokeWidth={1.5} class="text-muted" />
          {temaAktif.nama}
        </button>
        {#if menuTema}
          <div class="fixed inset-0 z-30" onclick={() => (menuTema = false)} role="presentation"></div>
          <div class="absolute top-full right-0 z-40 mt-1 w-44 rounded-lg border border-line bg-card p-1 shadow-xl" role="menu">
            {#each TEMA as t (t.id)}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={tema === t.id}
                onclick={() => pilihTema(t.id)}
                class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {tema === t.id ? 'bg-raised text-ink' : 'text-ink2 hover:bg-raised/60'}"
              >
                <span>{t.nama}</span>
                {#if tema === t.id}<Check size={13} strokeWidth={2} class="text-accent" />{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

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
            if (e.key === 'Enter') kirimBayar();
            else if (e.key === 'ArrowLeft') onKeyLeftBayar(e);
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
          class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {cariSalesmanAktif(cepatTeks.replace(/^\d+/, '').replace(/\d$/, '')) === s.nama
            ? 'border-accent bg-accent text-onaccent'
            : 'border-line2 bg-card text-ink2 hover:bg-raised'}"
          title="Isi kolom Cek dengan kode {s.kode.toUpperCase()} untuk {s.nama}"
        >
          <span class="font-mono text-[11px] {cariSalesmanAktif(cepatTeks.replace(/^\d+/, '').replace(/\d$/, '')) === s.nama ? 'text-onaccent/70' : 'text-muted'}">{s.kode.toUpperCase()}</span>
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
        <span class="font-mono text-[12px] text-muted">{daftarCek.length}</span>
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
                  <td class="px-3 py-2.5 font-mono text-[12px] text-muted">{c.jam.slice(0, 5)}</td>

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
                              onclick={() => { if (selEdit) selEdit.nilai = s.nama; simpanEdit(c); }}
                              class="w-full rounded-lg px-3 py-3 text-left text-[14px] font-medium transition-colors {selEdit?.nilai === s.nama ? 'bg-accent text-onaccent' : 'text-ink hover:bg-raised'}"
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
                      <input
                        bind:this={inputEditEl}
                        bind:value={selEdit.nilai}
                        type="text"
                        inputmode="numeric"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') simpanEdit(c);
                          else if (e.key === 'Escape') batalEdit();
                        }}
                        onblur={() => { if (selEdit && selEdit.nilai !== nilaiAwalEdit) simpanEdit(c); }}
                        class="h-6 w-20 rounded border border-accent bg-card px-1 text-right font-mono text-[12px] text-ink outline-none"
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
                      <input
                        bind:this={inputEditEl}
                        bind:value={selEdit.nilai}
                        type="text"
                        inputmode="numeric"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') simpanEdit(c);
                          else if (e.key === 'Escape') batalEdit();
                        }}
                        onblur={() => { if (selEdit && selEdit.nilai !== nilaiAwalEdit) simpanEdit(c); }}
                        class="h-6 w-20 rounded border border-accent bg-card px-1 text-right font-mono text-[12px] text-ink outline-none"
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
                      onchange={(e) => toggleKredit(c, (e.target as HTMLInputElement).checked)}
                      class="h-4 w-4 cursor-pointer rounded border-line2 align-middle accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      title="Tandai kredit (tidak ikut ditunggu di kotak bayar)"
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
                        class="inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 {galeri?.cek?.id === c.id ? 'border-accent bg-accent text-onaccent' : 'border-line2 bg-card text-ink2 hover:bg-raised'}"
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
                    <button
                      onclick={() => hapusCek(c.id)}
                      class="rounded-md p-1 text-ink2 transition-colors hover:bg-bad/8 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      title="Hapus baris cek"
                      aria-label="Hapus baris cek"
                    >
                      <Trash size={15} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>

              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- GALERI LAYAR PENUH (klik tombol foto pada baris cek) -->
  {#if galeri}
    {@const gambar = fotoCek(galeri.cek)}
    <div
      class="fixed inset-0 z-[80] flex flex-col bg-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Galeri bukti cek"
    >
      <!-- KEPALA -->
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-kertas">
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-[14px] font-medium">
            <Camera size={15} strokeWidth={1.5} class="shrink-0 text-white/60" />
            <span class="truncate">Bukti cek · {galeri.cek.salesmanNama}</span>
          </div>
          <div class="mt-0.5 font-mono text-[12px] text-white/60">
            {rupiah(Number(galeri.cek.nominal))} · {galeri.cek.jam.slice(0, 5)} · {gambar.length} gambar
          </div>
        </div>
        <button
          type="button"
          data-ui="tutupGaleri"
          onclick={tutupGaleri}
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-medium text-kertas transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          title="Tutup galeri (Esc)"
        >
          <X size={14} strokeWidth={1.5} />
          Tutup
          <span class="font-mono text-white/50">Esc</span>
        </button>
      </div>

      <!-- PRATINJAU: gambar yang sedang disorot kursor -->
      {#if sorot !== null && gambar[sorot]}
        <div class="flex min-h-0 flex-1 items-center justify-center p-3">
          <img
            src={gambar[sorot].url}
            alt={gambar[sorot].filename ?? 'bukti cek'}
            class="max-h-full max-w-full rounded-lg object-contain"
            loading="lazy"
          />
        </div>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-[13px] text-white/60">
          <Image size={22} strokeWidth={1.5} />
          <span>Klik gambar kecil untuk melihat ukuran besar</span>
          <span class="text-white/40">arahkan kursor ke gambar kecil untuk pratinjau</span>
        </div>
      {/if}

      <!-- SEMUA GAMBAR KECIL -->
      <div class="max-h-[40vh] shrink-0 overflow-y-auto border-t border-white/10 px-3 py-3">
        <div class="flex flex-wrap justify-center gap-2">
          {#each gambar as g, i (g.url)}
            <button
              type="button"
              data-ui="thumbBukti"
              onclick={() => bukaBesar(i)}
              onmouseenter={() => (sorot = i)}
              onmouseleave={() => (sorot = null)}
              onfocus={() => (sorot = i)}
              onblur={() => (sorot = null)}
              class="rounded-lg border-2 p-0.5 transition-colors {sorot === i || galeri.idx === i ? 'border-accent' : 'border-white/10'}"
              title="Gambar {i + 1} dari {gambar.length} — klik untuk melihat besar"
            >
              <img src={g.url} alt={g.filename ?? 'bukti'} class="h-20 w-20 rounded object-cover" loading="lazy" />
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- GAMBAR BESAR: dibuka DI HALAMAN INI (bukan window/tab baru) -->
    {#if besar && gambar[galeri.idx]}
      <div class="fixed inset-0 z-[90] flex flex-col bg-black" onclick={tutupBesar} role="presentation">
        <div class="flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-kertas" onclick={(e) => e.stopPropagation()}>
          <span class="font-mono text-[12px] text-white/60">{galeri.idx + 1} / {gambar.length}</span>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick={() => geserGaleri(-1)} class="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-medium transition-colors hover:bg-white/10">
              <ChevronLeft size={14} strokeWidth={1.5} />
              Sebelumnya
            </button>
            <button type="button" onclick={() => geserGaleri(1)} class="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-medium transition-colors hover:bg-white/10">
              Berikutnya
              <ChevronRight size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              data-ui="tutupBesar"
              onclick={tutupBesar}
              class="rounded-lg border border-white/15 p-2 transition-colors hover:bg-white/10"
              title="Kembali ke daftar gambar (Esc)"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div class="flex min-h-0 flex-1 items-center justify-center p-2" onclick={(e) => e.stopPropagation()}>
          <img
            src={gambar[galeri.idx].url}
            alt={gambar[galeri.idx].filename ?? 'bukti cek'}
            class="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    {/if}
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
