<script setup lang="ts">
import { computed, useId } from 'vue';
import { messages } from '../i18n';
import type { Locale } from '../agent/types';
import {
  CALL_LABEL,
  EMERGENCY_NUMBERS,
  EMERGENCY_TEXT,
  type EmergencyKind,
} from '../agent/skills/emergency';
import { openLink } from '../platform/location';

/** 緊急狀況：不經過模型，直接給大而明顯的撥號按鈕；按下只會打開撥號畫面，由使用者撥出。 */
const props = defineProps<{ kind: EmergencyKind; locale: Locale }>();
const t = computed(() => messages[props.locale]);
const titleId = useId();
</script>

<template>
  <section class="result-card emergency-card" :aria-labelledby="titleId">
    <h2 :id="titleId">{{ t[EMERGENCY_TEXT[kind]] }}</h2>
    <div class="action-row">
      <button
        v-for="number in EMERGENCY_NUMBERS[kind]"
        :key="number"
        type="button"
        class="primary-button emergency-call"
        @click="openLink(`tel:${number}`)"
      >
        {{ t[CALL_LABEL[number as keyof typeof CALL_LABEL]] }}
      </button>
    </div>
    <p class="small-note">{{ t.emergencyNote }}</p>
  </section>
</template>
