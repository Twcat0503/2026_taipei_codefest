<script setup lang="ts">
import { ref } from 'vue';
import { useFontSize } from '@/composables/useFontSize';

const { levels, current, setFontSize } = useFontSize();

const isOpen = ref(false);
</script>

<template>
  <!-- 放在頁面最上方、佔用版面而不是浮在內容上：浮動按鈕會蓋住各頁底部固定的操作列。 -->
  <div class="flex flex-col items-end gap-2 px-4 pt-2">
    <button
      type="button"
      aria-controls="font-size-panel"
      :aria-expanded="isOpen"
      class="min-h-12 min-w-12 rounded-full bg-primary-800 px-3 font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-800"
      @click="isOpen = !isOpen"
    >
      字級
    </button>
    <div
      v-if="isOpen"
      id="font-size-panel"
      role="group"
      aria-label="字級大小"
      class="flex flex-wrap justify-end gap-1 rounded-lg bg-white p-2 border border-grey-200"
    >
      <button
        v-for="level in levels"
        :key="level.id"
        type="button"
        :aria-pressed="current === level.id"
        class="min-h-12 min-w-12 rounded-lg px-3 font-bold border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-800"
        :class="
          current === level.id
            ? 'bg-primary-800 text-white border-primary-800'
            : 'bg-white text-grey-950 border-grey-500'
        "
        @click="setFontSize(level.id)"
      >
        {{ level.label }}
      </button>
    </div>
  </div>
</template>
