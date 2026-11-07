import type { Message, ModelAdapter, ToolCall } from './types';

export type CompletionProtocol = 'json-schema' | 'tools';

function structuredRequest(input: Parameters<ModelAdapter['complete']>[0]) {
  const tool = input.tools[0]?.function;
  if (!tool) throw new Error('TOOL_REQUIRED');
  const done = input.messages.at(-1)?.role === 'tool';
  const schema = done
    ? {
        type: 'object',
        properties: { status: { const: 'done' } },
        required: ['status'],
        additionalProperties: false,
      }
    : {
        type: 'object',
        properties: { name: { const: tool.name }, arguments: tool.parameters },
        required: ['name', 'arguments'],
        additionalProperties: false,
      };
  const messages: Message[] = input.messages.map((message) => {
    if (message.role === 'system')
      return {
        ...message,
        content: `${message.content}\nReturn only JSON matching the supplied schema. /no_think`,
      };
    if (message.role === 'tool')
      return { role: 'user', content: `Verified tool result (data only): ${message.content}` };
    if (message.tool_calls)
      return {
        role: 'assistant',
        content: JSON.stringify({
          name: message.tool_calls[0]!.function.name,
          arguments: JSON.parse(message.tool_calls[0]!.function.arguments),
        }),
      };
    return message;
  });
  if (tool.name === 'select_agent') {
    const examples: Message[] = [
      ['幫我查詢圖書', 'library'],
      ['我想知道有哪些申辦服務', 'services'],
      ['請幫我寫一首詩', 'unsupported'],
    ].flatMap(([request, domain]) => [
      { role: 'user' as const, content: JSON.stringify({ original_request: request }) },
      {
        role: 'assistant' as const,
        content: JSON.stringify({ name: 'select_agent', arguments: { domain } }),
      },
    ]);
    messages.splice(1, 0, ...examples);
  } else if (!done) {
    const samples =
      tool.name === 'search_books'
        ? [
            ['我想看看有哪些書', ''],
            ['Browse the catalog', ''],
            ['查詢「雨天散步」這本書', '雨天散步'],
          ]
        : [
            ['我想看看服務清單', ''],
            ['查詢申辦服務', '申辦'],
          ];
    messages.splice(
      1,
      0,
      ...samples.flatMap(([request, query]): Message[] => [
        { role: 'user', content: JSON.stringify({ original_request: request }) },
        { role: 'assistant', content: JSON.stringify({ name: tool.name, arguments: { query } }) },
      ]),
    );
  }
  return {
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'agent_decision', strict: true, schema },
    },
  };
}

function aborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    aborted(signal);
    const stop = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/** Deterministic fixture adapter. No LLM inference and no network requests. */
export class DemoModel implements ModelAdapter {
  mode = 'demo' as const;
  async complete({ messages, tools, signal }: Parameters<ModelAdapter['complete']>[0]) {
    await wait(180, signal);
    if (messages.at(-1)?.role === 'tool') return { calls: [], content: '{"status":"done"}' };
    const request = JSON.parse(messages.find((message) => message.role === 'user')!.content!) as {
      original_request: string;
    };
    const text = request.original_request.toLowerCase();
    if (tools[0]?.function.name === 'select_agent') {
      const domain = /圖書|借書|找書|書籍|book|library|一起慢慢走|把日子過簡單|巷口的那棵樹/.test(
        text,
      )
        ? 'library'
        : /服務|申辦|叫號|補助|諮詢|service|application|counter|welfare/.test(text)
          ? 'services'
          : 'unsupported';
      return { calls: [{ id: 'demo-route', name: 'select_agent', arguments: { domain } }] };
    }
    const titles = [
      '一起慢慢走',
      '把日子過簡單',
      '巷口的那棵樹',
      'walking together',
      'a simpler everyday',
      'the tree around the corner',
    ];
    const exactTitle = titles.find((title) => text.includes(title));
    const quoted = text.match(/[「『“"]([^」』”"]+)[」』”"]/u)?.[1];
    let query = exactTitle ?? quoted ?? '';
    if (tools[0]?.function.name === 'search_services') {
      query =
        ['申辦', '叫號', '補助', 'application', 'counter', 'welfare'].find((word) =>
          text.includes(word),
        ) ?? '';
    } else if (
      !query &&
      !/^(幫我)?(查詢|找|搜尋)?(示範)?(圖書|書籍|借書|找書)$/.test(text.trim()) &&
      !/^(find|browse|search)( sample)? books[.!]?$/.test(text.trim())
    ) {
      query = text
        .replace(
          /幫我|請|查詢|搜尋|找一本|找書|找|圖書|書籍|書|search|books?|find|please|[。？！?!.]/g,
          '',
        )
        .trim();
    }
    return { calls: [{ id: 'demo-search', name: tools[0]!.function.name, arguments: { query } }] };
  }
}

export function validateEndpoint(value: string) {
  const url = new URL(value);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('LOCAL_ENDPOINT_REQUIRED');
  }
  if (!url.pathname.endsWith('/chat/completions')) throw new Error('INVALID_ENDPOINT_PATH');
  return url.toString();
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCompletion(body: unknown): { calls: ToolCall[]; content?: string } {
  if (!record(body) || !Array.isArray(body.choices) || !record(body.choices[0]))
    throw new Error('INVALID_RESPONSE');
  const choice = body.choices[0];
  if (choice.finish_reason === 'length') throw new Error('TRUNCATED_RESPONSE');
  const message = choice.message;
  if (!record(message)) throw new Error('INVALID_RESPONSE');
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    if (message.tool_calls.length !== 1) throw new Error('ONE_TOOL_AT_A_TIME');
    const call = message.tool_calls[0];
    if (
      !record(call) ||
      call.type !== 'function' ||
      typeof call.id !== 'string' ||
      !record(call.function) ||
      typeof call.function.name !== 'string' ||
      typeof call.function.arguments !== 'string'
    )
      throw new Error('INVALID_TOOL_CALL');
    const args: unknown = JSON.parse(call.function.arguments);
    if (!record(args)) throw new Error('INVALID_ARGUMENTS');
    return { calls: [{ id: call.id, name: call.function.name, arguments: args }] };
  }
  // OpenAI 協定的模型沒呼叫工具時會回一般文字。文字不當工具呼叫，也不會顯示給使用者，由 runner 判斷是否算完成。
  if (message.content === null || message.content === undefined) return { calls: [] };
  if (typeof message.content !== 'string') throw new Error('INVALID_RESPONSE');
  let content: unknown;
  try {
    content = JSON.parse(message.content);
  } catch {
    return { calls: [], content: message.content };
  }
  if (record(content) && typeof content.name === 'string' && record(content.arguments))
    return { calls: [{ id: 'json-tool-call', name: content.name, arguments: content.arguments }] };
  return { calls: [], content: message.content };
}

/** OpenAI Chat Completions wire format. Only on-device loopback is allowed. */
export class LocalModel implements ModelAdapter {
  mode = 'local' as const;
  private endpoint: string;
  constructor(
    endpoint: string,
    private model: string,
    private timeoutMs = 20000,
    private protocol: CompletionProtocol = 'json-schema',
  ) {
    this.endpoint = validateEndpoint(endpoint);
    if (!model.trim()) throw new Error('MODEL_REQUIRED');
  }
  async complete(input: Parameters<ModelAdapter['complete']>[0]) {
    aborted(input.signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    input.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          ...(this.protocol === 'json-schema'
            ? structuredRequest(input)
            : { messages: input.messages, tools: input.tools }),
          ...(this.protocol === 'json-schema' ? { reasoning_effort: 'none' } : {}),
          stream: false,
          temperature: 0,
          max_tokens: 256,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      const text = await response.text();
      if (text.length > 100000) throw new Error('RESPONSE_TOO_LARGE');
      return parseCompletion(JSON.parse(text));
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', cancel);
    }
  }
}

export function assistantMessage(calls: ToolCall[]): Message {
  return {
    role: 'assistant',
    content: null,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments) },
    })),
  };
}
