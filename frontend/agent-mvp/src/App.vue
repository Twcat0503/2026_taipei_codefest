<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import BillPanel from './components/BillPanel.vue';
import { billCategories, billReadTool, type BillSelection } from './agent/skills/bills';
import { withDemoBills } from './agent/tool-client';
import PhoneModelPanel from './components/PhoneModelPanel.vue';
import { PhoneModel, type PhoneState } from './agent/phone-model';
import UiIcon from './components/UiIcon.vue';
import { messages } from './i18n';
import { branches } from './agent/catalog';
import {
  initialState,
  type Locale,
  type Localized,
  type ModelAdapter,
  type Navigation,
  type TaskState,
} from './agent/types';
import { AgentRunner } from './agent/runner';
import { followUps } from './agent/follow-ups';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { DemoModel, LocalModel } from './agent/model';
import { cancelDraft, changeBranch, confirmReservation, prepareReservation } from './agent/tools';
import { clearTask, getPreference, restoreTask, saveTask, setPreference } from './platform/storage';
import { canReadAloud, readAloud, stopReading } from './platform/speech';
import { getLocation, openLink } from './platform/location';
import { serviceOrigin } from './platform/service-navigation';
import { PREFILL_SLOTS } from './agent/prefill';
import {
  forgetWaterNumber,
  formatWaterNumber,
  loadProfile,
  normalizeWaterNumber,
  rememberWaterNumber,
} from './platform/profile';
import { maskIdNo, readMember, type Member } from './platform/member';
import { EMERGENCY_NUMBERS } from './agent/skills/emergency';

const EMERGENCY_TEXT = {
  fire: 'emergencyFire',
  medical: 'emergencyMedical',
  violence: 'emergencyViolence',
  police: 'emergencyPolice',
  mental: 'emergencyMental',
} as const;
const CALL_LABEL: Record<string, 'call119' | 'call110' | 'call113' | 'call1925'> = {
  '119': 'call119',
  '110': 'call110',
  '113': 'call113',
  '1925': 'call1925',
};

const locale = ref<Locale>(
  getPreference('tp-language', 'zh-Hant-TW') === 'en' ? 'en' : 'zh-Hant-TW',
);
const fontSize = ref(
  ['1', '1.25', '1.5'].includes(getPreference('tp-font', '1'))
    ? getPreference('tp-font', '1')
    : '1',
);
const t = computed(() => messages[locale.value]);
const state = reactive(initialState());
const resumed = ref(restoreTask(state));
const input = ref('');
const lastRequest = ref('');
const busy = ref(false);
const stage = ref<'routing' | 'searching'>('routing');
const resultHeading = ref<HTMLElement>();
const phoneState = ref<PhoneState>({ phase: 'idle', ready: false, error: null });
const phone = new PhoneModel((value) => {
  phoneState.value = value;
});
const phoneStarting = ref(false);
const mode = ref<ModelAdapter['mode']>(
  window.flutterObject ? 'phone' : import.meta.env.VITE_MODEL_ENDPOINT ? 'local' : 'demo',
);
const selectedMode = ref(mode.value);
const endpoint = ref(
  import.meta.env.VITE_MODEL_ENDPOINT || 'http://127.0.0.1:11434/v1/chat/completions',
);
const modelName = ref(import.meta.env.VITE_MODEL_NAME || 'qwen3:1.7b');
const configStatus = ref<'applied' | 'configError' | null>(null);
let adapter: ModelAdapter =
  mode.value === 'phone'
    ? phone
    : mode.value === 'local'
      ? new LocalModel(
          endpoint.value,
          modelName.value,
          20000,
          import.meta.env.VITE_MODEL_PROTOCOL === 'tools' ? 'tools' : 'json-schema',
        )
      : new DemoModel();
// 預設只用真實資料：官方即時／開放資料與官方入口，不拿模擬資料回答使用者。
// 開發時 VITE_TOOL_SOURCE=townpass-demo 可加回示範站資料與示範帳單，=demo 則為完全虛構的資料。
const toolSource = import.meta.env.VITE_TOOL_SOURCE;
const realData = toolSource !== 'demo' && toolSource !== 'townpass-demo';
const toolClient =
  toolSource === 'demo'
    ? undefined
    : toolSource === 'townpass-demo'
      ? withDemoBills(createAgentToolClient({ getLocation }), billReadTool)
      : createAgentToolClient({ getLocation, includeDemo: false });
let runner = new AgentRunner(adapter, state, toolClient);
const speechSupported = ref(canReadAloud());
const speaking = ref(false);
const speechFailed = ref(false);
const rate = ref('0.9');
const shownBooks = computed(() => state.bookResults);
const activeBook = computed(() =>
  state.bookResults.find((book) => book.id === (state.draft?.bookId ?? state.receipt?.bookId)),
);
const activeBranch = computed(() =>
  branches.find((branch) => branch.id === state.receipt?.branchId),
);
const noticeText = (notice: TaskState['notice']) =>
  realData && notice === 'unsupported'
    ? t.value.unsupportedReal
    : realData && notice === 'empty'
      ? t.value.emptyReal
      : t.value[notice];
const reply = computed(() => noticeText(state.notice));
const suggestions = computed(() =>
  realData
    ? [
        t.value.toiletSuggestion,
        t.value.parkingSuggestion,
        t.value.petitionSuggestion,
        t.value.paySuggestion,
        t.value.counter,
        t.value.bookSuggestion,
        t.value.disabledSuggestion,
        t.value.browseServices,
      ]
    : [
        t.value.browseBills,
        t.value.browseBooks,
        t.value.browseServices,
        t.value.counter,
        t.value.feeSuggestion,
        t.value.youbikeSuggestion,
        t.value.perkSuggestion,
      ],
);
// Leaving the assistant always needs a second, explicit tap.
const confirmingLink = ref<string | null>(null);
const leftFor = ref<string | null>(null);
const hostOf = (url: string) => (url.startsWith('tel:') ? url.slice(4) : new URL(url).host);
// In-app Town Pass pages are named by service, not by the demo host they happen to load from.
const leaveQuestion = (record: TaskState['records'][number]) =>
  record.url?.startsWith(`${serviceOrigin}/`)
    ? t.value.leaveAskApp.replace('{name}', record.title[locale.value])
    : t.value.leaveAsk.replace('{host}', hostOf(record.url ?? ''));
// Details the assistant fills in for the destination, so people do not type them again.
const profile = ref(loadProfile());
const member = ref<Member | 'loading' | 'unavailable' | null>(null);
const waterInput = ref('');
const rememberWater = ref(true);
const editingWater = ref(false);
const waterError = ref(false);
const slots = computed(() => (state.navigation ? (PREFILL_SLOTS[state.navigation.id] ?? []) : []));
watch(
  () => state.navigation?.id,
  async () => {
    waterInput.value = '';
    editingWater.value = false;
    waterError.value = false;
    member.value = null;
    if (!slots.value.some((slot) => slot.source === 'member')) return;
    member.value = 'loading';
    member.value = (await readMember()) ?? 'unavailable';
  },
);
function goNavigation() {
  if (!state.navigation) return;
  const prefill: Record<string, string> = {};
  for (const slot of slots.value) {
    if (slot.field === 'water_number') {
      const typed = waterInput.value.trim();
      if (typed) {
        const digits = normalizeWaterNumber(typed);
        if (!digits) {
          waterError.value = true;
          return;
        }
        prefill.water_number = digits;
        if (rememberWater.value) {
          rememberWaterNumber(digits);
          profile.value = loadProfile();
        }
      } else if (profile.value.waterNumber && !editingWater.value)
        prefill.water_number = profile.value.waterNumber;
    } else if (typeof member.value === 'object' && member.value) prefill.tax_id = member.value.idNo;
  }
  go(state.navigation.url, prefill);
}
function forgetWater() {
  forgetWaterNumber();
  profile.value = loadProfile();
}
function go(url: string, prefill?: Record<string, string>) {
  openLink(url, prefill);
  leftFor.value = url;
  confirmingLink.value = null;
}
function stay() {
  if (state.navigation) {
    state.navigation = null;
    state.notice = 'navigationDeclined';
  }
  confirmingLink.value = null;
}
const inputDisabled = computed(
  () => busy.value || !!state.draft || (mode.value === 'phone' && !phoneState.value.ready),
);
// Tap-to-answer choices: missing details (district, bill type) or what to do next.
const choices = computed(() => (busy.value || state.draft ? null : followUps(state)));
const showSuggestions = computed(
  () =>
    !busy.value &&
    !state.draft &&
    !state.receipt &&
    ['welcome', 'unsupported', 'empty', 'error', 'cancelled', 'navigationDeclined'].includes(
      state.notice,
    ),
);

// 對話紀錄只留在記憶體，不寫入 localStorage。
type Turn = {
  id: number;
  request: string;
  notice: TaskState['notice'];
  books: TaskState['bookResults'];
  records: TaskState['records'];
  navigation: Navigation | null;
  source: TaskState['source'];
  bills: TaskState['billResult'];
  failure: TaskState['failure'];
  traces: TaskState['traces'];
  reference?: string;
  receiptBook?: Localized;
};
const turns = ref<Turn[]>([]);
let nextTurnId = 0;
function archiveTurn() {
  if (!lastRequest.value && state.notice === 'welcome') return;
  const finished = !!state.receipt;
  turns.value.push({
    id: nextTurnId++,
    request: lastRequest.value,
    notice: state.notice,
    books: finished ? [] : state.bookResults,
    records: state.records,
    navigation: state.navigation,
    source: state.source,
    bills: state.billResult,
    failure: state.failure,
    traces: state.traces,
    reference: state.receipt?.reference,
    receiptBook: finished ? activeBook.value?.title : undefined,
  });
}

watch(
  [locale, fontSize],
  () => {
    document.documentElement.lang = locale.value;
    document.documentElement.style.fontSize = `${Number(fontSize.value) * 100}%`;
    document.title = `${t.value.brand} · ${t.value.product}`;
    setPreference('tp-language', locale.value);
    setPreference('tp-font', fontSize.value);
    stopReading();
    speaking.value = false;
  },
  { immediate: true },
);
watch(
  () => [state.draft, state.receipt],
  () => saveTask(state),
  { deep: true },
);

async function focusResult() {
  await nextTick();
  resultHeading.value?.focus({ preventScroll: true });
  resultHeading.value?.scrollIntoView({ block: 'start' });
}
async function submit(text = input.value) {
  if (inputDisabled.value || !text.trim()) return;
  stopReading();
  speaking.value = false;
  archiveTurn();
  lastRequest.value = text.trim();
  input.value = '';
  confirmingLink.value = null;
  leftFor.value = null;
  resumed.value = false;
  busy.value = true;
  await focusResult();
  try {
    await runner.run(text.trim(), (value) => (stage.value = value));
  } catch {
    /* Runner exposes a localized, non-sensitive error state. */
  } finally {
    busy.value = false;
    saveTask(state);
    await focusResult();
  }
}
async function showBookDetails(bookId: string) {
  if (inputDisabled.value) return;
  archiveTurn();
  busy.value = true;
  await focusResult();
  try {
    await runner.runTool('library', 'get_library_book', { book_id: bookId });
  } catch {
    /* Runner exposes a localized, non-sensitive error state. */
  } finally {
    busy.value = false;
    await focusResult();
  }
}
function onEnter(event: KeyboardEvent) {
  // 中文輸入法選字時的 Enter 不算送出。
  if (event.isComposing) return;
  event.preventDefault();
  void submit();
}
async function billAction(category?: BillSelection) {
  if (busy.value) return;
  stopReading();
  speaking.value = false;
  busy.value = true;
  stage.value = 'searching';
  try {
    if (category) await runner.chooseBillCategory(category, (value) => (stage.value = value));
    else await runner.retryBills((value) => (stage.value = value));
  } catch {
    /* Runner exposes the error state. */
  } finally {
    busy.value = false;
    await focusResult();
  }
}
function prepare(bookId: string) {
  prepareReservation(state, bookId, branches[0]!.id);
  void focusResult();
}
function updateBranch(event: Event) {
  changeBranch(state, (event.target as HTMLSelectElement).value);
}
function confirm() {
  if (state.draft) {
    confirmReservation(state, state.draft.id);
    void focusResult();
  }
}
function reset() {
  if (busy.value) return;
  stopReading();
  speaking.value = false;
  clearTask();
  Object.assign(state, initialState());
  turns.value = [];
  resumed.value = false;
  lastRequest.value = '';
  input.value = '';
}
async function applyConfig() {
  if (busy.value) return;
  try {
    if (mode.value === 'phone' && selectedMode.value !== 'phone') await phone.stop();
    adapter =
      selectedMode.value === 'phone'
        ? phone
        : selectedMode.value === 'local'
          ? new LocalModel(
              endpoint.value,
              modelName.value,
              20000,
              import.meta.env.VITE_MODEL_PROTOCOL === 'tools' ? 'tools' : 'json-schema',
            )
          : new DemoModel();
    runner = new AgentRunner(adapter, state, toolClient);
    mode.value = selectedMode.value;
    configStatus.value = 'applied';
  } catch {
    configStatus.value = 'configError';
  }
}
async function startPhone() {
  if (phoneStarting.value || busy.value) return;
  phoneStarting.value = true;
  try {
    await phone.start();
  } catch {
    /* Adapter publishes a redacted error state. */
  } finally {
    phoneStarting.value = false;
  }
}
async function stopPhone() {
  runner.cancel();
  try {
    await phone.stop();
  } catch {
    /* Keep the visible error and retry control. */
  }
}
async function refreshPhone() {
  try {
    await phone.refresh();
  } catch {
    /* Adapter exposes status errors. */
  }
}
function speak() {
  if (speaking.value) {
    stopReading();
    speaking.value = false;
    return;
  }
  speechFailed.value = false;
  speaking.value = true;
  const extra = state.draft
    ? `${activeBook.value?.title[locale.value]}. ${branches.find((branch) => branch.id === state.draft?.branchId)?.name[locale.value]}. ${t.value.simulated}`
    : state.receipt
      ? `${activeBook.value?.title[locale.value]}. ${activeBranch.value?.name[locale.value]}. ${state.receipt.reference}`
      : [
          ...(state.billResult?.records.map(
            (bill) =>
              `${billCategories[bill.category].label[locale.value]}. ${bill.periodLabel}. ${bill.amount} TWD. ${t.value[`billStatus_${bill.status}`]}`,
          ) ?? []),
          ...shownBooks.value.map((book) => book.title[locale.value]),
          ...(state.navigation
            ? [
                `${state.navigation.title[locale.value]}. ${state.navigation.description?.[locale.value] ?? ''}`,
              ]
            : []),
          ...state.records.map(
            (record) =>
              `${record.title[locale.value]}. ${record.description?.[locale.value] ?? ''}`,
          ),
        ].join('。');
  // Screen-reader and TTS users hear the choices too, not just sighted users.
  const choiceText = choices.value
    ? `${choices.value.prompt[locale.value]}：${choices.value.options.map((o) => o.label[locale.value]).join('、')}`
    : '';
  readAloud(
    `${reply.value} ${extra} ${choiceText}`,
    locale.value,
    Number(rate.value),
    () => (speaking.value = false),
    () => {
      speaking.value = false;
      speechFailed.value = true;
    },
  );
}
onBeforeUnmount(() => {
  runner.cancel();
  if (mode.value === 'phone')
    void phone
      .stop()
      .catch(() => {})
      .finally(() => phone.dispose());
  else phone.dispose();
  stopReading();
});
</script>

<template>
  <a class="skip-link" href="#request">{{ t.skip }}</a>
  <header class="chat-header">
    <h1>{{ t.product }}</h1>
    <div class="header-actions">
      <button
        class="icon-button"
        :disabled="busy"
        :aria-label="t.newTask"
        :title="t.newTask"
        @click="reset"
      >
        <UiIcon name="plus" />
      </button>
      <details class="settings">
        <summary>{{ t.settings }}</summary>
        <div class="settings-panel">
          <label
            >{{ t.font
            }}<select v-model="fontSize" :aria-label="t.font">
              <option value="1">{{ t.normal }}</option>
              <option value="1.25">{{ t.large }}</option>
              <option value="1.5">{{ t.largest }}</option>
            </select></label
          >
          <label
            >{{ t.language
            }}<select v-model="locale" :aria-label="t.language">
              <option value="zh-Hant-TW">繁體中文</option>
              <option value="en">English</option>
            </select></label
          >
          <label v-if="speechSupported"
            >{{ t.rate
            }}<select v-model="rate" :aria-label="t.rate">
              <option value="0.7">{{ t.slow }}</option>
              <option value="0.9">{{ t.standardRate }}</option>
            </select></label
          >
          <p v-else class="small-note">{{ t.speechUnavailable }}</p>

          <section class="remembered" aria-labelledby="remembered-title">
            <h2 id="remembered-title">{{ t.rememberedTitle }}</h2>
            <p v-if="!profile.waterNumber" class="small-note">{{ t.rememberedNone }}</p>
            <div v-else class="action-row">
              <span>{{ t.rememberedWater }} {{ formatWaterNumber(profile.waterNumber) }}</span>
              <button class="text-button" @click="forgetWater">{{ t.rememberedDelete }}</button>
            </div>
          </section>
          <details class="developer-panel">
            <summary>{{ t.developer }}</summary>
            <p>{{ mode === 'phone' ? t.phoneMode : mode === 'local' ? t.local : t.fixture }}</p>
            <p class="small-note">{{ t.connectionHint }}</p>
            <form class="settings-form" @submit.prevent="applyConfig">
              <label
                >{{ t.mode
                }}<select v-model="selectedMode" :disabled="busy">
                  <option value="demo">{{ t.demoMode }}</option>
                  <option value="local">{{ t.localMode }}</option>
                  <option value="phone">{{ t.phoneMode }}</option>
                </select></label
              ><template v-if="selectedMode === 'local'"
                ><label
                  >{{ t.endpoint
                  }}<input v-model="endpoint" type="url" required :disabled="busy" /></label
                ><label
                  >{{ t.model
                  }}<input v-model="modelName" required :disabled="busy" /></label></template
              ><button class="outline-button" :disabled="busy">{{ t.apply }}</button>
              <p v-if="configStatus" role="status">{{ t[configStatus] }}</p>
            </form>
            <p class="small-note">{{ t.boundary }}</p>
          </details>
        </div>
      </details>
    </div>
  </header>

  <main id="main" class="messages">
    <PhoneModelPanel
      v-if="mode === 'phone'"
      :state="phoneState"
      :locale="locale"
      :starting="phoneStarting"
      :busy="busy"
      @start="startPhone"
      @stop="stopPhone"
      @refresh="refreshPhone"
    />
    <template v-for="turn in turns" :key="turn.id">
      <div v-if="turn.request" class="user-message">
        <span class="sr-only">{{ t.you }}</span>
        <p>{{ turn.request }}</p>
      </div>
      <div class="assistant-message">
        <span class="sr-only">{{ t.assistant }}</span>
        <p>{{ noticeText(turn.notice) }}</p>
        <p v-if="turn.navigation" class="small-note">
          {{ turn.navigation.title[locale] }}（{{ turn.navigation.where }}）
        </p>
        <ul v-if="turn.books.length" class="plain-list">
          <li v-for="book in turn.books" :key="book.id">
            <strong>{{ book.title[locale] }}</strong>
            <span>{{ book.author[locale] }}</span>
          </li>
        </ul>
        <ul v-if="turn.records.length" class="plain-list">
          <li v-for="record in turn.records" :key="record.id">
            <strong>{{ record.title[locale] }}</strong>
            <span v-if="record.description?.[locale]">{{ record.description[locale] }}</span>
          </li>
        </ul>
        <template v-if="turn.bills">
          <p class="small-note">{{ t.billDemo }}</p>
          <ul class="plain-list">
            <li v-for="bill in turn.bills.records" :key="bill.id">
              {{ billCategories[bill.category].label[locale] }} · {{ bill.periodLabel }} ·
              {{ bill.amount }} TWD · {{ t[`billStatus_${bill.status}`] }}
            </li>
          </ul>
        </template>
        <p v-if="turn.failure?.hint" class="small-note">{{ turn.failure.hint }}</p>
        <p v-if="turn.source" class="small-note">{{ turn.source.label }}</p>
        <p v-if="turn.reference" class="small-note">
          {{ turn.receiptBook?.[locale] }}・{{ t.reference }} {{ turn.reference }}
        </p>
        <details v-if="turn.traces.length" class="decision">
          <summary>{{ t.trace }}</summary>
          <ol class="trace" lang="en">
            <li v-for="event in turn.traces" :key="event.id">
              <code>{{ event.actor }} / {{ event.event }}</code
              ><span>{{ event.detail }}</span
              ><small>{{ event.elapsedMs }} ms</small>
            </li>
          </ol>
        </details>
      </div>
    </template>

    <p v-if="resumed" class="small-note" role="status">{{ t.resumed }}</p>
    <div v-if="lastRequest" class="user-message">
      <span class="sr-only">{{ t.you }}</span>
      <p>{{ lastRequest }}</p>
    </div>

    <section
      ref="resultHeading"
      class="assistant-message"
      tabindex="-1"
      :aria-label="t.assistant"
      :aria-busy="busy"
    >
      <p role="status" aria-live="polite">{{ busy ? t[stage] : reply }}</p>
      <div v-if="busy" class="working">
        <span class="working-dots" aria-hidden="true">•••</span
        ><button class="text-button" @click="runner.cancel()">{{ t.stop }}</button>
      </div>

      <template v-if="!busy">
        <BillPanel
          v-if="state.domain === 'bills'"
          :state="state"
          :locale="locale"
          @select="billAction"
          @retry="billAction()"
        />
        <ul v-if="shownBooks.length && !state.draft && !state.receipt" class="result-list">
          <li v-for="book in shownBooks" :key="book.id" class="result-card">
            <span v-if="book.category[locale]" class="category">{{ book.category[locale] }}</span>
            <h2>{{ book.title[locale] }}</h2>
            <p>{{ book.author[locale] }}</p>
            <button v-if="!toolClient" class="outline-button" @click="prepare(book.id)">
              {{ t.reserve }}
            </button>
            <button v-else class="outline-button" @click="showBookDetails(book.id)">
              {{ t.details }}
            </button>
          </li>
        </ul>
        <ul v-if="state.records.length" class="result-list">
          <li v-for="record in state.records" :key="record.id" class="result-card">
            <span v-if="record.category?.[locale]" class="category">{{
              record.category[locale]
            }}</span>
            <h2>{{ record.title[locale] }}</h2>
            <p v-if="record.description?.[locale]">{{ record.description[locale] }}</p>
            <dl v-if="record.fields?.length">
              <template v-for="field in record.fields" :key="field.label[locale]">
                <dt>{{ field.label[locale] }}</dt>
                <dd>{{ field.value[locale] }}</dd>
              </template>
            </dl>
            <template v-if="record.url">
              <div
                v-if="confirmingLink === record.id"
                class="leave-confirm"
                role="group"
                :aria-label="t.leaveTitle"
              >
                <p>{{ leaveQuestion(record) }}</p>
                <div class="action-row">
                  <button class="primary-button" @click="go(record.url)">{{ t.leaveGo }}</button
                  ><button class="text-button" @click="stay">{{ t.leaveStay }}</button>
                </div>
              </div>
              <button v-else class="outline-button" @click="confirmingLink = record.id">
                {{ record.url.startsWith('https://www.google.com/maps') ? t.openMap : t.openPage }}
              </button>
            </template>
          </li>
        </ul>
        <section
          v-if="state.notice === 'emergency' && state.emergency"
          class="result-card emergency-card"
          aria-labelledby="emergency-title"
        >
          <h2 id="emergency-title">{{ t[EMERGENCY_TEXT[state.emergency]] }}</h2>
          <div class="action-row">
            <button
              v-for="number in EMERGENCY_NUMBERS[state.emergency]"
              :key="number"
              class="primary-button emergency-call"
              @click="openLink(`tel:${number}`)"
            >
              {{ t[CALL_LABEL[number]!] }}
            </button>
          </div>
          <p class="small-note">{{ t.emergencyNote }}</p>
        </section>
        <section
          v-if="state.navigation"
          class="result-card navigation-card"
          aria-labelledby="navigation-title"
        >
          <span class="category">{{ state.navigation.provider }}</span>
          <h2 id="navigation-title">{{ state.navigation.title[locale] }}</h2>
          <p v-if="state.navigation.description?.[locale]">
            {{ state.navigation.description[locale] }}
          </p>
          <dl>
            <dt>{{ state.navigation.url.startsWith('tel:') ? t.leaveCall : t.leaveSite }}</dt>
            <dd>{{ state.navigation.where }}</dd>
          </dl>
          <div v-if="slots.length" class="prefill">
            <template v-for="slot in slots" :key="slot.field">
              <template v-if="slot.field === 'water_number'">
                <template v-if="profile.waterNumber && !editingWater">
                  <dl>
                    <dt>{{ t.prefillWater }}</dt>
                    <dd>{{ formatWaterNumber(profile.waterNumber) }}</dd>
                  </dl>
                  <button class="text-button" @click="editingWater = true">
                    {{ t.prefillWaterChange }}
                  </button>
                </template>
                <template v-else>
                  <label class="field-label" for="water-number">{{ t.prefillWaterAsk }}</label>
                  <p id="water-hint" class="small-note">{{ t.prefillWaterHint }}</p>
                  <input
                    id="water-number"
                    v-model="waterInput"
                    inputmode="numeric"
                    autocomplete="off"
                    maxlength="14"
                    aria-describedby="water-hint"
                    :aria-invalid="waterError"
                    @input="waterError = false"
                  />
                  <p v-if="waterError" role="alert" class="field-error">
                    {{ t.prefillWaterInvalid }}
                  </p>
                  <label class="check"
                    ><input v-model="rememberWater" type="checkbox" />{{ t.prefillRemember }}</label
                  >
                </template>
              </template>
              <template v-else>
                <dl v-if="typeof member === 'object' && member">
                  <dt>{{ t.prefillIdNo }}</dt>
                  <dd>{{ maskIdNo(member.idNo) }}</dd>
                </dl>
                <p v-else-if="member === 'unavailable'" class="small-note">
                  {{ t.prefillNoMember }}
                </p>
              </template>
            </template>
          </div>
          <p class="small-note">{{ state.source?.note || t.leaveNote }}</p>
          <div class="action-row">
            <button class="primary-button" @click="goNavigation">
              {{ state.navigation.url.startsWith('tel:') ? t.leaveDial : t.leaveGo }}</button
            ><button class="text-button" @click="stay">{{ t.leaveStay }}</button>
          </div>
        </section>
        <p v-if="leftFor" class="small-note" role="status">{{ t.leaveRequested }}</p>
        <p v-if="state.failure?.hint" class="small-note">{{ state.failure.hint }}</p>
        <p v-if="state.source && !state.navigation" class="small-note">
          {{ state.source.label }}：{{ state.source.note }}
          <template v-if="state.source.truncated">
            {{ t.truncated.replace('{total}', String(state.source.total)) }}
          </template>
        </p>

        <section v-if="state.draft" class="result-card" aria-labelledby="review-title">
          <h2 id="review-title">{{ t.reviewTitle }}</h2>
          <dl>
            <dt>{{ t.book }}</dt>
            <dd>{{ activeBook?.title[locale] }}</dd>
          </dl>
          <label class="field-label" for="branch">{{ t.branch }}</label
          ><select id="branch" :value="state.draft.branchId" @change="updateBranch">
            <option v-for="branch in branches" :key="branch.id" :value="branch.id">
              {{ branch.name[locale] }}
            </option>
          </select>
          <p class="small-note">{{ t.simulated }}</p>
          <div class="action-row">
            <button class="primary-button" @click="confirm">{{ t.confirm }}</button
            ><button class="text-button" @click="cancelDraft(state)">{{ t.cancel }}</button>
          </div>
        </section>
        <section v-if="state.receipt" class="result-card" aria-labelledby="receipt-title">
          <h2 id="receipt-title">{{ t.receiptTitle }}</h2>
          <dl>
            <dt>{{ t.book }}</dt>
            <dd>{{ activeBook?.title[locale] }}</dd>
            <dt>{{ t.branch }}</dt>
            <dd>{{ activeBranch?.name[locale] }}</dd>
            <dt>{{ t.reference }}</dt>
            <dd class="receipt-reference">{{ state.receipt.reference }}</dd>
          </dl>
          <p class="small-note">{{ t.saved }}</p>
        </section>

        <section
          v-if="choices"
          class="choices"
          :class="{ 'choices-ask': choices.kind === 'choose' }"
          aria-labelledby="choices-title"
        >
          <h2 id="choices-title">{{ choices.prompt[locale] }}</h2>
          <div class="suggestions">
            <button
              v-for="choice in choices.options"
              :key="choice.request"
              :disabled="inputDisabled"
              @click="submit(choice.request)"
            >
              {{ choice.label[locale] }}
            </button>
          </div>
        </section>
        <div v-if="showSuggestions" class="suggestions" role="group" :aria-label="t.quick">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            :disabled="inputDisabled"
            @click="submit(suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>

        <button
          v-if="speechSupported && state.notice !== 'welcome'"
          class="text-button read-button"
          @click="speak"
        >
          <UiIcon name="sound" />{{ speaking ? t.stopRead : t.read }}
        </button>
        <p v-if="speechFailed" role="alert" class="small-note">{{ t.speechError }}</p>
        <details v-if="state.traces.length" class="decision">
          <summary>{{ t.trace }}</summary>
          <ol class="trace" lang="en">
            <li v-for="event in state.traces" :key="event.id">
              <code>{{ event.actor }} / {{ event.event }}</code
              ><span>{{ event.detail }}</span
              ><small>{{ event.elapsedMs }} ms</small>
            </li>
          </ol>
        </details>
      </template>
    </section>
  </main>

  <form class="composer" @submit.prevent="submit()">
    <label class="sr-only" for="request">{{ t.questionLabel }}</label>
    <div class="composer-box">
      <textarea
        id="request"
        v-model="input"
        :placeholder="t.placeholder"
        maxlength="600"
        rows="1"
        :disabled="inputDisabled"
        aria-describedby="input-help"
        @keydown.enter.exact="onEnter"
      ></textarea>
      <button
        type="submit"
        class="send-button"
        :aria-label="t.send"
        :title="t.send"
        :disabled="inputDisabled || !input.trim()"
      >
        <UiIcon name="send" />
      </button>
    </div>
    <p id="input-help">{{ realData ? t.composerNoteReal : t.composerNote }}</p>
  </form>
</template>
