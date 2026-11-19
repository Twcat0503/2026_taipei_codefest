<script setup lang="ts">
/**
 * Quick suggestion chips. The app renders them above the input and again after the conversation;
 * style.css shows one of the two depending on how tall the screen is for the text size.
 */
defineProps<{
  label: string;
  moreLabel: string;
  suggestions: { label: string; request: string; accessible?: string }[];
  guide: 'demo' | 'request';
  disabled: boolean;
}>();
defineEmits<{ pick: [request: string]; more: [] }>();
</script>

<template>
  <div class="quick-chips" role="group" :aria-label="label">
    <button
      v-for="suggestion in suggestions"
      :key="suggestion.request"
      :disabled="disabled"
      :aria-label="suggestion.accessible ?? suggestion.request"
      :data-suggestion-guide="guide"
      @click="$emit('pick', suggestion.request)"
    >
      <span aria-hidden="true"></span>{{ suggestion.label }}
    </button>
    <button type="button" data-suggestion-guide="refresh" @click="$emit('more')">
      {{ moreLabel }}
    </button>
  </div>
</template>
