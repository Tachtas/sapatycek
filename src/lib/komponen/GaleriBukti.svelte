<script lang="ts">
  // Galeri bukti cek (layar penuh + gambar besar). Dulu seluruh blok ini —
  // state galeri/sorot/besar, kunci gulir, penangan Esc & panah, dan ~110 baris
  // markup — hidup di App.svelte, tersebar di tiga tempat. Sekarang satu module:
  // App hanya memutuskan KAPAN dibuka dan apa yang dikembalikan fokusnya.
  //
  // Atribut data-ui (tutupGaleri, thumbBukti, tutupBesar) sengaja dipertahankan
  // apa adanya — uji CDP yang sudah ada memakai nama itu.
  import { Camera, ChevronLeft, ChevronRight, Image, X } from '@lucide/svelte';
  import { rupiah } from '../cek';

  let {
    baris,
    foto,
    onclose,
  }: {
    baris: any;
    /** Daftar bukti untuk baris ini (hasil fotoCek() di App). */
    foto: { url: string; filename?: string }[];
    onclose: () => void;
  } = $props();

  let idx = $state(0);
  let sorot = $state<number | null>(null); // thumbnail yang sedang di-hover (pratinjau)
  let besar = $state(false); // gambar besar dibuka DI HALAMAN (bukan window baru)

  // Kunci gulir layar belakang selama galeri terbuka.
  $effect(() => {
    const lama = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = lama; };
  });

  function tutupBesar() {
    besar = false;
  }

  function geser(arah: number) {
    if (foto.length === 0) return;
    idx = (idx + arah + foto.length) % foto.length;
    sorot = idx;
  }

  function bukaBesar(i: number) {
    idx = i;
    besar = true;
  }

  // Esc menutup (gambar besar dulu, baru galeri); panah berpindah gambar.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (besar) tutupBesar();
      else onclose();
    } else if (e.key === 'ArrowRight') geser(1);
    else if (e.key === 'ArrowLeft') geser(-1);
  }
</script>

<svelte:window onkeydown={onKey} />

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
        <span class="truncate">Bukti cek · {baris.salesmanNama}</span>
      </div>
      <div class="mt-0.5 font-mono text-[12px] text-white/60">
        {rupiah(Number(baris.nominal))} · {baris.jam.slice(0, 5)} · {foto.length} gambar
      </div>
    </div>
    <button
      type="button"
      data-ui="tutupGaleri"
      onclick={onclose}
      class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-medium text-kertas transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      title="Tutup galeri (Esc)"
    >
      <X size={14} strokeWidth={1.5} />
      Tutup
      <span class="font-mono text-white/50">Esc</span>
    </button>
  </div>

  <!-- PRATINJAU: gambar yang sedang disorot kursor -->
  {#if sorot !== null && foto[sorot]}
    <div class="flex min-h-0 flex-1 items-center justify-center p-3">
      <img
        src={foto[sorot].url}
        alt={foto[sorot].filename ?? 'bukti cek'}
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
      {#each foto as g, i (g.url)}
        <button
          type="button"
          data-ui="thumbBukti"
          onclick={() => bukaBesar(i)}
          onmouseenter={() => (sorot = i)}
          onmouseleave={() => (sorot = null)}
          onfocus={() => (sorot = i)}
          onblur={() => (sorot = null)}
          class="rounded-lg border-2 p-0.5 transition-colors {sorot === i || idx === i ? 'border-accent' : 'border-white/10'}"
          title="Gambar {i + 1} dari {foto.length} — klik untuk melihat besar"
        >
          <img src={g.url} alt={g.filename ?? 'bukti'} class="h-20 w-20 rounded object-cover" loading="lazy" />
        </button>
      {/each}
    </div>
  </div>
</div>

<!-- GAMBAR BESAR: dibuka DI HALAMAN INI (bukan window/tab baru) -->
{#if besar && foto[idx]}
  <div class="fixed inset-0 z-[90] flex flex-col bg-black" onclick={tutupBesar} role="presentation">
    <div class="flex shrink-0 items-center justify-between gap-3 px-4 py-2 text-kertas" onclick={(e) => e.stopPropagation()}>
      <span class="font-mono text-[12px] text-white/60">{idx + 1} / {foto.length}</span>
      <div class="flex items-center gap-1.5">
        <button type="button" onclick={() => geser(-1)} class="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-medium transition-colors hover:bg-white/10">
          <ChevronLeft size={14} strokeWidth={1.5} />
          Sebelumnya
        </button>
        <button type="button" onclick={() => geser(1)} class="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] font-medium transition-colors hover:bg-white/10">
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
      <img src={foto[idx].url} alt={foto[idx].filename ?? 'bukti cek'} class="max-h-full max-w-full object-contain" />
    </div>
  </div>
{/if}
