<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Locale, TaskState } from '../agent/types';
import { billCategories, type BillCategory, type BillSelection } from '../agent/skills/bills';
import { messages } from '../i18n';
import { billServiceUrl, requestNativeBillPage } from '../platform/service-navigation';
const props = defineProps<{ state: TaskState; locale: Locale }>();
const emit = defineEmits<{ select: [category: BillSelection]; retry: [] }>();
const t = computed(() => messages[props.locale]);
const navigation = ref<'billNavigationRequested' | 'billNavigationFailed' | null>(null);
watch(
  () => [props.state.billResult, props.state.pendingBillCategory],
  () => {
    navigation.value = null;
  },
);
const categoryEntries = Object.entries(billCategories) as [
  BillCategory,
  (typeof billCategories)[BillCategory],
][];
const links = computed(() =>
  categoryEntries.filter(
    ([key]) => props.state.billQuery?.category === 'all' || props.state.billQuery?.category === key,
  ),
);
const retry = computed(
  () =>
    props.state.billQuery &&
    ['billAuth', 'billUnavailable', 'cancelled', 'error'].includes(props.state.notice),
);
function open(event: MouseEvent, category: BillCategory | 'history') {
  if (!window.flutterObject) return;
  event.preventDefault();
  try {
    requestNativeBillPage(category);
    navigation.value = 'billNavigationRequested';
  } catch {
    navigation.value = 'billNavigationFailed';
  }
}
const updatedAt = (value: string) =>
  new Intl.DateTimeFormat(props.locale === 'en' ? 'en-US' : 'zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
const money = (amount: number) =>
  new Intl.NumberFormat(props.locale === 'en' ? 'en-US' : 'zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(amount);
</script>

<template>
  <section class="bill-panel" :aria-label="t.billTitle">
    <div
      v-if="state.pendingBillCategory"
      class="bill-options"
      role="group"
      :aria-label="t.billCategory"
    >
      <button
        v-for="[key, item] in categoryEntries"
        :key="key"
        class="outline-button"
        @click="emit('select', key)"
      >
        {{ item.label[locale] }}
      </button>
      <button class="outline-button" @click="emit('select', 'all')">{{ t.billAll }}</button>
    </div>
    <template v-if="state.billResult">
      <p class="notice-box">{{ t.billDemo }}</p>
      <p>
        {{ t.billAsOf }}
        <time :datetime="state.billResult.asOf">{{ updatedAt(state.billResult.asOf) }}</time>
      </p>
      <ul class="result-list bill-list">
        <li v-for="(bill, index) in state.billResult.records" :key="bill.id">
          <h3>
            {{ billCategories[bill.category].label[locale] }} · {{ t.billItem }} {{ index + 1 }}
          </h3>
          <dl>
            <dt>{{ t.billPeriod }}</dt>
            <dd>{{ bill.periodLabel }}</dd>
            <dt>{{ t.billAmount }}</dt>
            <dd>{{ money(bill.amount) }}</dd>
            <dt>{{ t.billDue }}</dt>
            <dd>{{ bill.dueDate }}</dd>
            <dt>{{ t.billStatus }}</dt>
            <dd>
              <strong>{{ t[`billStatus_${bill.status}`] }}</strong>
            </dd>
          </dl>
          <p v-if="bill.status === 'unknown' || bill.status === 'processing'">
            {{ t.billStatusCaution }}
          </p>
        </li>
      </ul>
    </template>
    <button v-if="retry" class="outline-button" @click="emit('retry')">{{ t.billRetry }}</button>
    <div v-if="state.billQuery || state.notice === 'billUnsupported'" class="bill-links">
      <h3>{{ t.billServicePages }}</h3>
      <p>{{ t.billNavigationHint }}</p>
      <a
        v-for="[key, item] in links"
        :key="key"
        :href="billServiceUrl(key)"
        class="outline-button"
        @click="open($event, key)"
        >{{ t.billOpen }}{{ item.label[locale] }}</a
      >
      <a
        :href="billServiceUrl('history')"
        class="outline-button"
        @click="open($event, 'history')"
        >{{ t.billHistory }}</a
      >
    </div>
    <p v-if="navigation" role="status">{{ t[navigation] }}</p>
  </section>
</template>
