/**
 * 可前往的服務入口白名單。模型只能選代號，網址一律由這裡組出來，不接受模型產生的網址。
 *
 * - 站內（inApp）：台北通 App 裡的微服務頁面（TownPass-Services），與 App 的服務頁、帳務頁開的是同一組網址；
 *   頁面內容是範本示範資料，畫面上要照實標示。
 * - 官方網站：台北通沒有對應微服務的項目，才導到臺北市政府官方網站。
 * 每個網址都在 2026-11-07 實際開啟確認過；改網址前請先確認頁面仍是同一個服務。
 */

export interface Destination {
  id: string;
  /** 畫面上的名稱。 */
  title: string;
  /** 到了那個頁面可以做什麼，白話說明。 */
  description: string;
  /** 誰提供的。 */
  provider: string;
  /** 站內頁面的路徑（接在台北通微服務網址後面）。 */
  path?: string;
  /** 官方網站的 https 網址，或 tel: 電話。 */
  url?: string;
  /** 有些入口可以帶搜尋關鍵字。 */
  search?: (keyword: string) => string;
}

const TOWNPASS = "台北通";

export const DESTINATIONS: readonly Destination[] = [
  // ── 台北通站內微服務 ──
  {
    id: "townpass_report",
    title: "有話要說",
    description: "選擇案件分類，填寫發生地點、主旨與描述，向市府反映問題。",
    provider: TOWNPASS,
    path: "/citizen-report/",
  },
  {
    id: "townpass_disaster",
    title: "災情通報",
    description: "通報淹水、樹倒、電線受損等災情地點。緊急情況請直接撥打 119 或 110。",
    provider: TOWNPASS,
    path: "/disaster-report",
  },
  {
    id: "townpass_apply",
    title: "申辦服務",
    description: "查看可線上申辦的項目，填寫申辦表單。",
    provider: TOWNPASS,
    path: "/",
  },
  {
    id: "townpass_counter",
    title: "臨櫃叫號",
    description: "查看戶政、地政、區公所等櫃檯目前叫到幾號、還要等多少人。",
    provider: TOWNPASS,
    path: "/counter-calling/",
  },
  {
    id: "townpass_library",
    title: "圖書借閱",
    description: "搜尋館藏、看熱門書與分館，查看書籍詳情與預約狀況。",
    provider: TOWNPASS,
    path: "/library-service/",
    search: (keyword) => `/library-service/keyword-search?search=${encodeURIComponent(keyword)}&type=all`,
  },
  {
    id: "townpass_subscription",
    title: "市政訊息訂閱",
    description: "選擇想收到的市政訊息，例如交通措施、銀髮資訊。",
    provider: TOWNPASS,
    path: "/subscription",
  },
  {
    id: "townpass_police",
    title: "警政服務",
    description: "線上報案與查看報案紀錄。緊急情況請直接撥打 110。",
    provider: TOWNPASS,
    path: "/police-report",
  },
  {
    id: "townpass_coupon",
    title: "優惠與票券",
    description: "查看景點、票券與優惠券。",
    provider: TOWNPASS,
    path: "/coupon/",
  },
  {
    id: "townpass_ticket_wallet",
    title: "票券錢包",
    description: "查看已購買的票券。",
    provider: TOWNPASS,
    path: "/ticket-wallet",
  },
  {
    id: "townpass_faq",
    title: "常見問題",
    description: "台北通的登入、卡證、優惠與帳單等常見問題。",
    provider: TOWNPASS,
    path: "/qna",
  },
  // 繳費：和 App「帳務」頁的入口相同。
  { id: "fee", title: "繳費", description: "選擇繳費項目，輸入或掃描繳費單資料。", provider: TOWNPASS, path: "/fee-payment/" },
  { id: "fee_parking", title: "繳停車費", description: "查詢並繳納停車費。", provider: TOWNPASS, path: "/fee-payment/detail/fee-5/" },
  { id: "fee_water", title: "繳水費", description: "輸入水號查詢並繳納水費。", provider: TOWNPASS, path: "/fee-payment/detail/fee-6/" },
  { id: "fee_tax", title: "繳地方稅", description: "查詢並繳納地方稅。", provider: TOWNPASS, path: "/fee-payment/detail/tax-1/" },
  { id: "fee_tuition", title: "繳學雜費", description: "查詢並繳納學雜費。", provider: TOWNPASS, path: "/fee-payment/detail/fee-7/" },
  { id: "fee_housing", title: "繳國／社宅租金維管費", description: "查詢並繳納國宅、社宅租金與管理費。", provider: TOWNPASS, path: "/fee-payment/detail/fee-8/" },
  { id: "fee_medical", title: "繳聯合醫院醫療費", description: "查詢並繳納聯合醫院醫療費。", provider: TOWNPASS, path: "/fee-payment/detail/fee-9/" },
  { id: "fee_maintenance", title: "繳平價住宅維護費", description: "查詢並繳納平價住宅維護費。", provider: TOWNPASS, path: "/fee-payment/detail/fee-10/" },
  { id: "fee_course", title: "繳公訓處自費課程", description: "查詢並繳納公訓處自費課程費用。", provider: TOWNPASS, path: "/fee-payment/detail/fee-11/" },
  { id: "fee_other", title: "其他繳費", description: "其他繳費項目。", provider: TOWNPASS, path: "/fee-payment/others/" },
  { id: "fee_scan", title: "掃碼繳費", description: "用相機掃描繳費單條碼後繳費。", provider: TOWNPASS, path: "/fee-payment/scan/" },
  { id: "fee_history", title: "繳費紀錄", description: "查看過去的繳費紀錄。", provider: TOWNPASS, path: "/fee-payment/history/" },
  // ── 台北通沒有對應微服務：臺北市政府官方網站 ──
  {
    id: "services_disabled",
    title: "台北服務通：身障者相關服務",
    description: "身心障礙者生活補助、醫療輔具補助、需求評估等申辦項目與申辦方式。",
    provider: "臺北市政府",
    url: "https://service.taipei/search-item?codeKind=IdentityGroup&classificationCode=Disabled",
  },
  {
    id: "services_maternity",
    title: "台北服務通：孕婦相關服務",
    description: "孕婦可申請的補助與服務項目，以及申辦方式。",
    provider: "臺北市政府",
    url: "https://service.taipei/search-item?codeKind=IdentityGroup&classificationCode=Maternity",
  },
  {
    id: "services_elderly",
    title: "台北服務通：長者相關服務",
    description: "長者（銀髮族）可申請的補助與服務項目，以及申辦方式。",
    provider: "臺北市政府",
    url: "https://service.taipei/search-item?codeKind=IdentityGroup&classificationCode=Elderly",
  },
  {
    id: "call_1999",
    title: "撥打 1999 臺北市民當家熱線",
    description: "用電話詢問市政服務或反映問題，由專人協助。",
    provider: "臺北市政府",
    url: "tel:1999",
  },
];

export const DESTINATION_IDS = DESTINATIONS.map((d) => d.id) as [string, ...string[]];

/** 搜尋字只接受短的純文字，避免把長句或網址塞進查詢。 */
export function destinationUrl(destination: Destination, keyword: string | undefined, townpassBase: string): string {
  const clean = keyword?.trim();
  const usable = clean && clean.length <= 30 && !/[/:?#&=<>]/.test(clean);
  if (destination.path !== undefined) {
    return `${townpassBase}${usable && destination.search ? destination.search(clean) : destination.path}`;
  }
  return destination.url!;
}
