<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Locale } from '../agent/types';
import { townpassSuggestionGroups } from '../agent/suggestion-groups';
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
  modelStatus: string;
}>();
defineEmits<{
  request: [text: string];
  voice: [];
  resume: [];
  nearbyParking: [];
}>();
const t = computed(() => messages[props.locale]);
const panel = ref<HTMLElement>();
const suggestionStage = ref<HTMLElement>();
const measurement = ref<HTMLElement>();
const voiceButton = ref<HTMLButtonElement>();
const voiceFontSize = ref(30);
const compact = ref(false);
const visibleCount = ref(3);
const suggestionGroup = ref(0);
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
  ...(suggestionGroup.value === 0 && props.nearbyParking
    ? [
        {
          title: t.value.nearestParking,
          hint: t.value.nearestParkingHint,
          action: 'parking' as const,
        },
      ]
    : []),
  ...(suggestionGroup.value === 0
    ? [
        { title: t.value.toiletSuggestion, hint: t.value.toiletHint, action: 'request' as const },
        {
          title: t.value.disabledSuggestion,
          hint: t.value.disabledHint,
          action: 'information' as const,
        },
      ]
    : suggestionGroup.value === 1
      ? [
          {
            title: t.value.pregnancyParkingSuggestion,
            hint: t.value.pregnancyParkingHint,
            action: 'request' as const,
            request: '附近有孕婦車位的停車場',
          },
          {
            title: t.value.youbikeSuggestion,
            hint: t.value.youbikeHint,
            action: 'request' as const,
            request: '附近的 YouBike',
          },
          {
            title: t.value.elderlySuggestion,
            hint: t.value.elderlyHint,
            action: 'request' as const,
            request: '長輩可以申請什麼補助',
          },
        ]
      : townpassSuggestionGroups[suggestionGroup.value - 2]!.map((item) => ({
          title: t.value[item.key],
          hint: item.demo ? t.value.suggestionDemoHint : t.value.suggestionServiceHint,
          action: 'request' as const,
          request: item.request,
        }))),
]);
const visibleSuggestions = computed(() => suggestions.value.slice(0, visibleCount.value));
watch(suggestionGroup, async () => {
  await nextTick();
  scheduleMeasure();
});
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
      <button
        class="suggestion-refresh"
        type="button"
        data-suggestion-guide="refresh"
        @click="suggestionGroup = (suggestionGroup + 1) % (2 + townpassSuggestionGroups.length)"
      >
        {{ t.moreSuggestions }}
      </button>
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
            suggestion.action === 'parking' || suggestion.action === 'information'
              ? nearbyParkingDisabled
              : suggestion.action === 'request' && disabled
          "
          :aria-label="suggestion.title"
          :data-suggestion-guide="
            suggestion.action === 'request'
              ? suggestionGroup >= 2
                ? 'demo'
                : 'request'
              : undefined
          "
          @click="
            suggestion.action === 'resume'
              ? $emit('resume')
              : suggestion.action === 'parking'
                ? $emit('nearbyParking')
                : $emit(
                    'request',
                    ('request' in suggestion && suggestion.request) || suggestion.title,
                  )
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
    <p v-if="modelNeedsStart" class="model-hint" role="status">
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
