<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean; wide?: boolean }>(), { active: false, wide: false });
const shortBars = [30, 42, 72, 46, 24, 18, 28];
const longBars = [
  18, 26, 42, 22, 15, 12, 20, 28, 40, 22, 15, 24, 18, 26, 42, 30, 18, 14, 22, 34, 42, 24, 16, 12,
  18, 24,
];
</script>

<template>
  <span class="voice-wave" :class="{ 'is-active': active, 'is-wide': wide }" aria-hidden="true">
    <span
      v-for="(height, index) in wide ? longBars : shortBars"
      :key="index"
      :style="{
        '--bar-height': `${height / 16}rem`,
        '--bar-ratio': `${(height / 72) * 100}%`,
        '--bar-delay': `${index * -0.09}s`,
      }"
    ></span>
  </span>
</template>
