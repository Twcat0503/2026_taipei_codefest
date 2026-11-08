<script setup lang="ts">
import { RouterView } from 'vue-router';
import FontSizeControl from '@/components/molecules/FontSizeControl.vue';
import { useButtonGuidance } from '@/composables/useButtonGuidance';
const { failed, language, messages } = useButtonGuidance();
</script>

<template>
  <FontSizeControl />
  <p
    v-if="failed"
    role="status"
    class="pointer-events-none fixed inset-x-2 top-2 z-[10000] rounded bg-white p-2 text-sm text-gray-800 shadow"
  >
    {{ messages[language].speechFailed }}
  </p>
  <RouterView v-slot="{ Component }">
    <KeepAlive include="CitizenReportView">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
