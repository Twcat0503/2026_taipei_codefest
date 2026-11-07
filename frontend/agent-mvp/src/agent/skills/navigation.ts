/**
 * Destination skill. The model may suggest a destination id, but explicit wording in the
 * user's request wins: a 1.7B on-device model mislabels short requests often enough to matter.
 * Ids must match `open_official_service` in tools/townpass/src/destinations.ts; Town Pass
 * in-app services come first, official websites only where the app has no micro-service.
 * `catalog` lists every in-app service instead of opening one.
 */
export const CATALOG_TOOL = 'list_townpass_services';
export const DESTINATION_RULES: readonly [id: string, pattern: RegExp][] = [
  ['catalog', /有哪些服務|有什麼服務|服務清單|可以做什麼|能做什麼|what services/i],
  ['call_1999', /1999|打電話|撥電話|撥打|call/i],
  ['townpass_disaster', /災情|淹水|樹倒|土石流|disaster|flood/i],
  ['townpass_report', /陳情|檢舉|報修|反映|投訴|路燈|坑洞|噪音|違停|有話要說|petition|complain/i],
  ['townpass_police', /報案|警察|警政|被偷|遺失|police/i],
  ['fee_history', /繳費紀錄|繳費記錄|繳過|payment history/i],
  ['fee_scan', /掃碼|條碼|掃描.*(繳費|帳單)/i],
  ['fee_water', /水費|water bill/i],
  ['fee_parking', /停車費|parking fee/i],
  ['fee_tax', /地方稅|房屋稅|地價稅|牌照稅|tax/i],
  ['fee_tuition', /學雜費|學費|tuition/i],
  ['fee_housing', /社宅|國宅|租金|public housing/i],
  ['fee_medical', /醫療費|醫藥費|medical fee/i],
  ['fee_maintenance', /維護費/i],
  ['fee_course', /公訓|課程費/i],
  ['fee', /繳費|帳單|付款|繳錢|\bpay\b|bill/i],
  ['townpass_counter', /叫號|臨櫃|號碼牌|櫃檯|queue|counter/i],
  ['townpass_subscription', /訂閱|推播|市政訊息|subscri/i],
  ['townpass_ticket_wallet', /票券錢包|我的票券|ticket wallet/i],
  ['townpass_coupon', /優惠|票券|折價|門票|景點|coupon|ticket/i],
  ['services_maternity', /孕婦|懷孕|產檢|生產|準媽媽|pregnan|maternity/i],
  ['services_elderly', /長者|老人|銀髮|長輩|敬老|長照|elderly|senior/i],
  ['services_disabled', /身障|身心障礙|障礙者|復康|輔具|輪椅|disab|wheelchair/i],
  ['townpass_library', /書|圖書|館藏|借閱|借書|book|library/i],
  ['townpass_faq', /常見問題|登入|註冊|密碼|faq/i],
  ['townpass_apply', /申辦|申請|補助|服務|apply|application|service/i],
];

export function destinationFor(request: string): string | null {
  return DESTINATION_RULES.find(([, pattern]) => pattern.test(request))?.[0] ?? null;
}

/** Task words at either end of a suggested keyword; titles keep their inner words. */
const EDGE =
  /^(?:幫我|幫忙|請|我想|我要|想要|查詢|查|搜尋|找一下|找|跟|和|與|有關|關於|相關|的|一本|一些|有沒有|有哪些|哪些|熱門|推薦|圖書館|圖書|館藏|書籍|書|借|books?|library|find|search|please|about|[，。！？、,.!?\s「」『』“”"])+|(?:有關|相關|的|書籍|書|圖書|館藏|books?|[，。！？、,.!?\s「」『』“”"])+$/giu;

/**
 * Only the library catalog takes a keyword, and only if the user actually said it.
 * This drops paraphrased or script-converted terms such as 熱門的书 for 熱門的書.
 */
export function catalogKeyword(request: string, suggested: unknown): string | undefined {
  const quoted = request.match(/[「『“"]([^」』”"]{1,30})[」』”"]/u)?.[1]?.trim();
  if (quoted) return quoted;
  if (typeof suggested !== 'string') return undefined;
  const raw = suggested.trim();
  if (!raw || !request.includes(raw)) return undefined;
  const cleaned = raw.replace(EDGE, '').trim();
  return cleaned && cleaned.length <= 30 ? cleaned : undefined;
}
