import { demoBillResult, isBillSelection } from './skills/bills';
import { books, services } from './catalog';
import type { ToolDefinition } from './types';

export type ToolInfo = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** Tool boundary, implemented by DemoToolClient or tools/townpass as direct function calls.
 * No transport or server is involved.
 */
export interface ToolClient {
  listTools(options: { signal: AbortSignal }): Promise<{ tools: ToolInfo[] }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    options: { signal: AbortSignal },
  ): Promise<ToolResult>;
}

export class DemoToolClient implements ToolClient {
  constructor(private definitions: ToolDefinition[]) {}
  async listTools({ signal }: { signal: AbortSignal }) {
    signal.throwIfAborted();
    return {
      tools: this.definitions.map(({ function: tool }) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      })),
    };
  }
  async callTool(
    params: { name: string; arguments: Record<string, unknown> },
    { signal }: { signal: AbortSignal },
  ): Promise<ToolResult> {
    signal.throwIfAborted();
    if (params.name === 'list_bills') {
      if (
        !isBillSelection(params.arguments.category) ||
        params.arguments.period !== 'current' ||
        Object.keys(params.arguments).length !== 2
      )
        throw new Error('INVALID_ARGUMENTS');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ...demoBillResult,
              records: demoBillResult.records.filter(
                (bill) =>
                  params.arguments.category === 'all' ||
                  bill.category === params.arguments.category,
              ),
            }),
          },
        ],
      };
    }
    const query = String(params.arguments.keyword ?? '')
      .trim()
      .toLowerCase();
    let records: unknown[];
    if (params.name === 'search_library_books')
      records = books.filter((book) =>
        [
          ...Object.values(book.title),
          ...Object.values(book.author),
          ...Object.values(book.category),
        ].some((text) => text.toLowerCase().includes(query)),
      );
    else if (params.name === 'search_application_services')
      records = services
        .filter((service) =>
          [...Object.values(service.title), ...service.keywords].some((text) =>
            text.toLowerCase().includes(query),
          ),
        )
        .map(({ id, title, description }) => ({ id, title, description }));
    else return { isError: true, content: [{ type: 'text', text: 'TOOL_NOT_FOUND' }] };
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'demo', records }) }] };
  }
}

/** Keep bill fixtures explicit while the team connects the authenticated bill API. */
export function withDemoBills(client: ToolClient, billDefinition: ToolDefinition): ToolClient {
  const bills = new DemoToolClient([billDefinition]);
  return {
    async listTools(options) {
      const listed = await client.listTools(options);
      return { tools: [...listed.tools, ...(await bills.listTools(options)).tools] };
    },
    callTool(params, options) {
      return params.name === 'list_bills'
        ? bills.callTool(params, options)
        : client.callTool(params, options);
    },
  };
}
