import { billReadTool } from './skills/bills';
import { branches, type Book, type Service } from './catalog';
import type { McpClient } from './mcp';
import type { Domain, Draft, TaskState, ToolCall, ToolDefinition } from './types';

const searchParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        'Short search term, preserving original names. Empty string lists all sample records.',
      maxLength: 100,
    },
  },
  required: ['query'],
  additionalProperties: false,
};
export const routingTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'select_agent',
    description: 'Route the request to one specialist. This does not execute a service.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['library', 'services', 'bills', 'unsupported'] },
      },
      required: ['domain'],
      additionalProperties: false,
    },
  },
};
export const domainTools = (domain: Domain): ToolDefinition[] =>
  domain === 'bills'
    ? [billReadTool]
    : domain === 'unsupported'
      ? []
      : [
          {
            type: 'function',
            function: {
              name: domain === 'library' ? 'search_books' : 'search_services',
              description:
                domain === 'library'
                  ? 'Search the fictional demo book catalog. No real library data or reservations.'
                  : 'Search the demo municipal service directory. This cannot submit applications.',
              parameters: searchParameters,
            },
          },
        ];

function localized(value: unknown): boolean {
  if (typeof value !== 'object' || !value) return false;
  const v = value as Record<string, unknown>;
  return ['zh-Hant-TW', 'en'].every(
    (lang) => typeof v[lang] === 'string' && (v[lang] as string).length <= 500,
  );
}

export async function executeReadTool(
  client: McpClient,
  domain: Domain,
  call: ToolCall,
  state: TaskState,
  signal: AbortSignal,
) {
  if (!domainTools(domain).some((tool) => tool.function.name === call.name))
    throw new Error('TOOL_NOT_ALLOWED');
  const { query } = call.arguments;
  if (
    typeof query !== 'string' ||
    query.length > 100 ||
    Object.keys(call.arguments).some((key) => key !== 'query')
  )
    throw new Error('INVALID_ARGUMENTS');
  const result = await client.callTool({ name: call.name, arguments: { query } }, { signal });
  signal.throwIfAborted();
  if (
    result.isError ||
    result.content.length !== 1 ||
    result.content[0]?.type !== 'text' ||
    result.content[0].text.length > 30000
  )
    throw new Error('MCP_TOOL_ERROR');
  const data = JSON.parse(result.content[0].text);
  if (data.source !== 'demo' || !Array.isArray(data.records) || data.records.length > 20)
    throw new Error('UNSUPPORTED_SERVICE_DATA');
  // This MVP intentionally only accepts demo records. A live provider needs separate write authorization.
  for (const item of data.records) {
    if (!item || typeof item.id !== 'string' || item.id.length > 100 || !localized(item.title))
      throw new Error('INVALID_TOOL_RESULT');
    if (
      domain === 'library'
        ? !localized(item.author) || !localized(item.category)
        : !localized(item.description)
    )
      throw new Error('INVALID_TOOL_RESULT');
  }
  if (domain === 'library') {
    state.bookResults = (data.records as Book[]).map(({ id, title, author, category }) => ({
      id,
      title,
      author,
      category,
    }));
    state.bookIds = state.bookResults.map((item) => item.id);
    state.serviceIds = [];
    state.serviceResults = [];
    state.notice = data.records.length ? 'books' : 'empty';
  } else {
    state.serviceResults = (data.records as Service[]).map(({ id, title, description }) => ({
      id,
      title,
      description,
      keywords: [],
    }));
    state.serviceIds = state.serviceResults.map((item) => item.id);
    state.bookIds = [];
    state.bookResults = [];
    state.notice = data.records.length ? 'services' : 'empty';
  }
  return {
    source: 'demo',
    records: domain === 'library' ? state.bookResults : state.serviceResults,
  };
}

function newId() {
  return globalThis.crypto.randomUUID();
}

export function prepareReservation(state: TaskState, bookId: string, branchId: string): Draft {
  if (
    !state.bookIds.includes(bookId) ||
    !state.bookResults.some((book) => book.id === bookId) ||
    !branches.some((branch) => branch.id === branchId)
  )
    throw new Error('INVALID_SELECTION');
  state.draft = { id: newId(), bookId, branchId };
  state.receipt = null;
  state.notice = 'review';
  return state.draft;
}

export function changeBranch(state: TaskState, branchId: string) {
  if (!state.draft || !branches.some((branch) => branch.id === branchId))
    throw new Error('INVALID_SELECTION');
  state.draft = { ...state.draft, branchId, id: newId() };
}

/** Called only by the explicit confirmation UI, never exposed in model tools. */
export function confirmReservation(state: TaskState, draftId: string) {
  if (state.receipt?.id === draftId) return state.receipt; // Local idempotency.
  if (!state.draft || state.draft.id !== draftId) throw new Error('STALE_CONFIRMATION');
  state.receipt = {
    ...state.draft,
    reference: `DEMO-${draftId.slice(0, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    source: 'demo',
  };
  state.draft = null;
  state.notice = 'receipt';
  return state.receipt;
}

export function cancelDraft(state: TaskState) {
  state.draft = null;
  state.notice = 'cancelled';
}
