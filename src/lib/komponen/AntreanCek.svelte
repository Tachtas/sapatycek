<script lang="ts">
  // Cek yang belum terkirim (internet putus) — disimpan di HP, dikirim ulang
  // otomatis. Dipisah dari App.svelte supaya berkas utama tetap terbaca.
  import { rupiah } from '../cek';
  import type { AntreanCek } from '../antrean.svelte';

  let {
    daftar,
    kirim,
    buang,
  }: { daftar: AntreanCek[]; kirim: () => void; buang: (ref: string) => void } = $props();
</script>

{#if daftar.length > 0}
  <div class="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 space-y-1">
    <div class="flex items-center justify-between gap-2">
      <div class="text-xs font-bold text-amber-900">
        ⏳ {daftar.length} cek tersimpan di HP — belum masuk perhitungan
      </div>
      <button
        type="button"
        data-ui="kirimAntrean"
        onclick={kirim}
        class="px-2 py-1 text-[11px] font-bold rounded-md bg-amber-600 text-white hover:bg-amber-700"
      >
        Kirim sekarang
      </button>
    </div>
    <div class="space-y-0.5">
      {#each daftar as e (e.ref)}
        <div class="flex items-center justify-between gap-2 text-[11px] text-amber-900">
          <span class="font-mono">{e.jam} · {e.salesmanNama} · {rupiah(Number(e.nominal))} · {e.tipe}</span>
          <button
            type="button"
            data-ui="buangAntrean"
            onclick={() => buang(e.ref)}
            title="Buang cek ini (belum terkirim)"
            class="px-1.5 py-0.5 rounded border border-amber-300 bg-white text-amber-800 font-bold"
          >
            ✕
          </button>
        </div>
      {/each}
    </div>
    <div class="text-[10px] text-amber-700">
      Dikirim otomatis begitu tersambung. Server menolak kiriman kembar, jadi tidak akan tercatat dua kali.
    </div>
  </div>
{/if}
