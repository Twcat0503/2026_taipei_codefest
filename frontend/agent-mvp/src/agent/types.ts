import type { BillQuery, BillResult } from './skills/bills';
import type { Book, Service } from './catalog';
export type Locale = 'zh-Hant-TW' | 'en';
export type Domain = 'services' | 'library' | 'bills' | 'unsupported';
export type Localized = Record<Locale, string>;
export type Schema = Record<string, unknown>;
export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Schema };
};
export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
};
export interface ModelAdapter {
  mode: 'demo' | 'local' | 'phone';
  requestTimeoutMs?: number;
  complete(input: {
    messages: Message[];
    tools: ToolDefinition[];
    signal: AbortSignal;
  }): Promise<{ calls: ToolCall[]; content?: string }>;
}
export type Trace = {
  id: number;
  actor: string;
  event: string;
  detail: string;
  elapsedMs: number;
};
export type Draft = { id: string; bookId: string; branchId: string };
export type Receipt = Draft & { reference: string; createdAt: string; source: 'demo' };
export type TaskState = {
  domain: Domain | null;
  bookIds: string[];
  bookResults: Book[];
  serviceResults: Service[];
  serviceIds: string[];
  billQuery: BillQuery | null;
  billResult: BillResult | null;
  pendingBillCategory: boolean;
  draft: Draft | null;
  receipt: Receipt | null;
  notice:
    | 'billCategory'
    | 'bills'
    | 'billsEmpty'
    | 'billUnsupported'
    | 'billAuth'
    | 'billUnavailable'
    | 'welcome'
    | 'books'
    | 'services'
    | 'empty'
    | 'unsupported'
    | 'review'
    | 'receipt'
    | 'cancelled'
    | 'error';
  traces: Trace[];
};
export const initialState = (): TaskState => ({
  domain: null,
  bookIds: [],
  bookResults: [],
  serviceResults: [],
  serviceIds: [],
  billQuery: null,
  billResult: null,
  pendingBillCategory: false,
  draft: null,
  receipt: null,
  notice: 'welcome',
  traces: [],
});
