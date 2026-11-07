<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import BillPanel from './components/BillPanel.vue';
import { billCategories, billReadTool, type BillSelection } from './agent/skills/bills';
import { withDemoBills } from './agent/tool-client';
import PhoneModelPanel from './components/PhoneModelPanel.vue';
import { PhoneModel, type PhoneState } from './agent/phone-model';
import UiIcon from './components/UiIcon.vue';
import NavigationPanel from './components/NavigationPanel.vue';
import EmergencyCard from './components/EmergencyCard.vue';
import ProfilePanel from './components/ProfilePanel.vue';
import { shouldReadAnswerAloud } from './agent/auto-read';
import { followUps } from './agent/follow-ups';
import { outcomeFeedback } from './agent/outcome-feedback';
import { serviceOrigin } from './platform/service-navigation';
import {
  forgetWaterNumber,
  formatWaterNumber,
  loadProfile,
  TAIPEI_DISTRICTS,
  updateProfile,
} from './platform/profile';
import { readMember, type Member } from './platform/member';
import WelcomePanel from './components/WelcomePanel.vue';
import VoiceWave from './components/VoiceWave.vue';
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
import { AgentRunner, fillsPendingLocation } from './agent/runner';
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
import { a11yState } from './platform/a11y';
import { feedback, setVoiceFeedbackEnabled, voiceFeedbackEnabled } from './platform/feedback';
import { hapticsEnabled, setHapticsEnabled } from './platform/haptics';
import {
  armNaturalVoiceAudio,
  naturalVoiceEnabled,
  prepareNaturalVoice,
  releaseNaturalVoice,
  setNaturalVoiceEnabled,
} from './platform/natural-voice';
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
/** Page heading: the task being worked on, kept when a reply only answers a follow-up question. */
const taskTitle = ref('');
const busy = ref(false);
const stage = ref<'routing' | 'searching' | 'locating'>('routing');
type ParkingSpace = 'disabled' | 'pregnancy';
type ParkingSearch = { space: ParkingSpace; radius: 1000 | 3000; area: string | null };
const parkingSearch = ref<ParkingSearch | null>(null);
const parkingDistrict = ref('');
const resultHeading = ref<HTMLElement>();
const requestInput = ref<HTMLTextAreaElement>();
const photoInput = ref<HTMLInputElement>();
const pendingPhoto = ref<File | null>(null);
const photoEntryNotice = ref<'photoSimulated' | 'photoNotReady' | 'photoError' | null>(null);
const assistantBody = ref<HTMLElement>();
const keyboardViewportHeight = ref<number | null>(null);
/** Typing with little height left (soft keyboard open, or large text): hide the quick chips. */
const composerCompact = ref(false);
const preferencesDialog = ref<HTMLDialogElement>();
// Every entry starts on the home screen so the voice button is the first thing people see;
// a saved conversation or draft is picked up from there with "continue".
const home = ref(true);
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
// 預設只用真實資料：台北通官方工具與開放資料（includeDemo: false）。帳單、前往確認卡與水號帶入
// 都走這條路；示範帳單面板（withDemoBills）會攔下繳費需求，所以只在示範資料模式提供。
// VITE_TOOL_SOURCE=townpass-demo 加回示範站模擬資料與示範帳單，=demo 為完全虛構的資料。
const toolSource = import.meta.env.VITE_TOOL_SOURCE;
const lookupLocation = async (signal: AbortSignal) => {
  if (parkingSearch.value && !parkingSearch.value.area) stage.value = 'locating';
  const position = await getLocation(signal);
  if (!signal.aborted && parkingSearch.value) stage.value = 'searching';
  return position;
};
const toolClient =
  toolSource === 'demo'
    ? undefined
    : toolSource === 'townpass-demo'
      ? withDemoBills(createAgentToolClient({ getLocation: lookupLocation }), billReadTool)
      : createAgentToolClient({ getLocation: lookupLocation, includeDemo: false });
const realData = toolSource !== 'demo' && toolSource !== 'townpass-demo';
let runner = new AgentRunner(adapter, state, toolClient);
// 台北通會員資料：只在 App 內讀一次、只留在記憶體，供選項、草稿與「我的資料」使用。
const memberInfo = ref<Member | null>(null);
if (window.flutterObject) void readMember().then((m) => (memberInfo.value = m));
// 民眾要求助手記住的資料（只存在這支手機）。
const profile = ref(loadProfile());
const homeDistrict = computed(() => profile.value.homeDistrict ?? memberInfo.value?.district);
watch(
  () => profile.value.preferAccessible,
  (on) => (runner.preferences.accessible = Boolean(on)),
  { immediate: true },
);
function setHomeDistrict(event: Event) {
  updateProfile({ homeDistrict: (event.target as HTMLSelectElement).value || undefined });
  profile.value = loadProfile();
}
function setPreferAccessible(event: Event) {
  updateProfile({ preferAccessible: (event.target as HTMLInputElement).checked });
  profile.value = loadProfile();
}
function forgetWater() {
  forgetWaterNumber();
  profile.value = loadProfile();
}
// 離開助手一律要第二次、明確的點選。
const confirmingLink = ref<string | null>(null);
const leftFor = ref(false);
const hostOf = (url: string) => (url.startsWith('tel:') ? url.slice(4) : new URL(url).host);
const leaveQuestion = (record: TaskState['records'][number]) =>
  record.url?.startsWith(`${serviceOrigin}/`)
    ? t.value.leaveAskApp.replace('{name}', record.title[locale.value])
    : t.value.leaveAsk.replace('{host}', hostOf(record.url ?? ''));
function goRecord(url: string) {
  openLink(url);
  leftFor.value = true;
  confirmingLink.value = null;
}
// 示範（規則模擬）模式沒有真正的視覺模型；本機與手機模型才送照片。
const canSeePhotos = computed(
  () => mode.value === 'local' || (mode.value === 'phone' && phoneState.value.ready),
);
const speechSupported = ref(canReadAloud());
const speaking = ref(false);
const speechFailed = ref(false);
const rate = ref('0.9');
// 震動與語音回饋的開關：偏好存在這支手機；勾選狀態以實際存下的值為準。
const hapticsOn = ref(hapticsEnabled());
const voiceFeedbackOn = ref(voiceFeedbackEnabled());
function setHaptics(event: Event) {
  const box = event.target as HTMLInputElement;
  setHapticsEnabled(box.checked);
  // 儲存被瀏覽器擋住時存不下來，勾選就退回實際生效的值。
  box.checked = hapticsOn.value = hapticsEnabled();
}
function setVoiceFeedback(event: Event) {
  const box = event.target as HTMLInputElement;
  setVoiceFeedbackEnabled(box.checked);
  box.checked = voiceFeedbackOn.value = voiceFeedbackEnabled();
}
// 本機自然語音（BlueMagpie）：只在 App 內提供、預設關閉；無法使用時自動改用系統語音。
const naturalVoice = ref(native && naturalVoiceEnabled());
// WebView 預設要使用者手勢才能出聲，所以開著的話，第一次點擊或按鍵就先解鎖播放用的 <audio>。
if (naturalVoice.value) armNaturalVoiceAudio();
const shownBooks = computed(() => state.bookResults);
const activeBook = computed(() =>
  state.bookResults.find((book) => book.id === (state.draft?.bookId ?? state.receipt?.bookId)),
);
const activeBranch = computed(() =>
  branches.find((branch) => branch.id === state.receipt?.branchId),
);
// 真實資料模式的「不支援／沒有結果」要提到官方資料，不能暗示示範內容。
const noticeText = (notice: TaskState['notice']) =>
  realData && notice === 'unsupported'
    ? t.value.unsupportedReal
    : realData && notice === 'empty'
      ? t.value.emptyReal
      : t.value[notice];
const reply = computed(() => noticeText(state.notice));
// 回答下方的選項：補資料用的選擇題（行政區、帳單種類），或下一步建議。
const choices = computed(() =>
  busy.value || state.draft ? null : followUps(state, { homeDistrict: homeDistrict.value }),
);
const suggestions = computed(() =>
  realData
    ? [
        // 陳情、繳費、叫號會開到台北通範本頁（示範資料），不當成建議。
        t.value.toiletSuggestion,
        t.value.parkingSuggestion,
        t.value.disabledSuggestion,
      ]
    : [t.value.browseBooks, t.value.browseServices],
);
const inputDisabled = computed(
  () => busy.value || !!state.draft || (mode.value === 'phone' && !phoneState.value.ready),
);
const showSuggestions = computed(
  () =>
    !busy.value &&
    !state.draft &&
    !state.receipt &&
    [
      'welcome',
      'greeting',
      'unsupported',
      'empty',
      'error',
      'cancelled',
      'navigationDeclined',
    ].includes(state.notice),
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
  navigation: Navigation | null;
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
    // Unsaved requests are simply left out rather than shown as a placeholder.
    request: turn.request ? messages[locale.value][turn.request] : (turn.text ?? ''),
    notice: turn.notice,
    books: [],
    records: [],
    navigation: null,
    source: null,
    bills: null,
    failure: null,
    traces: [],
  })),
);
let nextTurnId = turns.value.length;
taskTitle.value = turns.value.at(-1)?.request ?? '';
const conversationSaveFailed = ref(false);
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
  // Android WebView resizes the layout viewport for the keyboard, so innerHeight shrinks too.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  composerCompact.value =
    editing && (keyboardViewportHeight.value !== null || window.innerHeight < rem * 36);
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
  profile.value = loadProfile();
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
}
// 離開首頁時留一筆瀏覽紀錄，App 左上的返回鍵與系統返回手勢會先回到首頁，在首頁再按才離開助手。
const conversationEntry = 'agent-conversation';
watch(home, (isHome) => {
  const inConversation = history.state?.view === conversationEntry;
  if (!isHome && !inConversation) history.pushState({ view: conversationEntry }, '');
  else if (isHome && inConversation) history.back();
});
function onHistoryBack() {
  if (home.value || history.state?.view === conversationEntry) return;
  goHome();
  // 忙碌中留在對話畫面時，補回紀錄讓下一次返回仍回到首頁。
  if (!home.value) history.pushState({ view: conversationEntry }, '');
}
onMounted(() => window.addEventListener('popstate', onHistoryBack));
onBeforeUnmount(() => window.removeEventListener('popstate', onHistoryBack));
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
async function searchParking(
  space: ParkingSpace = 'disabled',
  radius: 1000 | 3000 = 1000,
  area: string | null = null,
  newRequest = true,
) {
  if (busy.value || state.draft || !toolClient) return;
  if (newRequest) archiveTurn();
  parkingSearch.value = { space, radius, area };
  lastRequest.value =
    space === 'disabled' ? t.value.parkingSuggestion : t.value.pregnancyParkingSuggestion;
  taskTitle.value = lastRequest.value;
  home.value = false;
  resumed.value = false;
  stage.value = area ? 'searching' : 'locating';
  busy.value = true;
  await focusResult();
  try {
    await runner.runTool('places', 'find_nearby_parking', {
      accessible: true,
      parking_space: space,
      ...(area ? { area } : { near_me: true, radius_m: radius }),
    });
  } catch {
    if (state.failure?.code === 'LOCATION_UNAVAILABLE') {
      state.notice = 'needLocation';
      parkingDistrict.value = homeDistrict.value ?? '';
    }
  } finally {
    busy.value = false;
    feedbackForAnswer();
    persistConversation();
    await focusResult();
  }
}
function parkingPhone(record: TaskState['records'][number]) {
  if (state.lastTool !== 'find_nearby_parking') return null;
  const phone = record.fields?.find((field) => field.label['zh-Hant-TW'] === '電話')?.value[
    'zh-Hant-TW'
  ];
  return phone && /^[+\d][\d\s()-]{5,24}$/.test(phone) ? phone.replace(/[^+\d]/g, '') : null;
}
// 一輪請求結束時的回饋。震動：有結果、出錯、緊急各一種（對照見 agent/outcome-feedback.ts），不帶
// 文字，因為畫面上的 role="status" 已經會播報。朗讀：「語音回饋」開著、而且確定沒開螢幕閱讀器時，
// 像按下「朗讀這段」一樣把回答唸出來（條件與哪些回答會唸見 agent/auto-read.ts）。只在剛結束時
// 呼叫，還原上次的對話或草稿時不會。
function feedbackForAnswer() {
  const kind = outcomeFeedback(state.notice);
  if (kind) feedback(kind);
  const readIt = shouldReadAnswerAloud(state.notice, {
    voiceFeedback: voiceFeedbackEnabled(),
    screenReader: a11yState.screenReader,
    speechSupported: speechSupported.value,
  });
  if (!readIt) return;
  try {
    startReading();
  } catch {
    // 朗讀只是額外的回饋，出錯也不能讓這一輪的收尾（存檔、移動焦點）做不完。
    speaking.value = false;
  }
}
// 點選建議或選項：馬上震動一下，因為回答可能還要等幾秒。
function pick(request: string) {
  feedback('selection');
  void submit(request);
}
function pickBillCategory(category: BillSelection) {
  feedback('selection');
  void billAction(category);
}
function pickNearbyParking() {
  feedback('selection');
  void searchParking();
}
async function submit(text = input.value) {
  if (inputDisabled.value || !text.trim()) return;
  parkingSearch.value = null;
  if (/^(?:你好|您好|嗨|哈囉|hello|hi)[!！。,.，\s]*$/iu.test(text.trim())) {
    archiveTurn();
    lastRequest.value = text.trim();
    taskTitle.value = lastRequest.value;
    input.value = '';
    home.value = false;
    resumed.value = false;
    Object.assign(state, initialState(), { notice: 'greeting' });
    saveTask(state);
    persistConversation();
    feedbackForAnswer();
    await focusResult();
    return;
  }
  profile.value = loadProfile();
  confirmingLink.value = null;
  leftFor.value = false;
  stopReading();
  speaking.value = false;
  voice.cancel();
  voiceOpen.value = false;
  home.value = false;
  archiveTurn();
  lastRequest.value = text.trim();
  // A district reply continues the same task, so the heading keeps the original request.
  taskTitle.value = fillsPendingLocation(state, text)
    ? taskTitle.value || state.pendingLocation!.request
    : lastRequest.value;
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
    feedbackForAnswer();
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
    feedbackForAnswer();
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
    feedbackForAnswer();
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
    feedbackForAnswer();
    void focusResult();
  }
}
function reset() {
  if (busy.value) return;
  stopReading();
  speaking.value = false;
  clearTask();
  clearConversation();
  parkingSearch.value = null;
  conversationSaveFailed.value = false;
  Object.assign(state, initialState());
  turns.value = [];
  resumed.value = false;
  lastRequest.value = '';
  taskTitle.value = '';
  input.value = '';
  pendingPhoto.value = null;
  photoEntryNotice.value = null;
  runner.cancelVision();
  cancelVoice();
  input.value = '';
  home.value = true;
  closeSettings();
}
function stay() {
  if (state.navigation) {
    state.navigation = null;
    state.notice = 'navigationDeclined';
  }
}
function requestPhoto() {
  if (busy.value || state.draft) return;
  if (!canSeePhotos.value) {
    photoEntryNotice.value = mode.value === 'demo' ? 'photoSimulated' : 'photoNotReady';
    return;
  }
  photoEntryNotice.value = null;
  photoInput.value?.click();
}
async function selectPhoto(event: Event) {
  const input = event.target as HTMLInputElement;
  const photo = input.files?.[0];
  input.value = '';
  if (!photo || !canSeePhotos.value || busy.value || state.draft) return;
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
    photo.size > 20 * 1024 * 1024
  ) {
    photoEntryNotice.value = 'photoError';
    return;
  }
  photoEntryNotice.value = null;
  pendingPhoto.value = photo;
  home.value = false;
  if (state.navigation?.id !== 'townpass_report') await submit(t.value.reportRequest);
  await nextTick();
  if (state.navigation?.id !== 'townpass_report') {
    pendingPhoto.value = null;
    photoEntryNotice.value = 'photoError';
  }
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
    runner.preferences.accessible = Boolean(profile.value.preferAccessible);
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
function setNaturalVoice(event: Event) {
  const box = event.target as HTMLInputElement;
  setNaturalVoiceEnabled(box.checked);
  // 儲存被瀏覽器擋住時存不下來，勾選就退回實際生效的值。
  box.checked = naturalVoice.value = naturalVoiceEnabled();
  stopReading();
  speaking.value = false;
  // 開啟時先在背景載入語音模型，第一次朗讀就不必等；關閉時釋放它佔用的記憶體。
  if (naturalVoice.value) void prepareNaturalVoice();
  else releaseNaturalVoice();
}
// 開始朗讀目前的回答，「朗讀這段」與自動朗讀共用。已經在朗讀的話，新的取代舊的。
function startReading() {
  // 先結束還在進行的朗讀：它的 finished 會同步把 speaking 設回 false，不能發生在下面設成 true 之後。
  stopReading();
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
  // 螢幕閱讀與朗讀的使用者也要聽得到選項。
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
// 「朗讀這段」按鈕：朗讀中再按一次就停止。
function speak() {
  if (speaking.value) {
    stopReading();
    speaking.value = false;
    return;
  }
  startReading();
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
  releaseNaturalVoice();
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
      <button v-if="mode === 'phone' && !home" class="phone-status-button" @click="openSettings">
        {{ phoneState.ready ? t.phoneConnected : t.phoneStart }}
      </button>
      <Transition name="view-fade" mode="out-in" @after-enter="onViewEntered">
        <WelcomePanel
          v-if="home"
          :locale="locale"
          :disabled="inputDisabled"
          :has-task="hasConversation"
          :pending-draft="!!state.draft"
          :nearby-parking="realData && !!toolClient"
          :nearby-parking-disabled="busy || !!state.draft"
          :native="native || mode === 'phone'"
          :model-needs-start="mode === 'phone' && !phoneState.ready"
          :model-starting="phoneStarting"
          :model-status="
            phoneState.error ? t[`phoneError_${phoneState.error}`] : t[`phone_${phoneState.phase}`]
          "
          @request="pick"
          @nearby-parking="pickNearbyParking"
          @voice="startVoice"
          @start-model="startPhone"
          @resume="home = false"
          @settings="openSettings"
        />

        <div v-else class="conversation">
          <div class="conversation-heading" :class="{ 'has-request': hasConversation }">
            <h1>{{ taskTitle || t.today }}</h1>
            <button class="icon-button" :aria-label="t.settings" @click="openSettings">
              <UiIcon name="settings" />
            </button>
          </div>
          <div v-if="!hasConversation && !voiceOpen" class="conversation-empty">
            <p>{{ t.welcome }}</p>
            <p class="small-note">{{ t.historyHint }}</p>
          </div>
          <div class="messages">
            <template v-for="turn in turns" :key="turn.id">
              <div v-if="turn.request" class="user-message">
                <span class="sr-only">{{ t.you }}</span>
                <p>{{ turn.request }}</p>
              </div>
              <article class="past-message" :aria-label="t.assistant">
                <p v-if="turn.restored" class="small-note">{{ t.savedSummaryNote }}</p>
                <p class="reply-bubble">{{ noticeText(turn.notice) }}</p>
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
                <p v-if="turn.navigation" class="small-note">
                  {{ turn.navigation.title[locale] }}（{{ turn.navigation.where }}）
                </p>
                <p v-if="turn.failure?.hint" class="small-note">{{ turn.failure.hint }}</p>
                <p v-if="turn.source && !turn.navigation" class="source-note">
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
                  @select="pickBillCategory"
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
                    <button
                      v-if="parkingPhone(record)"
                      class="outline-button"
                      :aria-label="t.callParking.replace('{name}', record.title[locale])"
                      @click="openLink(`tel:${parkingPhone(record)}`)"
                    >
                      {{ t.callParkingButton }}
                    </button>
                    <template v-if="record.url">
                      <div
                        v-if="confirmingLink === record.id"
                        class="leave-confirm"
                        role="group"
                        :aria-label="t.leaveTitle"
                      >
                        <p>{{ leaveQuestion(record) }}</p>
                        <div class="action-row">
                          <button class="primary-button" @click="goRecord(record.url)">
                            {{ t.leaveGo }}
                          </button>
                          <button class="text-button" @click="confirmingLink = null">
                            {{ t.leaveStay }}
                          </button>
                        </div>
                      </div>
                      <button v-else class="outline-button" @click="confirmingLink = record.id">
                        {{
                          record.url.startsWith('https://www.google.com/maps')
                            ? t.openMap
                            : t.openPage
                        }}
                      </button>
                    </template>
                  </li>
                </ul>
                <section
                  v-if="
                    parkingSearch &&
                    state.domain === 'places' &&
                    !busy &&
                    (state.notice === 'results' ||
                      state.notice === 'needLocation' ||
                      (state.notice === 'empty' && !parkingSearch.area))
                  "
                  class="parking-actions"
                  :aria-label="t.parkingActions"
                >
                  <p v-if="state.notice === 'results' && parkingSearch.area" class="small-note">
                    {{ t.parkingAreaNote }}
                  </p>
                  <p v-if="state.notice === 'results' && !parkingSearch.area" class="small-note">
                    {{ t.parkingDistanceNote }}
                  </p>
                  <p v-if="state.notice === 'empty' && !parkingSearch.area" class="small-note">
                    {{
                      t.parkingNoResults.replace('{radius}', String(parkingSearch.radius / 1000))
                    }}
                  </p>
                  <button
                    v-if="
                      state.notice === 'empty' &&
                      parkingSearch.radius === 1000 &&
                      !parkingSearch.area
                    "
                    class="outline-button"
                    @click="searchParking(parkingSearch.space, 3000, null, false)"
                  >
                    {{ t.parkingExpand }}
                  </button>
                  <button
                    v-if="state.notice === 'needLocation'"
                    class="outline-button"
                    @click="searchParking(parkingSearch.space, parkingSearch.radius, null, false)"
                  >
                    {{ t.parkingRetryLocation }}
                  </button>
                  <div
                    v-if="
                      state.notice === 'needLocation' ||
                      (state.notice === 'empty' &&
                        parkingSearch.radius === 3000 &&
                        !parkingSearch.area)
                    "
                    class="parking-district"
                  >
                    <label for="parking-district">{{ t.parkingChooseDistrict }}</label>
                    <select id="parking-district" v-model="parkingDistrict">
                      <option value="">{{ t.parkingDistrictPlaceholder }}</option>
                      <option
                        v-for="district in TAIPEI_DISTRICTS"
                        :key="district"
                        :value="district"
                      >
                        {{ district }}
                      </option>
                    </select>
                    <button
                      class="outline-button"
                      :disabled="!parkingDistrict"
                      @click="
                        searchParking(
                          parkingSearch.space,
                          parkingSearch.radius,
                          parkingDistrict,
                          false,
                        )
                      "
                    >
                      {{ t.parkingSearchDistrict }}
                    </button>
                  </div>
                </section>
                <ProfilePanel
                  v-if="state.notice === 'profile'"
                  :member="memberInfo"
                  :profile="profile"
                  :home-district="homeDistrict"
                  :locale="locale"
                />
                <EmergencyCard
                  v-if="state.notice === 'emergency' && state.emergency"
                  :kind="state.emergency"
                  :locale="locale"
                />
                <NavigationPanel
                  v-if="state.navigation"
                  :navigation="state.navigation"
                  :source="state.source"
                  :locale="locale"
                  :request="lastRequest"
                  :can-see-photos="canSeePhotos"
                  :demo-mode="mode === 'demo'"
                  :describe="(image: string) => runner.describePhoto(image, locale)"
                  :cancel-describe="() => runner.cancelVision()"
                  :photo-file="pendingPhoto"
                  @photo-consumed="pendingPhoto = null"
                  @stay="stay"
                />
                <p v-if="state.failure?.hint" class="notice-box">{{ state.failure.hint }}</p>
                <p v-if="state.source && !state.navigation" class="source-note">
                  {{ state.source.label }}：{{ state.source.note }}
                  <template v-if="state.source.truncated">{{
                    t.truncated.replace('{total}', String(state.source.total))
                  }}</template>
                  <button
                    v-if="
                      state.lastTool === 'find_nearby_parking' &&
                      state.source.url.startsWith('https://data.taipei/')
                    "
                    class="text-button"
                    @click="openLink(state.source.url)"
                  >
                    {{ t.parkingSourceLink }}
                  </button>
                </p>
                <button
                  v-if="state.notice === 'error' && lastRequest"
                  class="primary-button"
                  @click="
                    parkingSearch
                      ? searchParking(
                          parkingSearch.space,
                          parkingSearch.radius,
                          parkingSearch.area,
                          false,
                        )
                      : submit(lastRequest)
                  "
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
                <section
                  v-if="choices && !(parkingSearch && state.notice === 'needLocation')"
                  class="choices"
                  :class="{ 'choices-ask': choices.kind === 'choose' }"
                  aria-labelledby="choices-title"
                >
                  <h2 id="choices-title">{{ choices.prompt[locale] }}</h2>
                  <div class="recovery-options">
                    <button
                      v-for="choice in choices.options"
                      :key="choice.request"
                      class="outline-button"
                      :disabled="inputDisabled"
                      @click="pick(choice.request)"
                    >
                      {{ choice.label[locale] }}
                    </button>
                  </div>
                </section>
                <p v-if="leftFor" class="small-note" role="status">{{ t.leaveRequested }}</p>
                <div
                  v-if="showSuggestions"
                  class="recovery-options"
                  role="group"
                  :aria-label="t.quick"
                >
                  <button
                    v-for="suggestion in suggestions"
                    :key="suggestion"
                    class="outline-button"
                    :disabled="inputDisabled"
                    @click="pick(suggestion)"
                  >
                    {{ suggestion }}
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
        v-if="!home && !state.draft && !composerCompact"
        class="quick-chips"
        role="group"
        :aria-label="t.quick"
      >
        <!-- 只放查得到真實資料的捷徑：開放資料的廁所與停車場、官方身障服務頁。
             帳單、陳情、叫號會開到台北通範本頁（頁面內容是示範資料），所以不放。 -->
        <button
          :disabled="inputDisabled"
          :aria-label="t.toiletSuggestion"
          @click="pick(t.toiletSuggestion)"
        >
          <span aria-hidden="true"></span>{{ t.toiletShortcut }}
        </button>
        <button
          :disabled="inputDisabled"
          :aria-label="t.parkingSuggestion"
          @click="pick(t.parkingSuggestion)"
        >
          <span aria-hidden="true"></span>{{ t.parkingShortcut }}
        </button>
        <button
          :disabled="inputDisabled"
          :aria-label="t.disabledSuggestion"
          @click="pick(t.disabledSuggestion)"
        >
          <span aria-hidden="true"></span>{{ t.disabledShortcut }}
        </button>
      </div>
      <p v-if="state.draft && !home" class="draft-hint">{{ t.draftHint }}</p>
      <form class="composer" @submit.prevent="submit()">
        <input
          id="assistant-photo-input"
          ref="photoInput"
          class="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          :aria-label="t.photoPicker"
          aria-hidden="true"
          tabindex="-1"
          @change="selectPhoto"
        />
        <button
          type="button"
          class="add-button"
          :aria-label="t.photoReport"
          :disabled="busy || !!state.draft"
          @click="requestPhoto"
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
          <!-- 首頁已有語音大按鈕，麥克風只放在對話畫面，輸入框有字時換成送出鍵。 -->
          <button
            v-if="!home && !input.trim()"
            type="button"
            class="send-button mic-button"
            :aria-label="t.voiceLabel"
            :disabled="inputDisabled"
            @click="startVoice"
          >
            <UiIcon name="mic" />
          </button>
          <button
            type="submit"
            class="send-button"
            :class="{ 'is-empty': !input.trim() }"
            :aria-label="t.send"
            :disabled="inputDisabled || !input.trim()"
          >
            <UiIcon name="send" />
          </button>
        </div>
      </form>
      <p id="input-help" class="composer-note">
        <span>{{ mode === 'demo' ? t.ruleBadge : t.modelBadge }}</span
        ><span class="scope-copy"> · {{ !toolClient ? t.demoBadge : t.readOnlyBadge }}</span>
      </p>
      <p v-if="photoEntryNotice" class="photo-entry-note" role="status">
        {{ t[photoEntryNotice] }}
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
          <label class="check"
            ><input type="checkbox" :checked="hapticsOn" @change="setHaptics" />{{
              t.hapticFeedback
            }}</label
          >
          <label class="check"
            ><input type="checkbox" :checked="voiceFeedbackOn" @change="setVoiceFeedback" />{{
              t.voiceFeedback
            }}</label
          >
          <template v-if="native">
            <label class="check"
              ><input
                type="checkbox"
                :checked="naturalVoice"
                aria-describedby="natural-voice-hint"
                @change="setNaturalVoice"
              />{{ t.naturalVoice }}</label
            >
            <p id="natural-voice-hint" class="small-note">{{ t.naturalVoiceHint }}</p>
          </template>
        </section>
        <section class="settings-section remembered" aria-labelledby="remembered-title">
          <h3 id="remembered-title">{{ t.rememberedTitle }}</h3>
          <p v-if="!profile.waterNumber" class="small-note">{{ t.rememberedNone }}</p>
          <div v-else class="action-row">
            <span>{{ t.rememberedWater }} {{ formatWaterNumber(profile.waterNumber) }}</span>
            <button class="text-button" @click="forgetWater">{{ t.rememberedDelete }}</button>
          </div>
          <label
            >{{ t.fieldHome
            }}<select
              :value="profile.homeDistrict ?? ''"
              :aria-label="t.fieldHome"
              @change="setHomeDistrict"
            >
              <option value="">
                {{
                  memberInfo?.district
                    ? `${t.homeFromMember}（${memberInfo.district}）`
                    : t.homeUnset
                }}
              </option>
              <option v-for="d in TAIPEI_DISTRICTS" :key="d" :value="d">{{ d }}</option>
            </select></label
          >
          <label class="check"
            ><input
              type="checkbox"
              :checked="profile.preferAccessible"
              @change="setPreferAccessible"
            />{{ t.fieldAccessible }}</label
          >
        </section>
        <section v-if="!native && mode !== 'phone'" class="settings-section">
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
                <option v-if="!native" value="demo">{{ t.demoMode }}</option>
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
