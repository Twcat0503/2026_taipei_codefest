<script setup lang="ts">
defineProps<{ name?: keyof typeof paths }>();
const paths = {
  plus: 'M12 5v14M5 12h14',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 4a8 8 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a8 8 0 0 0-2.1-1.2L15 3H9l-.4 2.6a8 8 0 0 0-2.1 1.2l-2.4-1-2 3.5 2 1.5a8 8 0 0 0 0 2.4l-2 1.5 2 3.5 2.4-1a8 8 0 0 0 2.1 1.2L9 21h6l.4-2.6a8 8 0 0 0 2.1-1.2l2.4 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z',
  send: 'M12 19V5m-6 6 6-6 6 6',
  sound: 'm11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  microphone:
    'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Zm-7 9v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8',
  camera: 'M3 8h3l2-2h8l2 2h3v12H3V8Zm9 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  back: 'm14 6-6 6 6 6',
  close: 'm6 6 12 12M6 18 18 6',
  chat: 'M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  history: 'M4 5h16v16H4V5Zm4-3v6m8-6v6M4 10h16m-12 4h2m4 0h2m-8 4h2',
  check: 'm5 12 4 4L19 6',
  book: 'M12 5v16M3 4h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V4Z',
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
