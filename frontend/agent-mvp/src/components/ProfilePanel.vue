<script setup lang="ts">
import { computed } from 'vue';
import { messages } from '../i18n';
import type { Locale } from '../agent/types';
import { formatWaterNumber, type Profile } from '../platform/profile';
import { maskIdNo, maskPhone, type Member } from '../platform/member';

/** 「我的資料」：台北通會員資料（遮罩）與助手記住的資料；會員資料只顯示、不儲存。 */
const props = defineProps<{
  member: Member | null;
  profile: Profile;
  homeDistrict?: string;
  locale: Locale;
}>();
const t = computed(() => messages[props.locale]);
</script>

<template>
  <section class="result-card" aria-labelledby="profile-title">
    <h2 id="profile-title">{{ t.profileMember }}</h2>
    <dl v-if="member">
      <template v-if="member.realName"
        ><dt>{{ t.fieldName }}</dt>
        <dd>{{ member.realName }}</dd></template
      >
      <template v-if="member.phone"
        ><dt>{{ t.fieldPhone }}</dt>
        <dd>{{ maskPhone(member.phone) }}</dd></template
      >
      <template v-if="member.email"
        ><dt>{{ t.fieldEmail }}</dt>
        <dd>{{ member.email }}</dd></template
      >
      <template v-if="member.birthday"
        ><dt>{{ t.fieldBirthday }}</dt>
        <dd>{{ member.birthday }}</dd></template
      >
      <template v-if="member.address"
        ><dt>{{ t.fieldAddress }}</dt>
        <dd>{{ member.address }}</dd></template
      >
      <dt>{{ t.fieldIdNo }}</dt>
      <dd>{{ maskIdNo(member.idNo) }}</dd>
    </dl>
    <p v-else class="small-note">{{ t.profileNoMember }}</p>
    <h2>{{ t.profileRemembered }}</h2>
    <dl>
      <dt>{{ t.rememberedWater }}</dt>
      <dd>{{ profile.waterNumber ? formatWaterNumber(profile.waterNumber) : t.notSet }}</dd>
      <dt>{{ t.fieldHome }}</dt>
      <dd>{{ homeDistrict ?? t.notSet }}</dd>
      <dt>{{ t.fieldAccessible }}</dt>
      <dd>{{ profile.preferAccessible ? t.yes : t.no }}</dd>
    </dl>
    <p class="small-note">{{ t.profileNote }}</p>
  </section>
</template>
