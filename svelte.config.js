import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Tanpa berkas ini svelte-check menolak memeriksa apa pun: ia melaporkan
// "No Svelte configuration found in vite config" untuk tiap berkas .svelte —
// dua galat palsu yang menutupi seluruh pemeriksaan tipe (ditemukan 5 Nov
// 2026). Sama seperti sapaty-pos, preprocessornya `vitePreprocess()` supaya
// `<script lang="ts">` dan blok gaya di berkas .svelte dipahami alat periksa.
export default {
  preprocess: vitePreprocess(),
};
