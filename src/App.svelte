<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { DbConnection } from './module_bindings';
  import { antrean, antreTambah, antreBuang } from './lib/antrean.svelte';
  import { rupiah, formatRibuan, uraiCek, parseCek, hitungRingkasan } from './lib/cek';
  import AntreanCek from './lib/komponen/AntreanCek.svelte';
  import { loginGoogle, handleOidcCallback, spacetimeToken, emailLogin, logout, tokenKedaluwarsa, bolehCobaLagi, tandaiCobaLagi, perpanjangToken, tokenSegeraHabis } from './lib/login';

  // Config SpacetimeDB
  const HOST = 'https://maincloud.spacetimedb.com';
  const DB_NAME = 'sapaty-pos';
  const OUTLET = 'Braka'; // Cek kasir HANYA untuk outlet Braka (Audy tidak ada cek)

  // Tanggal otomatis hari ini Asia/Jayapura (WIT, UTC+9)
  const tanggal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jayapura' }).format(new Date());

  let conn = $state<any>(null);
  let statusKoneksi = $state<'menghubungkan' | 'terhubung' | 'terputus'>('menghubungkan');

  // Data reactive dari SpacetimeDB
  let daftarCek = $state<any[]>([]);
  let daftarPenjualan = $state<any[]>([]);
  let daftarStaff = $state<any[]>([]);
  let daftarFoto = $state<any[]>([]); // cek_foto: bukti gambar per cek (galeri)
  let daftarSalesman = $state<any[]>([]);

  // Input Cek & Bayar (lebar +20%: w-36 & w-32)
  let cepatTeks = $state('');
  let bayarTeks = $state('');
  let inputCepatEl = $state<HTMLInputElement | null>(null);
  let inputBayarEl = $state<HTMLInputElement | null>(null);

  // Status fokus kursor di bayar untuk efek flashing
  let isBayarFocused = $state(false);

  let menyimpanCek = $state(false);
  let jmlCekLama = $state(0);
  let menyimpanBayar = $state(false);
  let pendingCekNominal = $state<number | null>(null);

  // Keterangan pelunasan di samping input bayar (permanen tidak hilang setelah 5 detik)
  let pesanPelunasan = $state<{ sales: string; nominal: number; bayar: number; kembali: number } | null>(null);
  let pesanGalat = $state<string | null>(null);
  let timerGalat: any = null;

  // Flash highlight visual saat row baru ditambah
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
  // baru), atau saat tombol ✕ ditekan.
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
    }, 2500);
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

    conn.db.staff.onInsert(() => refreshData());
    conn.db.staff.onUpdate(() => refreshData());

    conn.db.salesman.onInsert(() => refreshData());
    conn.db.salesman.onUpdate(() => refreshData());
    conn.db.salesman.onDelete(() => refreshData());

    conn.db.cekFoto.onInsert(() => refreshData());
    conn.db.cekFoto.onUpdate(() => refreshData());

    conn.subscriptionBuilder()
      .onApplied(() => {
        refreshData();
      })
      .subscribe([
        'SELECT * FROM cek',
        'SELECT * FROM penjualan',
        'SELECT * FROM staff',
        'SELECT * FROM salesman',
        'SELECT * FROM cek_foto',
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
      daftarStaff = Array.from(conn.db.staff.iter());
      daftarSalesman = Array.from(conn.db.salesman.iter());
      daftarFoto = Array.from(conn.db.cekFoto.iter());
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
      setPesanGalat(`⏳ Tersimpan di HP (${antrean.daftar.length} belum terkirim) — dikirim otomatis begitu tersambung.`);
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
      const ribuan = Number(s.nilai.replace(/[^0-9]/g, ''));
      nominal = BigInt(ribuan * 1000);
    } else if (s.kolom === 'dibayar') {
      const ribuan = Number(s.nilai.replace(/[^0-9]/g, ''));
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
    if (!confirm('Hapus baris cek ini?')) return;
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

  function regKredit(p: any): boolean {
    return String(p?.paymentMode ?? '').toLowerCase().startsWith('kredit');
  }

  function bedaBayar(c: any): { cekKredit: boolean; regKredit: boolean } | null {
    if (!c.orderNo) return null;
    const p = penjualanPerOrder.get(c.orderNo);
    if (!p) return null;
    const reg = regKredit(p);
    if (Boolean(c.kredit) === reg) return null;
    return { cekKredit: Boolean(c.kredit), regKredit: reg };
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
      setPesanGalat(`✓ ${terkirim} cek dari HP terkirim.${antrean.daftar.length ? ` Sisa ${antrean.daftar.length} menunggu.` : ''}`);
    }
  }

  // Cek hanya bermakna hari itu; baris hari lama dibuang. Dua langkah:
  // uji (tidak menghapus) dulu, baru jalankan.
  async function bersihkanCekLama() {
    if (!conn?.reducers?.bersihkanCekLama) {
      alert('Reducer belum tersedia — muat ulang halaman.');
      return;
    }
    if (jmlCekLama === 0) {
      alert('Tidak ada cek dari hari lama.');
      return;
    }
    if (!confirm(`Ada ${jmlCekLama} baris cek dari hari sebelumnya.\n\nJalankan UJI dulu (tidak menghapus apa pun)?`)) return;
    try {
      await conn.reducers.bersihkanCekLama({ dryRun: true });
      await new Promise((r) => setTimeout(r, 900));
      const log = Array.from((conn.db.syncLog?.iter?.() ?? []) as Iterable<any>)
        .filter((l: any) => String(l.jenis ?? '').startsWith('purge-cek'))
        .sort((a: any, b: any) => Number(a.lastSyncedAt?.microsSinceUnixEpoch ?? 0) - Number(b.lastSyncedAt?.microsSinceUnixEpoch ?? 0))
        .pop();
      const siap = Number(log?.totalRows ?? 0);
      if (!confirm(`Uji: ${siap} baris siap dibuang (jejak 'Belum Cocok' ditahan 7 hari).\n\nHapus sekarang?`)) return;
      await conn.reducers.bersihkanCekLama({ dryRun: false });
      alert(`Selesai: ${siap} baris cek hari lama dibuang.`);
    } catch (e) {
      alert('Gagal: ' + String((e as Error)?.message ?? e));
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

{#if sesi.status === 'belum_login'}
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 max-w-sm w-full text-center space-y-3">
      <div class="text-4xl">🔒</div>
      <div class="text-lg font-bold text-slate-900">Sapaty Cek</div>
      <div class="text-xs text-slate-500">Halaman ini hanya untuk akun terdaftar.<br />Masuk dengan Google via SpacetimeDB.</div>
      <button
        type="button"
        onclick={masukGoogle}
        class="w-full h-10 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors"
      >
        Masuk dengan Google
      </button>
    </div>
  </div>
{:else if sesi.status === 'kedaluwarsa'}
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl border border-amber-300 shadow-xs p-6 max-w-sm w-full text-center space-y-3">
      <div class="text-4xl">⏳</div>
      <div class="text-lg font-bold text-amber-700">Sesi login habis</div>
      <div class="text-xs text-slate-500">
        Masa berlaku login SpacetimeAuth sekitar 1 jam — itulah sebabnya indikator jadi kuning dan input cek
        tidak bisa dipakai. Masuk lagi untuk melanjutkan (tidak ada input yang hilang).
      </div>
      <button
        type="button"
        data-ui="masukUlang"
        onclick={masukGoogle}
        class="w-full h-10 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors"
      >
        Masuk lagi dengan Google
      </button>
    </div>
  </div>
{:else if sesi.status === 'ditolak'}
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl border border-rose-200 shadow-xs p-6 max-w-sm w-full text-center space-y-3">
      <div class="text-4xl">⛔</div>
      <div class="text-lg font-bold text-rose-700">Akses ditolak</div>
      <div class="text-xs text-slate-500">Akun <b>{sesi.email}</b> tidak diizinkan membuka halaman ini.</div>
      <button
        type="button"
        onclick={() => logout()}
        class="w-full h-10 rounded-lg bg-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-300 transition-colors"
      >
        Ganti akun
      </button>
    </div>
  </div>
{:else}
<div class="max-w-6xl mx-auto p-3 sm:p-4 space-y-3">
  <!-- STICKY WRAPPER: card info + input kasir + tabs tetap di atas saat scroll -->
  <div class="sticky top-0 z-20 space-y-2 bg-slate-50 -mt-3 pt-3 pb-2 -mx-3 px-3 sm:-mt-4 sm:pt-4 sm:-mx-4 sm:px-4">
  <!-- 1. KARTU INFORMASI: sudah diinput vs belum diinput vs beda tafsir -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cek diinput</div>
      <div class="text-sm font-bold text-slate-900">{ringkasan.jmlCek} cek · {rupiah(ringkasan.totalCek)}</div>
      <div class="text-[11px] font-mono {ringkasan.jmlBelumCocok > 0 ? 'text-rose-600 font-bold' : 'text-emerald-600'}">
        {ringkasan.jmlCocok} sudah input · {ringkasan.jmlBelumCocok} belum input
      </div>
    </div>

    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Belum diinput (POS)</div>
      <div class="text-sm font-bold {ringkasan.penjualanTanpaCek.length > 0 ? 'text-amber-600' : 'text-slate-700'}">
        {ringkasan.penjualanTanpaCek.length} order · {rupiah(nilaiTanpaCek)}
      </div>
      <div class="text-[11px] text-slate-400">pesanan tanpa cek</div>
    </div>

    <div class="bg-white px-3 py-2 rounded-lg border {jmlBedaBayar > 0 ? 'border-rose-300' : 'border-slate-200'} shadow-xs">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Beda cara bayar</div>
      <div class="text-sm font-bold {jmlBedaBayar > 0 ? 'text-rose-600' : 'text-slate-700'}">
        {jmlBedaBayar} cek
      </div>
      <div class="text-[11px] text-slate-400">cek kasir ≠ input Ollsera</div>
    </div>

    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs">
      <div class="flex items-start justify-between">
        <div>
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Selisih</div>
          <div class="text-sm font-bold {ringkasan.selisih === 0 ? 'text-emerald-600' : 'text-rose-600'}">
            {rupiah(ringkasan.selisih)}
          </div>
        </div>
        <span class="text-[9px] px-1.5 py-0.5 rounded font-bold {statusKoneksi === 'terhubung' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
          {statusKoneksi === 'terhubung' ? '● LIVE' : statusKoneksi === 'menghubungkan' ? '○ menyambung' : gagalKoneksi ? '○ login ulang?' : '○ terputus'}
        </span>
      </div>
      <div class="text-[11px] text-slate-400">POS {rupiah(ringkasan.totalPenjualan)} − cek {rupiah(ringkasan.totalCek)}</div>
    </div>
  </div>

  <!-- 2. BARIS INPUT KASIR (LEBAR INPUT +20%, KETERANGAN PELUNASAN PERMANEN SEJAJAR) -->
  <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs">
    <div class="flex flex-wrap items-center gap-3">
      <!-- INPUT CEK (Lebar +20%: w-36) -->
      <div class="flex items-center gap-1.5">
        <label for="input-cepat" class="text-xs font-bold uppercase text-slate-500">Cek:</label>
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
          class="h-8 w-36 rounded-md border border-slate-300 bg-slate-50 px-2.5 text-base font-mono font-bold tracking-wide focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
        />
      </div>

      <!-- INPUT BAYAR (Lebar +20%: w-32, onfocus memicu flashing target cek) -->
      <div class="flex items-center gap-1.5">
        <label for="input-bayar" class="text-xs font-bold uppercase text-slate-500">Bayar:</label>
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
          class="h-8 w-32 rounded-md border border-slate-300 bg-slate-50 px-2.5 text-base font-mono font-bold tracking-wide focus:border-emerald-600 focus:bg-white focus:ring-1 focus:ring-emerald-600 outline-none transition-colors"
        />
      </div>

      <!-- KETERANGAN: tiga info TERPISAH supaya tidak saling menghilangkan.
           Pelunasan tetap tampil walau kasir sudah mulai mengetik cek berikutnya. -->
      <div class="flex-1 flex flex-col items-start gap-1 min-w-0">
        {#if pesanPelunasan}
          <div class="flex items-center gap-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
            <span class="font-bold">✓ LUNAS:</span>
            <span>{pesanPelunasan.sales} {rupiah(pesanPelunasan.nominal)}</span>
            <span class="text-slate-300">|</span>
            <span>Bayar {rupiah(pesanPelunasan.bayar)}</span>
            <span class="text-slate-300">|</span>
            <span class="font-bold text-emerald-700">Kembali {rupiah(pesanPelunasan.kembali)}</span>
            <button
              type="button"
              data-ui="tutupPelunasan"
              onclick={tutupPelunasan}
              title="Tutup keterangan pelunasan"
              class="ml-1 px-1.5 rounded border border-emerald-300 bg-white text-emerald-700 font-bold"
            >
              ✕
            </button>
          </div>
        {/if}

        {#if pesanGalat}
          <div class="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-md">
            {pesanGalat}
          </div>
        {/if}

        {#if targetBayar}
          <div class="text-xs text-slate-600 font-medium">
            Target: <b class="text-slate-800">{targetBayar.salesmanNama}</b>
            (Sisa: <b class="text-emerald-700">{rupiah(sisaTargetBayar)}</b>)
          </div>
        {:else if !pesanPelunasan}
          <div class="text-xs text-slate-400">Semua cek lunas</div>
        {/if}
      </div>
    </div>

    <!-- PRATINJAU TAFSIR INPUT (pencegahan salah tafsir sebelum Enter) -->
    {#if pratinjauCek.jenis !== 'kosong'}
      <div
        class="mt-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border {pratinjauCek.jenis === 'siap'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
          : pratinjauCek.jenis === 'sebagian'
            ? 'bg-slate-50 border-slate-200 text-slate-600'
            : 'bg-rose-50 border-rose-200 text-rose-700'}"
      >
        {#if pratinjauCek.jenis === 'siap'}✓ {/if}{pratinjauCek.teks}
      </div>
    {/if}

    <!-- PAPAN KETUK SALESMAN: kode ↔ nama (hafalan B/C/V sering keliru) -->
    <div class="mt-1.5 flex items-center gap-1.5 flex-wrap">
      <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Salesman</span>
      {#each daftarSalesmanAktif as s (s.kode + s.nama)}
        <button
          type="button"
          data-ui="pilihSalesman"
          onclick={() => pilihSalesman(s.kode)}
          class="px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors {cariSalesmanAktif(cepatTeks.replace(/^\d+/, '').replace(/\d$/, '')) === s.nama
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}"
          title="Isi kolom Cek dengan kode {s.kode.toUpperCase()} untuk {s.nama}"
        >
          {s.kode.toUpperCase()} · {s.nama}
        </button>
      {/each}
    </div>
  </div>

  <!-- 2b. ANTREAN HP: cek yang belum terkirim (internet putus) -->
  <AntreanCek daftar={antrean.daftar} kirim={() => kirimAntrean()} buang={(ref) => antreBuang(ref)} />

  <!-- 3. NAVIGATION TABS & FILTER -->
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-200 pb-2">
    <div class="flex gap-2">
      <button
        onclick={() => { tabAktif = 'cek'; }}
        class="px-3 py-1.5 text-xs font-bold rounded-md transition-colors {tabAktif === 'cek' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}"
      >
        📋 Daftar Cek ({daftarCek.length})
      </button>
      {#if jmlCekLama > 0}
        <button
          type="button"
          data-ui="bersihkanCekLama"
          onclick={bersihkanCekLama}
          title="Cek hanya dipakai pada hari itu — baris hari lama dibersihkan otomatis pukul 08:00 WIT"
          class="px-3 py-1.5 text-xs font-bold rounded-md transition-colors bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100"
        >
          🧹 Cek lama ({jmlCekLama})
        </button>
      {/if}
      {#if ringkasan.penjualanTanpaCek.length > 0}
        <button
          onclick={() => { tabAktif = 'tanpa_cek'; }}
          class="px-3 py-1.5 text-xs font-bold rounded-md transition-colors {tabAktif === 'tanpa_cek' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}"
        >
          ⚠️ Penjualan Tanpa Cek ({ringkasan.penjualanTanpaCek.length})
        </button>
      {/if}
    </div>

    {#if tabAktif === 'cek'}
      <div class="flex gap-1.5 w-full sm:w-auto overflow-x-auto">
        {#each ([['semua', 'Semua'], ['belum_input', 'Belum Input'], ['beda_bayar', `Beda Bayar${jmlBedaBayar ? ' (' + jmlBedaBayar + ')' : ''}`], ['kurang_bayar', 'Kurang Bayar'], ['kredit', 'Kredit']] as const) as [v, label] (v)}
          <button
            type="button"
            onclick={() => { filterStatus = v; }}
            class="px-2.5 py-1.5 text-xs font-bold rounded-md whitespace-nowrap transition-colors {filterStatus === v ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600'}"
          >
            {label}
          </button>
        {/each}
        <input
          bind:value={cariTeks}
          placeholder="Cari salesman / order..."
          class="text-xs bg-white border border-slate-200 rounded-md px-2.5 py-1 outline-none flex-1 sm:w-44"
        />
      </div>
    {/if}
  </div>
  </div><!-- /sticky wrapper -->

  <!-- CONTENT TAB 1: DAFTAR CEK (KOLOM STATUS DIHAPUS, ADA KREDIT?, KLIK 2x EDIT, FLASH SAAT BAYAR FOKUS) -->
  {#if tabAktif === 'cek'}
    <div class="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      {#if cekTersaring.length === 0}
        <div class="p-8 text-center text-slate-400 text-xs">
          Belum ada deklarasi cek kasir untuk hari ini.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th class="p-2.5">Jam</th>
                <th class="p-2.5">Salesman</th>
                <th class="p-2.5 text-right">Nominal</th>
                <th class="p-2.5 text-right">Dibayar</th>
                <th class="p-2.5 text-right">Kembalian</th>
                <th class="p-2.5">Tipe</th>
                <th class="p-2.5 text-center">Kredit?</th>
                <th class="p-2.5">Pasangan POS</th>
                <th class="p-2.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              {#each cekTersaring as c (c.id)}
                {@const isTarget = isBayarFocused && targetBayar?.id === c.id}
                <tr
                  class="transition-colors {isTarget ? 'animate-flash-target font-semibold' : flashCekId === c.id ? 'bg-emerald-100' : c.kredit ? 'bg-amber-50' : Number(c.dibayar) < Number(c.nominal) ? 'bg-purple-50' : 'hover:bg-slate-50'}"
                >
                  <td class="p-2.5 font-mono text-slate-600">{c.jam.slice(0, 5)}</td>

                  <!-- 1. SALESMAN (Klik 2x edit -> pilih dari dropdown) -->
                  <td
                    class="p-2.5 cursor-pointer"
                    ondblclick={() => mulaiEdit(c, 'salesman')}
                    title="Klik 2x untuk ubah salesman"
                  >
                    {#if selEdit && selEdit.id === c.id && selEdit.kolom === 'salesman'}
                      <span class="font-bold text-blue-700 underline">{c.salesmanNama}</span>
                      <!-- Picker bottom-sheet: pengganti dropdown native (tahan semua browser) -->
                      <div class="fixed inset-0 z-50 bg-slate-900/40" onclick={() => batalEdit()}>
                        <div class="absolute left-2 right-2 bottom-2 bg-white rounded-xl shadow-2xl p-2 max-h-[70vh] overflow-y-auto" onclick={(e) => e.stopPropagation()}>
                          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1.5">Pilih salesman</div>
                          {#each daftarSalesmanAktif as s (s.nama)}
                            <button
                              type="button"
                              onclick={() => { if (selEdit) selEdit.nilai = s.nama; simpanEdit(c); }}
                              class="w-full text-left px-3 py-3 rounded-lg text-sm font-bold transition-colors {selEdit?.nilai === s.nama ? 'bg-blue-600 text-white' : 'text-slate-900 active:bg-slate-100'}"
                            >
                              {s.nama}
                            </button>
                          {/each}
                        </div>
                      </div>
                    {:else}
                      <span class="font-bold text-slate-900">{c.salesmanNama}</span>
                    {/if}
                  </td>

                  <!-- 2. NOMINAL (Klik 2x edit dalam ribuan) -->
                  <td
                    class="p-2.5 text-right font-mono font-bold text-slate-900 cursor-pointer"
                    ondblclick={() => mulaiEdit(c, 'nominal')}
                    title="Klik 2x untuk ubah nominal"
                  >
                    {#if selEdit && selEdit.id === c.id && selEdit.kolom === 'nominal'}
                      <input
                        bind:this={inputEditEl}
                        bind:value={selEdit.nilai}
                        type="number"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') simpanEdit(c);
                          else if (e.key === 'Escape') batalEdit();
                        }}
                        onblur={() => { if (selEdit && selEdit.nilai !== nilaiAwalEdit) simpanEdit(c); }}
                        class="h-6 w-20 rounded border border-blue-500 bg-white px-1 text-right text-xs outline-none"
                      />
                    {:else}
                      {formatRibuan(c.nominal)}
                      <span class="text-[10px] text-slate-400 font-normal ml-0.5">({rupiah(c.nominal)})</span>
                    {/if}
                  </td>

                  <!-- 3. DIBAYAR (Klik 2x edit dalam ribuan) -->
                  <td
                    class="p-2.5 text-right font-mono font-semibold cursor-pointer"
                    ondblclick={() => mulaiEdit(c, 'dibayar')}
                    title="Klik 2x untuk ubah dibayar"
                  >
                    {#if selEdit && selEdit.id === c.id && selEdit.kolom === 'dibayar'}
                      <input
                        bind:this={inputEditEl}
                        bind:value={selEdit.nilai}
                        type="number"
                        onkeydown={(e) => {
                          if (e.key === 'Enter') simpanEdit(c);
                          else if (e.key === 'Escape') batalEdit();
                        }}
                        onblur={() => { if (selEdit && selEdit.nilai !== nilaiAwalEdit) simpanEdit(c); }}
                        class="h-6 w-20 rounded border border-blue-500 bg-white px-1 text-right text-xs outline-none"
                      />
                    {:else if c.kredit}
                      <span class="text-slate-400">Kredit</span>
                    {:else if Number(c.dibayar) >= Number(c.nominal)}
                      <span class="text-emerald-700">{formatRibuan(c.dibayar)}</span>
                    {:else if Number(c.dibayar) > 0}
                      <span class="text-amber-700">{formatRibuan(c.dibayar)}</span>
                    {:else}
                      <span class="text-rose-600 font-bold">0</span>
                    {/if}
                  </td>

                  <!-- 3b. KEMBALIAN = dibayar - nominal (0 kalau belum lunas/kredit) -->
                  <td class="p-2.5 text-right font-mono font-semibold {!c.kredit && Number(c.dibayar) > Number(c.nominal) ? 'text-emerald-700' : 'text-slate-300'}">
                    {!c.kredit && Number(c.dibayar) > Number(c.nominal) ? formatRibuan(Number(c.dibayar) - Number(c.nominal)) : '—'}
                  </td>

                  <td class="p-2.5">
                    <span class="px-1.5 py-0.5 rounded text-[11px] font-bold {c.tipe === 'Grosir' ? 'bg-purple-100 text-purple-700' : c.tipe === 'Obral' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}">
                      {c.tipe}
                    </span>
                  </td>

                  <!-- 4. KOLOM KREDIT? (Checkbox langsung simpan, tidak ikut ditunggu di bayar) -->
                  <td class="p-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={c.kredit}
                      onchange={(e) => toggleKredit(c, (e.target as HTMLInputElement).checked)}
                      class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer align-middle"
                      title="Tandai kredit (tidak ikut ditunggu di kotak bayar)"
                    />
                  </td>

                  <!-- 5. PASANGAN POS (termasuk tanda beda cara bayar + bukti gambar) -->
                  <td class="p-2.5 text-[11px]">
                    {#if c.orderNo}
                      <div class="font-mono text-slate-900 font-bold">{c.orderNo}</div>
                      <div class="text-slate-500">{c.customer}</div>
                      {@const beda = bedaBayar(c)}
                      {#if beda}
                        <div
                          class="mt-1 inline-block px-1.5 py-0.5 rounded border border-rose-300 bg-rose-50 text-rose-700 font-bold"
                          title="Kasir dan Ollsera berbeda cara bayar — betulkan di Ollsera"
                        >
                          ⚠️ cek: {beda.cekKredit ? 'Kredit' : 'Tunai'} · Ollsera: {beda.regKredit ? 'Kredit' : 'Tunai'}
                        </div>
                      {/if}
                    {:else}
                      <span class="text-rose-500 font-semibold">Belum cocok POS</span>
                    {/if}
                    {#if fotoCek(c).length > 0}
                      <button
                        type="button"
                        data-ui="buktiGambar"
                        onclick={() => bukaGaleri(c)}
                        class="mt-1 inline-block px-1.5 py-0.5 rounded border font-bold {galeri?.cek?.id === c.id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-300 bg-slate-50 text-slate-700'}"
                        title="Buka galeri bukti gambar (layar penuh)"
                      >
                        📷 {fotoCek(c).length}
                      </button>
                    {/if}
                  </td>

                  <td class="p-2.5 text-center">
                    <button
                      onclick={() => hapusCek(c.id)}
                      class="text-[11px] text-rose-600 hover:text-rose-800 font-semibold px-1.5 py-0.5 rounded hover:bg-rose-50"
                      title="Hapus baris cek"
                    >
                      Hapus
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
      class="fixed inset-0 z-[80] bg-slate-900/95 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Galeri bukti cek"
    >
      <!-- KEPALA -->
      <div class="flex items-center justify-between gap-2 px-4 py-3 bg-slate-900 text-white shrink-0">
        <div class="min-w-0">
          <div class="text-sm font-bold truncate">📷 Bukti cek · {galeri.cek.salesmanNama}</div>
          <div class="text-[11px] text-slate-300">
            {rupiah(Number(galeri.cek.nominal))} · {galeri.cek.jam.slice(0, 5)} · {gambar.length} gambar
          </div>
        </div>
        <button
          type="button"
          data-ui="tutupGaleri"
          onclick={tutupGaleri}
          class="shrink-0 px-3 py-2 rounded-lg bg-white text-slate-900 text-xs font-bold"
          title="Tutup galeri (Esc)"
        >
          ✕ Tutup (Esc)
        </button>
      </div>

      <!-- PRATINJAU: gambar yang sedang disorot kursor -->
      {#if sorot !== null && gambar[sorot]}
        <div class="flex-1 min-h-0 flex items-center justify-center p-3">
          <img
            src={gambar[sorot].url}
            alt={gambar[sorot].filename ?? 'bukti cek'}
            class="max-h-full max-w-full object-contain rounded-lg"
            loading="lazy"
          />
        </div>
      {:else}
        <div class="flex-1 min-h-0 flex flex-col items-center justify-center text-slate-400 text-xs gap-1">
          <span class="text-2xl">🖼️</span>
          <span>Klik gambar kecil untuk melihat ukuran besar</span>
          <span class="text-slate-500">arahkan kursor ke gambar kecil untuk pratinjau</span>
        </div>
      {/if}

      <!-- SEMUA GAMBAR KECIL -->
      <div class="shrink-0 max-h-[40vh] overflow-y-auto px-3 pt-1 pb-3 bg-slate-900">
        <div class="flex flex-wrap gap-2 justify-center">
          {#each gambar as g, i (g.url)}
            <button
              type="button"
              data-ui="thumbBukti"
              onclick={() => bukaBesar(i)}
              onmouseenter={() => (sorot = i)}
              onmouseleave={() => (sorot = null)}
              onfocus={() => (sorot = i)}
              onblur={() => (sorot = null)}
              class="rounded-lg border-2 p-0.5 bg-slate-800 {sorot === i || galeri.idx === i ? 'border-blue-400' : 'border-slate-700'}"
              title="Gambar {i + 1} dari {gambar.length} — klik untuk melihat besar"
            >
              <img src={g.url} alt={g.filename ?? 'bukti'} class="h-20 w-20 object-cover rounded" loading="lazy" />
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- GAMBAR BESAR: dibuka DI HALAMAN INI (bukan window/tab baru) -->
    {#if besar && gambar[galeri.idx]}
      <div class="fixed inset-0 z-[90] bg-black/95 flex flex-col" onclick={tutupBesar} role="presentation">
        <div class="shrink-0 flex items-center justify-between gap-2 px-4 py-2 text-white" onclick={(e) => e.stopPropagation()}>
          <span class="text-xs font-mono">{galeri.idx + 1} / {gambar.length}</span>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick={() => geserGaleri(-1)} class="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs font-bold">
              ‹ Sebelumnya
            </button>
            <button type="button" onclick={() => geserGaleri(1)} class="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs font-bold">
              Berikutnya ›
            </button>
            <button
              type="button"
              data-ui="tutupBesar"
              onclick={tutupBesar}
              class="px-3 py-2 rounded-lg bg-white text-slate-900 text-xs font-bold"
              title="Kembali ke daftar gambar (Esc)"
            >
              ✕
            </button>
          </div>
        </div>
        <div class="flex-1 min-h-0 flex items-center justify-center p-2" onclick={(e) => e.stopPropagation()}>
          <img
            src={gambar[galeri.idx].url}
            alt={gambar[galeri.idx].filename ?? 'bukti cek'}
            class="max-h-full max-w-full object-contain"
          />
        </div>
      </div>
    {/if}
  {/if}

  <!-- CONTENT TAB 2: PENJUALAN TANPA CEK -->
  {#if tabAktif === 'tanpa_cek'}
    <div class="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      {#if ringkasan.penjualanTanpaCek.length === 0}
        <div class="p-8 text-center text-emerald-600 font-bold text-xs">
          ✓ Semua transaksi register POS telah memiliki pasangan cek kasir!
        </div>
      {:else}
        <div class="p-3 bg-amber-50 border-b border-amber-200 text-xs font-semibold text-amber-900">
          Transaksi berikut tercatat di Register POS Ollsera tetapi belum dideklarasikan oleh kasir.
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Waktu</th>
                <th class="p-2.5">Order No</th>
                <th class="p-2.5">Customer</th>
                <th class="p-2.5">Pembayaran</th>
                <th class="p-2.5 text-right">Total POS</th>
                <th class="p-2.5">Kasir POS</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              {#each ringkasan.penjualanTanpaCek as p (p.orderNo)}
                <tr class="hover:bg-slate-50">
                  <td class="p-2.5 font-mono text-slate-600">{p.orderTime || '-'}</td>
                  <td class="p-2.5 font-mono font-bold text-blue-700">{p.orderNo}</td>
                  <td class="p-2.5 text-slate-900">{p.customerName || '1Ecer'}</td>
                  <td class="p-2.5 text-slate-600">{p.paymentType || 'Tunai'}</td>
                  <td class="p-2.5 text-right font-mono font-bold text-slate-900">{rupiah(p.total)}</td>
                  <td class="p-2.5 text-slate-500">{p.cashierName || '-'}</td>
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

<style>
  @keyframes flash-cell-yellow {
    0%, 100% {
      background-color: rgb(254 240 138); /* bg-yellow-200 */
      box-shadow: inset 0 0 0 2px rgb(234 179 8);
    }
    50% {
      background-color: rgb(253 224 71); /* bg-yellow-300 */
      box-shadow: inset 0 0 0 2px rgb(202 138 4);
    }
  }

  .animate-flash-target {
    animation: flash-cell-yellow 0.8s ease-in-out infinite !important;
  }
</style>
