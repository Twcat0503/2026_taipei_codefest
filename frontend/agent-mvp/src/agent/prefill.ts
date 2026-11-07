/**
 * 前往台北通站內服務時，哪些欄位可以替民眾帶入。欄位 id 對應範本表單的輸入框，
 * 也必須在 App 的白名單（lib/util/tp_prefill.dart）裡，否則 App 不會填。
 *
 * - remembered：民眾說過一次、記在這支手機（profile.ts）
 * - member：每次從台北通會員資料讀取（member.ts），不儲存
 * - draft：助手依民眾的原話整理（skills/report-draft.ts），在確認卡上讓民眾修改
 */
export type PrefillField = 'water_number' | 'tax_id' | 'title' | 'description' | 'location';
export type PrefillSlot = { field: PrefillField; source: 'remembered' | 'member' | 'draft' };

/** Destinations whose filled-in form lives on a different page than the service home. */
export const PREFILL_FORM_PATH: Record<string, string> = {
  // 「其他事項（自動選擇案件類別）」：不用先選分類，直接是填寫頁。
  townpass_report: '/citizen-report/form/R-99',
};

export const PREFILL_SLOTS: Record<string, PrefillSlot[]> = {
  fee_water: [{ field: 'water_number', source: 'remembered' }],
  fee_housing: [{ field: 'tax_id', source: 'member' }],
  fee_maintenance: [{ field: 'tax_id', source: 'member' }],
  fee_medical: [{ field: 'tax_id', source: 'member' }],
  townpass_report: [
    { field: 'title', source: 'draft' },
    { field: 'description', source: 'draft' },
    { field: 'location', source: 'draft' },
  ],
};
