<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import BillPanel from './components/BillPanel.vue';
import { billCategories, billReadTool, type BillSelection } from './agent/skills/bills';
import { withDemoBills } from './agent/tool-client';
import PhoneModelPanel from './components/PhoneModelPanel.vue';
import { PhoneModel, type PhoneState } from './agent/phone-model';
import UiIcon from './components/UiIcon.vue';
import WelcomePanel from './components/WelcomePanel.vue';
import DisasterDemo from './components/DisasterDemo.vue';
import VoiceWave from './components/VoiceWave.vue';
import { messages } from './i18n';
import { branches } from './agent/catalog';
import {
  initialState,
  type Locale,
  type Localized,
  type ModelAdapter,
  type TaskState,
} from './agent/types';
import { AgentRunner } from './agent/runner';
import { createAgentToolClient } from '../../../tools/townpass/src/agent-client';
import { DemoModel, LocalModel } from './agent/model';
import { cancelDraft, changeBranch, confirmReservation, prepareReservation } from './agent/tools';
import {
  clearConversation,
  clearTask,
  getPreference,
  restoreConversation,
  restoreTask,
  saveConversation,
  saveTask,
  setPreference,
} from './platform/storage';
import { canReadAloud, readAloud, stopReading } from './platform/speech';
import { getLocation, openLink } from './platform/location';
import { createVoiceInput, type VoiceStatus } from './platform/voice-input';

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
const requestInput = ref<HTMLTextAreaElement>();
const assistantBody = ref<HTMLElement>();
const keyboardViewportHeight = ref<number | null>(null);
const attachmentInput = ref<HTMLInputElement>();
const attachments = ref<File[]>([]);
const preferencesDialog = ref<HTMLDialogElement>();
const home = ref(!resumed.value);
const disasterDemo = ref(false);
const native = !!window.flutterObject;
const voiceOpen = ref(false);
const voiceStatus = ref<VoiceStatus>('idle');
const voiceOriginal = ref('');
const voice = createVoiceInput(
  (status) => (voiceStatus.value = status),
  (text) =>
    (input.value = `${voiceOriginal.value}${voiceOriginal.value ? ' ' : ''}${text}`.slice(0, 600)),
  () => {
    voiceOpen.value = false;
    void focusInput();
  },
);
const voiceMessage = computed(() => {
  const keys = {
    idle: 'voiceHint',
    starting: 'voiceStarting',
    listening: 'voiceListening',
    unavailable: 'voiceUnavailable',
    permission: 'voicePermission',
    error: 'voiceError',
  } as const;
  return t.value[keys[voiceStatus.value]];
});
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
// 預設查台北通工具；VITE_TOOL_SOURCE=demo 才用 DemoToolClient 的虛構資料。
const toolClient =
  import.meta.env.VITE_TOOL_SOURCE === 'demo'
    ? undefined
    : withDemoBills(createAgentToolClient({ getLocation }), billReadTool);
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
const reply = computed(() => t.value[state.notice]);
const inputDisabled = computed(
  () => busy.value || !!state.draft || (mode.value === 'phone' && !phoneState.value.ready),
);
const showSuggestions = computed(
  () =>
    !busy.value &&
    !state.draft &&
    !state.receipt &&
    ['welcome', 'unsupported', 'empty', 'error', 'cancelled'].includes(state.notice),
);
const hasConversation = computed(() => state.notice !== 'welcome' || turns.value.length > 0);

type Turn = {
  id: number;
  restored?: boolean;
  time: number;
  request: string;
  notice: TaskState['notice'];
  books: TaskState['bookResults'];
  records: TaskState['records'];
  source: TaskState['source'];
  bills: TaskState['billResult'];
  failure: TaskState['failure'];
  traces: TaskState['traces'];
  reference?: string;
  receiptBook?: Localized;
};
const restoredTurns = restoreConversation();
const turns = ref<Turn[]>(
  restoredTurns.map((turn, index) => ({
    id: index,
    restored: true,
    time: 0,
    request: turn.request
      ? messages[locale.value][turn.request as keyof (typeof messages)['en']]
      : t.value.savedRequestUnavailable,
    notice: turn.notice,
    books: [],
    records: [],
    source: null,
    bills: null,
    failure: null,
    traces: [],
  })),
);
let nextTurnId = turns.value.length;
const conversationSaveFailed = ref(false);
if (turns.value.length) home.value = false;
function persistConversation() {
  const current =
    lastRequest.value && state.notice !== 'welcome'
      ? [{ request: lastRequest.value, notice: state.notice }]
      : [];
  conversationSaveFailed.value = !saveConversation([...turns.value, ...current]);
}
function archiveTurn() {
  if (!lastRequest.value && state.notice === 'welcome') return;
  const finished = !!state.receipt;
  turns.value.push({
    id: nextTurnId++,
    time: Date.now(),
    request: lastRequest.value,
    notice: state.notice,
    books: finished ? [] : state.bookResults,
    records: state.records,
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
    voice.cancel();
    voiceOpen.value = false;
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
  if (assistantBody.value && resultHeading.value) {
    assistantBody.value.scrollBy({
      top:
        resultHeading.value.getBoundingClientRect().top -
        assistantBody.value.getBoundingClientRect().top,
    });
  }
}
function updateKeyboardViewport() {
  const viewport = window.visualViewport;
  const editing = document.activeElement === requestInput.value;
  keyboardViewportHeight.value =
    editing && viewport && viewport.scale === 1 && window.innerHeight - viewport.height > 100
      ? viewport.height
      : null;
}
function updateKeyboardAfterFocusOut() {
  queueMicrotask(updateKeyboardViewport);
}
onMounted(() => {
  window.visualViewport?.addEventListener('resize', updateKeyboardViewport);
  window.addEventListener('resize', updateKeyboardViewport);
  document.addEventListener('focusin', updateKeyboardViewport);
  document.addEventListener('focusout', updateKeyboardAfterFocusOut);
});
function onViewEntered() {
  if (
    !home.value &&
    hasConversation.value &&
    !voiceOpen.value &&
    !disasterDemo.value &&
    document.activeElement !== requestInput.value
  )
    void focusResult();
}
async function focusInput() {
  home.value = false;
  await nextTick();
  requestInput.value?.focus();
}
function openSettings() {
  const dialog = preferencesDialog.value;
  if (!dialog) return;
  dialog.inert = false;
  dialog.removeAttribute('aria-hidden');
  dialog.showModal();
}
function closeSettings() {
  const dialog = preferencesDialog.value;
  if (!dialog) return;
  dialog.inert = true;
  dialog.setAttribute('aria-hidden', 'true');
  dialog.close();
}
function goHome() {
  if (busy.value) return;
  cancelVoice();
  home.value = true;
  disasterDemo.value = false;
}
function startDisasterDemo() {
  if (busy.value || state.draft) return;
  closeSettings();
  cancelVoice();
  stopReading();
  speaking.value = false;
  home.value = false;
  input.value = '';
  disasterDemo.value = true;
}
function startVoice() {
  if (inputDisabled.value) return;
  stopReading();
  speaking.value = false;
  home.value = false;
  voiceOriginal.value = input.value;
  voiceOpen.value = true;
  voice.start(locale.value);
}
function cancelVoice() {
  voice.cancel();
  if (voiceOpen.value) input.value = voiceOriginal.value;
  voiceOpen.value = false;
}
function typeInstead() {
  voice.cancel();
  voiceOpen.value = false;
  void focusInput();
}
async function submit(text = input.value) {
  if (inputDisabled.value || attachments.value.length || !text.trim()) return;
  if (
    /^(?:我想要|我要|我想)?通報災情[。！!？?]?$|^(?:i want to )?report a disaster[.!?]?$/iu.test(
      text.trim(),
    )
  ) {
    startDisasterDemo();
    return;
  }
  disasterDemo.value = false;
  stopReading();
  speaking.value = false;
  voice.cancel();
  voiceOpen.value = false;
  home.value = false;
  archiveTurn();
  lastRequest.value = text.trim();
  input.value = '';
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
    persistConversation();
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
  clearConversation();
  conversationSaveFailed.value = false;
  Object.assign(state, initialState());
  turns.value = [];
  resumed.value = false;
  lastRequest.value = '';
  input.value = '';
  attachments.value = [];
  cancelVoice();
  input.value = '';
  home.value = true;
  closeSettings();
  disasterDemo.value = false;
}
function selectAttachments(event: Event) {
  const target = event.target as HTMLInputElement;
  if (inputDisabled.value) return;
  attachments.value = [...attachments.value, ...Array.from(target.files ?? [])];
  target.value = '';
  if (attachments.value.length) home.value = false;
}
function removeAttachment(index: number) {
  attachments.value.splice(index, 1);
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
          ...state.records.map(
            (record) =>
              `${record.title[locale.value]}. ${record.description?.[locale.value] ?? ''}`,
          ),
        ].join('。');
  readAloud(
    `${reply.value} ${extra}`,
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
  window.visualViewport?.removeEventListener('resize', updateKeyboardViewport);
  window.removeEventListener('resize', updateKeyboardViewport);
  document.removeEventListener('focusin', updateKeyboardViewport);
  document.removeEventListener('focusout', updateKeyboardAfterFocusOut);
  voice.cancel();
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
  <div
    class="assistant-shell"
    :class="{ 'native-host': native, 'is-home': home }"
    :style="keyboardViewportHeight ? { height: `${keyboardViewportHeight}px` } : undefined"
  >
    <a class="skip-link" href="#request">{{ t.skip }}</a>
    <header v-if="!native" class="chat-header">
      <button class="icon-button" :disabled="busy" :aria-label="t.backHome" @click="goHome">
        <UiIcon name="back" />
      </button>
      <span>{{ t.product }}</span>
      <button class="icon-button" :disabled="busy" :aria-label="t.newTask" @click="reset">
        <UiIcon name="close" />
      </button>
    </header>

    <main id="main" ref="assistantBody" class="assistant-body">
      <button v-if="mode === 'phone'" class="phone-status-button" @click="openSettings">
        {{ phoneState.ready ? t.phoneConnected : t.phoneStart }}
      </button>
      <Transition name="view-fade" mode="out-in" @after-enter="onViewEntered">
        <WelcomePanel
          v-if="home"
          :locale="locale"
          :disabled="inputDisabled"
          :has-task="hasConversation"
          :pending-draft="!!state.draft"
          @request="submit"
          @voice="startVoice"
          @resume="home = false"
          @settings="openSettings"
        />

        <div v-else class="conversation">
          <div
            class="conversation-heading"
            :class="{ 'has-request': hasConversation || disasterDemo }"
          >
            <h1>{{ disasterDemo ? t.disasterRequest : lastRequest || t.today }}</h1>
            <button class="icon-button" :aria-label="t.settings" @click="openSettings">
              <UiIcon name="settings" />
            </button>
          </div>
          <DisasterDemo v-if="disasterDemo" :locale="locale" @exit="goHome" />
          <div v-if="!hasConversation && !voiceOpen && !disasterDemo" class="conversation-empty">
            <p>{{ t.welcome }}</p>
            <p class="small-note">{{ t.historyHint }}</p>
          </div>
          <div v-if="!disasterDemo" class="messages">
            <template v-for="turn in turns" :key="turn.id">
              <div v-if="turn.request" class="user-message">
                <span class="sr-only">{{ t.you }}</span>
                <p>{{ turn.request }}</p>
              </div>
              <article class="past-message" :aria-label="t.assistant">
                <p v-if="turn.restored" class="small-note">{{ t.savedSummaryNote }}</p>
                <p class="reply-bubble">{{ t[turn.notice] }}</p>
                <ul v-if="turn.books.length" class="plain-list">
                  <li v-for="book in turn.books" :key="book.id">
                    <strong>{{ book.title[locale] }}</strong
                    ><span>{{ book.author[locale] }}</span>
                  </li>
                </ul>
                <ul v-if="turn.records.length" class="plain-list">
                  <li v-for="record in turn.records" :key="record.id">
                    <strong>{{ record.title[locale] }}</strong
                    ><span v-if="record.description?.[locale]">{{
                      record.description[locale]
                    }}</span>
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
                <p v-if="turn.source" class="source-note">
                  {{ turn.source.label }}：{{ turn.source.note }}
                </p>
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
              </article>
            </template>

            <p v-if="resumed" class="notice-box" role="status">{{ t.resumed }}</p>
            <div v-if="lastRequest && turns.length" class="user-message">
              <span class="sr-only">{{ t.you }}</span>
              <p>{{ lastRequest }}</p>
            </div>
            <section
              v-if="state.notice !== 'welcome' || busy"
              ref="resultHeading"
              class="assistant-message"
              tabindex="-1"
              :aria-label="t.assistant"
              :aria-busy="busy"
            >
              <p :class="busy ? 'sr-only' : 'reply-bubble'" role="status" aria-live="polite">
                {{ busy ? t[stage] : reply }}
              </p>
              <div v-if="busy" class="working">
                <span class="working-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                <button class="text-button" @click="runner.cancel()">{{ t.stop }}</button>
              </div>
              <template v-else>
                <BillPanel
                  v-if="state.domain === 'bills'"
                  :state="state"
                  :locale="locale"
                  @select="billAction"
                  @retry="billAction()"
                />
                <ul v-if="shownBooks.length && !state.draft && !state.receipt" class="result-list">
                  <li v-for="book in shownBooks" :key="book.id" class="result-card">
                    <span v-if="book.category[locale]" class="category">{{
                      book.category[locale]
                    }}</span>
                    <h2>{{ book.title[locale] }}</h2>
                    <p>{{ book.author[locale] }}</p>
                    <button v-if="!toolClient" class="primary-button" @click="prepare(book.id)">
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
                      <template v-for="field in record.fields" :key="field.label[locale]"
                        ><dt>{{ field.label[locale] }}</dt>
                        <dd>{{ field.value[locale] }}</dd></template
                      >
                    </dl>
                    <button v-if="record.url" class="outline-button" @click="openLink(record.url)">
                      {{ t.openPage }}
                    </button>
                  </li>
                </ul>
                <p v-if="state.failure?.hint" class="notice-box">{{ state.failure.hint }}</p>
                <p v-if="state.source" class="source-note">
                  {{ state.source.label }}：{{ state.source.note }}
                  <template v-if="state.source.truncated">{{
                    t.truncated.replace('{total}', String(state.source.total))
                  }}</template>
                </p>
                <button
                  v-if="state.notice === 'error' && lastRequest"
                  class="primary-button"
                  @click="submit(lastRequest)"
                >
                  {{ t.retry }}
                </button>

                <Transition name="content-fade" mode="out-in" @after-enter="focusResult">
                  <section
                    v-if="state.draft"
                    key="review"
                    class="result-card review-panel"
                    aria-labelledby="review-title"
                  >
                    <span class="demo-badge">{{ t.demoBadge }}</span>
                    <h2 id="review-title">{{ t.reviewTitle }}</h2>
                    <dl>
                      <dt>{{ t.book }}</dt>
                      <dd>{{ activeBook?.title[locale] }}</dd>
                    </dl>
                    <label class="field-label" for="branch">{{ t.branch }}</label>
                    <select id="branch" :value="state.draft.branchId" @change="updateBranch">
                      <option v-for="branch in branches" :key="branch.id" :value="branch.id">
                        {{ branch.name[locale] }}
                      </option>
                    </select>
                    <p class="small-note">{{ t.simulated }}</p>
                    <div class="action-row">
                      <button class="primary-button" @click="confirm">{{ t.confirm }}</button
                      ><button class="outline-button" @click="cancelDraft(state)">
                        {{ t.cancel }}
                      </button>
                    </div>
                  </section>
                  <section
                    v-else-if="state.receipt"
                    key="receipt"
                    class="result-card receipt-panel"
                    aria-labelledby="receipt-title"
                  >
                    <span class="receipt-check" aria-hidden="true"><UiIcon name="check" /></span>
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
                </Transition>
                <div
                  v-if="showSuggestions"
                  class="recovery-options"
                  role="group"
                  :aria-label="t.quick"
                >
                  <button
                    class="outline-button"
                    :disabled="inputDisabled"
                    @click="submit(t.browseBooks)"
                  >
                    {{ t.browseBooks }}
                  </button>
                  <button
                    class="outline-button"
                    :disabled="inputDisabled"
                    @click="submit(t.browseServices)"
                  >
                    {{ t.browseServices }}
                  </button>
                </div>
                <button v-if="speechSupported" class="text-button read-button" @click="speak">
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
          </div>
          <div v-if="busy || voiceOpen" class="townpass-watermark" aria-hidden="true">
            <strong>城 市 通</strong><span>TOWN PASS</span>
          </div>
        </div>
      </Transition>
    </main>

    <section v-if="voiceOpen" class="voice-dock" :aria-label="t.voiceLabel">
      <div class="voice-surface">
        <VoiceWave wide :active="voiceStatus === 'listening'" />
        <p role="status">{{ voiceMessage }}</p>
        <p v-if="input && voiceStatus === 'listening'" class="voice-transcript">{{ input }}</p>
        <div class="voice-actions">
          <button class="voice-dismiss" :aria-label="t.voiceCancel" @click="cancelVoice">
            <UiIcon name="close" />
          </button>
          <button
            v-if="voiceStatus === 'listening'"
            class="voice-text-button"
            @click="voice.finish()"
          >
            {{ t.voiceFinish }}
          </button>
          <button
            v-if="voiceStatus === 'error' || voiceStatus === 'permission'"
            class="voice-text-button"
            @click="startVoice"
          >
            {{ t.voiceRetry }}
          </button>
          <button class="voice-text-button" @click="typeInstead">{{ t.useKeyboard }}</button>
        </div>
      </div>
    </section>
    <footer v-else class="composer-dock">
      <div
        v-if="!home && !state.draft && !disasterDemo"
        class="quick-chips"
        role="group"
        :aria-label="t.quick"
      >
        <button
          :disabled="inputDisabled"
          :aria-label="t.browseBills"
          @click="submit(t.browseBills)"
        >
          <span aria-hidden="true"></span>{{ t.billShortcut }}
        </button>
        <button :disabled="inputDisabled" @click="submit(t.reportRequest)">
          <span aria-hidden="true"></span>{{ t.reportShortcut }}
        </button>
        <button :disabled="inputDisabled" :aria-label="t.counter" @click="submit(t.counter)">
          <span aria-hidden="true"></span>{{ t.counterShortcut }}
        </button>
      </div>
      <p v-if="state.draft && !home" class="draft-hint">{{ t.draftHint }}</p>
      <div v-if="attachments.length" class="attachments" role="region" :aria-label="t.attachments">
        <ul>
          <li v-for="(file, index) in attachments" :key="index">
            <span>{{ file.name }}</span>
            <button
              type="button"
              :aria-label="t.removeAttachment.replace('{name}', file.name)"
              @click="removeAttachment(index)"
            >
              <UiIcon name="close" />
            </button>
          </li>
        </ul>
        <p role="status">{{ t.attachmentUnavailable }}</p>
      </div>
      <form class="composer" @submit.prevent="submit()">
        <input
          ref="attachmentInput"
          class="sr-only"
          type="file"
          :aria-label="t.attachmentPicker"
          :disabled="inputDisabled"
          accept="image/*,.pdf,.txt,text/plain,application/pdf"
          multiple
          tabindex="-1"
          @change="selectAttachments"
        />
        <button
          type="button"
          class="add-button"
          :aria-label="t.addAttachment"
          :disabled="inputDisabled"
          @click="attachmentInput?.click()"
        >
          <UiIcon name="plus" />
        </button>
        <label class="sr-only" for="request">{{ t.questionLabel }}</label>
        <div class="composer-box">
          <textarea
            id="request"
            ref="requestInput"
            v-model="input"
            :placeholder="home ? t.homePlaceholder : t.chatPlaceholder"
            maxlength="600"
            rows="1"
            :disabled="inputDisabled"
            aria-describedby="input-help"
            @focus="home = false"
            @keydown.enter.exact="onEnter"
          ></textarea>
          <button
            type="submit"
            class="send-button"
            :class="{ 'is-empty': !input.trim() }"
            :aria-label="t.send"
            :disabled="inputDisabled || !!attachments.length || !input.trim()"
          >
            <UiIcon name="send" />
          </button>
        </div>
      </form>
      <p id="input-help" class="composer-note">
        <span>{{ disasterDemo ? t.demoBadge : mode === 'demo' ? t.ruleBadge : t.modelBadge }}</span
        ><span class="scope-copy">
          · {{ disasterDemo || !toolClient ? t.demoBadge : t.readOnlyBadge }}</span
        >
      </p>
      <p v-if="conversationSaveFailed" role="status">{{ t.conversationSaveFailed }}</p>
    </footer>

    <dialog
      ref="preferencesDialog"
      class="settings-dialog"
      aria-labelledby="settings-title"
      @cancel.prevent="closeSettings"
    >
      <div class="dialog-heading">
        <h2 id="settings-title">{{ t.settingsTitle }}</h2>
        <button class="icon-button" :aria-label="t.closeSettings" @click="closeSettings">
          <UiIcon name="close" />
        </button>
      </div>
      <div class="settings-content">
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
        <section class="settings-section" aria-labelledby="reading-title">
          <h3 id="reading-title">{{ t.readingSettings }}</h3>
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
          <button
            class="outline-button"
            :disabled="inputDisabled"
            @click="
              closeSettings();
              startVoice();
            "
          >
            {{ t.voiceLabel }}
          </button>
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
            >
            <template v-if="selectedMode === 'local'"
              ><label
                >{{ t.endpoint
                }}<input v-model="endpoint" type="url" required :disabled="busy" /></label
              ><label>{{ t.model }}<input v-model="modelName" required :disabled="busy" /></label
            ></template>
            <button class="primary-button" :disabled="busy">{{ t.apply }}</button>
            <p v-if="configStatus" role="status">{{ t[configStatus] }}</p>
          </form>
          <p class="small-note">{{ t.boundary }}</p>
        </details>
        <div class="settings-section">
          <button
            class="outline-button"
            :disabled="busy"
            @click="
              closeSettings();
              goHome();
            "
          >
            {{ t.backHome }}
          </button>
          <button class="text-button" :disabled="busy" @click="reset">{{ t.clearProgress }}</button>
          <p class="small-note">{{ t.privacyHint }}</p>
          <p class="small-note">{{ toolClient ? t.toolScope : t.demoScope }}</p>
        </div>
      </div>
    </dialog>
  </div>
</template>
