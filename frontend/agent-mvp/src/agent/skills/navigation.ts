/**
 * Official-destination skill. The model may suggest a destination id, but explicit wording in the
 * user's request wins: a 1.7B on-device model mislabels short requests often enough to matter.
 * Ids must match `open_official_service` in tools/townpass/src/destinations.ts.
 */
export const DESTINATION_RULES: readonly [id: string, pattern: RegExp][] = [
  ['call_1999', /1999|打電話|撥電話|撥打|call/i],
  ['petition', /陳情|檢舉|報修|反映|投訴|路燈|坑洞|噪音|違停|petition|complain/i],
  ['pay', /繳費|繳水費|水費|停車費|醫療費|學雜費|學費|規費|帳單|付款|\bpay\b|bill/i],
  ['services_maternity', /孕婦|懷孕|產檢|生產|準媽媽|pregnan|maternity/i],
  ['services_elderly', /長者|老人|銀髮|長輩|敬老|長照|elderly|senior/i],
  ['services_disabled', /身障|身心障礙|障礙者|復康|輔具|輪椅|disab|wheelchair/i],
  ['library_catalog', /書|圖書|館藏|借閱|借書|book|library/i],
  ['services_home', /申辦|申請|補助|服務|apply|application|service/i],
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
