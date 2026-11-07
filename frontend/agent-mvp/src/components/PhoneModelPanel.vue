<script setup lang="ts">
import { computed } from 'vue';
import type { PhoneState } from '../agent/phone-model';
import type { Locale } from '../agent/types';
import { messages } from '../i18n';
const props = defineProps<{
  state: PhoneState;
  locale: Locale;
  starting: boolean;
  busy: boolean;
}>();
defineEmits<{ start: []; stop: []; refresh: [] }>();
const t = computed(() => messages[props.locale]);
const native = !!window.flutterObject;
</script>
<template>
  <section class="phone-model-panel" aria-labelledby="phone-model-title">
    <h2 id="phone-model-title">{{ t.phoneTitle }}</h2>
    <p>{{ native ? t.phoneDownloadHint : t.phoneBrowserHint }}</p>
    <p role="status" aria-live="polite">
      {{ state.ready ? t.phoneReady : t[`phone_${state.phase}`] }}
    </p>
    <p v-if="state.error" role="alert">{{ t[`phoneError_${state.error}`] }}</p>
    <p v-if="state.phase === 'running' && !state.ready && !starting">{{ t.phoneReconnect }}</p>
    <div class="action-row">
      <button
        v-if="!state.ready && !starting"
        class="primary-button"
        :disabled="!native || busy || state.phase === 'stopping'"
        @click="$emit('start')"
      >
        {{ t.phoneStart }}
      </button>
      <button
        v-if="starting || state.phase !== 'idle'"
        class="outline-button"
        :disabled="state.phase === 'stopping'"
        @click="$emit('stop')"
      >
        {{ starting ? t.phoneCancel : t.phoneStop }}
      </button>
      <button
        class="text-button"
        :disabled="!native || starting || busy || state.phase === 'stopping'"
        @click="$emit('refresh')"
      >
        {{ t.phoneRefresh }}
      </button>
    </div>
  </section>
</template>
