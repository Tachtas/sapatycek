<script lang="ts">
  // Cek yang belum terkirim (internet putus) — disimpan di HP, dikirim ulang
  // otomatis. Dipisah dari App.svelte supaya berkas utama tetap terbaca.
  import { TriangleAlert, X } from '@lucide/svelte';
  import { rupiah } from '../cek';
  import type { AntreanCek } from '../antrean.svelte';

  let {
    daftar,
    kirim,
    buang,
  }: { daftar: AntreanCek[]; kirim: () => void; buang: (ref: string) => void } = $props();
</script>

{#if daftar.length > 0}
  <div class="space-y-2 rounded-2xl border border-bad/30 bg-bad/8 px-4 py-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2 text-[13px] text-ink2">
        <TriangleAlert size={15} strokeWidth={1.5} class="shrink-0 text-bad" />
        <span>
          <span class="font-mono font-medium text-ink">{daftar.length}</span>
          cek tersimpan di HP — belum masuk perhitungan
        </span>
      </div>
      <button
        type="button"
        data-ui="kirimAntrean"
        onclick={kirim}
        class="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Kirim sekarang
      </button>
    </div>
    <div class="divide-y divide-line border-t border-line">
      {#each daftar as e (e.ref)}
        <div class="flex items-center justify-between gap-3 py-1.5">
          <span class="font-mono text-[12px] text-ink2">
            {e.jam} · {e.salesmanNama} · {rupiah(Number(e.nominal))} · {e.tipe}
          </span>
          <button
            type="button"
            data-ui="buangAntrean"
            onclick={() => buang(e.ref)}
            title="Buang cek ini (belum terkirim)"
            class="rounded-md p-1 text-muted transition-colors hover:bg-bad/8 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      {/each}
    </div>
    <div class="text-[12px] text-muted">
      Dikirim otomatis begitu tersambung. Server menolak kiriman kembar, jadi tidak akan tercatat dua kali.
    </div>
  </div>
{/if}
