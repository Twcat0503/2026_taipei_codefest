/**
 * 官方服務入口白名單。模型只能選代號，網址一律由這裡組出來，不接受模型產生的網址。
 * 每個網址都在 2026-11-07 實際開啟確認過內容；改網址前請先在瀏覽器確認頁面仍是同一個服務。
 */

export interface Destination {
  id: string;
  /** 畫面上的名稱。 */
  title: string;
  /** 到了那個頁面可以做什麼，白話說明。 */
  description: string;
  /** 誰提供的。 */
  provider: string;
  /** https 網址，或 tel: 電話。 */
  url: string;
  /** 有些入口可以帶搜尋關鍵字。 */
  search?: (keyword: string) => string;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "library_catalog",
    title: "臺北市立圖書館館藏查詢",
    description: "查書、看各分館是否在館、預約借閱（預約需登入借閱證）。",
    provider: "臺北市立圖書館",
    url: "https://book.tpml.edu.tw/",
    search: (keyword) => `https://book.tpml.edu.tw/search?searchField=FullText&searchInput=${encodeURIComponent(keyword)}`,
  },
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
    id: "services_home",
    title: "台北服務通",
    description: "臺北市政府線上申辦入口，可依身分、人生階段、機關找申辦項目。",
    provider: "臺北市政府",
    url: "https://service.taipei/",
  },
  {
    id: "petition",
    title: "臺北市陳情系統",
    description: "反映路燈、道路、噪音等市政問題或提出陳情（送出前需填寫聯絡資料）。",
    provider: "臺北市政府",
    url: "https://1999.gov.taipei/",
  },
  {
    id: "call_1999",
    title: "撥打 1999 臺北市民當家熱線",
    description: "用電話詢問市政服務或反映問題，由專人協助。",
    provider: "臺北市政府",
    url: "tel:1999",
  },
  {
    id: "pay",
    title: "臺北市政府智慧支付平台",
    description: "繳水費、停車費、醫療費、學雜費與各項規費；查帳單需輸入繳費單上的資料。",
    provider: "臺北市政府",
    url: "https://pay.taipei/",
  },
];

export const DESTINATION_IDS = DESTINATIONS.map((d) => d.id) as [string, ...string[]];

/** 搜尋字只接受短的純文字，避免把長句或網址塞進查詢。 */
export function destinationUrl(destination: Destination, keyword: string | undefined): string {
  const clean = keyword?.trim();
  if (destination.search && clean && clean.length <= 30 && !/[/:?#&=<>]/.test(clean)) return destination.search(clean);
  return destination.url;
}
