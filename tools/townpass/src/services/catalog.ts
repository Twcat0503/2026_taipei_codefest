/** 台北通網頁服務總覽。link_only 代表涉及送件、付款或個人資料，只提供頁面連結。 */

export interface CatalogEntry {
  id: string;
  title: string;
  path: string;
  mode: "query" | "link_only";
  tools: string[];
  note?: string;
}

const WRITE_NOTE = "示範站沒有接上真實後端，這裡不提供送出動作；請使用者自行到頁面操作。";
const PERSONAL_NOTE = "內容是假的個人紀錄，不提供查詢以免被誤認成使用者資料。";

export const CATALOG: readonly CatalogEntry[] = [
  { id: "library", title: "圖書借閱", path: "/library-service/", mode: "query", tools: ["search_library_books", "get_library_book", "get_library_ranking", "list_library_branches", "list_library_notices"], note: "預約與借閱紀錄未提供。" },
  { id: "counter", title: "臨櫃叫號", path: "/counter-calling/", mode: "query", tools: ["search_service_counters"] },
  { id: "faq", title: "常見問題", path: "/qna", mode: "query", tools: ["search_faq"] },
  { id: "application", title: "申辦服務", path: "/", mode: "query", tools: ["search_application_services"], note: "只查項目，不送出申辦。" },
  { id: "fee", title: "繳費項目", path: "/fee-payment/others/", mode: "query", tools: ["search_fee_types"], note: "只查項目與所需欄位，不查帳單也不付款。「其他繳費」頁列出的是同一批項目。" },
  { id: "fee_scan", title: "掃碼繳費", path: "/fee-payment/scan/", mode: "link_only", tools: [], note: `需要相機掃描帳單條碼並付款。${WRITE_NOTE}` },
  { id: "citizen_report", title: "有話要說", path: "/citizen-report/", mode: "query", tools: ["list_report_categories"], note: "只查分類，不送出陳情。" },
  { id: "disaster_report", title: "災情通報", path: "/disaster-report", mode: "query", tools: ["list_report_categories"], note: "只查分類，不送出通報。緊急情況請撥打 119 或 110。" },
  { id: "perk", title: "優惠與票券", path: "/coupon/", mode: "query", tools: ["search_perks"], note: "不提供購票或兌換。" },
  { id: "surrounding", title: "找地點", path: "/surrounding-service/", mode: "query", tools: ["find_nearby_youbike", "find_nearby_parking", "find_nearby_toilets"] },
  { id: "police_report", title: "警政服務", path: "/police-report", mode: "link_only", tools: [], note: WRITE_NOTE },
  { id: "police_record", title: "報案紀錄", path: "/police-report/record", mode: "link_only", tools: [], note: PERSONAL_NOTE },
  { id: "subscription", title: "市政訊息訂閱", path: "/subscription", mode: "query", tools: ["list_subscription_topics"], note: "只列出可訂閱的主題，訂閱與取消請到頁面操作。" },
  { id: "subscription_items", title: "已訂閱訊息", path: "/subscription/item-list", mode: "link_only", tools: [], note: PERSONAL_NOTE },
  { id: "ticket_wallet", title: "票券錢包", path: "/ticket-wallet", mode: "link_only", tools: [], note: PERSONAL_NOTE },
  { id: "fee_history", title: "繳費紀錄", path: "/fee-payment/history/", mode: "link_only", tools: [], note: PERSONAL_NOTE },
];
