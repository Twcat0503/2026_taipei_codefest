import type { messages } from '../i18n';

type MessageKey = keyof typeof messages.en;
type Suggestion = { key: MessageKey; request: string; demo?: boolean };

/** Requests use the same wording as the deterministic Town Pass routing rules. */
export const townpassSuggestionGroups: readonly (readonly Suggestion[])[] = [
  [
    { key: 'suggestionWater', request: '我要繳水費', demo: true },
    { key: 'suggestionReport', request: '我要反映路燈問題', demo: true },
    { key: 'suggestionQueue', request: '查詢臨櫃叫號', demo: true },
  ],
  [
    { key: 'suggestionLibrary', request: '幫我查詢圖書', demo: true },
    { key: 'suggestionTickets', request: '有什麼優惠票券？', demo: true },
    { key: 'suggestionSubscribe', request: '我想訂閱市政訊息', demo: true },
  ],
  [
    { key: 'suggestionPolice', request: '我要查詢警政服務', demo: true },
    { key: 'suggestionFaq', request: '台北通常見問題', demo: true },
    { key: 'suggestionMap', request: '打開台北通找地點', demo: true },
  ],
];
