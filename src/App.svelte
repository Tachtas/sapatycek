<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { DbConnection } from './module_bindings';

  // Config SpacetimeDB
  const HOST = 'https://maincloud.spacetimedb.com';
  const DB_NAME = 'sapaty-pos';
  const OUTLET = 'Braka'; // Cek kasir HANYA untuk outlet Braka (Audy tidak ada cek)

  let tanggal = $state(new Date().toISOString().slice(0, 10));

  let conn = $state<any>(null);
  let statusKoneksi = $state<'menghubungkan' | 'terhubung' | 'terputus'>('menghubungkan');

  // Data reactive dari SpacetimeDB
  let daftarCek = $state<any[]>([]);
  let daftarPenjualan = $state<any[]>([]);
  let daftarStaff = $state<any[]>([]);

  // Input Cek & Bayar (tanpa tombol)
  let cepatTeks = $state('');
  let bayarTeks = $state('');
  let inputCepatEl = $state<HTMLInputElement | null>(null);
  let inputBayarEl = $state<HTMLInputElement | null>(null);

  let menyimpanCek = $state(false);
  let menyimpanBayar = $state(false);
  let pendingCekNominal = $state<number | null>(null);

  // Flash highlight visual
  let flashCekId = $state<bigint | null>(null);
  let timerFlash: any = null;

  // Notifikasi besar pembayaran & galat
  let notifs = $state<{ id: number; tipe: 'hijau' | 'merah' | 'info'; judul: string; baris: string[] }[]>([]);
  let notifIdSeq = 0;

  // Filter & tab
  let cariTeks = $state('');
  let filterStatus = $state<'semua' | 'cocok' | 'belum' | 'kurang_bayar'>('semua');
  let tabAktif = $state<'cek' | 'tanpa_cek' | 'ringkasan'>('cek');

  function tampilkanNotif(tipe: 'hijau' | 'merah' | 'info', judul: string, baris: string[] = []) {
    const id = ++notifIdSeq;
    notifs = [{ id, tipe, judul, baris }, ...notifs.slice(0, 4)];
    setTimeout(() => {
      notifs = notifs.filter((n) => n.id !== id);
    }, 5000);
  }

  function triggerFlash(id: bigint) {
    clearTimeout(timerFlash);
    flashCekId = id;
    timerFlash = setTimeout(() => {
      flashCekId = null;
    }, 2500);
  }

  // Peta shortcut kode salesman dari nama
  const kodeSalesMap = $derived.by(() => {
    const map = new Map<string, { nama: string; kode: string }>();
    const salesList = daftarStaff.filter((s) => s.outlet === OUTLET && s.active);
    for (const s of salesList) {
      const nama = s.label || s.email.split('@')[0];
      const kode = nama[0].toLowerCase();
      map.set(kode, { nama, kode });
    }
    return map;
  });

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
    hubungkanSpacetimeDB();
    inputCepatEl?.focus();
  });

  function hubungkanSpacetimeDB() {
    statusKoneksi = 'menghubungkan';
    try {
      const builder = DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .onConnect((connection) => {
          conn = connection;
          statusKoneksi = 'terhubung';
          pasangSubscription();
        })
        .onDisconnect(() => {
          statusKoneksi = 'terputus';
        })
        .onConnectError((_ctx, err) => {
          statusKoneksi = 'terputus';
          console.error('Koneksi SpacetimeDB error:', err);
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

    conn.subscriptionBuilder()
      .onApplied(() => {
        refreshData();
      })
      .subscribe([
        'SELECT * FROM cek',
        'SELECT * FROM penjualan',
        'SELECT * FROM staff',
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

      daftarStaff = Array.from(conn.db.staff.iter());
    } catch (e) {
      console.error('Error membaca tabel:', e);
    }
  }

  $effect(() => {
    if (tanggal) refreshData();
  });

  // =========================================================================
  // LOGIKA INPUT CEK TANPA TOMBOL: Otomatis submit saat format lengkap
  // =========================================================================
  function cekLengkap(teks: string): boolean {
    const bersih = teks.trim().toLowerCase().replace(/[^0-9a-z]/g, '');
    return /^\d+[a-z]\d$/.test(bersih);
  }

  function onInputCepat() {
    const teks = cepatTeks.trim();
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

  async function kirimCepat() {
    const teks = cepatTeks.trim().toLowerCase();
    if (!teks || menyimpanCek) return;

    const match = teks.match(/^(\d+)([a-z])(\d)$/);
    if (!match) return;

    const nominalRibuan = Number(match[1]);
    const nominal = BigInt(nominalRibuan * 1000);
    const kode = match[2];
    const tipeDigit = match[3];

    pendingCekNominal = nominalRibuan * 1000;

    // Pindahkan kursor SEKETIKA (0ms) ke kotak Bayar
    cepatTeks = '';
    inputBayarEl?.focus();

    const infoSales = kodeSalesMap.get(kode);
    const salesmanNama = infoSales ? infoSales.nama : `Sales (${kode.toUpperCase()})`;
    const salesman = kode;

    let tipe = 'Ecer';
    if (tipeDigit === '2') tipe = 'Obral';
    else if (tipeDigit === '3') tipe = 'Grosir';

    const jam = new Date().toTimeString().slice(0, 8);
    menyimpanCek = true;

    try {
      await conn?.reducers.tambahDeklarasiCek({
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

      // Flash baris teratas
      await tick();
      if (daftarCek.length > 0) triggerFlash(daftarCek[0].id);

      // Jika kasir sudah sempat mengetik di kotak Bayar saat cek disimpan
      if (bayarTeks.trim()) {
        onInputBayar();
      }
    } catch (e: any) {
      tampilkanNotif('merah', `Gagal simpan cek: ${e.message || e}`);
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
    const teks = bayarTeks.trim();
    if (!teks || !/^\d+$/.test(teks)) return;

    // Nominal input bayar dalam ribuan (misal "50" = 50.000)
    const bayarRp = Number(teks) * 1000;
    const sisa = sisaTargetBayar;

    // Jika kasir sudah mengetik sama dengan atau melebihi sisa tagihan, LANGSUNG BAYAR seketika!
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
    const teks = bayarTeks.trim();
    if (!teks || menyimpanBayar) return;

    // Jika cek baru masih dalam proses simpan, tunggu 50ms agar masuk database
    if (menyimpanCek) {
      setTimeout(kirimBayar, 50);
      return;
    }

    const nominalAngka = Number(teks.replace(/[^0-9]/g, ''));
    if (!nominalAngka) return;

    const bayarPenuh = BigInt(nominalAngka < 1000 ? nominalAngka * 1000 : nominalAngka);
    const target = targetBayar;
    if (!target) {
      tampilkanNotif('merah', 'Tidak ada transaksi yang menunggu pembayaran.');
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

      // Tampilkan notifikasi pembayaran sah besar (hijau 5 detik)
      tampilkanNotif('hijau', `Pembayaran Lunas`, [
        `${salesNama} = ${rupiah(target.nominal)}`,
        `Bayar = ${rupiah(bayarRp)}`,
        `Kembali = ${rupiah(Math.max(0, kembali))}`,
      ]);
    } catch (e: any) {
      tampilkanNotif('merah', `Gagal catat bayar: ${e.message || e}`);
      bayarTeks = teks;
      inputBayarEl?.focus();
    } finally {
      menyimpanBayar = false;
    }
  }

  async function hapusCek(id: bigint) {
    if (!confirm('Hapus baris cek ini?')) return;
    try {
      await conn?.reducers.hapusDeklarasiCek({ id });
      tampilkanNotif('info', 'Baris cek dihapus.');
    } catch (err: any) {
      tampilkanNotif('merah', `Gagal hapus: ${err.message || err}`);
    }
  }

  // Ringkasan Rekonsiliasi
  const ringkasan = $derived.by(() => {
    const totalCek = daftarCek.reduce((a, b) => a + Number(b.nominal), 0);
    const totalDibayar = daftarCek.reduce((a, b) => a + Number(b.dibayar), 0);
    const cocokList = daftarCek.filter((c) => c.status === 'Cocok' || c.status === 'Cocok Tanpa Bukti Waktu');
    const belumCocokList = daftarCek.filter((c) => c.status === 'Belum Cocok');

    const totalPenjualan = daftarPenjualan.reduce((a, b) => a + Number(b.total), 0);

    const orderNoCek = new Set(daftarCek.map((c) => c.orderNo).filter(Boolean));
    const penjualanTanpaCek = daftarPenjualan.filter((p) => !orderNoCek.has(p.orderNo));

    return {
      totalCek,
      totalDibayar,
      totalPenjualan,
      selisih: totalPenjualan - totalCek,
      jmlCek: daftarCek.length,
      jmlCocok: cocokList.length,
      jmlBelumCocok: belumCocokList.length,
      penjualanTanpaCek,
    };
  });

  // Filter daftar cek untuk tabel
  const cekTersaring = $derived.by(() => {
    const q = cariTeks.trim().toLowerCase();
    return daftarCek.filter((c) => {
      if (filterStatus === 'cocok' && c.status === 'Belum Cocok') return false;
      if (filterStatus === 'belum' && c.status !== 'Belum Cocok') return false;
      if (filterStatus === 'kurang_bayar' && c.dibayar >= c.nominal) return false;
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

  function rupiah(n: number | bigint) {
    return 'Rp ' + Number(n).toLocaleString('id-ID');
  }

  function formatRibuan(n: number | bigint) {
    return (Number(n) / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 });
  }
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
  <!-- HEADER (Braka Only, tanpa switcher Audy) -->
  <header class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
        <span>🔍 Sapaty Cek Braka</span>
        <span class="text-xs px-2.5 py-0.5 rounded-full font-medium {statusKoneksi === 'terhubung' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
          {statusKoneksi === 'terhubung' ? '● Live SpacetimeDB' : '○ ' + statusKoneksi}
        </span>
      </h1>
      <p class="text-xs text-slate-500 mt-0.5">Rekonsiliasi Deklarasi Kasir vs Register POS Realtime</p>
    </div>

    <!-- TANGGAL SELECTOR -->
    <div class="flex items-center gap-2">
      <span class="text-xs font-semibold text-slate-500">Tanggal:</span>
      <input
        type="date"
        bind:value={tanggal}
        class="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-semibold shadow-xs focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
  </header>

  <!-- NOTIFIKASI BESAR PEMBAYARAN & FEEDBACK (Hilang 5 Detik) -->
  {#if notifs.length > 0}
    <div class="space-y-2">
      {#each notifs as n (n.id)}
        <div
          class="p-4 rounded-xl shadow-md border text-base font-semibold flex justify-between items-start transition-all {n.tipe === 'hijau' ? 'bg-emerald-500 text-white border-emerald-600' : n.tipe === 'merah' ? 'bg-rose-500 text-white border-rose-600' : 'bg-blue-600 text-white border-blue-700'}"
        >
          <div>
            <div class="text-lg font-bold">{n.judul}</div>
            {#if n.baris && n.baris.length > 0}
              <div class="mt-1 text-sm font-mono space-y-0.5 opacity-95">
                {#each n.baris as b}
                  <div>{b}</div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- DUA KOTAK INPUT SEJAJAR: CEK & BAYAR (TANPA TOMBOL, FULL OTOMATIS) -->
  <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <!-- 1. KOTAK CEK -->
      <label class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center">
          <span class="text-xs font-bold uppercase tracking-wider text-slate-600">Cek (Ketik Cepat Otomatis)</span>
          <span class="text-[11px] text-slate-400">Contoh: <b>25m1</b></span>
        </div>
        <input
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
          class="h-14 w-full rounded-xl border-2 border-slate-300 bg-slate-50 px-4 text-3xl font-mono font-bold tracking-wider focus:border-blue-600 focus:bg-white focus:ring-0 outline-none transition-colors"
        />
      </label>

      <!-- 2. KOTAK BAYAR -->
      <label class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center">
          <span class="text-xs font-bold uppercase tracking-wider text-slate-600">Bayar (Otomatis Saat Uang Cukup)</span>
          {#if targetBayar}
            <span class="text-[11px] font-bold text-emerald-600">
              Target: {targetBayar.salesmanNama} (Sisa: {rupiah(sisaTargetBayar)})
            </span>
          {:else}
            <span class="text-[11px] text-slate-400">Semua lunas</span>
          {/if}
        </div>
        <input
          bind:this={inputBayarEl}
          bind:value={bayarTeks}
          oninput={onInputBayar}
          onkeydown={(e) => {
            if (e.key === 'Enter') kirimBayar();
            else if (e.key === 'ArrowLeft') onKeyLeftBayar(e);
          }}
          type="text"
          inputmode="numeric"
          autocomplete="off"
          spellcheck="false"
          placeholder="50"
          class="h-14 w-full rounded-xl border-2 border-slate-300 bg-slate-50 px-4 text-3xl font-mono font-bold tracking-wider focus:border-emerald-600 focus:bg-white focus:ring-0 outline-none transition-colors"
        />
      </label>
    </div>

    <!-- PETUNJUK KODE SALESMAN & ATURAN -->
    <div class="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500 border-t border-slate-100">
      <span class="font-bold text-slate-600">Kode Sales:</span>
      {#each Array.from(kodeSalesMap.values()) as s}
        <span class="bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
          <b class="text-blue-700">{s.kode}</b> = {s.nama}
        </span>
      {/each}
      <span class="ml-2 font-bold text-slate-600">Tipe:</span>
      <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">1=Ecer</span>
      <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">2=Obral</span>
      <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">3=Grosir</span>
      <span class="text-slate-400 ml-auto hidden sm:inline">Navigasi: ➔ Cek ke Bayar, ⬅ Bayar ke Cek</span>
    </div>
  </div>

  <!-- SUMMARY CARDS -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
    <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
      <span class="text-xs font-semibold text-slate-400 uppercase">Total Cek Kasir</span>
      <div class="text-lg sm:text-xl font-bold text-slate-900 mt-1">{rupiah(ringkasan.totalCek)}</div>
      <span class="text-[11px] text-slate-500">{ringkasan.jmlCek} baris ({ringkasan.jmlCocok} cocok)</span>
    </div>

    <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
      <span class="text-xs font-semibold text-slate-400 uppercase">Register POS (Ollsera)</span>
      <div class="text-lg sm:text-xl font-bold text-slate-900 mt-1">{rupiah(ringkasan.totalPenjualan)}</div>
      <span class="text-[11px] text-slate-500">{daftarPenjualan.length} order tercatat</span>
    </div>

    <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
      <span class="text-xs font-semibold text-slate-400 uppercase">Selisih Kasir vs POS</span>
      <div class="text-lg sm:text-xl font-bold {ringkasan.selisih === 0 ? 'text-emerald-600' : 'text-rose-600'} mt-1">
        {rupiah(ringkasan.selisih)}
      </div>
      <span class="text-[11px] text-slate-500">{ringkasan.selisih === 0 ? '✓ Seimbang' : 'Ada ketidakcocokan'}</span>
    </div>

    <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
      <div>
        <span class="text-xs font-semibold text-slate-400 uppercase">Penjualan Tanpa Cek</span>
        <div class="text-lg sm:text-xl font-bold {ringkasan.penjualanTanpaCek.length > 0 ? 'text-amber-600' : 'text-slate-700'} mt-1">
          {ringkasan.penjualanTanpaCek.length} Order
        </div>
      </div>
      <span class="text-[11px] text-slate-400">Kasir belum lapor</span>
    </div>
  </div>

  <!-- NAVIGATION TABS & FILTER -->
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-200 pb-3">
    <div class="flex gap-2">
      <button
        onclick={() => { tabAktif = 'cek'; }}
        class="px-4 py-2 text-sm font-bold rounded-lg transition-colors {tabAktif === 'cek' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}"
      >
        📋 Daftar Cek ({daftarCek.length})
      </button>
      <button
        onclick={() => { tabAktif = 'tanpa_cek'; }}
        class="px-4 py-2 text-sm font-bold rounded-lg transition-colors {tabAktif === 'tanpa_cek' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}"
      >
        ⚠️ Penjualan Tanpa Cek ({ringkasan.penjualanTanpaCek.length})
      </button>
    </div>

    {#if tabAktif === 'cek'}
      <div class="flex gap-2 w-full sm:w-auto">
        <select
          bind:value={filterStatus}
          class="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none font-medium"
        >
          <option value="semua">Semua Status</option>
          <option value="cocok">Sudah Cocok</option>
          <option value="belum">Belum Cocok</option>
          <option value="kurang_bayar">Kurang Bayar</option>
        </select>
        <input
          bind:value={cariTeks}
          placeholder="Cari salesman / order..."
          class="text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 outline-none flex-1 sm:w-48"
        />
      </div>
    {/if}
  </div>

  <!-- CONTENT TAB 1: DAFTAR CEK -->
  {#if tabAktif === 'cek'}
    <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {#if cekTersaring.length === 0}
        <div class="p-12 text-center text-slate-400 text-sm">
          Belum ada deklarasi cek kasir untuk {OUTLET} pada tanggal {tanggal}.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th class="p-3">Jam</th>
                <th class="p-3">Salesman</th>
                <th class="p-3 text-right">Nominal</th>
                <th class="p-3 text-right">Dibayar</th>
                <th class="p-3">Tipe</th>
                <th class="p-3">Status</th>
                <th class="p-3">Pasangan POS</th>
                <th class="p-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              {#each cekTersaring as c (c.id)}
                <tr class="hover:bg-slate-50 transition-colors {flashCekId === c.id ? 'bg-emerald-100' : ''}">
                  <td class="p-3 font-mono text-xs text-slate-600">{c.jam.slice(0, 5)}</td>
                  <td class="p-3">
                    <span class="font-bold text-slate-900">{c.salesmanNama}</span>
                  </td>
                  <td class="p-3 text-right font-mono font-bold text-slate-900">
                    {formatRibuan(c.nominal)}
                    <span class="text-[10px] text-slate-400 font-normal ml-0.5">({rupiah(c.nominal)})</span>
                  </td>
                  <td class="p-3 text-right font-mono font-semibold">
                    {#if c.kredit}
                      <span class="text-slate-400">Kredit</span>
                    {:else if Number(c.dibayar) >= Number(c.nominal)}
                      <span class="text-emerald-700">{formatRibuan(c.dibayar)}</span>
                    {:else if Number(c.dibayar) > 0}
                      <span class="text-amber-700">{formatRibuan(c.dibayar)}</span>
                    {:else}
                      <span class="text-rose-600 font-bold">Rp 0</span>
                    {/if}
                  </td>
                  <td class="p-3">
                    <span class="px-2 py-0.5 rounded text-xs font-bold {c.tipe === 'Grosir' ? 'bg-purple-100 text-purple-700' : c.tipe === 'Obral' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}">
                      {c.tipe}
                    </span>
                  </td>
                  <td class="p-3">
                    {#if c.status === 'Cocok'}
                      <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                        ✓ Cocok
                      </span>
                    {:else if c.status === 'Cocok Tanpa Bukti Waktu'}
                      <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                        ~ Waktu Jauh
                      </span>
                    {:else}
                      <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                        ✕ Belum Cocok
                      </span>
                    {/if}
                  </td>
                  <td class="p-3 text-xs">
                    {#if c.orderNo}
                      <div class="font-mono text-slate-900 font-bold">{c.orderNo}</div>
                      <div class="text-slate-500">{c.customer}</div>
                    {:else}
                      <span class="text-slate-400">-</span>
                    {/if}
                  </td>
                  <td class="p-3 text-center">
                    <button
                      onclick={() => hapusCek(c.id)}
                      class="text-xs text-rose-600 hover:text-rose-800 font-semibold px-2 py-1 rounded hover:bg-rose-50"
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

  <!-- CONTENT TAB 2: PENJUALAN TANPA CEK -->
  {#if tabAktif === 'tanpa_cek'}
    <div class="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {#if ringkasan.penjualanTanpaCek.length === 0}
        <div class="p-12 text-center text-emerald-600 font-bold text-sm">
          ✓ Semua transaksi register POS telah memiliki pasangan cek kasir!
        </div>
      {:else}
        <div class="p-4 bg-amber-50 border-b border-amber-200 text-xs font-semibold text-amber-900">
          Transaksi berikut tercatat di Register POS Ollsera tetapi belum dideklarasikan oleh kasir.
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[11px] border-b border-slate-200">
              <tr>
                <th class="p-3">Waktu</th>
                <th class="p-3">Order No</th>
                <th class="p-3">Customer</th>
                <th class="p-3">Pembayaran</th>
                <th class="p-3 text-right">Total POS</th>
                <th class="p-3">Kasir POS</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              {#each ringkasan.penjualanTanpaCek as p (p.orderNo)}
                <tr class="hover:bg-slate-50">
                  <td class="p-3 font-mono text-xs text-slate-600">{p.orderTime || '-'}</td>
                  <td class="p-3 font-mono font-bold text-blue-700">{p.orderNo}</td>
                  <td class="p-3 text-slate-900">{p.customerName || '1Ecer'}</td>
                  <td class="p-3 text-slate-600">{p.paymentType || 'Tunai'}</td>
                  <td class="p-3 text-right font-mono font-bold text-slate-900">{rupiah(p.total)}</td>
                  <td class="p-3 text-xs text-slate-500">{p.cashierName || '-'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>
