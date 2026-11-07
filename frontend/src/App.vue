<script setup lang="ts">
import { RouterView } from 'vue-router';
import FontSizeControl from '@/components/molecules/FontSizeControl.vue';
</script>

<template>
  <FontSizeControl />
  <RouterView v-slot="{ Component }">
    <KeepAlive include="CitizenReportView">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
