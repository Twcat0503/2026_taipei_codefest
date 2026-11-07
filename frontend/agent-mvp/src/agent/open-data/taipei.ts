/**
 * 臺北市開放資料（真實、可查證），供安心助手把民眾的白話對應到官方資料。
 * 這裡只放「資料」：行政區名、陳情案類與受理機關，皆取自 data.taipei 的公開資料集，
 * 名稱與受理機關依來源原文，不自行改寫。來源常數一併匯出，畫面上要顯名標示。
 */
import type { Localized } from '../types';

/** 一個可查證的開放資料來源。畫面顯名用，避免把示範或整理後的資料誤認為官方原始資料。 */
export type DataSource = { name: string; provider: string; url: string; license: string };

/** 陳情案類來源：臺北市陳情系統類別資料（研考會）。主類別／次類別／受理機關取自此。 */
export const PETITION_SOURCE: DataSource = {
  name: '臺北市陳情系統類別資料',
  provider: '臺北市政府研究發展考核委員會',
  url: 'https://data.taipei/dataset/detail?id=cb423c17-88eb-4231-a725-f1b93247d1bf',
  license: '政府資料開放授權條款－第1版',
};

/** 行政區來源：臺北市所轄面積暨行政區里鄰數量月報表（民政局）。12 區名稱以此為準。 */
export const DISTRICT_SOURCE: DataSource = {
  name: '臺北市所轄面積暨行政區里鄰數量月報表',
  provider: '臺北市政府民政局',
  url: 'https://data.taipei/dataset/detail?id=d1bb140b-733b-43cc-91ca-685a984d022a',
  license: '政府資料開放授權條款－第1版',
};

/** 臺北市 12 行政區，依市府慣用排序。名稱對照 DISTRICT_SOURCE（12 區 456 里）。 */
export const DISTRICTS: [zh: string, en: string][] = [
  ['中正區', 'Zhongzheng'],
  ['大同區', 'Datong'],
  ['中山區', 'Zhongshan'],
  ['松山區', 'Songshan'],
  ['大安區', "Da'an"],
  ['萬華區', 'Wanhua'],
  ['信義區', 'Xinyi'],
  ['士林區', 'Shilin'],
  ['北投區', 'Beitou'],
  ['內湖區', 'Neihu'],
  ['南港區', 'Nangang'],
  ['文山區', 'Wenshan'],
];

/** 文字裡出現的第一個行政區；找不到回空字串。 */
export function findDistrict(text: string): string {
  return DISTRICTS.find(([zh]) => text.includes(zh))?.[0] ?? '';
}

/** 陳情案件的九大主類別（取自 PETITION_SOURCE，排除內部用的「員工事件通報」）。 */
const MAIN = {
  road: { 'zh-Hant-TW': '道路、山坡地、路樹及路燈', en: 'Roads, slopes, street trees and lights' },
  traffic: { 'zh-Hant-TW': '交通運輸', en: 'Transport' },
  env: { 'zh-Hant-TW': '垃圾、噪音、污染及資源回收', en: 'Waste, noise, pollution and recycling' },
  water: { 'zh-Hant-TW': '公園、排水溝、下水道及自來水', en: 'Parks, drains, sewers and water' },
  safety: { 'zh-Hant-TW': '警消、法務及政風', en: 'Police, fire, legal and ethics' },
  urban: {
    'zh-Hant-TW': '都市發展、建管、產業、財稅及地政',
    en: 'Urban development, building and land',
  },
  welfare: {
    'zh-Hant-TW': '衛福、勞動、民政、區政及動保',
    en: 'Health, labor, civil affairs and animals',
  },
} satisfies Record<string, Localized>;

/**
 * 一條把白話對應到真實陳情案類的規則。
 * - keywords：民眾可能說的話（第一個命中者勝出）
 * - subject：整理後的案件主旨，顯示在可修改的草稿欄位
 * - main / sub / agency：對應的官方主類別、次類別、受理機關（取自 PETITION_SOURCE）
 *   對不到乾淨官方案類時，main 省略，交由「其他事項」頁自動選類別
 */
export type ReportCategory = { main: Localized; sub: string; agency: string };
export type ReportRule = { keywords: RegExp; subject: string } & Partial<ReportCategory>;

/** 白話 → 真實案類。順序即優先序：較明確的規則排在前面。 */
export const REPORT_RULES: ReportRule[] = [
  {
    keywords: /路燈|街燈|燈不亮/,
    subject: '路燈故障',
    main: MAIN.road,
    sub: '路燈不亮或損壞',
    agency: '工務局公園路燈工程管理處',
  },
  {
    keywords: /紅綠燈|號誌|交通燈/,
    subject: '交通號誌故障',
    main: MAIN.traffic,
    sub: '交通號誌異常',
    agency: '交通管制工程處',
  },
  {
    keywords: /人孔|孔蓋|溝蓋/,
    subject: '人孔蓋或溝蓋破損',
    main: MAIN.water,
    sub: '人孔蓋破損、遺失處理',
    agency: '工務局新建工程處',
  },
  {
    keywords: /坑洞|路面|柏油|凹陷|不平/,
    subject: '道路坑洞',
    main: MAIN.road,
    sub: '道路凹陷、不平、有高低差',
    agency: '工務局新建工程處',
  },
  {
    keywords: /人行道|騎樓|地磚/,
    subject: '人行道問題',
    main: MAIN.road,
    sub: '人行道維護',
    agency: '工務局新建工程處',
  },
  {
    keywords: /路樹|樹倒|樹枝|倒樹|樹木/,
    subject: '路樹問題',
    main: MAIN.road,
    sub: '路樹修剪維護、路燈遷移',
    agency: '工務局公園路燈工程管理處',
  },
  {
    keywords: /違建|鐵皮|加蓋|防火巷/,
    subject: '違建或占用',
    main: MAIN.urban,
    sub: '建築物使用管理、違建查報及拆除',
    agency: '建築管理工程處',
  },
  {
    keywords: /違停|違規停車|亂停|並排停車/,
    subject: '違規停車',
    main: MAIN.safety,
    sub: '違規停車',
    agency: '停車管理工程處',
  },
  {
    keywords: /噪音|太吵|很吵|施工聲|吵鬧/,
    subject: '噪音問題',
    main: MAIN.env,
    sub: '場所及設施噪音舉發',
    agency: '環境保護局',
  },
  {
    keywords: /污染|油煙|異味|空污|廢水|排煙/,
    subject: '污染問題',
    main: MAIN.env,
    sub: '環保稽查',
    agency: '環保稽查大隊',
  },
  {
    keywords: /垃圾|髒亂|廚餘|資源回收|清運/,
    subject: '垃圾與環境髒亂',
    main: MAIN.env,
    sub: '垃圾車清運及服務事項',
    agency: '環境保護局',
  },
  {
    keywords: /淹水|積水|排水/,
    subject: '淹水或積水',
    main: MAIN.water,
    sub: '排水溝疏通',
    agency: '環境保護局',
  },
  {
    keywords: /漏水|停水|沒水|水管|自來水/,
    subject: '漏水或停水',
    main: MAIN.water,
    sub: '用戶無水、漏水報修',
    agency: '自來水事業處',
  },
  {
    keywords: /公車|客運|站牌|司機/,
    subject: '公車服務問題',
    main: MAIN.traffic,
    sub: '公車問題',
    agency: '公共運輸處',
  },
  {
    keywords: /復康巴士|計程車|小黃/,
    subject: '復康巴士或計程車問題',
    main: MAIN.traffic,
    sub: '計程車、復康巴士問題',
    agency: '公共運輸處',
  },
  {
    keywords: /youbike|ubike|微笑單車|公共自行車/i,
    subject: 'YouBike 問題',
    main: MAIN.traffic,
    sub: '微笑單車（YouBike）',
    agency: '交通局',
  },
  {
    keywords: /公園|遊具|溜滑梯|涼亭|座椅/,
    subject: '公園設施問題',
    main: MAIN.water,
    sub: '一般公園綠地管理及設施維護',
    agency: '工務局公園路燈工程管理處',
  },
  {
    keywords: /流浪狗|流浪貓|流浪動物|野狗|動物|狗|貓/,
    subject: '動物問題',
    main: MAIN.welfare,
    sub: '動物保護',
    agency: '動物保護處',
  },
  // 對不到乾淨官方案類：保留主旨，由「其他事項（自動選擇案件類別）」頁處理。
  { keywords: /無障礙|輪椅|坡道|電梯/, subject: '無障礙設施問題' },
];
