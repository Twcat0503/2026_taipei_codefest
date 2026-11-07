<script setup lang="ts">
defineProps<{ name?: 'plus' | 'send' | 'sound' | 'camera' }>();
const paths = {
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5m-6 6 6-6 6 6',
  sound: 'm11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  camera: 'M3 8h3l2-2h8l2 2h3v12H3V8Zm9 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
};
</script>
<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name ?? 'send']" />
  </svg>
</template>
