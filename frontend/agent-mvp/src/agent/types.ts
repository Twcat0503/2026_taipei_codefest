import type { BillQuery, BillResult } from './skills/bills';
import type { Book } from './catalog';
export type Locale = 'zh-Hant-TW' | 'en';
export type Domain = 'library' | 'services' | 'perks' | 'places' | 'bills' | 'unsupported';
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
export type ToolRecord = {
  id: string;
  title: Localized;
  description?: Localized;
  category?: Localized;
  fields?: { label: Localized; value: Localized }[];
  url?: string;
};
/** Where the shown records came from. Always displayed so demo data is never mistaken for real data. */
export type ResultSource = {
  kind: 'demo' | 'snapshot' | 'live' | 'link';
  label: string;
  note: string;
  url: string;
  total: number;
  truncated: boolean;
};
export type ToolFailure = { code: string; message: string; hint?: string };
export type Draft = { id: string; bookId: string; branchId: string };
/** A verified official destination. Opening it always needs an explicit tap by the user. */
export type Navigation = {
  id: string;
  title: Localized;
  description?: Localized;
  provider: string;
  /** https URL or tel: number, taken only from the tool's allowlist. */
  url: string;
  /** Where it opens, e.g. 台北通「有話要說」 or a website host. */
  where: string;
};
export type Receipt = Draft & { reference: string; createdAt: string; source: 'demo' };
export type TaskState = {
  domain: Domain | null;
  bookIds: string[];
  bookResults: Book[];
  billQuery: BillQuery | null;
  billResult: BillResult | null;
  pendingBillCategory: boolean;
  records: ToolRecord[];
  source: ResultSource | null;
  failure: ToolFailure | null;
  pendingLocation: { request: string } | null;
  navigation: Navigation | null;
  /** The last tool that produced this answer; drives the follow-up choices. */
  lastTool: string | null;
  /** Set when the request sounds like an emergency; the UI offers call buttons. */
  emergency: import('./skills/emergency').EmergencyKind | null;
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
    | 'results'
    | 'needLocation'
    | 'empty'
    | 'unsupported'
    | 'navigate'
    | 'navigationDeclined'
    | 'emergency'
    | 'profile'
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
  billQuery: null,
  billResult: null,
  pendingBillCategory: false,
  records: [],
  source: null,
  failure: null,
  pendingLocation: null,
  navigation: null,
  lastTool: null,
  emergency: null,
  draft: null,
  receipt: null,
  notice: 'welcome',
  traces: [],
});
