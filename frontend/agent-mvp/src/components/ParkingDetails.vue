<script setup lang="ts">
import { computed } from 'vue';
import type { Locale, ToolRecord } from '../agent/types';
import { parkingPresentation, type ParkingSpace } from '../agent/parking-presentation';
import { messages } from '../i18n';

const props = defineProps<{ record: ToolRecord; space: ParkingSpace | null; locale: Locale }>();
const t = computed(() => messages[props.locale]);
const view = computed(() => parkingPresentation(props.record, props.space, props.locale));
</script>

<template>
  <p v-if="view.summary" class="parking-summary">{{ view.summary }}</p>
  <p v-if="view.address">{{ view.address }}</p>
  <details v-if="record.description?.[locale] || view.details.length" class="parking-details">
    <summary>{{ t.parkingDetails }}</summary>
    <p v-if="record.description?.[locale]">{{ record.description[locale] }}</p>
    <dl v-if="view.details.length">
      <template v-for="field in view.details" :key="field.label[locale]">
        <dt>{{ field.label[locale] }}</dt>
        <dd>{{ field.value[locale] }}</dd>
      </template>
    </dl>
  </details>
</template>
