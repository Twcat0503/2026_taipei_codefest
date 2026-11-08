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
import { emergencyReadout, type EmergencyKind } from './agent/skills/emergency';
import ProfilePanel from './components/ProfilePanel.vue';
import ParkingDetails from './components/ParkingDetails.vue';
import WelfarePanel from './components/WelfarePanel.vue';
import { welfareFor, welfareReadout, type WelfareSelection } from './agent/skills/welfare';
import { welfareGuides } from './agent/open-data/welfare';
import { parkingReadout, type ParkingSpace } from './agent/parking-presentation';
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
import { townpassSuggestionGroups } from './agent/suggestion-groups';
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
import type { FormContext, FormSpec } from './agent/skills/form-fill';
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
import { a11yState, loadA11yState } from './platform/a11y';
import { announce } from './platform/announcer';
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
import { createButtonGuidance } from './platform/button-guidance';
import { streamButtonExplanation } from './agent/button-explanation';
import { requestNative, hasNativeBridge } from './platform/native-bridge';
import { initialGuidance } from '../../shared/guidance-preference';

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
type ParkingSearch = { space: ParkingSpace; radius: 1000 | 3000; area: string | null };
const parkingSearch = ref<ParkingSearch | null>(null);
const showAllParking = ref(false);
const isParkingResult = computed(() => state.lastTool === 'find_nearby_parking');
const parkingSpace = computed(
  () => parkingSearch.value?.space ?? state.lastPlace?.parkingSpace ?? null,
);
const parkingArea = computed(() =>
  parkingSearch.value ? parkingSearch.value.area : state.lastPlace?.area,
);
const parkingByDistance = computed(
  () =>
    !parkingArea.value &&
    !!state.records[0]?.fields?.some((field) => field.label['zh-Hant-TW'] === '距離'),
);
const visibleRecords = computed(() =>
  isParkingResult.value && !showAllParking.value ? state.records.slice(0, 3) : state.records,
);
watch(
  () => state.records,
  () => {
    showAllParking.value = false;
  },
);
const parkingDistrict = ref('');
const resultHeading = ref<HTMLElement>();
const requestInput = ref<HTMLTextAreaElement>();
const photoInput = ref<HTMLInputElement>();
const pendingPhoto = ref<File | null>(null);
const photoEntryNotice = ref<'photoSimulated' | 'photoNotReady' | 'photoError' | null>(null);
let photoNoticeTimer: ReturnType<typeof setTimeout> | undefined;
const assistantBody = ref<HTMLElement>();
const keyboardViewportHeight = ref<number | null>(null);
/** Typing with little height left (soft keyboard open, or large text): hide the quick chips. */
const composerCompact = ref(false);
const preferencesDialog = ref<HTMLDialogElement>();
const assistantShell = ref<HTMLElement>();
const buttonGuidanceOn = ref(initialGuidance().enabled);
const buttonGuideSpeechFailed = ref(false);
const buttonGuideSyncFailed = ref(false);
let guidancePreferenceVersion = 0;
let guidanceReady: Promise<void> = Promise.resolve();
let buttonGuide: ReturnType<typeof createButtonGuidance> | undefined;
// Every entry starts on the home screen so the voice button is the first thing people see;
// a saved conversation or draft is picked up from there with "continue".
const home = ref(true);
const native = !!window.flutterObject;
const voiceOpen = ref(false);
const voiceStatus = ref<VoiceStatus>('idle');
const voiceOriginal = ref('');
let voiceStartVersion = 0;
const voice = createVoiceInput(
  (status) => {
    voiceStatus.value = status;
    if (status === 'error' && voiceOpen.value && a11yState.screenReader !== true)
      readAloud(
        t.value.voiceError,
        locale.value,
        Number(rate.value),
        () => {},
        () => {},
      );
  },
  (text) =>
    (input.value = `${voiceOriginal.value}${voiceOriginal.value ? ' ' : ''}${text}`.slice(0, 600)),
  () => {
    voiceOpen.value = false;
    if (inputDisabled.value) void focusInput();
    else void submit();
  },
);
const voiceMessage = computed(() => {
  const keys = {
    idle: 'voiceHint',
    starting: 'voiceStarting',
    listening: 'voiceListening',
    transcribing: 'voiceTranscribing',
    modelUnavailable: 'voiceModelUnavailable',
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
function setButtonGuidance(event: Event) {
  ++guidancePreferenceVersion;
  buttonGuidanceOn.value = (event.target as HTMLInputElement).checked;
  setPreference('tp-button-guidance', buttonGuidanceOn.value ? 'on' : 'off');
  void syncButtonGuidance({ enabled: buttonGuidanceOn.value, lang: locale.value });
}
async function syncButtonGuidance(data: Record<string, unknown> = {}) {
  if (!hasNativeBridge()) return;
  const version = guidancePreferenceVersion;
  try {
    const reply = await requestNative('button_guidance', data, { timeoutMs: 2000 });
    if (version !== guidancePreferenceVersion) return;
    if (reply.ok !== true || typeof reply.enabled !== 'boolean')
      throw new Error('GUIDANCE_SYNC_FAILED');
    buttonGuidanceOn.value = reply.enabled;
    setPreference('tp-button-guidance', reply.enabled ? 'on' : 'off');
    buttonGuideSyncFailed.value = false;
  } catch {
    if (version === guidancePreferenceVersion) buttonGuideSyncFailed.value = true;
  }
}
onMounted(() => {
  if (!assistantShell.value) return;
  buttonGuide = createButtonGuidance(assistantShell.value, {
    locale: () => locale.value,
    screenReader: () => a11yState.screenReader,
    explain: async function* (label, purpose, signal) {
      if (
        busy.value ||
        voiceOpen.value ||
        mode.value === 'demo' ||
        (mode.value === 'phone' && !phoneState.value.ready)
      )
        throw new Error('BUTTON_MODEL_UNAVAILABLE');
      yield* streamButtonExplanation(adapter, label, purpose, locale.value, signal);
    },
    reportSpeechFailure: (failed) => (buttonGuideSpeechFailed.value = failed),
    speak: (text, finished, failed) =>
      readAloud(text, locale.value, Number(rate.value), finished, failed),
    stop: stopReading,
  });
  buttonGuide.enable(buttonGuidanceOn.value);
  guidanceReady = syncButtonGuidance(
    getPreference('tp-button-guidance', '')
      ? { enabled: buttonGuidanceOn.value, lang: locale.value }
      : {},
  );
});
watch(locale, () => {
  ++guidancePreferenceVersion;
  void syncButtonGuidance({ lang: locale.value });
});
watch(
  [
    buttonGuidanceOn,
    locale,
    rate,
    () => a11yState.screenReader,
    mode,
    () => phoneState.value.ready,
  ],
  () => {
    buttonGuide?.enable(buttonGuidanceOn.value);
  },
);
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
const reply = computed(() =>
  state.welfare
    ? t.value.welfareIntro
    : isParkingResult.value && state.notice === 'results'
      ? t.value.parkingResults
      : noticeText(state.notice),
);
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
const quickGroup = ref(0);
const quickSuggestions = computed(() =>
  quickGroup.value === 0
    ? [
        { label: t.value.toiletShortcut, request: t.value.toiletSuggestion },
        { label: t.value.parkingShortcut, request: t.value.parkingSuggestion },
        { label: t.value.disabledShortcut, request: t.value.disabledSuggestion },
      ]
    : quickGroup.value === 1
      ? [
          {
            label: t.value.pregnancyParkingShortcut,
            request: '附近有孕婦車位的停車場',
            accessible: t.value.pregnancyParkingSuggestion,
          },
          {
            label: t.value.youbikeShortcut,
            request: '附近的 YouBike',
            accessible: t.value.youbikeSuggestion,
          },
          {
            label: t.value.elderlyShortcut,
            request: '長輩可以申請什麼補助',
            accessible: t.value.elderlySuggestion,
          },
        ]
      : townpassSuggestionGroups[quickGroup.value - 2]!.map((item) => ({
          label: `${t.value[item.key]}${item.demo ? t.value.suggestionDemoLabel : ''}`,
          request: item.request,
          accessible: `${t.value[item.key]}${item.demo ? t.value.suggestionDemoLabel : ''}`,
        })),
);
const inputDisabled = computed(
  () =>
    busy.value ||
    (!home.value && !!state.draft) ||
    (mode.value === 'phone' && !phoneState.value.ready),
);
const showSuggestions = computed(
  () =>
    !busy.value &&
    !state.draft &&
    !state.receipt &&
    [
      'welcome',
      'greeting',
      'capabilities',
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
  /** Emergency turns keep their call buttons, also after a reload. */
  emergency: EmergencyKind | null;
  reference?: string;
  receiptBook?: Localized;
  /** A saved parking lookup; after a reload it can be run again from the summary. */
  parking?: ParkingSpace;
  parkingResult?: boolean;
  lastTool?: string | null;
  welfare?: WelfareSelection | null;
};
const restoredTurns = restoreConversation();
const turns = ref<Turn[]>(
  restoredTurns.map((turn, index) => ({
    id: index,
    restored: true,
    time: turn.results?.time ?? 0,
    // Unsaved requests are simply left out rather than shown as a placeholder.
    request: turn.request ? messages[locale.value][turn.request] : (turn.text ?? ''),
    notice: turn.notice,
    books: turn.results?.books ?? [],
    records: turn.results?.records ?? [],
    navigation: null,
    source: turn.results?.source ?? null,
    bills: null,
    failure: null,
    traces: [],
    emergency: turn.emergency ?? null,
    lastTool: turn.results?.tool,
    parkingResult: turn.results?.tool === 'find_nearby_parking',
    parking:
      turn.results?.parking ??
      (turn.request === 'parkingSuggestion'
        ? ('disabled' as const)
        : turn.request === 'pregnancyParkingSuggestion'
          ? ('pregnancy' as const)
          : undefined),
  })),
);
let nextTurnId = turns.value.length;
taskTitle.value = turns.value.at(-1)?.request ?? '';
const conversationSaveFailed = ref(false);
function persistConversation() {
  const current =
    lastRequest.value && state.notice !== 'welcome'
      ? [
          {
            request: lastRequest.value,
            notice: state.notice,
            emergency: state.emergency,
            lastTool: state.lastTool,
            books: state.bookResults,
            records: state.records,
            source: state.source,
            time: Date.now(),
            parking: isParkingResult.value ? (parkingSpace.value ?? undefined) : undefined,
          },
        ]
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
    lastTool: state.lastTool,
    emergency: state.notice === 'emergency' ? (state.emergency ?? 'general') : null,
    reference: state.receipt?.reference,
    receiptBook: finished ? activeBook.value?.title : undefined,
    parkingResult: isParkingResult.value,
    parking: isParkingResult.value ? (parkingSpace.value ?? undefined) : undefined,
    welfare: state.welfare,
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
function onPageShow(event: PageTransitionEvent) {
  if (!event.persisted) return;
  runner.cancel();
  cancelVoice();
  stopReading();
  speaking.value = false;
  if (preferencesDialog.value?.open) closeSettings();
  if (home.value) void introduceHome();
  else home.value = true;
}
let homeIntroVersion = 0;
let homeIntroSpeaking = false;
function cancelHomeIntro() {
  homeIntroVersion++;
  if (homeIntroSpeaking) {
    homeIntroSpeaking = false;
    stopReading();
  }
}
async function introduceHome() {
  const version = ++homeIntroVersion;
  await Promise.all([guidanceReady, loadA11yState()]);
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (
    version !== homeIntroVersion ||
    !home.value ||
    !buttonGuidanceOn.value ||
    voiceOpen.value ||
    preferencesDialog.value?.open
  )
    return;
  const panel = assistantShell.value?.querySelector('.welcome-panel');
  const suggestions = panel?.querySelector('.suggestions-header');
  const hasSuggestions = !!suggestions && suggestions.getClientRects().length > 0;
  const hasContinue = !!panel?.querySelector('.welcome-suggestions .welcome-suggestion.is-resume');
  const text = [
    t.value.homeIntro,
    hasSuggestions ? t.value.homeIntroSuggestions : '',
    hasContinue ? t.value.homeIntroContinue : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (a11yState.screenReader === true) {
    announce(text);
    return;
  }
  homeIntroSpeaking = true;
  readAloud(
    text,
    locale.value,
    Number(rate.value),
    () => {
      homeIntroSpeaking = false;
    },
    () => {
      homeIntroSpeaking = false;
    },
  );
}
onMounted(() => {
  document.addEventListener('pointerdown', cancelHomeIntro, true);
  document.addEventListener('keydown', cancelHomeIntro, true);
  void introduceHome();
  window.addEventListener('pageshow', onPageShow);
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
function beginHomeTask() {
  if (home.value && !busy.value) reset();
}
function openTextConversation() {
  beginHomeTask();
  home.value = false;
}
function openSettings() {
  buttonGuide?.cancel();
  profile.value = loadProfile();
  const dialog = preferencesDialog.value;
  if (!dialog) return;
  dialog.inert = false;
  dialog.removeAttribute('aria-hidden');
  dialog.showModal();
}
function closeSettings() {
  buttonGuide?.cancel();
  const dialog = preferencesDialog.value;
  if (!dialog) return;
  dialog.inert = true;
  dialog.setAttribute('aria-hidden', 'true');
  dialog.close();
}
function goHome() {
  if (busy.value) return;
  buttonGuide?.cancel();
  cancelVoice();
  home.value = true;
}
// 離開首頁時留一筆瀏覽紀錄，App 左上的返回鍵與系統返回手勢會先回到首頁，在首頁再按才離開助手。
const conversationEntry = 'agent-conversation';
watch(home, (isHome) => {
  if (isHome) void introduceHome();
  else cancelHomeIntro();
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
  if (busy.value || (!home.value && !!state.draft)) return;
  beginHomeTask();
  stopReading();
  speaking.value = false;
  home.value = false;
  voiceOriginal.value = input.value;
  voiceOpen.value = true;
  voiceStatus.value = 'starting';
  const version = ++voiceStartVersion;
  const startListening = () => {
    if (version === voiceStartVersion && voiceOpen.value) voice.start(locale.value);
  };
  // Speak before opening the microphone so the prompt is not recognized as the user's request.
  if (a11yState.screenReader === true) startListening();
  else
    readAloud(
      t.value.voiceListeningCue,
      locale.value,
      Number(rate.value),
      startListening,
      startListening,
    );
}
function cancelVoice() {
  ++voiceStartVersion;
  stopReading();
  voice.cancel();
  if (voiceOpen.value) input.value = voiceOriginal.value;
  voiceOpen.value = false;
}
async function searchParking(
  space: ParkingSpace = 'disabled',
  radius: 1000 | 3000 = 1000,
  area: string | null = null,
  newRequest = true,
) {
  beginHomeTask();
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
  const localInformation = welfareFor(text.trim(), state.welfare);
  if (
    !text.trim() ||
    busy.value ||
    (!home.value && state.draft) ||
    (inputDisabled.value && !localInformation)
  )
    return;
  beginHomeTask();
  parkingSearch.value = null;
  const greeting = /^(?:你好|您好|嗨|哈囉|hello|hi)[!！。,.，\s]*$/iu.test(text.trim());
  const capabilities =
    /^(?:(?:你|妳|您)(?:可以|能|會)(?:做什麼|做甚麼|做啥|做哪些事|做哪些事情|幹嘛|幹什麼|幹什么|幫我做什麼|幫我做甚麼|幫我什麼|幫忙什麼)(?:嗎|呢)?|(?:what can you do|what do you do|how can you help(?: me)?))[?？!！。,.，\s]*$/iu.test(
      text.trim(),
    );
  if (greeting || capabilities) {
    archiveTurn();
    lastRequest.value = text.trim();
    taskTitle.value = lastRequest.value;
    input.value = '';
    home.value = false;
    resumed.value = false;
    Object.assign(state, initialState(), { notice: greeting ? 'greeting' : 'capabilities' });
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
    // A typed parking request gets the same options (switch space type, widen, by district).
    const place = state.lastPlace;
    if (state.lastTool === 'find_nearby_parking' && place?.parkingSpace)
      parkingSearch.value = { space: place.parkingSpace, radius: 1000, area: place.area ?? null };
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
  confirmingLink.value = null;
  leftFor.value = false;
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
  if (busy.value || (!home.value && state.draft)) return;
  clearTimeout(photoNoticeTimer);
  if (!canSeePhotos.value) {
    photoEntryNotice.value = mode.value === 'demo' ? 'photoSimulated' : 'photoNotReady';
    if (photoEntryNotice.value === 'photoSimulated') {
      photoNoticeTimer = setTimeout(() => {
        if (photoEntryNotice.value === 'photoSimulated') photoEntryNotice.value = null;
      }, 5000);
    }
    return;
  }
  photoEntryNotice.value = null;
  photoInput.value?.click();
}
async function selectPhoto(event: Event) {
  const input = event.target as HTMLInputElement;
  const photo = input.files?.[0];
  input.value = '';
  if (!photo || !canSeePhotos.value || busy.value || (!home.value && state.draft)) return;
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) ||
    photo.size > 20 * 1024 * 1024
  ) {
    photoEntryNotice.value = 'photoError';
    return;
  }
  beginHomeTask();
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
    if (mode.value === 'phone' && !phoneState.value.ready) void startPhone();
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
onMounted(() => {
  if (mode.value === 'phone') void startPhone();
});
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
  const parkingSpeech =
    isParkingResult.value && state.notice === 'results'
      ? parkingReadout(state.records, parkingSpace.value, locale.value, parkingByDistance.value)
      : '';
  const extra =
    state.emergency && state.notice === 'emergency'
      ? emergencyReadout(state.emergency, t.value)
      : state.draft
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
    (state.welfare ? welfareReadout(state.welfare, locale.value) : parkingSpeech) ||
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
  cancelHomeIntro();
  document.removeEventListener('pointerdown', cancelHomeIntro, true);
  document.removeEventListener('keydown', cancelHomeIntro, true);
  ++voiceStartVersion;
  ++guidancePreferenceVersion;
  buttonGuide?.dispose();
  window.removeEventListener('pageshow', onPageShow);
  clearTimeout(photoNoticeTimer);
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
    ref="assistantShell"
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
    <div class="assistant-main-frame">
      <button
        v-if="home"
        class="icon-button assistant-settings"
        :aria-label="t.settings"
        @click="openSettings"
      >
        <UiIcon name="settings" />
      </button>
      <main id="main" ref="assistantBody" class="assistant-body">
        <Transition name="view-fade" mode="out-in" @after-enter="onViewEntered">
          <WelcomePanel
            v-if="home"
            :locale="locale"
            :disabled="inputDisabled"
            :voice-disabled="busy || (!home && !!state.draft)"
            :has-task="hasConversation"
            :nearby-parking="realData && !!toolClient"
            :nearby-parking-disabled="busy || (!home && !!state.draft)"
            :native="native || mode === 'phone'"
            :model-needs-start="mode === 'phone' && !phoneState.ready"
            :model-status="
              phoneState.error
                ? t[`phoneError_${phoneState.error}`]
                : t[`phone_${phoneState.phase}`]
            "
            @request="pick"
            @nearby-parking="pickNearbyParking"
            @voice="startVoice"
            @resume="home = false"
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
                  <p v-if="turn.restored" class="small-note">
                    {{
                      turn.lastTool
                        ? t.savedResultNote.replace(
                            '{time}',
                            new Date(turn.time).toLocaleString(locale),
                          )
                        : t.savedSummaryNote
                    }}
                  </p>
                  <p class="reply-bubble">
                    {{
                      turn.welfare
                        ? turn.welfare.topic === 'overview'
                          ? t.welfareTitle
                          : welfareGuides[turn.welfare.topic].title[locale]
                        : noticeText(turn.notice)
                    }}
                  </p>
                  <EmergencyCard v-if="turn.emergency" :kind="turn.emergency" :locale="locale" />
                  <div
                    v-if="
                      turn.restored &&
                      turn.parking &&
                      turn.id === turns.at(-1)?.id &&
                      state.notice === 'welcome' &&
                      !busy
                    "
                    class="parking-actions"
                    role="group"
                    :aria-label="t.parkingActions"
                  >
                    <button class="outline-button" @click="searchParking(turn.parking)">
                      {{ t.parkingSearchAgain }}
                    </button>
                    <button
                      class="outline-button"
                      @click="searchParking(turn.parking === 'disabled' ? 'pregnancy' : 'disabled')"
                    >
                      {{
                        turn.parking === 'disabled'
                          ? t.parkingSwitchPregnancy
                          : t.parkingSwitchDisabled
                      }}
                    </button>
                  </div>
                  <ul v-if="turn.books.length" class="plain-list">
                    <li v-for="book in turn.books" :key="book.id">
                      <strong>{{ book.title[locale] }}</strong
                      ><span>{{ book.author[locale] }}</span>
                    </li>
                  </ul>
                  <ul v-if="turn.records.length" class="plain-list">
                    <li v-for="record in turn.records" :key="record.id">
                      <strong>{{ record.title[locale] }}</strong
                      ><ParkingDetails
                        v-if="turn.parkingResult"
                        :record="record"
                        :space="turn.parking ?? null"
                        :locale="locale"
                      /><span v-else-if="record.description?.[locale]">{{
                        record.description[locale]
                      }}</span>
                      <dl v-if="!turn.parkingResult && record.fields?.length">
                        <template v-for="field in record.fields" :key="field.label[locale]">
                          <dt>{{ field.label[locale] }}</dt>
                          <dd>{{ field.value[locale] }}</dd>
                        </template>
                      </dl>
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
                  <WelfarePanel
                    v-if="state.welfare"
                    :selection="state.welfare"
                    :locale="locale"
                    @select="
                      stopReading();
                      speaking = false;
                      state.welfare = $event;
                    "
                  />
                  <ul
                    v-if="shownBooks.length && !state.draft && !state.receipt"
                    class="result-list"
                  >
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
                  <p v-if="isParkingResult && state.notice === 'results'" class="small-note">
                    {{
                      parkingByDistance
                        ? t.parkingDistanceNote
                        : parkingArea
                          ? t.parkingAreaNote
                          : t.parkingCountNote
                    }}
                  </p>
                  <ul v-if="state.records.length" class="result-list">
                    <li v-for="record in visibleRecords" :key="record.id" class="result-card">
                      <span v-if="record.category?.[locale]" class="category">{{
                        record.category[locale]
                      }}</span>
                      <h2>{{ record.title[locale] }}</h2>
                      <ParkingDetails
                        v-if="isParkingResult"
                        :record="record"
                        :space="parkingSpace"
                        :locale="locale"
                      />
                      <p v-else-if="record.description?.[locale]">
                        {{ record.description[locale] }}
                      </p>
                      <dl v-if="!isParkingResult && record.fields?.length">
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
                  <button
                    v-if="isParkingResult && state.records.length > 3"
                    class="text-button"
                    :aria-expanded="showAllParking"
                    @click="showAllParking = !showAllParking"
                  >
                    {{
                      showAllParking
                        ? t.parkingShowLess
                        : t.parkingShowMore.replace('{count}', String(state.records.length - 3))
                    }}
                  </button>
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
                      class="outline-button"
                      @click="
                        searchParking(
                          parkingSearch.space === 'disabled' ? 'pregnancy' : 'disabled',
                          1000,
                          parkingSearch.area,
                        )
                      "
                    >
                      {{
                        parkingSearch.space === 'disabled'
                          ? t.parkingSwitchPregnancy
                          : t.parkingSwitchDisabled
                      }}
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
                    :fill-form="
                      mode === 'demo'
                        ? undefined
                        : (spec: FormSpec, request: string, context: FormContext) =>
                            runner.fillForm(spec, request, context)
                    "
                    :cancel-fill="() => runner.cancelForm()"
                    :photo-file="pendingPhoto"
                    @photo-consumed="pendingPhoto = null"
                    @stay="stay"
                  />
                  <p v-if="state.failure?.hint" class="notice-box">{{ state.failure.hint }}</p>
                  <div v-if="state.source && !state.navigation" class="source-note">
                    <template v-if="isParkingResult">
                      <p>{{ state.source.label }}</p>
                      <details class="parking-details">
                        <summary>{{ t.parkingSourceDetails }}</summary>
                        <p>{{ state.source.note }}</p>
                      </details>
                    </template>
                    <template v-else>{{ state.source.label }}：{{ state.source.note }}</template>
                    <template
                      v-if="state.source.truncated && (!isParkingResult || showAllParking)"
                      >{{ t.truncated.replace('{total}', String(state.source.total)) }}</template
                    >
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
                  </div>
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
    </div>

    <section v-if="voiceOpen" class="voice-dock" :aria-label="t.voiceLabel">
      <div class="voice-surface">
        <VoiceWave wide :active="voiceStatus === 'listening'" />
        <p role="status">{{ voiceMessage }}</p>
        <p v-if="input && voiceStatus === 'listening'" class="voice-transcript">{{ input }}</p>
        <div class="voice-actions">
          <button class="voice-dismiss" :aria-label="t.voiceCancel" @click="cancelVoice">
            <UiIcon name="close" />
          </button>
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
        <button
          v-for="suggestion in quickSuggestions"
          :key="suggestion.request"
          :disabled="inputDisabled"
          :aria-label="'accessible' in suggestion ? suggestion.accessible : suggestion.request"
          :data-suggestion-guide="quickGroup >= 2 ? 'demo' : 'request'"
          @click="pick(suggestion.request)"
        >
          <span aria-hidden="true"></span>{{ suggestion.label }}
        </button>
        <button
          type="button"
          data-suggestion-guide="refresh"
          @click="quickGroup = (quickGroup + 1) % (2 + townpassSuggestionGroups.length)"
        >
          {{ t.moreSuggestions }}
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
          :disabled="busy || (!home && !!state.draft)"
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
            @focus="openTextConversation"
            @keydown.enter.exact="onEnter"
          ></textarea>
          <button
            v-if="!home && !input.trim()"
            type="button"
            class="voice-input-button"
            :aria-label="t.voiceLabel"
            :disabled="busy || !!state.draft"
            @click="startVoice"
          >
            <UiIcon name="microphone" />
            <span>{{ t.voiceShort }}</span>
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
            ><input
              type="checkbox"
              :checked="buttonGuidanceOn"
              data-guide-toggle
              aria-describedby="button-guidance-hint"
              @change="setButtonGuidance"
            />{{ t.buttonGuidance }}</label
          >
          <p id="button-guidance-hint" class="small-note">{{ t.buttonGuidanceHint }}</p>
          <p v-if="buttonGuidanceOn && buttonGuideSpeechFailed" class="small-note" role="status">
            {{ t.guideSpeechFailed }}
          </p>
          <p v-if="buttonGuideSyncFailed" class="small-note" role="status">
            {{ t.guideSyncFailed }}
          </p>
          <p v-if="buttonGuidanceOn && a11yState.screenReader === true" class="small-note">
            {{ t.guideScreenReaderNotice }}
          </p>
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
        <section class="settings-section">
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
