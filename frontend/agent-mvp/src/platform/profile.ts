/**
 * 個人資料卡：民眾說過一次就記住、下次自動帶入的資料。只存在這支手機的瀏覽器儲存空間，
 * 不送到模型或伺服器；設定裡可以查看與刪除。
 *
 * 身分證字號等敏感欄位不在這裡：那些每次從台北通會員資料讀取（member.ts），不寫入儲存空間。
 */
const KEY = 'tp-profile-v1';

export type Profile = { waterNumber?: string };

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
    return water ? { waterNumber: water } : {};
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
