import { books, branches } from '../agent/catalog';
import type { Draft, TaskState } from '../agent/types';

const key = 'townpass-agent-demo-v1';
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
