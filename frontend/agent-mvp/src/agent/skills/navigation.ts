import { normalizeRequest } from './normalize';

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
  ['townpass_places', /找地點|看地圖|地圖上|打開地圖|on the map|map/i],
  [
    'call_1999',
    /1999|打電話|撥電話|撥打|真人|專人|客服|人工|講電話|\bcall\b|hotline|(talk|speak) to (a )?(real )?(person|human|someone)/i,
  ],
  [
    'townpass_disaster',
    /災情|淹水|積水|水淹|淹進|淹到|大水|樹倒|倒樹|路樹倒|電線(掉|斷|垂)|電線桿倒|土石|坍方|落石|山崩|崩塌|disaster|flood|landslide|fallen tree/i,
  ],
  [
    'townpass_report',
    /陳情|檢舉|報修|反映|投訴|路燈|坑洞|破洞|人行道.{0,4}(壞|破|不平|翹)|垃圾|流浪(狗|貓)|野狗|違停|亂停|違規停車|噪音|很吵|好吵|紅綠燈.{0,4}(壞|不亮)|號誌|有話要說|petition|complain|pothole|garbage|stray|noise/i,
  ],
  ['townpass_police', /報案|警察|警政|被偷|遺失|police/i],
  [
    'fee_history',
    /繳費紀錄|繳費記錄|繳過|繳成功|有沒有繳|繳了沒|付過了|payment history|did i pay/i,
  ],
  ['fee_scan', /掃碼|條碼|掃描.*(繳費|帳單)/i],
  ['fee_water', /水費|自來水|水錢|water bill/i],
  ['fee_parking', /停車費|parking fee/i],
  ['fee_tax', /地方稅|房屋稅|地價稅|牌照稅|繳稅|稅金|稅單|tax/i],
  ['fee_tuition', /學雜費|學費|註冊費|tuition|school fee/i],
  ['fee_housing', /社宅|國宅|租金|public housing/i],
  [
    'fee_medical',
    /醫療費|醫藥費|看病(的)?錢|看病費|住院費|醫院(的)?(費用|帳單)|medical (fee|bill)|hospital bill/i,
  ],
  ['fee_maintenance', /維護費/i],
  ['fee_course', /公訓|課程費/i],
  ['fee', /繳費|帳單|付款|繳錢|費用|\bpay\b|bill/i],
  [
    'townpass_counter',
    /叫號|臨櫃|號碼牌|櫃檯|排到幾號|叫到幾號|現在幾號|排隊|等多久|queue|counter|waiting/i,
  ],
  [
    'townpass_subscription',
    /訂閱|推播|市政訊息|通知我|提醒我|收到.{0,10}(消息|通知)|subscri|notif/i,
  ],
  [
    'townpass_ticket_wallet',
    /票券錢包|我的票券|我買的.{0,6}(票|門票)|買過的票|已經買的票|ticket wallet|tickets? i (bought|purchased)/i,
  ],
  ['townpass_coupon', /優惠|票券|折價|門票|景點|coupon|ticket/i],
  ['services_maternity', /孕婦|懷孕|產檢|生產|準媽媽|pregnan|maternity/i],
  [
    'services_elderly',
    /長者|老人|銀髮|長輩|敬老|長照|六十五歲|65\s*歲|老年|elderly|senior|over 65/i,
  ],
  ['services_disabled', /身障|身心障礙|障礙者|復康|輔具|輪椅|disab|wheelchair/i],
  // 《書名》 is how Chinese marks a book title.
  [
    'townpass_library',
    /書|圖書|館藏|借閱|借書|《[^》]+》|小說|繪本|雜誌|作者|著作|讀物|book|library|novel/i,
  ],
  ['townpass_faq', /常見問題|登入|註冊|密碼|faq/i],
  ['townpass_apply', /申辦|申請|補助|服務|線上辦|網路上辦|網路辦|證明|apply|application|service/i],
];

export function destinationFor(request: string): string | null {
  const text = normalizeRequest(request);
  return DESTINATION_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
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
  // A single character left after trimming (新 from 新書) is not a search term.
  return cleaned && cleaned.length >= 2 && cleaned.length <= 30 ? cleaned : undefined;
}
