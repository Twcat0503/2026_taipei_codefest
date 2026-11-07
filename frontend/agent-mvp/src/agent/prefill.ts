/**
 * 前往台北通站內服務時，哪些欄位可以替民眾帶入。欄位 id 對應範本表單的輸入框，
 * 也必須在 App 的白名單（lib/util/tp_prefill.dart）裡，否則 App 不會填。
 *
 * - remembered：民眾說過一次、記在這支手機（profile.ts）
 * - member：每次從台北通會員資料讀取（member.ts），不儲存
 * - draft：助手依民眾的原話整理（skills/form-fill.ts 的 fillFormGuarded，模型不可用時退回
 *   skills/report-draft.ts 的規則），在確認卡上讓民眾修改
 */
export type PrefillField =
  | 'water_number'
  | 'tax_id'
  | 'title'
  | 'description'
  | 'location'
  | 'mobile_number'
  | 'mail'
  /** 災情通報的「地點描述」（範本頁輸入框 id 是 desc）與「補充描述」。 */
  | 'desc'
  | 'additional_disc';
export type PrefillSlot = { field: PrefillField; source: 'remembered' | 'member' | 'draft' };

/** Destinations whose filled-in form lives on a different page than the service home. */
export const PREFILL_FORM_PATH: Record<string, string> = {
  // 「其他事項（自動選擇案件類別）」：不用先選分類，直接是填寫頁。
  townpass_report: '/citizen-report/form/R-99',
  // 線上報案第一步：聯絡資料（姓名與身分證字號頁面本身會從會員資料顯示）。
  townpass_police: '/police-report/form',
};

export const PREFILL_SLOTS: Record<string, PrefillSlot[]> = {
  fee_water: [{ field: 'water_number', source: 'remembered' }],
  fee_housing: [{ field: 'tax_id', source: 'member' }],
  fee_maintenance: [{ field: 'tax_id', source: 'member' }],
  fee_medical: [{ field: 'tax_id', source: 'member' }],
  townpass_police: [
    { field: 'mobile_number', source: 'member' },
    { field: 'mail', source: 'member' },
  ],
  townpass_report: [
    { field: 'title', source: 'draft' },
    { field: 'description', source: 'draft' },
    { field: 'location', source: 'draft' },
  ],
};

/**
 * 災情通報的分類（skills/townpass-forms.ts 的 DISASTER_CATEGORIES）對應範本的表單頁
 * /disaster-report/form/<id>；代號取自範本 public/mock/disaster_reporting.json。
 */
export const DISASTER_FORM_IDS: Record<string, string> = {
  '電線(桿)或纜線受損': 'D-1-1',
  '變電所、電廠受災': 'D-1-2',
  路燈故障: 'D-1-3',
  電力停電: 'D-1-4',
  橋樑基礎沖刷: 'D-2-1',
  橋樑斷裂: 'D-2-2',
  前述以外之橋梁災情: 'D-2-3',
  土石流: 'D-3-1',
  土石崩落: 'D-3-2',
  堰塞湖: 'D-3-3',
  建築物火災: 'D-4-1',
  危險物品火災: 'D-4-2',
  工廠火災: 'D-4-3',
  '其他(前述以外火災)': 'D-4-4',
};
