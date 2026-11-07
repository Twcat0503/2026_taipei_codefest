import { billReadTool } from './skills/bills';
import { branches, type Book } from './catalog';
import type { ToolClient, ToolInfo } from './tool-client';
import type {
  Domain,
  Draft,
  TaskState,
  ToolCall,
  ToolDefinition,
  ToolFailure,
  ToolRecord,
} from './types';

type ToolDomain = Exclude<Domain, 'unsupported'>;
/** Local whitelist: only these read-only tools and argument names ever reach a tool client. */
export const TOOLS: Record<string, { domain: ToolDomain | ToolDomain[]; args: string[] }> = {
  list_bills: { domain: 'bills', args: ['category', 'period'] },
  search_library_books: { domain: 'library', args: ['keyword'] },
  get_library_book: { domain: 'library', args: ['book_id'] },
  get_library_ranking: { domain: 'library', args: [] },
  list_library_branches: { domain: 'library', args: ['area'] },
  list_library_notices: { domain: 'library', args: [] },
  list_townpass_services: { domain: 'services', args: ['keyword'] },
  search_application_services: { domain: 'services', args: ['keyword'] },
  search_service_counters: { domain: 'services', args: ['keyword'] },
  search_faq: { domain: 'services', args: ['keyword'] },
  search_fee_types: { domain: 'services', args: ['keyword'] },
  list_report_categories: { domain: 'services', args: ['kind'] },
  list_subscription_topics: { domain: 'services', args: ['keyword'] },
  search_perks: { domain: 'perks', args: ['keyword', 'kind'] },
  find_nearby_youbike: { domain: 'places', args: ['near_me', 'radius_m', 'area', 'keyword'] },
  find_nearby_parking: {
    domain: 'places',
    args: ['near_me', 'radius_m', 'area', 'keyword', 'accessible'],
  },
  find_nearby_toilets: {
    domain: 'places',
    args: ['near_me', 'radius_m', 'area', 'keyword', 'accessible'],
  },
  // Real mode: requests that need an official site end in a confirm-before-leaving card.
  open_official_service: {
    domain: ['library', 'services', 'bills', 'perks'],
    args: ['destination', 'keyword'],
  },
};
export const NAVIGATION_TOOL = 'open_official_service';
export const toolInDomain = (name: string, domain: Domain) => {
  const owner = TOOLS[name]?.domain;
  return Array.isArray(owner) ? owner.includes(domain as ToolDomain) : owner === domain;
};

const searchParameters = {
  type: 'object',
  properties: {
    keyword: {
      type: 'string',
      description:
        'Short search term, preserving original names. Empty string lists all sample records.',
      maxLength: 100,
    },
  },
  required: ['keyword'],
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
        domain: {
          type: 'string',
          enum: ['library', 'services', 'perks', 'places', 'bills', 'unsupported'],
        },
      },
      required: ['domain'],
      additionalProperties: false,
    },
  },
};
/** Tool definitions for the built-in fictional fixtures. */
export const domainTools = (domain: Domain): ToolDefinition[] =>
  domain === 'bills'
    ? [billReadTool]
    : domain === 'library' || domain === 'services'
      ? [
          {
            type: 'function',
            function: {
              name: domain === 'library' ? 'search_library_books' : 'search_application_services',
              description:
                domain === 'library'
                  ? 'Search the fictional demo book catalog. No real library data or reservations.'
                  : 'Search the demo municipal service directory. This cannot submit applications.',
              parameters: searchParameters,
            },
          },
        ]
      : [];

/** Offer only whitelisted tools of this domain that the client really provides. */
export function allowedTools(domain: Domain, available: ToolInfo[]): ToolDefinition[] {
  return available
    .filter((tool) => toolInDomain(tool.name, domain))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema,
      },
    }));
}

export class ToolCallError extends Error {
  constructor(readonly failure: ToolFailure) {
    super('TOOL_ERROR');
  }
}

function localized(value: unknown): boolean {
  if (typeof value !== 'object' || !value) return false;
  const v = value as Record<string, unknown>;
  return ['zh-Hant-TW', 'en'].every(
    (lang) => typeof v[lang] === 'string' && (v[lang] as string).length <= 500,
  );
}
const optionalLocalized = (value: unknown) => value === undefined || localized(value);

function validArguments(allowed: string[], args: Record<string, unknown>) {
  return Object.entries(args).every(
    ([key, value]) =>
      allowed.includes(key) &&
      (typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 100)),
  );
}

function validRecord(item: Record<string, unknown>, isBook: boolean) {
  if (typeof item?.id !== 'string' || item.id.length > 100 || !localized(item.title)) return false;
  if (isBook) return localized(item.author) && localized(item.category);
  if (!optionalLocalized(item.description) || !optionalLocalized(item.category)) return false;
  if (
    item.url !== undefined &&
    !(typeof item.url === 'string' && (item.url.startsWith('https://') || item.url === 'tel:1999'))
  )
    return false;
  const fields = item.fields;
  if (fields === undefined) return true;
  return (
    Array.isArray(fields) &&
    fields.length <= 12 &&
    fields.every((field) => localized(field?.label) && localized(field?.value))
  );
}

function readFailure(text: string | undefined): ToolFailure {
  try {
    const { error } = JSON.parse(text ?? '');
    if (typeof error?.code === 'string' && typeof error?.message === 'string')
      return { code: error.code, message: error.message, hint: error.hint };
  } catch {
    /* Not structured; report a generic failure below. */
  }
  return { code: 'TOOL_ERROR', message: 'Tool failed' };
}

export async function executeReadTool(
  client: ToolClient,
  domain: Domain,
  call: ToolCall,
  state: TaskState,
  signal: AbortSignal,
) {
  const tool = TOOLS[call.name];
  if (!tool || !toolInDomain(call.name, domain)) throw new Error('TOOL_NOT_ALLOWED');
  if (!validArguments(tool.args, call.arguments)) throw new Error('INVALID_ARGUMENTS');
  const result = await client.callTool({ name: call.name, arguments: call.arguments }, { signal });
  signal.throwIfAborted();
  if (result.isError) throw new ToolCallError(readFailure(result.content[0]?.text));
  if (
    result.content.length !== 1 ||
    result.content[0]?.type !== 'text' ||
    result.content[0].text.length > 100000
  )
    throw new Error('TOOL_ERROR');
  const data = JSON.parse(result.content[0].text);
  state.lastTool = call.name;
  if (
    !['demo', 'snapshot', 'live', 'link'].includes(data.source) ||
    !Array.isArray(data.records) ||
    data.records.length > 20 ||
    (call.name === NAVIGATION_TOOL && data.source !== 'link')
  )
    throw new Error('UNSUPPORTED_SERVICE_DATA');
  const isBook = call.name === 'search_library_books' || call.name === 'get_library_ranking';
  for (const item of data.records)
    if (!validRecord(item, isBook)) throw new Error('INVALID_TOOL_RESULT');
  if (call.name === NAVIGATION_TOOL) {
    const [record] = data.records as ToolRecord[];
    if (data.records.length !== 1 || !record?.url) throw new Error('INVALID_TOOL_RESULT');
    const field = (label: string) =>
      record.fields?.find((item) => item.label['zh-Hant-TW'] === label)?.value['zh-Hant-TW'] ?? '';
    // Nothing opens here: the UI asks the user before leaving the assistant.
    state.navigation = {
      id: record.id,
      title: record.title,
      description: record.description,
      provider: field('提供單位'),
      url: record.url,
      where: field('前往') || record.url,
    };
    state.records = [];
    state.bookIds = [];
    state.bookResults = [];
    state.notice = 'navigate';
  } else if (isBook && data.source === 'demo') {
    // Reservation is a demo flow, so only demo book lists can start it.
    state.bookResults = (data.records as Book[]).map(({ id, title, author, category, url }) => ({
      id,
      title,
      author,
      category,
      url,
    }));
    state.bookIds = state.bookResults.map((item) => item.id);
    state.records = [];
    state.notice = data.records.length ? 'books' : 'empty';
  } else {
    state.records = (data.records as ToolRecord[]).map(
      ({ id, title, description, category, fields, url }) => ({
        id,
        title,
        description,
        category,
        fields,
        url,
      }),
    );
    state.bookIds = [];
    state.bookResults = [];
    state.notice = data.records.length ? 'results' : 'empty';
  }
  state.source =
    typeof data.source_label === 'string'
      ? {
          kind: data.source,
          label: data.source_label,
          note: String(data.source_note ?? ''),
          url: String(data.source_url ?? ''),
          total: Number(data.total ?? data.records.length),
          truncated: data.truncated === true,
        }
      : null;
  // The model only needs enough to finish or chain; the UI shows verified records instead.
  return {
    source: data.source as string,
    total: data.records.length as number,
    records: (data.records as ToolRecord[])
      .slice(0, 5)
      .map(({ id, title }) => ({ id, title: title['zh-Hant-TW'] })),
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
