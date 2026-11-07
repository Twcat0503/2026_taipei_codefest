<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import UiIcon from './UiIcon.vue';
import { messages } from '../i18n';
import type { Locale, Navigation, TaskState } from '../agent/types';
import { PREFILL_FORM_PATH, PREFILL_SLOTS } from '../agent/prefill';
import { draftReport, type ReportDraft } from '../agent/skills/report-draft';
import type { ReportVision } from '../agent/skills/report-vision';
import { DISTRICTS, DISTRICT_SOURCE, PETITION_SOURCE } from '../agent/open-data/taipei';
import { pickReportPhoto } from '../platform/image';
import { openLink } from '../platform/location';
import { serviceOrigin } from '../platform/service-navigation';
import { maskIdNo, maskPhone, readMember, type Member } from '../platform/member';
import {
  formatWaterNumber,
  loadProfile,
  normalizeWaterNumber,
  rememberWaterNumber,
} from '../platform/profile';

/**
 * 「前往台北通服務」確認卡：助手只幫忙整理要帶過去的資料，前往要使用者按下才會開啟。
 * - 有話要說（townpass_report）：結構化報案表單（主旨／描述／行政區／地點）＋拍照描述
 * - 報案、繳費等：用台北通會員資料（手機、Email、身分證字號）或記住的水號帶入，只顯示不儲存
 */
const props = defineProps<{
  navigation: Navigation;
  source: TaskState['source'];
  locale: Locale;
  /** 使用者這一輪說的原話，用來整理報案草稿。 */
  request: string;
  /** 示範（規則模擬）模式沒有視覺模型；本機與手機模型才送照片。 */
  canSeePhotos: boolean;
  demoMode: boolean;
  describe: (image: string) => Promise<ReportVision>;
  cancelDescribe: () => void;
  /** 從輸入框附件加進來、等著描述的照片。 */
  photoFile: File | null;
}>();
const emit = defineEmits<{ stay: []; photoConsumed: [] }>();
const t = computed(() => messages[props.locale]);

// 快捷鈕與照片入口送的是固定句，不是使用者描述的問題，不拿來整理草稿。
const isCannedRequest = (text: string) =>
  [messages['zh-Hant-TW'].reportRequest, messages.en.reportRequest].includes(text.trim());

const slots = computed(() => PREFILL_SLOTS[props.navigation.id] ?? []);
const isReport = computed(() => slots.value.some((slot) => slot.source === 'draft'));

// --- Town Pass member data (memory only) ---
const member = ref<Member | 'loading' | 'unavailable' | null>(null);
async function loadMember() {
  member.value = 'loading';
  member.value = (await readMember()) ?? 'unavailable';
}
function memberField(m: Member, field: string) {
  return field === 'tax_id'
    ? m.idNo
    : field === 'mobile_number'
      ? m.phone
      : field === 'mail'
        ? m.email
        : undefined;
}
function shownMemberField(m: Member, field: string) {
  const value = memberField(m, field);
  if (!value) return '';
  return field === 'tax_id'
    ? maskIdNo(value)
    : field === 'mobile_number'
      ? maskPhone(value)
      : value;
}
const MEMBER_LABEL: Record<string, 'prefillIdNo' | 'prefillPhone' | 'prefillMail'> = {
  tax_id: 'prefillIdNo',
  mobile_number: 'prefillPhone',
  mail: 'prefillMail',
};
const needsMember = computed(() => slots.value.some((slot) => slot.source === 'member'));

// --- Water number (remembered on this phone) ---
const profile = ref(loadProfile());
const waterInput = ref('');
const rememberWater = ref(true);
const editingWater = ref(false);
const waterError = ref(false);

// --- Report draft ---
const draft = reactive<ReportDraft>({
  title: '',
  description: '',
  location: '',
  district: '',
  category: null,
});
const draftError = ref(false);

// --- Photo description ---
const photo = ref<string | null>(null);
const photoBusy = ref(false);
const photoOk = ref(false);
const photoError = ref<'error' | 'none' | 'unavailable' | 'notReady' | null>(null);
const photoInput = ref<HTMLInputElement>();
const photoMessageKey = computed<
  | 'photoBusy'
  | 'photoDone'
  | 'photoNone'
  | 'photoNotReady'
  | 'photoUnavailable'
  | 'photoSimulated'
  | 'photoError'
  | null
>(() => {
  if (photoBusy.value) return 'photoBusy';
  if (photoError.value === 'none') return 'photoNone';
  if (photoError.value === 'notReady') return 'photoNotReady';
  if (photoError.value === 'unavailable')
    return props.demoMode ? 'photoSimulated' : 'photoUnavailable';
  if (photoError.value === 'error') return 'photoError';
  if (photoOk.value) return 'photoDone';
  return null;
});
function resetPhoto() {
  props.cancelDescribe();
  photo.value = null;
  photoBusy.value = false;
  photoOk.value = false;
  photoError.value = null;
  if (photoInput.value) photoInput.value.value = '';
}
async function addPhoto(file: File) {
  photoError.value = null;
  photoOk.value = false;
  if (!props.canSeePhotos) {
    photoError.value = 'unavailable';
    return;
  }
  let image: string;
  try {
    image = await pickReportPhoto(file);
  } catch {
    photoError.value = 'error';
    return;
  }
  photo.value = image;
  photoBusy.value = true;
  try {
    const result = await props.describe(image);
    // 不覆蓋使用者已經寫好的內容；描述則接在後面。
    if (!draft.title.trim() && result.subject) draft.title = result.subject.slice(0, 40);
    const line = result.description.trim();
    if (line)
      draft.description = draft.description.trim()
        ? `${draft.description.trim()}\n${line}`.slice(0, 500)
        : line;
    draftError.value = false;
    photoOk.value = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    photoError.value =
      message === 'VISION_NO_RESULT'
        ? 'none'
        : message === 'PHONE_NOT_READY'
          ? 'notReady'
          : message === 'VISION_UNAVAILABLE'
            ? 'unavailable'
            : 'error';
  } finally {
    photoBusy.value = false;
  }
}
async function onPhotoPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) await addPhoto(file);
}

// A new card (even for the same service) starts from the new request.
const leftFor = ref(false);
watch(
  () => props.navigation,
  () => {
    Object.assign(
      draft,
      isReport.value
        ? draftReport(isCannedRequest(props.request) ? '' : props.request, undefined)
        : { title: '', description: '', location: '', district: '', category: null },
    );
    resetPhoto();
    draftError.value = false;
    waterInput.value = '';
    editingWater.value = false;
    waterError.value = false;
    leftFor.value = false;
    member.value = null;
    // 報案草稿的「我家」地址與電話／Email 都來自會員資料。
    if (isReport.value || needsMember.value) void loadMember();
  },
  { immediate: true },
);
// 草稿先依原話整理；會員資料回來後，原話提到「我家」才補得上地址。
watch(member, (value) => {
  if (!isReport.value || typeof value !== 'object' || !value?.address) return;
  const homeDraft = draftReport(props.request, value.address);
  if (!draft.location.trim() && homeDraft.location) {
    draft.location = homeDraft.location;
    if (!draft.district) draft.district = homeDraft.district;
  }
});
watch(
  () => props.photoFile,
  (file) => {
    if (!file) return;
    emit('photoConsumed');
    if (isReport.value) void addPhoto(file);
  },
  { immediate: true },
);
onBeforeUnmount(() => props.cancelDescribe());

function go(url: string, prefill?: Record<string, string>) {
  openLink(url, prefill);
  leftFor.value = true;
}
function goNavigation() {
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
    } else if (slot.source === 'draft') {
      if (slot.field === 'location') {
        const detail = draft.location.trim();
        const district = draft.district.trim();
        // Prepend the chosen district only when the typed location has none of its own.
        const value =
          district && detail && !/[一-鿿]{1,3}區/.test(detail)
            ? `${district}${detail}`
            : detail || district;
        if (value) prefill.location = value;
      } else if (slot.field === 'title' || slot.field === 'description') {
        const value = draft[slot.field].trim();
        if (value) prefill[slot.field] = value;
      }
    } else if (typeof member.value === 'object' && member.value) {
      const value = memberField(member.value, slot.field);
      if (value) prefill[slot.field] = value;
    }
  }
  const formPath = PREFILL_FORM_PATH[props.navigation.id];
  if (formPath) {
    if (isReport.value) {
      // The report form requires a subject and a description; an empty draft opens the list.
      if (Boolean(prefill.title) !== Boolean(prefill.description)) {
        draftError.value = true;
        return;
      }
      if (prefill.title) {
        go(`${serviceOrigin}${formPath}`, prefill);
        return;
      }
    } else if (Object.keys(prefill).length) {
      // Something to fill in: open the form itself instead of the service home.
      go(`${serviceOrigin}${formPath}`, prefill);
      return;
    }
  }
  go(props.navigation.url, prefill);
}
</script>

<template>
  <section class="result-card navigation-card" aria-labelledby="navigation-title">
    <span class="category">{{ navigation.provider }}</span>
    <h2 id="navigation-title">{{ navigation.title[locale] }}</h2>
    <p v-if="navigation.description?.[locale]">{{ navigation.description[locale] }}</p>
    <dl>
      <dt>{{ navigation.url.startsWith('tel:') ? t.leaveCall : t.leaveSite }}</dt>
      <dd>{{ navigation.where }}</dd>
    </dl>

    <form v-if="isReport" class="report-form" @submit.prevent="goNavigation">
      <p class="field-label">{{ t.draftIntro }}</p>
      <div class="report-photo">
        <input
          id="report-photo-input"
          ref="photoInput"
          class="sr-only"
          type="file"
          accept="image/*"
          capture="environment"
          :disabled="photoBusy"
          @change="onPhotoPicked"
        />
        <label v-if="!photo" class="outline-button photo-button" for="report-photo-input">
          <UiIcon name="camera" />{{ t.photoAdd }}
        </label>
        <img v-else :src="photo" :alt="t.photoAlt" class="photo-preview" />
        <button
          v-if="photo"
          type="button"
          class="text-button"
          :disabled="photoBusy"
          @click="resetPhoto"
        >
          {{ t.photoRemove }}
        </button>
        <p class="small-note">{{ t.photoHint }}</p>
        <p
          v-if="photoMessageKey"
          class="small-note"
          :class="{ 'field-error': photoError && photoError !== 'none' }"
          :role="photoBusy ? 'status' : 'alert'"
          :aria-live="photoBusy ? 'polite' : undefined"
        >
          {{ t[photoMessageKey] }}
        </p>
      </div>
      <dl v-if="draft.category" class="draft-category">
        <dt>{{ t.draftCategory }}</dt>
        <dd>{{ draft.category.main[locale] }} ・ {{ draft.category.sub }}</dd>
        <dt>{{ t.draftAgency }}</dt>
        <dd>{{ draft.category.agency }}</dd>
      </dl>
      <label class="field-label" for="draft-title">{{ t.draftTitle }}</label>
      <input id="draft-title" v-model="draft.title" maxlength="40" autocomplete="off" />
      <label class="field-label" for="draft-description">{{ t.draftDescription }}</label>
      <textarea
        id="draft-description"
        v-model="draft.description"
        maxlength="500"
        rows="3"
      ></textarea>
      <label class="field-label" for="draft-district">{{ t.draftDistrict }}</label>
      <select id="draft-district" v-model="draft.district" class="draft-district">
        <option value="">{{ t.draftDistrictAny }}</option>
        <option v-for="[zh, en] in DISTRICTS" :key="zh" :value="zh">
          {{ locale === 'en' ? en : zh }}
        </option>
      </select>
      <label class="field-label" for="draft-location">{{ t.draftLocation }}</label>
      <input
        id="draft-location"
        v-model="draft.location"
        maxlength="100"
        autocomplete="off"
        :placeholder="t.draftLocationHint"
      />
      <p v-if="draftError" role="alert" class="field-error">{{ t.draftIncomplete }}</p>
      <p class="small-note draft-sources">
        {{ t.dataSource }}：<a :href="PETITION_SOURCE.url" target="_blank" rel="noopener">{{
          PETITION_SOURCE.name
        }}</a
        >（{{ PETITION_SOURCE.provider }}）・<a
          :href="DISTRICT_SOURCE.url"
          target="_blank"
          rel="noopener"
          >{{ DISTRICT_SOURCE.name }}</a
        >（{{ DISTRICT_SOURCE.provider }}）
      </p>
    </form>
    <div v-else-if="slots.length" class="prefill">
      <template v-for="slot in slots" :key="slot.field">
        <template v-if="slot.field === 'water_number'">
          <template v-if="profile.waterNumber && !editingWater">
            <dl>
              <dt>{{ t.prefillWater }}</dt>
              <dd>{{ formatWaterNumber(profile.waterNumber) }}</dd>
            </dl>
            <button type="button" class="text-button" @click="editingWater = true">
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
            <p v-if="waterError" role="alert" class="field-error">{{ t.prefillWaterInvalid }}</p>
            <label class="check"
              ><input v-model="rememberWater" type="checkbox" />{{ t.prefillRemember }}</label
            >
          </template>
        </template>
        <template v-else>
          <dl v-if="typeof member === 'object' && member && memberField(member, slot.field)">
            <dt>{{ t[MEMBER_LABEL[slot.field]!] }}</dt>
            <dd>{{ shownMemberField(member, slot.field) }}</dd>
          </dl>
          <p v-else-if="member === 'unavailable'" class="small-note">{{ t.prefillNoMember }}</p>
        </template>
      </template>
    </div>
    <p class="small-note">{{ source?.note || t.leaveNote }}</p>
    <div class="action-row">
      <button type="button" class="primary-button" @click="goNavigation">
        {{ navigation.url.startsWith('tel:') ? t.leaveDial : t.leaveGo }}
      </button>
      <button type="button" class="text-button" @click="emit('stay')">{{ t.leaveStay }}</button>
    </div>
    <p v-if="leftFor" class="small-note" role="status">{{ t.leaveRequested }}</p>
  </section>
</template>
