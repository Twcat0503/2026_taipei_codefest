import { books, branches } from '../agent/catalog';
import type { Draft, TaskState } from '../agent/types';
import { messages } from '../i18n';
import { isEmergencyKind, type EmergencyKind } from '../agent/skills/emergency';

const key = 'townpass-agent-demo-v1';
const conversationKey = 'townpass-agent-conversation-v1';
const safeRequests = [
  'rehabRequest',
  'benefitsRequest',
  'accessibleRequest',
  'parkingSuggestion',
  'pregnancyParkingSuggestion',
  'browseBooks',
  'browseBills',
  'browseServices',
  'counter',
  'feeSuggestion',
  'youbikeSuggestion',
  'perkSuggestion',
  'reportRequest',
] as const;
const safeNotices: TaskState['notice'][] = [
  'billCategory',
  'bills',
  'billsEmpty',
  'billUnsupported',
  'billAuth',
  'billUnavailable',
  'greeting',
  'navigate',
  'navigationDeclined',
  'emergency',
  'profile',
  'books',
  'results',
  'needLocation',
  'empty',
  'unsupported',
  'review',
  'receipt',
  'cancelled',
  'error',
];
export type SavedTurn = {
  request: string;
  notice: TaskState['notice'];
  /** Kept so the call buttons come back with an emergency summary. */
  emergency?: EmergencyKind | null;
};
export type RestoredTurn = {
  /** Dictionary key of a suggested request, so it follows the current language. */
  request: (typeof safeRequests)[number] | null;
  /** What the person typed or said, with identifiers masked. */
  text?: string;
  notice: TaskState['notice'];
  /** Which call buttons to show again; only on emergency turns. */
  emergency?: EmergencyKind;
};
const MASK = '＊＊＊';
const MAX_TEXT = 200;
/**
 * Free text comes back when the person returns, but never with identifiers in it:
 * ID numbers, e-mail addresses and any run of 6+ digits (phone, water account, card).
 */
export function maskSensitive(text: string) {
  return text
    .replace(/[A-Z][12ABCD89]\d{8}/gi, MASK)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, MASK)
    .replace(/\+?\d(?:[\s-]?\d){5,}/g, MASK)
    .trim()
    .slice(0, MAX_TEXT);
}
export function saveConversation(turns: SavedTurn[]): boolean {
  try {
    const safe = turns.map(({ request, notice, emergency }) => {
      const key =
        safeRequests.find((name) =>
          Object.values(messages).some((dictionary) => dictionary[name] === request),
        ) ?? null;
      const text = key ? '' : maskSensitive(request);
      return {
        request: key,
        ...(text ? { text } : {}),
        notice: safeNotices.includes(notice) ? notice : 'unsupported',
        ...(notice === 'emergency' && isEmergencyKind(emergency) ? { emergency } : {}),
      };
    });
    localStorage.setItem(conversationKey, JSON.stringify(safe.slice(-100)));
    return true;
  } catch {
    return false;
  }
}
export function restoreConversation(): RestoredTurn[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(conversationKey) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.slice(-100).flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const { request, text, notice, emergency } = entry as {
        request?: unknown;
        text?: unknown;
        notice?: unknown;
        emergency?: unknown;
      };
      if (typeof notice !== 'string' || !safeNotices.includes(notice as TaskState['notice']))
        return [];
      const requestKey =
        typeof request === 'string' &&
        safeRequests.includes(request as (typeof safeRequests)[number])
          ? (request as (typeof safeRequests)[number])
          : null;
      const saved = typeof text === 'string' && !requestKey ? maskSensitive(text) : '';
      return [
        {
          request: requestKey,
          ...(saved ? { text: saved } : {}),
          notice: notice as TaskState['notice'],
          // Older saves have no kind; the general lines still give every number.
          ...(notice === 'emergency'
            ? { emergency: isEmergencyKind(emergency) ? emergency : 'general' }
            : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
export function clearConversation() {
  try {
    localStorage.removeItem(conversationKey);
  } catch {
    /* Storage may be unavailable. */
  }
}
export function saveTask(state: TaskState) {
  // Persist only validated fixture IDs. Never persist prompts, names, location or model responses.
  try {
    localStorage.setItem(key, JSON.stringify({ draft: state.draft, receipt: state.receipt }));
  } catch {
    /* Private mode or full storage: keep in memory. */
  }
}
export function clearTask() {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Memory state remains usable. */
  }
}
function validDraft(value: unknown): value is Draft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Draft;
  return (
    typeof draft.id === 'string' &&
    draft.id.length < 100 &&
    books.some((book) => book.id === draft.bookId) &&
    branches.some((branch) => branch.id === draft.branchId)
  );
}
export function restoreTask(state: TaskState) {
  try {
    const data = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (validDraft(data.draft)) {
      state.draft = { id: data.draft.id, bookId: data.draft.bookId, branchId: data.draft.branchId };
      state.bookIds = [data.draft.bookId];
      state.bookResults = books.filter((book) => book.id === data.draft.bookId);
      state.domain = 'library';
      state.notice = 'review';
      return true;
    }
    if (
      validDraft(data.receipt) &&
      data.receipt.source === 'demo' &&
      typeof data.receipt.reference === 'string' &&
      /^DEMO-[A-F0-9-]{8}$/.test(data.receipt.reference) &&
      typeof data.receipt.createdAt === 'string' &&
      Number.isFinite(Date.parse(data.receipt.createdAt))
    ) {
      state.receipt = {
        id: data.receipt.id,
        bookId: data.receipt.bookId,
        branchId: data.receipt.branchId,
        reference: data.receipt.reference,
        createdAt: data.receipt.createdAt,
        source: 'demo',
      };
      state.bookResults = books.filter((book) => book.id === data.receipt.bookId);
      state.notice = 'receipt';
      return true;
    }
  } catch {
    clearTask();
  }
  return false;
}
export function getPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
export function setPreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences stay active for this session. */
  }
}
