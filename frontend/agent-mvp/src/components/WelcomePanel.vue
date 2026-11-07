<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Locale } from '../agent/types';
import { messages } from '../i18n';
import UiIcon from './UiIcon.vue';
import VoiceWave from './VoiceWave.vue';
import governmentIllustration from '../../../../assets/svg/Illustrations_gov.svg';

const props = defineProps<{
  locale: Locale;
  disabled: boolean;
  voiceDisabled: boolean;
  hasTask: boolean;
  nearbyParking: boolean;
  nearbyParkingDisabled: boolean;
  native: boolean;
  modelNeedsStart: boolean;
  modelStarting: boolean;
  modelStatus: string;
}>();
defineEmits<{
  request: [text: string];
  voice: [];
  resume: [];
  startModel: [];
  nearbyParking: [];
}>();
const t = computed(() => messages[props.locale]);
const panel = ref<HTMLElement>();
const suggestionStage = ref<HTMLElement>();
const measurement = ref<HTMLElement>();
const voiceButton = ref<HTMLButtonElement>();
const modelButton = ref<HTMLButtonElement>();
const modelFontSize = ref(16);
const voiceFontSize = ref(30);
const compact = ref(false);
const visibleCount = ref(3);
const primaryLabel = computed(() => t.value.voiceButton);
let observer: ResizeObserver | undefined;
let frame = 0;
let canvas: HTMLCanvasElement | undefined;
async function measure() {
  if (!panel.value) return;
  const scale = parseFloat(getComputedStyle(panel.value).fontSize);
  compact.value = panel.value.clientHeight < scale * (props.locale === 'en' ? 40 : 34);
  await nextTick();
  if (voiceButton.value) {
    const button = voiceButton.value;
    const style = getComputedStyle(button);
    const icon = button.querySelector('.voice-wave, .voice-resume-icon');
    const available =
      button.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      (icon?.getBoundingClientRect().width ?? 0) -
      parseFloat(style.columnGap);
    const maximum = Math.min(scale * 1.875, 40);
    canvas ??= document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `700 ${maximum}px ${style.fontFamily}`;
      voiceFontSize.value = Math.max(
        1,
        Math.min(
          maximum,
          ((maximum * available) / context.measureText(primaryLabel.value).width) * 0.97,
        ),
      );
    }
    await nextTick();
  }
  if (modelButton.value) {
    const button = modelButton.value;
    const style = getComputedStyle(button);
    const available =
      button.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight) -
      (button.querySelector('svg')?.getBoundingClientRect().width ?? 0) -
      (parseFloat(style.columnGap) || 0);
    const maximum = Math.min(scale, 28);
    canvas ??= document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `700 ${maximum}px ${style.fontFamily}`;
      modelFontSize.value = Math.max(
        1,
        Math.min(
          maximum,
          ((maximum * available) / context.measureText(t.value.phoneStart).width) * 0.97,
        ),
      );
    }
  }
  if (!suggestionStage.value || !measurement.value) return;
  const heights = Array.from(
    measurement.value.children,
    (child) => child.getBoundingClientRect().height,
  );
  const list = suggestionStage.value.querySelector('.welcome-suggestions');
  const gap = list ? parseFloat(getComputedStyle(list).rowGap) : 16;
  const available = suggestionStage.value.clientHeight;
  let count = 3;
  while (count > 0 && Math.max(...heights.slice(0, count)) * count + gap * (count - 1) > available)
    count--;
  visibleCount.value = count;
}
function scheduleMeasure() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => void measure());
}
onMounted(() => {
  observer = new ResizeObserver(scheduleMeasure);
  if (panel.value) observer.observe(panel.value);
  if (suggestionStage.value) observer.observe(suggestionStage.value);
  if (voiceButton.value) observer.observe(voiceButton.value);
  if (modelButton.value) observer.observe(modelButton.value);
  for (const child of measurement.value?.children ?? []) observer.observe(child);
  scheduleMeasure();
});
watch(
  () => [props.locale, props.hasTask, props.modelNeedsStart, props.modelStatus],
  async () => {
    await nextTick();
    scheduleMeasure();
  },
);
watch(primaryLabel, scheduleMeasure);
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
});
const suggestions = computed(() => [
  ...(props.hasTask
    ? [{ title: t.value.continueConversation, hint: t.value.resumeHint, action: 'resume' as const }]
    : []),
  ...(props.nearbyParking
    ? [
        {
          title: t.value.nearestParking,
          hint: t.value.nearestParkingHint,
          action: 'parking' as const,
        },
      ]
    : []),
  { title: t.value.rehabRequest, hint: t.value.rehabHint, action: 'request' as const },
  { title: t.value.benefitsRequest, hint: t.value.benefitsHint, action: 'request' as const },
  { title: t.value.accessibleRequest, hint: t.value.accessibleHint, action: 'request' as const },
]);
const visibleSuggestions = computed(() => suggestions.value.slice(0, visibleCount.value));
</script>

<template>
  <section
    ref="panel"
    class="welcome-panel"
    :class="{ 'is-compact': compact, 'is-native': native }"
    aria-labelledby="welcome-title"
  >
    <div class="welcome-banner">
      <div class="welcome-brand">
        <div class="welcome-lockup">
          <div class="welcome-copy">
            <div class="welcome-heading">
              <h1 id="welcome-title">{{ t.welcomeTitle }}</h1>
              <span class="townpass-wordmark" aria-hidden="true">
                <span><b>TOWN</b> PASS</span><strong>城 市 通</strong>
              </span>
            </div>
            <p>{{ t.welcomeProduct }}</p>
          </div>
          <img :src="governmentIllustration" width="100" height="80" alt="" />
        </div>
      </div>
    </div>
    <div v-if="!compact" class="suggestions-header">
      <h2 class="suggestions-heading"><UiIcon name="help" />{{ t.welcomeSuggestions }}</h2>
    </div>
    <div ref="suggestionStage" class="suggestion-stage">
      <div ref="measurement" class="suggestion-measure" aria-hidden="true" inert>
        <div
          v-for="suggestion in suggestions"
          :key="suggestion.title"
          class="welcome-suggestion"
          :class="{ 'is-resume': suggestion.action === 'resume' }"
        >
          <UiIcon name="chat" /><span
            ><strong>{{ suggestion.title }}</strong
            ><small>{{ suggestion.hint }}</small></span
          >
        </div>
      </div>
      <div v-if="visibleCount" class="welcome-suggestions">
        <button
          v-for="suggestion in visibleSuggestions"
          :key="suggestion.title"
          class="welcome-suggestion"
          :class="{ 'is-resume': suggestion.action === 'resume' }"
          :disabled="
            suggestion.action === 'parking'
              ? nearbyParkingDisabled
              : suggestion.action === 'request' && disabled
          "
          :aria-label="suggestion.title"
          @click="
            suggestion.action === 'resume'
              ? $emit('resume')
              : suggestion.action === 'parking'
                ? $emit('nearbyParking')
                : $emit('request', suggestion.title)
          "
        >
          <UiIcon :name="suggestion.action === 'resume' ? 'clock' : 'chat'" />
          <span
            ><strong>{{ suggestion.title }}</strong
            ><small>{{ suggestion.hint }}</small></span
          >
        </button>
      </div>
    </div>
    <button
      v-if="modelNeedsStart"
      ref="modelButton"
      class="outline-button model-launch"
      :disabled="modelStarting"
      :aria-label="t.phoneStart"
      @click="$emit('startModel')"
    >
      <UiIcon name="settings" />
      <span :style="{ fontSize: `${modelFontSize}px` }">{{ t.phoneStart }}</span>
    </button>
    <p v-if="modelNeedsStart" class="model-hint" :class="{ 'sr-only': hasTask }" role="status">
      {{ modelStatus }}
    </p>
    <button
      ref="voiceButton"
      class="voice-launch"
      :disabled="voiceDisabled"
      :aria-label="t.voiceLabel"
      @click="$emit('voice')"
    >
      <VoiceWave />
      <span class="voice-label" :style="{ fontSize: `${voiceFontSize}px` }">{{
        primaryLabel
      }}</span>
    </button>
  </section>
</template>
