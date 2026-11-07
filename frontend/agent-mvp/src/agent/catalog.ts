import type { Localized } from './types';

// Original, fictional fixtures. These are not live municipal or library records.
export type Book = { id: string; title: Localized; author: Localized; category: Localized };
export type Service = { id: string; title: Localized; description: Localized; keywords: string[] };

export const books: Book[] = [
  {
    id: 'book-01',
    title: { 'zh-Hant-TW': '一起慢慢走', en: 'Walking Together' },
    author: { 'zh-Hant-TW': '城市編輯小組', en: 'City Editorial Team' },
    category: { 'zh-Hant-TW': '生活・友善城市', en: 'Life · Inclusive cities' },
  },
  {
    id: 'book-02',
    title: { 'zh-Hant-TW': '把日子過簡單', en: 'A Simpler Everyday' },
    author: { 'zh-Hant-TW': '安心生活研究室', en: 'Everyday Living Studio' },
    category: { 'zh-Hant-TW': '生活・日常練習', en: 'Life · Everyday practice' },
  },
  {
    id: 'book-03',
    title: { 'zh-Hant-TW': '巷口的那棵樹', en: 'The Tree Around the Corner' },
    author: { 'zh-Hant-TW': '綠意編輯室', en: 'Green Editorial Studio' },
    category: { 'zh-Hant-TW': '自然・城市散步', en: 'Nature · City walks' },
  },
];

export const branches: { id: string; name: Localized }[] = [
  { id: 'demo-central', name: { 'zh-Hant-TW': '示範總館', en: 'Demo Central Library' } },
  { id: 'demo-community', name: { 'zh-Hant-TW': '示範社區分館', en: 'Demo Community Branch' } },
];

export const services: Service[] = [
  {
    id: 'library',
    title: { 'zh-Hant-TW': '圖書查詢與預約', en: 'Find and reserve a book' },
    description: {
      'zh-Hant-TW': '查找示範書籍、選擇取書館，體驗預約確認流程。',
      en: 'Search sample books, choose a branch and preview a demo reservation.',
    },
    keywords: ['圖書', '借書', 'library', 'book'],
  },
  {
    id: 'application',
    title: { 'zh-Hant-TW': '申辦服務諮詢', en: 'Application guidance' },
    description: {
      'zh-Hant-TW': '正式申辦 API 尚未接入。本版提供服務介紹，不會代為送件。',
      en: 'The application API is not connected. This demo provides information only.',
    },
    keywords: ['申辦', '補助', '諮詢', 'application', 'welfare'],
  },
  {
    id: 'counter',
    title: { 'zh-Hant-TW': '臨櫃叫號查詢', en: 'Counter information' },
    description: {
      'zh-Hant-TW': '即時叫號 API 尚未接入。本版不提供即時號碼或取號。',
      en: 'Live queue data is not connected. No live numbers or tickets are provided.',
    },
    keywords: ['叫號', '臨櫃', 'counter', 'queue'],
  },
];
