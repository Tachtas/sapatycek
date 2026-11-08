<script lang="ts">
  // Editor satu sel tabel (klik 2x). Dulu dua blok identik di App.svelte (kolom
  // Nominal dan Dibayar) — nilainya, fokus otomatis, dan aturan
  // Enter/Escape/blur kini satu tempat. Tampilannya sengaja TIDAK berubah.
  import { onMount, untrack } from 'svelte';

  let {
    awal,
    onsimpan,
    onbatal,
  }: {
    /** Nilai saat sel dibuka — dipakai untuk tahu apakah kasir benar mengubahnya. */
    awal: string;
    onsimpan: (nilai: string) => void;
    onbatal: () => void;
  } = $props();

  // Nilai awal memang diambil SEKALI (sel dibuka sekali lalu ditutup) — bukan
  // prop yang harus terus diikuti, jadi dibaca tanpa melacaknya (untrack).
  const nilaiAwal = awal;
  // svelte-ignore state_referenced_locally — memang cuma nilai awal, lihat atas.
  let nilai = $state(untrack(() => nilaiAwal));
  // Supaya satu sel tidak tersimpan dua kali (Enter lalu blur).
  let selesai = $state(false);
  let el = $state<HTMLInputElement | null>(null);

  onMount(() => {
    el?.focus();
    el?.select();
  });

  function simpan() {
    if (selesai) return;
    selesai = true;
    onsimpan(nilai);
  }

  function batal() {
    if (selesai) return;
    selesai = true;
    onbatal();
  }
</script>

<input
  bind:this={el}
  bind:value={nilai}
  type="text"
  inputmode="numeric"
  onkeydown={(e) => {
    if (e.key === 'Enter') simpan();
    else if (e.key === 'Escape') batal();
  }}
  onblur={() => {
    // Berpindah fokus = setuju, tapi hanya kalau nilainya memang berubah.
    if (!selesai && nilai !== nilaiAwal) simpan();
  }}
  class="h-6 w-20 rounded border border-accent bg-card px-1 text-right font-mono text-[12px] text-ink outline-none"
/>
