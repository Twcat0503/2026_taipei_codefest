<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import BillPanel from './components/BillPanel.vue';
import { billCategories, type BillSelection } from './agent/skills/bills';
import UiIcon from './components/UiIcon.vue';
import { messages } from './i18n';
import { branches } from './agent/catalog';
import { initialState, type Locale, type ModelAdapter } from './agent/types';
import PhoneModelPanel from './components/PhoneModelPanel.vue';
import { PhoneModel, type PhoneState } from './agent/phone-model';
import { AgentRunner } from './agent/runner';
import { DemoModel, LocalModel } from './agent/model';
import { cancelDraft, changeBranch, confirmReservation, prepareReservation } from './agent/tools';
import { clearTask, getPreference, restoreTask, saveTask, setPreference } from './platform/storage';
import { canReadAloud, readAloud, stopReading } from './platform/speech';

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
let runner = new AgentRunner(adapter, state);
const speechSupported = ref(canReadAloud());
const speaking = ref(false);
const speechFailed = ref(false);
const rate = ref('0.9');
const shownBooks = computed(() => state.bookResults);
const shownServices = computed(() => state.serviceResults);
const activeBook = computed(() =>
  state.bookResults.find((book) => book.id === (state.draft?.bookId ?? state.receipt?.bookId)),
);
const activeBranch = computed(() =>
  branches.find((branch) => branch.id === state.receipt?.branchId),
);
const step = computed(() =>
  state.draft || state.receipt ? 3 : state.domain && state.notice !== 'welcome' ? 2 : 1,
);
const reply = computed(() => t.value[state.notice]);
const inputDisabled = computed(
  () => busy.value || !!state.draft || (mode.value === 'phone' && !phoneState.value.ready),
);

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
}
async function submit(text = input.value) {
  if (inputDisabled.value || !text.trim()) return;
  stopReading();
  speaking.value = false;
  lastRequest.value = text.trim();
  input.value = '';
  resumed.value = false;
  busy.value = true;
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
    runner = new AgentRunner(adapter, state);
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
          ...shownServices.value.map(
            (service) => `${service.title[locale.value]}. ${service.description[locale.value]}`,
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
  <a class="skip-link" href="#main">{{ t.skip }}</a>
  <header class="site-header">
    <a class="brand" href="#main"
      ><span class="brand-mark"><UiIcon /></span
      ><span
        >{{ t.brand }}<span class="brand-divider"> / </span><strong>{{ t.product }}</strong></span
      ></a
    >
    <div class="preferences" role="group" :aria-label="t.accessibility">
      <label
        ><span>{{ t.font }}</span
        ><select v-model="fontSize" :aria-label="t.font">
          <option value="1">{{ t.normal }}</option>
          <option value="1.25">{{ t.large }}</option>
          <option value="1.5">{{ t.largest }}</option>
        </select></label
      >
      <label
        ><span class="sr-only">{{ t.language }}</span
        ><select v-model="locale" :aria-label="t.language">
          <option value="zh-Hant-TW">繁體中文</option>
          <option value="en">English</option>
        </select></label
      >
    </div>
  </header>

  <main id="main" class="page-shell">
    <section class="hero" aria-labelledby="hero-title">
      <div class="eyebrow"><span class="status-dot"></span>{{ t.eyebrow }}</div>
      <h1 id="hero-title">{{ t.heading }}</h1>
      <p class="hero-intro">{{ t.intro }}</p>
      <div class="mode-note">
        <span class="badge">{{ t.badge }}</span
        ><span>{{ t.demo }}</span>
      </div>
    </section>

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

    <div class="workspace">
      <div class="conversation">
        <section class="suggestions" :aria-label="t.quick">
          <h2>{{ t.quick }}</h2>
          <div class="quick-grid">
            <button :disabled="inputDisabled" @click="submit(t.browseBills)">
              <UiIcon name="grid" />{{ t.browseBills }}<UiIcon class="end-arrow" name="arrow" />
            </button>
            <button :disabled="inputDisabled" @click="submit(t.browseBooks)">
              <UiIcon name="book" />{{ t.browseBooks }}<UiIcon class="end-arrow" name="arrow" />
            </button>
            <button :disabled="inputDisabled" @click="submit(t.browseServices)">
              <UiIcon name="grid" />{{ t.browseServices }}<UiIcon class="end-arrow" name="arrow" />
            </button>
          </div>
          <div class="quick-chips">
            <button :disabled="inputDisabled" @click="submit(t.sampleBook)">
              {{ t.sampleBook }}</button
            ><button :disabled="inputDisabled" @click="submit(t.counter)">{{ t.counter }}</button>
          </div>
        </section>

        <p v-if="resumed" class="resume-note" role="status">{{ t.resumed }}</p>
        <div v-if="lastRequest" class="user-message">
          <span>{{ t.you }}</span>
          <p>{{ lastRequest }}</p>
        </div>

        <section class="assistant-card" aria-labelledby="result-title" :aria-busy="busy">
          <div class="assistant-top">
            <span class="assistant-avatar"><UiIcon /></span>
            <h2 id="result-title" ref="resultHeading" tabindex="-1">{{ t.assistant }}</h2>
            <span class="mini-label">{{ t.badge }}</span>
          </div>
          <p class="reply-text" role="status" aria-live="polite">{{ busy ? t[stage] : reply }}</p>
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
              <li v-for="(book, index) in shownBooks" :key="book.id" class="book-card">
                <div class="book-cover" :class="`cover-${index % 3}`" aria-hidden="true">
                  <UiIcon name="book" /><span>0{{ index + 1 }}</span>
                </div>
                <div class="book-info">
                  <span class="category">{{ book.category[locale] }}</span>
                  <h3>{{ book.title[locale] }}</h3>
                  <p>{{ book.author[locale] }}</p>
                  <button class="outline-button" @click="prepare(book.id)">
                    {{ t.reserve }}<UiIcon name="arrow" />
                  </button>
                </div>
              </li>
            </ul>
            <ul v-if="shownServices.length" class="result-list service-results">
              <li v-for="service in shownServices" :key="service.id">
                <UiIcon :name="service.id === 'library' ? 'book' : 'grid'" />
                <div>
                  <h3>{{ service.title[locale] }}</h3>
                  <p>{{ service.description[locale] }}</p>
                  <button
                    v-if="service.id === 'library'"
                    class="outline-button"
                    @click="submit(t.browseBooks)"
                  >
                    {{ t.explore }}<UiIcon name="arrow" /></button
                  ><span v-else class="category">{{ t.infoOnly }}</span>
                </div>
              </li>
            </ul>

            <section v-if="state.draft" class="review-panel" aria-labelledby="review-title">
              <span class="section-number">{{ t.reviewEyebrow }}</span>
              <h3 id="review-title">{{ t.reviewTitle }}</h3>
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
              <p class="notice-box">{{ t.simulated }}</p>
              <div class="action-row">
                <button class="primary-button" @click="confirm">
                  <UiIcon name="check" />{{ t.confirm }}</button
                ><button class="text-button" @click="cancelDraft(state)">{{ t.cancel }}</button>
              </div>
            </section>
            <section v-if="state.receipt" class="receipt-panel" aria-labelledby="receipt-title">
              <span class="receipt-check"><UiIcon name="check" /></span>
              <h3 id="receipt-title">{{ t.receiptTitle }}</h3>
              <dl>
                <dt>{{ t.book }}</dt>
                <dd>{{ activeBook?.title[locale] }}</dd>
                <dt>{{ t.branch }}</dt>
                <dd>{{ activeBranch?.name[locale] }}</dd>
                <dt>{{ t.reference }}</dt>
                <dd class="receipt-reference">{{ state.receipt.reference }}</dd>
              </dl>
              <p>{{ t.saved }}</p>
            </section>

            <div class="speech-controls" v-if="speechSupported">
              <button class="text-button" @click="speak">
                <UiIcon name="sound" />{{ speaking ? t.stopRead : t.read }}</button
              ><label
                ><span class="sr-only">{{ t.rate }}</span
                ><select v-model="rate">
                  <option value="0.7">{{ t.slow }}</option>
                  <option value="0.9">{{ t.standardRate }}</option>
                </select></label
              >
            </div>
            <p v-else class="small-note">{{ t.speechUnavailable }}</p>
            <p v-if="speechFailed" role="alert" class="small-note">{{ t.speechError }}</p>
          </template>
        </section>

        <form class="composer" @submit.prevent="submit()">
          <label for="request">{{ t.questionLabel }}</label
          ><textarea
            id="request"
            v-model="input"
            :placeholder="t.placeholder"
            maxlength="600"
            rows="2"
            :disabled="inputDisabled"
            aria-describedby="input-help"
          ></textarea>
          <div class="composer-bottom">
            <span>{{ input.length }} / 600 {{ t.count }}</span
            ><button
              type="submit"
              class="primary-button"
              :disabled="inputDisabled || !input.trim()"
            >
              {{ t.send }}<UiIcon name="arrow" />
            </button>
          </div>
          <p id="input-help">{{ t.inputHint }}</p>
        </form>
      </div>

      <aside class="side-panel" :aria-label="t.progressTitle">
        <div class="progress-card">
          <span class="section-number">{{ t.journeyEyebrow }}</span>
          <h2>{{ t.progressTitle }}</h2>
          <ol>
            <li
              v-for="n in 3"
              :key="n"
              :class="{ current: step === n, completed: step > n || !!state.receipt }"
              :aria-current="step === n ? 'step' : undefined"
            >
              <span class="step-number"
                ><UiIcon v-if="step > n || state.receipt" name="check" /><template v-else
                  >0{{ n }}</template
                ></span
              >
              <div>
                <strong>{{ t[`step${n}` as 'step1'] }}</strong>
                <p>{{ t[`step${n}Detail` as 'step1Detail'] }}</p>
              </div>
            </li>
          </ol>
          <button :disabled="busy" class="reset-button" :title="t.newTaskHint" @click="reset">
            {{ t.newTask }}<UiIcon name="arrow" />
          </button>
        </div>
        <div class="privacy-note">
          <UiIcon name="shield" />
          <h3>{{ t.privacyTitle }}</h3>
          <p>{{ t.privacy }}</p>
        </div>
      </aside>
    </div>

    <details class="developer-panel">
      <summary>{{ t.developer }}</summary>
      <div class="developer-content">
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
        <h3>{{ t.trace }}</h3>
        <p v-if="!state.traces.length">{{ t.noTrace }}</p>
        <ol v-else class="trace" lang="en">
          <li v-for="event in state.traces" :key="event.id">
            <code>{{ event.actor }} / {{ event.event }}</code
            ><span>{{ event.detail }}</span
            ><small>{{ event.elapsedMs }} ms</small>
          </li>
        </ol>
        <p class="small-note">{{ t.boundary }}</p>
      </div>
    </details>
    <footer>
      <p>{{ t.source }}</p>
      <span>{{ t.footer }}</span>
    </footer>
  </main>
</template>
