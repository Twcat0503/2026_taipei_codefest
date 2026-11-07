import { demoBillResult, isBillSelection } from './skills/bills';
import { books, services } from './catalog';
import type { ToolDefinition } from './types';

export type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type McpResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** Teammate-owned MCP transport implements this boundary (official tools/list & tools/call shapes).
 * This interface is not a full MCP transport; no server, discovery, auth or network is simulated.
 */
export interface McpClient {
  listTools(options: { signal: AbortSignal }): Promise<{ tools: McpTool[] }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    options: { signal: AbortSignal },
  ): Promise<McpResult>;
}

export class DemoMcpClient implements McpClient {
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
  ): Promise<McpResult> {
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
    const query = String(params.arguments.query ?? '')
      .trim()
      .toLowerCase();
    let records: unknown[];
    if (params.name === 'search_books')
      records = books.filter((book) =>
        [
          ...Object.values(book.title),
          ...Object.values(book.author),
          ...Object.values(book.category),
        ].some((text) => text.toLowerCase().includes(query)),
      );
    else if (params.name === 'search_services')
      records = services.filter((service) =>
        [...Object.values(service.title), ...service.keywords].some((text) =>
          text.toLowerCase().includes(query),
        ),
      );
    else return { isError: true, content: [{ type: 'text', text: 'TOOL_NOT_FOUND' }] };
    return { content: [{ type: 'text', text: JSON.stringify({ source: 'demo', records }) }] };
  }
}
