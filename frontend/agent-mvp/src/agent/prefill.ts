/**
 * 前往台北通站內服務時，哪些欄位可以替民眾帶入。欄位 id 對應範本表單的輸入框，
 * 也必須在 App 的白名單（lib/util/tp_prefill.dart）裡，否則 App 不會填。
 *
 * - remembered：民眾說過一次、記在這支手機（profile.ts）
 * - member：每次從台北通會員資料讀取（member.ts），不儲存
 */
export type PrefillSlot = { field: 'water_number' | 'tax_id'; source: 'remembered' | 'member' };

export const PREFILL_SLOTS: Record<string, PrefillSlot[]> = {
  fee_water: [{ field: 'water_number', source: 'remembered' }],
  fee_housing: [{ field: 'tax_id', source: 'member' }],
  fee_maintenance: [{ field: 'tax_id', source: 'member' }],
  fee_medical: [{ field: 'tax_id', source: 'member' }],
};
