import { books, services } from './catalog';
import type { ToolDefinition } from './types';

export type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type McpResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** Tool boundary, implemented by DemoMcpClient or tools/townpass as direct function calls.
 * The shapes follow MCP tools/list and tools/call, but no MCP transport or server is involved.
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
