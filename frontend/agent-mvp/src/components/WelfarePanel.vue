<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { Locale } from '../agent/types';
import type { WelfareSelection } from '../agent/skills/welfare';
import {
  welfareGuides,
  welfareSections,
  welfareTopics,
  WELFARE_CHECKED_AT,
  WELFARE_SOURCES,
} from '../agent/open-data/welfare';
import { messages } from '../i18n';
import { openLink } from '../platform/location';

const props = defineProps<{ selection: WelfareSelection; locale: Locale }>();
const emit = defineEmits<{ select: [selection: WelfareSelection] }>();
const t = computed(() => messages[props.locale]);
const id = useId();
const heading = ref<HTMLElement>();
const guide = computed(() =>
  props.selection.topic === 'overview' ? null : welfareGuides[props.selection.topic],
);
const sectionLabels = computed(() => ({
  overview: t.value.welfareOverview,
  eligibility: t.value.welfareEligibility,
  documents: t.value.welfareDocuments,
  steps: t.value.welfareSteps,
  cost: t.value.welfareCost,
}));
const sources = computed(() =>
  WELFARE_SOURCES.filter((source) => guide.value?.sources.includes(source.id)),
);
const prepared = ref<number[]>([]);
const pending = ref<{ label: string; url: string } | null>(null);
const failed = ref(false);
watch(
  () => props.selection.topic,
  () => {
    prepared.value = [];
  },
);
watch(
  () => props.selection,
  () => {
    pending.value = null;
    failed.value = false;
  },
);
async function select(selection: WelfareSelection) {
  emit('select', selection);
  await nextTick();
  heading.value?.focus();
}
function leave() {
  if (!pending.value) return;
  try {
    openLink(pending.value.url);
    pending.value = null;
    failed.value = false;
  } catch {
    failed.value = true;
  }
}
</script>

<template>
  <section class="welfare-panel" :aria-label="t.welfareTitle">
    <template v-if="!guide">
      <h2 ref="heading" tabindex="-1">{{ t.welfareChoose }}</h2>
      <ul class="result-list">
        <li v-for="topic in welfareTopics" :key="topic" class="result-card">
          <h3>{{ welfareGuides[topic].title[locale] }}</h3>
          <p>{{ welfareGuides[topic].summary[locale] }}</p>
          <button
            class="outline-button"
            :aria-label="t.welfareExplore.replace('{name}', welfareGuides[topic].title[locale])"
            @click="select({ topic, section: 'overview' })"
          >
            {{ t.details }}
          </button>
        </li>
      </ul>
    </template>
    <template v-else>
      <h2>{{ guide.title[locale] }}</h2>
      <div class="choices" role="group" :aria-label="t.welfareSections">
        <button
          v-for="section in welfareSections"
          :key="section"
          class="outline-button"
          :aria-pressed="selection.section === section"
          @click="select({ ...selection, section })"
        >
          {{ sectionLabels[section] }}
        </button>
      </div>
      <section class="result-card" :aria-labelledby="`${id}-section`">
        <h3 :id="`${id}-section`" ref="heading" tabindex="-1">
          {{ sectionLabels[selection.section] }}
        </h3>
        <template v-if="selection.section === 'documents'">
          <p class="small-note">{{ t.welfareChecklistHint }}</p>
          <label
            v-for="(item, index) in guide.sections.documents.items"
            :key="index"
            class="welfare-check"
          >
            <input v-model="prepared" type="checkbox" :value="index" />
            <span>{{ item[locale] }}</span>
          </label>
          <p role="status">
            {{
              t.welfareProgress
                .replace('{done}', String(prepared.length))
                .replace('{total}', String(guide.sections.documents.items.length))
            }}
          </p>
        </template>
        <ul v-else class="welfare-list">
          <li v-for="(item, index) in guide.sections[selection.section].items" :key="index">
            {{ item[locale] }}
          </li>
        </ul>
      </section>
      <button class="text-button" @click="select({ topic: 'overview', section: 'overview' })">
        {{ t.welfareAll }}
      </button>
      <p class="small-note">{{ t.welfareScope }}</p>
      <button
        class="outline-button"
        @click="pending = { label: guide.action.label[locale], url: guide.action.url }"
      >
        {{ guide.action.label[locale] }}
      </button>
      <details class="parking-details">
        <summary>{{ t.welfareSources }}</summary>
        <p class="small-note">{{ t.welfareChecked.replace('{date}', WELFARE_CHECKED_AT) }}</p>
        <ul class="welfare-list">
          <li v-for="source in sources" :key="source.id">
            <p>{{ source.agency }} · {{ source.name }}</p>
            <p v-if="source.updated" class="small-note">
              {{ t.welfareUpdated.replace('{date}', source.updated) }}
            </p>
            <button class="text-button" @click="pending = { label: source.name, url: source.url }">
              {{ t.welfareViewSource }}
            </button>
          </li>
        </ul>
        <p class="small-note">{{ t.welfareAttribution }}</p>
      </details>
    </template>
    <div v-if="pending" class="leave-confirm" role="group" :aria-label="t.leaveTitle">
      <p>{{ t.welfareLeave.replace('{name}', pending.label) }}</p>
      <p v-if="failed" role="alert">{{ t.welfareOpenFailed }}</p>
      <div class="action-row">
        <button class="primary-button" @click="leave">
          {{ pending.url.startsWith('tel:') ? t.leaveDial : t.leaveGo }}
        </button>
        <button class="text-button" @click="pending = null">{{ t.leaveStay }}</button>
      </div>
    </div>
  </section>
</template>
