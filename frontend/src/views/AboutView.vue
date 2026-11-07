<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { DEMO_DATA_SOURCES, OPEN_DATA_LICENSE_URL, OPEN_DATA_SOURCES } from '@/data/dataSources';
</script>

<template>
  <main class="p-5 pb-24">
    <h1 class="text-primary-500 text-h1 font-bold mb-2">資料來源</h1>
    <p class="mb-6">本頁列出畫面上使用的資料。示範資料不是真實資料，請勿當作實際服務資訊。</p>

    <section aria-labelledby="open-data-title" class="mb-8">
      <h2 id="open-data-title" class="text-xl font-bold mb-3">開放資料</h2>
      <ul class="grid gap-4">
        <li
          v-for="source in OPEN_DATA_SOURCES"
          :key="source.url"
          class="rounded-lg border border-grey-200 p-4"
        >
          <p class="font-bold">{{ source.name }}</p>
          <dl class="mt-2 grid gap-1">
            <div>
              <dt class="inline font-semibold">提供機關：</dt>
              <dd class="inline">{{ source.agency }}</dd>
            </div>
            <div>
              <dt class="inline font-semibold">用在：</dt>
              <dd class="inline">{{ source.usedIn }}</dd>
            </div>
            <div>
              <dt class="inline font-semibold">資料時間：</dt>
              <dd class="inline">{{ source.dataTime }}</dd>
            </div>
            <div>
              <dt class="inline font-semibold">資料連結：</dt>
              <dd class="inline break-all">
                <a
                  :href="source.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-primary-700 underline"
                >
                  {{ source.url }}
                </a>
              </dd>
            </div>
          </dl>
        </li>
      </ul>
      <p class="mt-4">
        開放資料依《政府資料開放授權條款－第1版》提供，資料提供機關如上表。授權條款全文：
        <a
          :href="OPEN_DATA_LICENSE_URL"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary-700 underline break-all"
        >
          {{ OPEN_DATA_LICENSE_URL }}
        </a>
      </p>
    </section>

    <section aria-labelledby="demo-data-title" class="mb-8">
      <h2 id="demo-data-title" class="text-xl font-bold mb-3">
        <span
          class="inline-block rounded border border-secondary-700 bg-secondary-50 px-2 mr-2 text-base"
        >
          示範資料
        </span>
        示範用的資料
      </h2>
      <p class="mb-3">
        下列資料是放在本專案裡的示範檔案（public/mock/），不是即時資料，資料時間皆未標示。
      </p>
      <ul class="grid gap-3">
        <li v-for="item in DEMO_DATA_SOURCES" :key="item.file" class="rounded-lg bg-grey-50 p-3">
          <p class="font-semibold break-all">{{ item.file }}</p>
          <p>用在：{{ item.usedIn }}</p>
          <p>提供機關：{{ item.agency }}</p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="third-party-title" class="mb-8">
      <h2 id="third-party-title" class="text-xl font-bold mb-3">第三方服務</h2>
      <p>
        地圖畫面使用 Google Maps JavaScript API（程式碼載入自
        maps.googleapis.com）。未設定金鑰時不會顯示地圖。
      </p>
    </section>

    <RouterLink
      :to="{ name: 'home' }"
      class="inline-flex min-h-12 items-center text-primary-700 underline"
    >
      回首頁
    </RouterLink>
  </main>
</template>
