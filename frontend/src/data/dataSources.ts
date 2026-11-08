import { WELFARE_CHECKED_AT, WELFARE_SOURCES } from '../../shared/welfare-sources';

/**
 * /about 頁列出的資料來源。
 * 規則：只放程式碼裡實際用到、且能指出出處的資料；查不到出處的欄位寫「未標示」，不推測。
 */

export interface OpenDataSource {
  /** 畫面上的名稱（取自 public/mock/place_list.json） */
  name: string;
  /** 提供機關（取自 public/mock/place_list.json 的 agency） */
  agency: string;
  /** 程式碼實際請求的網址（取自 public/mock/place_list.json 的 request_url） */
  url: string;
  /** 用在哪個畫面 */
  usedIn: string;
  /** 資料時間說明 */
  dataTime: string;
}

export interface DemoDataSource {
  /** 示範資料檔（public/mock/ 下的檔名） */
  file: string;
  /** 用在哪個畫面 */
  usedIn: string;
  /** 若程式碼註明了提供機關才填；否則為「未標示」 */
  agency: string;
}

export const OPEN_DATA_LICENSE_URL = 'https://data.gov.tw/license';

export const OPEN_DATA_SOURCES: OpenDataSource[] = [
  ...WELFARE_SOURCES.map((source) => ({
    name: source.name,
    agency: source.agency,
    url: source.url,
    usedIn: '安心助手：補助與復康的條件、準備清單與辦理步驟（官方說明摘要）',
    dataTime: `非即時資訊；最後查核 ${WELFARE_CHECKED_AT}；官方頁面更新日期：${source.updated ?? '未標示'}`
  })),
  {
    name: '微笑單車 2.0',
    agency: '台北市政府交通局',
    url: 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json',
    usedIn: '周邊服務（找地點）：站點位置、可借車輛、可停空位',
    dataTime: '即時資料，每次開啟時讀取；各站更新時間顯示在站點明細（資料欄位 updateTime）'
  }
];

export const DEMO_DATA_SOURCES: DemoDataSource[] = [
  {
    file: 'find-place/TCMSV_alldesc.json',
    usedIn: '周邊服務（找地點）：停車場',
    agency: '台北市停車管理工程處（取自 place_list.json）；原始資料網址未標示'
  },
  {
    file: 'find-place/public_toilet_taipei.json',
    usedIn: '周邊服務（找地點）：公廁',
    agency: '未標示'
  },
  { file: 'place_list.json', usedIn: '周邊服務（找地點）：可搜尋的地點類別', agency: '未標示' },
  { file: 'service_list.json', usedIn: '申辦服務：申辦項目清單', agency: '未標示' },
  { file: 'case_progress.json', usedIn: '申辦服務：案件進度', agency: '未標示' },
  { file: 'form.json', usedIn: '申辦服務：申請表單欄位', agency: '未標示' },
  { file: 'qna_list.json', usedIn: '功能教學、常見問題', agency: '未標示' },
  { file: 'counter_list.json', usedIn: '臨櫃叫號', agency: '未標示' },
  { file: 'coupon_data.json', usedIn: '優惠、票夾', agency: '未標示' },
  { file: 'ticket_wallet.json', usedIn: '票夾、付款完成', agency: '未標示' },
  { file: 'citizen_report.json', usedIn: '有話要說', agency: '未標示' },
  { file: 'citizen_result.json', usedIn: '有話要說：查詢結果', agency: '未標示' },
  { file: 'citizen_search_detail.json', usedIn: '有話要說：案件明細', agency: '未標示' },
  { file: 'subscription_list.json', usedIn: '訂閱', agency: '未標示' },
  { file: 'subscription_item_list.json', usedIn: '訂閱：項目清單與明細', agency: '未標示' },
  { file: 'disaster_reporting.json', usedIn: '災情通報', agency: '未標示' },
  { file: 'police_report_record.json', usedIn: '警政報案：報案紀錄', agency: '未標示' },
  {
    file: 'fee-payment/fee_payment_list.json、bill_list.json、pay_history_list.json',
    usedIn: '繳費服務：繳費項目、帳單、帳務紀錄',
    agency: '未標示'
  },
  {
    file: 'library/（library_list、library_book_list、library_notice_list、library_records_*、library_search_hot_keywords）',
    usedIn: '圖書借閱：分館、書目、重要訊息、借閱紀錄、熱門關鍵字',
    agency: '未標示'
  }
];
