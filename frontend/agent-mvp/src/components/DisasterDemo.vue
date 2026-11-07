<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import type { Locale } from '../agent/types';
import { messages } from '../i18n';
import examplePhoto from '../assets/disaster-example.png';

const props = defineProps<{ locale: Locale }>();
defineEmits<{ exit: [] }>();
const t = computed(() => messages[props.locale]);
const stage = ref<'location' | 'obstruction' | 'photo'>('location');
const customPlace = ref(false);
const place = ref('');
const focusTarget = ref<HTMLElement>();
const choices = ['disasterBlocked', 'disasterPartial', 'disasterClear', 'disasterUnsure'] as const;
const selected = ref<(typeof choices)[number]>('disasterBlocked');
const localPhoto = ref('');
const photoError = ref(false);
async function focusStep() {
  await nextTick();
  focusTarget.value?.focus({ preventScroll: true });
  focusTarget.value?.scrollIntoView({ block: 'nearest' });
}
function choose(value: (typeof choices)[number]) {
  selected.value = value;
  stage.value = 'photo';
}
function changePhoto(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    photoError.value = true;
    return;
  }
  try {
    const url = URL.createObjectURL(file);
    if (localPhoto.value) URL.revokeObjectURL(localPhoto.value);
    localPhoto.value = url;
    photoError.value = false;
  } catch {
    photoError.value = true;
  }
}
onBeforeUnmount(() => {
  if (localPhoto.value) URL.revokeObjectURL(localPhoto.value);
});
</script>

<template>
  <section class="disaster-demo" :aria-label="t.disasterShortcut">
    <p class="demo-disclosure">{{ t.disasterNotice }}</p>
    <Transition name="content-fade" mode="out-in" @after-enter="focusStep">
      <div :key="stage" ref="focusTarget" class="disaster-step" tabindex="-1">
        <template v-if="stage === 'location'">
          <p class="reply-bubble">{{ t.disasterLocation }}</p>
          <div v-if="!customPlace" class="disaster-choices choice-row">
            <button class="primary-button" @click="stage = 'obstruction'">
              {{ t.disasterYes }}
            </button>
            <button class="outline-button" @click="customPlace = true">{{ t.disasterNo }}</button>
          </div>
          <form v-else class="location-preview-form" @submit.prevent="stage = 'obstruction'">
            <label for="demo-place">{{ t.disasterPlaceLabel }}</label>
            <input
              id="demo-place"
              v-model="place"
              required
              maxlength="100"
              aria-describedby="demo-place-hint"
            />
            <p id="demo-place-hint" class="small-note">{{ t.disasterPlaceHint }}</p>
            <button class="primary-button" :disabled="!place.trim()">
              {{ t.disasterContinue }}
            </button>
          </form>
        </template>
        <template v-else-if="stage === 'obstruction'">
          <div class="user-message">{{ customPlace ? place : t.disasterYes }}</div>
          <p class="reply-bubble">{{ t.disasterObstruction }}</p>
          <div class="disaster-choices">
            <button
              v-for="(choice, index) in choices"
              :key="choice"
              :class="index === 0 ? 'primary-button' : 'outline-button'"
              @click="choose(choice)"
            >
              {{ t[choice] }}
            </button>
          </div>
        </template>
        <template v-else>
          <img
            class="disaster-photo"
            :src="localPhoto || examplePhoto"
            :alt="localPhoto ? t.disasterUploadAlt : t.disasterSampleAlt"
            width="362"
            height="283"
            @error="photoError = true"
          />
          <p class="reply-bubble">{{ t.disasterSummary.replace('{choice}', t[selected]) }}</p>
          <details class="photo-options">
            <summary>{{ t.disasterPhotoLabel }}</summary>
            <label class="sr-only" for="demo-photo">{{ t.disasterPhotoLabel }}</label>
            <input
              id="demo-photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-describedby="photo-hint"
              @change="changePhoto"
            />
            <p id="photo-hint" class="small-note">{{ t.disasterPhotoHint }}</p>
          </details>
          <p v-if="photoError" role="alert" class="notice-box">{{ t.disasterPhotoError }}</p>
          <button class="text-button" @click="stage = 'obstruction'">{{ t.disasterChange }}</button>
        </template>
      </div>
    </Transition>
    <button class="text-button disaster-exit" @click="$emit('exit')">{{ t.disasterExit }}</button>
  </section>
</template>
