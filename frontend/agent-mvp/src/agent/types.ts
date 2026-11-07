import type { Book } from './catalog';
export type Locale = 'zh-Hant-TW' | 'en';
export type Domain = 'library' | 'services' | 'perks' | 'places' | 'unsupported';
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
  mode: 'demo' | 'local';
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
  kind: 'demo' | 'snapshot' | 'live';
  label: string;
  note: string;
  url: string;
  total: number;
  truncated: boolean;
};
export type ToolFailure = { code: string; message: string; hint?: string };
export type Draft = { id: string; bookId: string; branchId: string };
export type Receipt = Draft & { reference: string; createdAt: string; source: 'demo' };
export type TaskState = {
  domain: Domain | null;
  bookIds: string[];
  bookResults: Book[];
  records: ToolRecord[];
  source: ResultSource | null;
  failure: ToolFailure | null;
  draft: Draft | null;
  receipt: Receipt | null;
  notice:
    | 'welcome'
    | 'books'
    | 'results'
    | 'needLocation'
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
  records: [],
  source: null,
  failure: null,
  draft: null,
  receipt: null,
  notice: 'welcome',
  traces: [],
});
