<script lang="ts">
  import { onMount } from 'svelte';
  import { DbConnection, tables, reducers } from './module_bindings';

  // Config SpacetimeDB
  const HOST = 'https://maincloud.spacetimedb.com';
  const DB_NAME = 'sapaty-pos';

  let outlet = $state<'Braka' | 'Audy'>('Braka');
  let tanggal = $state(new Date().toISOString().slice(0, 10));

  let conn = $state<any>(null);
  let statusKoneksi = $state<'menghubungkan' | 'terhubung' | 'terputus'>('menghubungkan');

  // Data reactive dari SpacetimeDB
  let daftarCek = $state<any[]>([]);
  let daftarPenjualan = $state<any[]>([]);
  let daftarStaff = $state<any[]>([]);

  // Form input cepat
  let cepatTeks = $state('');
  let inputCepatEl = $state<HTMLInputElement | null>(null);

  // Form bayar
  let bayarTeks = $state('');
  let inputBayarEl = $state<HTMLInputElement | null>(null);

  // Notifikasi & Flash
  let notif = $state<{ tipe: 'sukses' | 'galat' | 'info'; pesan: string } | null>(null);
  let timerNotif: any = null;
  let flashCekId = $state<bigint | null>(null);

  // Filter & Search
  let cariTeks = $state('');
  let filterStatus = $state<'semua' | 'cocok' | 'belum' | 'kurang_bayar'>('semua');
  let tabAktif = $state<'cek' | 'tanpa_cek' | 'ringkasan'>('cek');

  function tampilkanNotif(tipe: 'sukses' | 'galat' | 'info', pesan: string) {
    clearTimeout(timerNotif);
    notif = { tipe, pesan };
    timerNotif = setTimeout(() => {
      notif = null;
    }, 4500);
  }

  // Peta shortcut kode salesman dari nama
  const kodeSalesMap = $derived.by(() => {
    const map = new Map<string, { nama: string; kode: string }>();
    const salesList = daftarStaff.filter((s) => s.outlet === outlet && s.active);
    for (const s of salesList) {
      const nama = s.label || s.email.split('@')[0];
      const kode = nama[0].toLowerCase();
      map.set(kode, { nama, kode });
    }
    return map;
  });

  // Sambungkan ke SpacetimeDB
  onMount(() => {
    hubungkanSpacetimeDB();
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

    // Pasang listener data
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
        .filter((c: any) => c.outlet === outlet && c.tanggal === tanggal)
        .sort((a: any, b: any) => Number(b.id - a.id));

      daftarPenjualan = Array.from(conn.db.penjualan.iter())
        .filter((p: any) => p.outlet === outlet && p.orderDate === tanggal);

      daftarStaff = Array.from(conn.db.staff.iter());
    } catch (e) {
      console.error('Error membaca tabel:', e);
    }
  }

  $effect(() => {
    // Re-filter saat outlet atau tanggal berganti
    if (outlet && tanggal) {
      refreshData();
    }
  });

  // Logika Input Cepat: <angka><huruf_sales><tipe_123> contoh "25m1"
  function handleInputCepat(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      prosesKirimCepat();
    } else if (e.key === 'ArrowRight') {
      inputBayarEl?.focus();
    } else {
      // Auto-submit saat regex pola lengkap terpenuhi
      const raw = cepatTeks.trim().toLowerCase();
      if (/^\d+[a-z]\d$/.test(raw)) {
        setTimeout(prosesKirimCepat, 50);
      }
    }
  }

  async function prosesKirimCepat() {
    const raw = cepatTeks.trim().toLowerCase();
    if (!raw) return;

    // Parse format <angka><kode><tipe>
    const match = raw.match(/^(\d+)([a-z])(\d)?$/);
    if (!match) {
      tampilkanNotif('galat', 'Format cek: <nominal><kodeSales><tipe>, misal: 25m1');
      return;
    }

    const nominalRibuan = Number(match[1]);
    const nominal = BigInt(nominalRibuan * 1000);
    const kode = match[2];
    const tipeDigit = match[3] || '1';

    const infoSales = kodeSalesMap.get(kode);
    const salesmanNama = infoSales ? infoSales.nama : `Sales (${kode.toUpperCase()})`;
    const salesman = kode;

    let tipe = 'Ecer';
    if (tipeDigit === '2') tipe = 'Obral';
    else if (tipeDigit === '3') tipe = 'Grosir';

    const jam = new Date().toTimeString().slice(0, 8);

    cepatTeks = '';
    // Pindahkan kursor seketika ke input Bayar
    inputBayarEl?.focus();

    try {
      await conn?.reducers.tambahDeklarasiCek({
        outlet,
        tanggal,
        jam,
        salesman,
        salesmanNama,
        nominal,
        tipe,
        kredit: false,
        dibayar: 0n,
      });

      // Beri efek flash pada baris teratas
      setTimeout(() => {
        if (daftarCek.length > 0) flashCekId = daftarCek[0].id;
        setTimeout(() => { flashCekId = null; }, 2500);
      }, 100);
    } catch (err: any) {
      tampilkanNotif('galat', `Gagal simpan cek: ${err.message || err}`);
    }
  }

  // Logika Input Bayar
  function handleInputBayar(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      prosesKirimBayar();
    } else if (e.key === 'ArrowLeft' && !bayarTeks) {
      inputCepatEl?.focus();
    }
  }

  async function prosesKirimBayar() {
    const raw = bayarTeks.trim();
    if (!raw) return;

    const nominalAngka = Number(raw.replace(/[^0-9]/g, ''));
    if (!nominalAngka) return;

    // Jika ketik di bawah 1000, asumsikan ribuan (mis. "50" -> 50.000)
    const bayarPenuh = BigInt(nominalAngka < 1000 ? nominalAngka * 1000 : nominalAngka);

    bayarTeks = '';
    inputCepatEl?.focus();

    try {
      // Cari target cek terbaru yang belum lunas
      const target = daftarCek.slice().reverse().find((c) => !c.kredit && c.dibayar < c.nominal);
      if (target) {
        const kembali = Number(bayarPenuh) - (Number(target.nominal) - Number(target.dibayar));
        if (kembali >= 0) {
          tampilkanNotif('sukses', `Lunas! Kembalian: Rp ${kembali.toLocaleString('id-ID')}`);
        }
      }

      await conn?.reducers.catatBayarCek({
        outlet,
        tanggal,
        nominalBayar: bayarPenuh,
      });
    } catch (err: any) {
      tampilkanNotif('galat', `Gagal catat bayar: ${err.message || err}`);
    }
  }

  async function jalankanRekonsiliasi() {
    try {
      tampilkanNotif('info', 'Mencocokkan cek dengan transaksi POS...');
      await conn?.reducers.rekonsiliasiCekHari({
        outlet,
        tanggal,
        toleransiMenit: 5,
      });
      tampilkanNotif('sukses', 'Rekonsiliasi selesai!');
    } catch (err: any) {
      tampilkanNotif('galat', `Rekonsiliasi gagal: ${err.message || err}`);
    }
  }

  async function hapusCek(id: bigint) {
    if (!confirm('Yakin ingin menghapus deklarasi cek ini?')) return;
    try {
      await conn?.reducers.hapusDeklarasiCek({ id });
      tampilkanNotif('info', 'Cek berhasil dihapus.');
    } catch (err: any) {
      tampilkanNotif('galat', `Gagal hapus: ${err.message || err}`);
    }
  }

  // Perhitungan Ringkasan
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
  <!-- HEADER -->
  <header class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
    <div>
      <h1 class="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
        <span>🔍 Sapaty Cek</span>
        <span class="text-xs px-2 py-0.5 rounded-full font-medium {statusKoneksi === 'terhubung' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
          {statusKoneksi === 'terhubung' ? '● Live SpacetimeDB' : '○ ' + statusKoneksi}
        </span>
      </h1>
      <p class="text-xs text-slate-500 mt-0.5">Rekonsiliasi Deklarasi Kasir vs Register POS Realtime</p>
    </div>

    <!-- OUTLET & TANGGAL SELECTOR -->
    <div class="flex items-center gap-3 w-full sm:w-auto">
      <div class="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-sm font-semibold">
        <button
          type="button"
          onclick={() => { outlet = 'Braka'; }}
          class="px-3 py-1.5 rounded-md transition-colors {outlet === 'Braka' ? 'bg-white shadow-xs text-blue-700 font-bold' : 'text-slate-600 hover:text-slate-900'}"
        >
          Braka
        </button>
        <button
          type="button"
          onclick={() => { outlet = 'Audy'; }}
          class="px-3 py-1.5 rounded-md transition-colors {outlet === 'Audy' ? 'bg-white shadow-xs text-blue-700 font-bold' : 'text-slate-600 hover:text-slate-900'}"
        >
          Audy
        </button>
      </div>

      <input
        type="date"
        bind:value={tanggal}
        class="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium shadow-xs focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
  </header>

  <!-- NOTIFIKASI FLOATING -->
  {#if notif}
    <div
      class="p-4 rounded-xl shadow-lg border text-sm font-semibold flex justify-between items-center transition-all {notif.tipe === 'sukses' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : notif.tipe === 'galat' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-blue-50 text-blue-800 border-blue-200'}"
    >
      <span>{notif.pesan}</span>
      <button onclick={() => { notif = null; }} class="text-xs underline ml-4">Tutup</button>
    </div>
  {/if}

  <!-- INPUT AREA KASIR -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <!-- KOTAK CEK KASIR -->
    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
      <div class="flex justify-between items-center">
        <label for="input-cepat" class="text-xs font-bold uppercase tracking-wider text-slate-500">
          1. Input Cek Kasir (Ketik Cepat)
        </label>
        <span class="text-[11px] text-slate-400">Contoh: <b>25m1</b> (25rb Melaty Ecer)</span>
      </div>
      <div class="flex gap-2">
        <input
          id="input-cepat"
          bind:this={inputCepatEl}
          bind:value={cepatTeks}
          onkeydown={handleInputCepat}
          placeholder="25m1"
          autocomplete="off"
          class="flex-1 text-2xl font-mono font-bold px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white outline-none"
        />
        <button
          onclick={prosesKirimCepat}
          class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-sm shadow-xs transition-colors"
        >
          Catat Cek
        </button>
      </div>

      <!-- PETUNJUK KODE SALES -->
      <div class="flex flex-wrap gap-1.5 pt-1 text-[11px] text-slate-500">
        <span class="font-semibold text-slate-400">Kode Sales:</span>
        {#each Array.from(kodeSalesMap.values()) as s}
          <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            <b class="text-blue-600">{s.kode}</b> = {s.nama}
          </span>
        {/each}
        <span class="ml-2 font-semibold text-slate-400">Tipe:</span>
        <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">1=Ecer</span>
        <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">2=Obral</span>
        <span class="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">3=Grosir</span>
      </div>
    </div>

    <!-- KOTAK BAYAR KASIR -->
    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
      <div class="flex justify-between items-center">
        <label for="input-bayar" class="text-xs font-bold uppercase tracking-wider text-slate-500">
          2. Kotak Bayar (Uang Masuk)
        </label>
        <span class="text-[11px] text-slate-400">Contoh: <b>50</b> (50.000) atau <b>100</b></span>
      </div>
      <div class="flex gap-2">
        <input
          id="input-bayar"
          bind:this={inputBayarEl}
          bind:value={bayarTeks}
          onkeydown={handleInputBayar}
          placeholder="50"
          autocomplete="off"
          class="flex-1 text-2xl font-mono font-bold px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white outline-none"
        />
        <button
          onclick={prosesKirimBayar}
          class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm shadow-xs transition-colors"
        >
          Bayar
        </button>
      </div>
      <p class="text-[11px] text-slate-400">Otomatis mencatat pembayaran ke cek terbaru yang belum lunas.</p>
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
      <button
        onclick={jalankanRekonsiliasi}
        class="mt-2 text-xs py-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded border border-slate-200 transition-colors"
      >
        🔄 Cocokkan Ulang
      </button>
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
          Belum ada deklarasi cek kasir untuk {outlet} pada tanggal {tanggal}.
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
                <tr class="hover:bg-slate-50 transition-colors {flashCekId === c.id ? 'bg-emerald-50' : ''}">
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
                    {:else if c.dibayar >= c.nominal}
                      <span class="text-emerald-700">{formatRibuan(c.dibayar)}</span>
                    {:else if c.dibayar > 0}
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
