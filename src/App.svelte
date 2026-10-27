<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { DbConnection } from './module_bindings';

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

  // Input Cek & Bayar (tanpa tombol, ukuran compact 50%)
  let cepatTeks = $state('');
  let bayarTeks = $state('');
  let inputCepatEl = $state<HTMLInputElement | null>(null);
  let inputBayarEl = $state<HTMLInputElement | null>(null);

  let menyimpanCek = $state(false);
  let menyimpanBayar = $state(false);
  let pendingCekNominal = $state<number | null>(null);

  // Keterangan pelunasan di samping input bayar (tidak menggeser layout)
  let pesanPelunasan = $state<{ sales: string; nominal: number; bayar: number; kembali: number } | null>(null);
  let timerPelunasan: any = null;
  let pesanGalat = $state<string | null>(null);
  let timerGalat: any = null;

  // Flash highlight visual pada baris tabel
  let flashCekId = $state<bigint | null>(null);
  let timerFlash: any = null;

  // Filter & tab
  let cariTeks = $state('');
  let filterStatus = $state<'semua' | 'cocok' | 'belum' | 'kurang_bayar'>('semua');
  let tabAktif = $state<'cek' | 'tanpa_cek'>('cek');

  function setPesanPelunasan(sales: string, nominal: number, bayar: number, kembali: number) {
    clearTimeout(timerPelunasan);
    pesanGalat = null;
    pesanPelunasan = { sales, nominal, bayar, kembali };
    timerPelunasan = setTimeout(() => {
      pesanPelunasan = null;
    }, 6000);
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
    const teks = bayarTeks.trim();
    if (!teks || menyimpanBayar) return;

    if (menyimpanCek) {
      setTimeout(kirimBayar, 50);
      return;
    }

    const nominalAngka = Number(teks.replace(/[^0-9]/g, ''));
    if (!nominalAngka) return;

    const bayarPenuh = BigInt(nominalAngka < 1000 ? nominalAngka * 1000 : nominalAngka);
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

      // Tampilkan keterangan pelunasan di samping input bayar
      setPesanPelunasan(salesNama, Number(target.nominal), bayarRp, Math.max(0, kembali));
    } catch (e: any) {
      setPesanGalat(`Gagal bayar: ${e.message || e}`);
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
    } catch (err: any) {
      setPesanGalat(`Gagal hapus: ${err.message || err}`);
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

<div class="max-w-6xl mx-auto p-3 sm:p-4 space-y-3">
  <!-- 1. KARTU INFORMASI HEADER (UKURAN LEBIH KECIL, RAMPING) -->
  <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs flex items-center justify-between">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Cek</div>
        <div class="text-sm font-bold text-slate-900">{rupiah(ringkasan.totalCek)}</div>
      </div>
      <span class="text-[11px] text-slate-400 font-mono">{ringkasan.jmlCek} ({ringkasan.jmlCocok}✓)</span>
    </div>

    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs flex items-center justify-between">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Register POS</div>
        <div class="text-sm font-bold text-slate-900">{rupiah(ringkasan.totalPenjualan)}</div>
      </div>
      <span class="text-[11px] text-slate-400 font-mono">{daftarPenjualan.length} order</span>
    </div>

    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs flex items-center justify-between">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Selisih</div>
        <div class="text-sm font-bold {ringkasan.selisih === 0 ? 'text-emerald-600' : 'text-rose-600'}">
          {rupiah(ringkasan.selisih)}
        </div>
      </div>
      <span class="text-[10px] font-bold {ringkasan.selisih === 0 ? 'text-emerald-500' : 'text-rose-500'}">
        {ringkasan.selisih === 0 ? 'Pas' : 'Selisih'}
      </span>
    </div>

    <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs flex items-center justify-between">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tanpa Cek</div>
        <div class="text-sm font-bold {ringkasan.penjualanTanpaCek.length > 0 ? 'text-amber-600' : 'text-slate-700'}">
          {ringkasan.penjualanTanpaCek.length} Order
        </div>
      </div>
      <span class="text-[9px] px-1.5 py-0.5 rounded font-bold {statusKoneksi === 'terhubung' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
        {statusKoneksi === 'terhubung' ? '● LIVE' : '○'}
      </span>
    </div>
  </div>

  <!-- 2. BARIS INPUT KASIR (UKURAN 50% LEBIH KECIL, KETERANGAN DI SAMPING BAYAR) -->
  <div class="bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-xs">
    <div class="flex flex-wrap items-center gap-3">
      <!-- INPUT CEK (Ukuran 50%: h-8, w-28, text-base font-mono) -->
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
          class="h-8 w-28 rounded-md border border-slate-300 bg-slate-50 px-2 text-base font-mono font-bold tracking-wide focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600 outline-none transition-colors"
        />
      </div>

      <!-- INPUT BAYAR (Ukuran 50%: h-8, w-24, text-base font-mono) -->
      <div class="flex items-center gap-1.5">
        <label for="input-bayar" class="text-xs font-bold uppercase text-slate-500">Bayar:</label>
        <input
          id="input-bayar"
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
          class="h-8 w-24 rounded-md border border-slate-300 bg-slate-50 px-2 text-base font-mono font-bold tracking-wide focus:border-emerald-600 focus:bg-white focus:ring-1 focus:ring-emerald-600 outline-none transition-colors"
        />
      </div>

      <!-- KETERANGAN DI SAMPING INPUT BAYAR (TIDAK MENGGESER KE BAWAH) -->
      <div class="flex-1 flex items-center min-w-0">
        {#if pesanPelunasan}
          <div class="flex items-center gap-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md truncate">
            <span class="font-bold">✓ LUNAS:</span>
            <span>{pesanPelunasan.sales} {rupiah(pesanPelunasan.nominal)}</span>
            <span class="text-slate-300">|</span>
            <span>Bayar {rupiah(pesanPelunasan.bayar)}</span>
            <span class="text-slate-300">|</span>
            <span class="font-bold text-emerald-700">Kembali {rupiah(pesanPelunasan.kembali)}</span>
          </div>
        {:else if pesanGalat}
          <div class="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-md truncate">
            {pesanGalat}
          </div>
        {:else if targetBayar}
          <div class="text-xs text-slate-600 font-medium truncate">
            Target: <b class="text-slate-800">{targetBayar.salesmanNama}</b>
            (Sisa: <b class="text-emerald-700">{rupiah(sisaTargetBayar)}</b>)
          </div>
        {:else}
          <div class="text-xs text-slate-400">
            Semua cek lunas
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- 3. NAVIGATION TABS & FILTER -->
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-slate-200 pb-2">
    <div class="flex gap-2">
      <button
        onclick={() => { tabAktif = 'cek'; }}
        class="px-3 py-1.5 text-xs font-bold rounded-md transition-colors {tabAktif === 'cek' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}"
      >
        📋 Daftar Cek ({daftarCek.length})
      </button>
      <button
        onclick={() => { tabAktif = 'tanpa_cek'; }}
        class="px-3 py-1.5 text-xs font-bold rounded-md transition-colors {tabAktif === 'tanpa_cek' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}"
      >
        ⚠️ Penjualan Tanpa Cek ({ringkasan.penjualanTanpaCek.length})
      </button>
    </div>

    {#if tabAktif === 'cek'}
      <div class="flex gap-2 w-full sm:w-auto">
        <select
          bind:value={filterStatus}
          class="text-xs bg-white border border-slate-200 rounded-md px-2 py-1 outline-none font-medium"
        >
          <option value="semua">Semua Status</option>
          <option value="cocok">Sudah Cocok</option>
          <option value="belum">Belum Cocok</option>
          <option value="kurang_bayar">Kurang Bayar</option>
        </select>
        <input
          bind:value={cariTeks}
          placeholder="Cari salesman / order..."
          class="text-xs bg-white border border-slate-200 rounded-md px-2.5 py-1 outline-none flex-1 sm:w-44"
        />
      </div>
    {/if}
  </div>

  <!-- CONTENT TAB 1: DAFTAR CEK -->
  {#if tabAktif === 'cek'}
    <div class="bg-white rounded-lg border border-slate-200 shadow-xs overflow-hidden">
      {#if cekTersaring.length === 0}
        <div class="p-8 text-center text-slate-400 text-xs">
          Belum ada deklarasi cek kasir untuk hari ini.
        </div>
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-200">
              <tr>
                <th class="p-2.5">Jam</th>
                <th class="p-2.5">Salesman</th>
                <th class="p-2.5 text-right">Nominal</th>
                <th class="p-2.5 text-right">Dibayar</th>
                <th class="p-2.5">Tipe</th>
                <th class="p-2.5">Status</th>
                <th class="p-2.5">Pasangan POS</th>
                <th class="p-2.5 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100 font-medium">
              {#each cekTersaring as c (c.id)}
                <tr class="hover:bg-slate-50 transition-colors {flashCekId === c.id ? 'bg-emerald-100' : ''}">
                  <td class="p-2.5 font-mono text-slate-600">{c.jam.slice(0, 5)}</td>
                  <td class="p-2.5">
                    <span class="font-bold text-slate-900">{c.salesmanNama}</span>
                  </td>
                  <td class="p-2.5 text-right font-mono font-bold text-slate-900">
                    {formatRibuan(c.nominal)}
                    <span class="text-[10px] text-slate-400 font-normal ml-0.5">({rupiah(c.nominal)})</span>
                  </td>
                  <td class="p-2.5 text-right font-mono font-semibold">
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
                  <td class="p-2.5">
                    <span class="px-1.5 py-0.5 rounded text-[11px] font-bold {c.tipe === 'Grosir' ? 'bg-purple-100 text-purple-700' : c.tipe === 'Obral' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}">
                      {c.tipe}
                    </span>
                  </td>
                  <td class="p-2.5">
                    {#if c.status === 'Cocok'}
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                        ✓ Cocok
                      </span>
                    {:else if c.status === 'Cocok Tanpa Bukti Waktu'}
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">
                        ~ Waktu Jauh
                      </span>
                    {:else}
                      <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800">
                        ✕ Belum Cocok
                      </span>
                    {/if}
                  </td>
                  <td class="p-2.5 text-[11px]">
                    {#if c.orderNo}
                      <div class="font-mono text-slate-900 font-bold">{c.orderNo}</div>
                      <div class="text-slate-500">{c.customer}</div>
                    {:else}
                      <span class="text-slate-400">-</span>
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
