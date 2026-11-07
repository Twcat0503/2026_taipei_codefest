<script setup lang="ts">
defineProps<{
  /** 簡短說明目前缺少哪一部分功能 */
  detail?: string;
}>();
</script>

<template>
  <div role="alert" class="m-5 rounded-lg border border-secondary-600 bg-secondary-50 p-4">
    <p class="font-bold text-grey-950">地圖暫時無法使用</p>
    <p class="mt-1 text-grey-950">
      目前沒有設定地圖服務金鑰，或地圖載入失敗，所以看不到地圖。{{ detail }}
    </p>
  </div>
</template>
