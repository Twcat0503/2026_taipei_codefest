/**
 * 個人資料卡：民眾說過一次就記住、下次自動帶入的資料。只存在這支手機的瀏覽器儲存空間，
 * 不送到模型或伺服器；設定裡可以查看與刪除。
 *
 * 身分證字號等敏感欄位不在這裡：那些每次從台北通會員資料讀取（member.ts），不寫入儲存空間。
 */
const KEY = 'tp-profile-v1';

export type Profile = {
  waterNumber?: string;
  /** 民眾指定的「我家附近」行政區；沒指定時用會員資料的戶籍行政區。 */
  homeDistrict?: string;
  /** 找地點時預設只列有無障礙設施的地點（使用偏好，不是障別或健康資料）。 */
  preferAccessible?: boolean;
};

export const TAIPEI_DISTRICTS = [
  '中正區',
  '大同區',
  '中山區',
  '松山區',
  '大安區',
  '萬華區',
  '信義區',
  '士林區',
  '北投區',
  '內湖區',
  '南港區',
  '文山區',
] as const;

/** 水號共 10 碼：大區 1 碼、中區 2 碼、戶號 6 碼、檢核號 1 碼。接受帶連字號或空白的寫法。 */
export function normalizeWaterNumber(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{10}$/.test(digits) ? digits : null;
}
export const formatWaterNumber = (digits: string) =>
  `${digits.slice(0, 1)}-${digits.slice(1, 3)}-${digits.slice(3, 9)}-${digits.slice(9)}`;

export function loadProfile(): Profile {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const water =
      typeof data.waterNumber === 'string' ? normalizeWaterNumber(data.waterNumber) : null;
    const profile: Profile = {};
    if (water) profile.waterNumber = water;
    if ((TAIPEI_DISTRICTS as readonly string[]).includes(data.homeDistrict))
      profile.homeDistrict = data.homeDistrict;
    if (data.preferAccessible === true) profile.preferAccessible = true;
    return profile;
  } catch {
    return {};
  }
}

function save(profile: Profile) {
  try {
    if (Object.keys(profile).length) localStorage.setItem(KEY, JSON.stringify(profile));
    else localStorage.removeItem(KEY);
  } catch {
    /* Private mode or full storage: nothing is remembered, the flow still works. */
  }
}

export function rememberWaterNumber(digits: string) {
  save({ ...loadProfile(), waterNumber: digits });
}
export function forgetWaterNumber() {
  const profile = loadProfile();
  delete profile.waterNumber;
  save(profile);
}

export function updateProfile(change: Partial<Profile>) {
  const next: Profile = { ...loadProfile(), ...change };
  for (const key of Object.keys(next) as (keyof Profile)[])
    if (next[key] === undefined || next[key] === false || next[key] === '') delete next[key];
  save(next);
}
