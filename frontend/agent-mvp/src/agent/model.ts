import { recordInference } from '../dev/hud';
import { destinationFor } from './skills/navigation';
import { VISION_IMAGE } from './skills/report-vision';
import type { Message, ModelAdapter, ToolCall, VisionRequest } from './types';
import { chatTextStream } from './text-stream';

export type CompletionProtocol = 'json-schema' | 'tools';

type Sample = [request: string, tool: string, args: Record<string, unknown>];
const toolSamples: Sample[] = [
  ['我想看看有哪些書', 'search_library_books', { keyword: '' }],
  ['Browse the catalog', 'search_library_books', { keyword: '' }],
  ['查詢「雨天散步」這本書', 'search_library_books', { keyword: '雨天散步' }],
  ['最熱門的書', 'get_library_ranking', {}],
  ['信義區有哪些圖書分館', 'list_library_branches', { area: '信義區' }],
  ['圖書館最近有什麼公告', 'list_library_notices', {}],
  ['有哪些服務', 'list_townpass_services', { keyword: '' }],
  ['查詢申辦服務', 'search_application_services', { keyword: '申辦' }],
  ['戶政事務所叫到幾號', 'search_service_counters', { keyword: '戶政' }],
  ['忘記密碼怎麼登入', 'search_faq', { keyword: '登入' }],
  ['怎麼繳水費', 'search_fee_types', { keyword: '水費' }],
  ['我要通報淹水', 'list_report_categories', { kind: 'disaster' }],
  ['可以訂閱哪些市政訊息', 'list_subscription_topics', { keyword: '' }],
  ['有什麼票券優惠', 'search_perks', { keyword: '', kind: 'ticket' }],
  ['附近的 YouBike', 'find_nearby_youbike', { near_me: true }],
  ['大安區 YouBike', 'find_nearby_youbike', { area: '大安區' }],
  ['大安區的無障礙廁所', 'find_nearby_toilets', { area: '大安區', accessible: true }],
  ['大安區的停車場', 'find_nearby_parking', { area: '大安區' }],
  ['最近的無障礙廁所', 'find_nearby_toilets', { near_me: true, accessible: true }],
  [
    '附近有身障車位的停車場',
    'find_nearby_parking',
    { near_me: true, accessible: true, parking_space: 'disabled' },
  ],
  [
    '幫我找跟貓有關的書',
    'open_official_service',
    { destination: 'townpass_library', keyword: '貓' },
  ],
  ['我想申請身障補助', 'open_official_service', { destination: 'services_disabled' }],
  ['路燈壞了要陳情', 'open_official_service', { destination: 'townpass_report' }],
  ['我要繳水費', 'open_official_service', { destination: 'fee_water' }],
  ['有哪些服務', 'list_townpass_services', {}],
];

function structuredRequest(input: Parameters<ModelAdapter['complete']>[0], ollamaHints = true) {
  const tool = input.tools[0]?.function;
  if (!tool) throw new Error('TOOL_REQUIRED');
  const done = input.messages.at(-1)?.role === 'tool';
  const callSchema = ({ function: fn }: (typeof input.tools)[number]) => ({
    type: 'object',
    properties: { name: { const: fn.name }, arguments: fn.parameters },
    required: ['name', 'arguments'],
    additionalProperties: false,
  });
  const schema = done
    ? {
        type: 'object',
        properties: { status: { const: 'done' } },
        required: ['status'],
        additionalProperties: false,
      }
    : input.tools.length === 1
      ? callSchema(input.tools[0]!)
      : { anyOf: input.tools.map(callSchema) };
  const messages: Message[] = input.messages.map((message) => {
    if (message.role === 'system')
      return {
        ...message,
        content: `${message.content}\nReturn only JSON matching the supplied schema.${ollamaHints ? ' /no_think' : ''}`,
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
      ['怎麼繳水費', 'services'],
      ['我想看到我這期的帳單與繳費狀態', 'bills'],
      ['查水費繳了沒', 'bills'],
      ['有什麼優惠券', 'perks'],
      ['附近有 YouBike 嗎', 'places'],
      ['大安區的無障礙廁所', 'places'],
      ['中山區停車場', 'places'],
      ['他剛剛倒下去，怎麼叫都叫不醒', 'emergency'],
      ['我不想活了', 'emergency'],
      ['叫救護車要怎麼收費', 'services'],
      ['請幫我寫一首詩', 'unsupported'],
    ].flatMap(([request, domain]) => [
      { role: 'user' as const, content: JSON.stringify({ original_request: request }) },
      {
        role: 'assistant' as const,
        content: JSON.stringify({ name: 'select_agent', arguments: { domain } }),
      },
    ]);
    messages.splice(1, 0, ...examples);
  } else if (!done && tool.name === 'select_bill_query') {
    const samples = [
      ['我想看到我這期的帳單與繳費狀態', 'unknown', 'current', 'read'],
      ['查本期水費繳了沒', 'water', 'current', 'read'],
      ['Show all my current bills', 'all', 'current', 'read'],
      ['幫我繳水費', 'water', 'current', 'unsupported'],
      ['查上期停車費', 'parking', 'unsupported', 'read'],
    ];
    messages.splice(
      1,
      0,
      ...samples.flatMap(([request, category, period, action]): Message[] => [
        { role: 'user', content: JSON.stringify({ original_request: request }) },
        {
          role: 'assistant',
          content: JSON.stringify({ name: tool.name, arguments: { category, period, action } }),
        },
      ]),
    );
  } else if (!done) {
    const offered = new Set(input.tools.map((item) => item.function.name));
    messages.splice(
      1,
      0,
      ...toolSamples
        .filter(([, name]) => offered.has(name))
        .flatMap(([request, name, args]): Message[] => [
          { role: 'user', content: JSON.stringify({ original_request: request }) },
          { role: 'assistant', content: JSON.stringify({ name, arguments: args }) },
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
    const names = tools.map((tool) => tool.function.name);
    const quoted = text.match(/[「『“"]([^」』”"]+)[」』”"]/u)?.[1];
    const said = (...words: string[]) => quoted ?? words.find((word) => text.includes(word)) ?? '';
    if (names[0] === 'select_agent') {
      const isBill =
        /帳單|繳了|繳費狀態|待繳|未繳|已繳|bill|payment status|幫我繳|我要繳|查.*費|電費|瓦斯費/.test(
          text,
        ) ||
        (/水費|停車費|地方稅|學雜費|學費|醫療費|維護費|租金|公訓|tuition|housing|medical|maintenance|electricity|gas/.test(
          text,
        ) &&
          !/怎麼|如何|how/.test(text)) ||
        (messages.some((m) => m.content?.includes('Awaiting bill category')) &&
          /全部|所有|all|課程/.test(text));
      const domain = isBill
        ? 'bills'
        : /youbike|ubike|單車|腳踏車|停車|廁所|洗手間|附近|最近的|parking|toilet|nearby/.test(text)
          ? 'places'
          : /優惠|票券|景點|折價|coupon|ticket/.test(text)
            ? 'perks'
            : /圖書|借書|找書|書籍|的書|本書|熱門書|排行|分館|book|library|一起慢慢走|把日子過簡單|巷口的那棵樹/.test(
                  text,
                )
              ? 'library'
              : /服務|申辦|申請|叫號|臨櫃|補助|諮詢|繳費|水費|停車費|地方稅|陳情|反映|路燈|通報|災情|常見問題|登入|註冊|警政|訂閱|懷孕|孕婦|長者|長輩|銀髮|身障|1999|打電話|service|application|counter|welfare|faq/.test(
                    text,
                  )
                ? 'services'
                : 'unsupported';
      return { calls: [{ id: 'demo-route', name: 'select_agent', arguments: { domain } }] };
    }
    if (tools[0]?.function.name === 'select_bill_query') {
      const categories: [string, RegExp][] = [
        ['water', /水費|water/],
        ['parking', /停車|parking/],
        ['tax', /地方稅|稅|tax/],
        ['tuition', /學雜費|學費|tuition/],
        ['housing', /社宅|國宅|租金|public housing/],
        ['medical', /醫療|醫院|hospital|medical/],
        ['maintenance', /維護|maintenance/],
        ['course', /課程|course/],
        ['other', /其他|other/],
        ['unsupported', /電費|瓦斯|electricity|gas/],
        ['all', /全部|所有|all/],
      ];
      const category = categories.find(([, pattern]) => pattern.test(text))?.[0] ?? 'unknown';
      const period = /上期|上個月|歷史|去年|last|previous|history|20[0-9]{2}/.test(text)
        ? 'unsupported'
        : 'current';
      const action = /幫我繳|我要繳|立即繳|付款|取消|pay (my|the)|make.*payment/.test(text)
        ? 'unsupported'
        : 'read';
      return {
        calls: [
          { id: 'demo-bill', name: 'select_bill_query', arguments: { category, period, action } },
        ],
      };
    }
    if (
      names.includes('open_official_service') &&
      names.every((name) => name === 'open_official_service' || name === 'list_townpass_services')
    ) {
      const ruled = destinationFor(request.original_request);
      const destination = !ruled || ruled === 'catalog' ? 'townpass_library' : ruled;
      const keyword = quoted ?? demoArguments('search_library_books', text, said, quoted).keyword;
      return {
        calls: [
          {
            id: 'demo-call',
            name: 'open_official_service',
            arguments: {
              destination,
              ...(destination === 'townpass_library' && keyword ? { keyword } : {}),
            },
          },
        ],
      };
    }
    const rules: [RegExp, string][] = [
      [/排行|熱門書|popular/, 'get_library_ranking'],
      [/分館|branch/, 'list_library_branches'],
      [/公告|notice/, 'list_library_notices'],
      [/叫號|臨櫃|取號|櫃檯|counter/, 'search_service_counters'],
      [/常見問題|登入|註冊|密碼|faq/, 'search_faq'],
      [/繳費|水費|停車費|地方稅|學雜費|fee/, 'search_fee_types'],
      [/陳情|通報|災情|report/, 'list_report_categories'],
      [/訂閱|推播|市政訊息/, 'list_subscription_topics'],
      [/有哪些服務|服務清單|警政|票券錢包|繳費紀錄/, 'list_townpass_services'],
      [/停車|parking/, 'find_nearby_parking'],
      [/廁所|洗手間|toilet/, 'find_nearby_toilets'],
      [/youbike|ubike|單車|腳踏車/, 'find_nearby_youbike'],
    ];
    const name =
      rules.find(([rule, tool]) => rule.test(text) && names.includes(tool))?.[1] ?? names[0]!;
    return {
      calls: [{ id: 'demo-call', name, arguments: demoArguments(name, text, said, quoted) }],
    };
  }
}

function demoArguments(
  name: string,
  text: string,
  said: (...words: string[]) => string,
  quoted: string | undefined,
): Record<string, unknown> {
  if (name === 'get_library_ranking' || name === 'list_library_notices') return {};
  const area = text.match(/[一-鿿]{2}區/u)?.[0];
  if (name === 'list_library_branches') return area ? { area } : {};
  if (name === 'list_report_categories')
    return { kind: /災|淹水|disaster/.test(text) ? 'disaster' : 'citizen' };
  if (name.startsWith('find_nearby_'))
    return {
      ...(/附近|最近|nearby|nearest/.test(text) || !area ? { near_me: true } : {}),
      ...(area ? { area } : {}),
      ...(/無障礙|身障|孕婦|輪椅|愛心/.test(text) && name !== 'find_nearby_youbike'
        ? { accessible: true }
        : {}),
      ...(name === 'find_nearby_parking' && /身障|輪椅|身心障礙|愛心/.test(text)
        ? { parking_space: 'disabled' }
        : name === 'find_nearby_parking' && /孕婦|懷孕/.test(text)
          ? { parking_space: 'pregnancy' }
          : {}),
      ...(quoted ? { keyword: quoted } : {}),
    };
  if (name === 'search_perks') {
    const kind = /票券|ticket/.test(text)
      ? 'ticket'
      : /優惠券|折價|coupon/.test(text)
        ? 'coupon'
        : /景點/.test(text)
          ? 'hot_spot'
          : undefined;
    return { keyword: quoted ?? '', ...(kind ? { kind } : {}) };
  }
  if (name === 'search_faq') return { keyword: said('登入', '註冊', '密碼', '卡證', '帳單') };
  if (name === 'search_fee_types') return { keyword: said('水費', '停車費', '地方稅', '學雜費') };
  if (name === 'search_service_counters')
    return { keyword: said('戶政', '地政', '區公所', '稅捐', '就業') };
  if (name === 'list_subscription_topics')
    return { keyword: said('交通', '銀髮', '圖書', '旅遊', '體育') };
  if (name === 'list_townpass_services') return { keyword: said('警政', '票券錢包', '繳費紀錄') };
  if (name === 'search_application_services')
    return { keyword: said('申辦', '叫號', '補助', 'application', 'counter', 'welfare') };
  const titles = [
    '一起慢慢走',
    '把日子過簡單',
    '巷口的那棵樹',
    'walking together',
    'a simpler everyday',
    'the tree around the corner',
  ];
  const keyword = titles.find((title) => text.includes(title)) ?? quoted;
  if (keyword) return { keyword };
  const browsing =
    /^(幫我)?(查詢|找|搜尋)?(示範)?(圖書|書籍|借書|找書)$/.test(text.trim()) ||
    /^(find|browse|search)( sample)? books[.!]?$/.test(text.trim());
  return {
    keyword: browsing
      ? ''
      : text
          .replace(
            /幫我|請|查詢|搜尋|找一本|找書|找|圖書|書籍|書|search|books?|find|please|[。？！?!.]/g,
            '',
          )
          .trim(),
  };
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

const VISION_SCHEMA = {
  type: 'object',
  properties: { subject: { type: 'string' }, description: { type: 'string' } },
  required: ['subject', 'description'],
  additionalProperties: false,
} as const;

/** Pull the assistant text out of a Chat Completions reply, for the vision (non-tool) path. */
export function visionContent(body: unknown): string {
  if (!record(body) || !Array.isArray(body.choices) || !record(body.choices[0]))
    throw new Error('INVALID_RESPONSE');
  const choice = body.choices[0];
  if (choice.finish_reason === 'length') throw new Error('TRUNCATED_RESPONSE');
  const message = choice.message;
  if (!record(message) || typeof message.content !== 'string') throw new Error('INVALID_RESPONSE');
  return message.content;
}

/**
 * Error wording that local OpenAI-compatible servers use when the loaded model is text-only:
 * llama.cpp `llama-server` without `--mmproj` ("image input is not supported ... mmproj"),
 * Ollama ("missing data required for image input", "does not support images"), vLLM
 * ("is not a multimodal model") and LM Studio ("does not support vision").
 */
const VISION_UNSUPPORTED =
  /image input is not supported|mmproj|missing data required for image input|does not support (?:images?|image input|vision)|not a multimodal model|vision is not supported/i;

/** True when an error body says the model cannot take images (vs. any other failure). */
export function visionUnsupported(errorBody: string): boolean {
  return VISION_UNSUPPORTED.test(errorBody.slice(0, 4000));
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
    private options: { getApiKey?: () => string | undefined; ollamaHints?: boolean } = {},
  ) {
    this.endpoint = validateEndpoint(endpoint);
    if (!model.trim()) throw new Error('MODEL_REQUIRED');
  }
  async complete(input: Parameters<ModelAdapter['complete']>[0]) {
    aborted(input.signal);
    const started = performance.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    input.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.getApiKey?.()
            ? { Authorization: `Bearer ${this.options.getApiKey()}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.model,
          ...(this.protocol === 'json-schema'
            ? structuredRequest(input, this.options.ollamaHints !== false)
            : { messages: input.messages, tools: input.tools }),
          ...(this.protocol === 'json-schema' && this.options.ollamaHints !== false
            ? { reasoning_effort: 'none' }
            : {}),
          stream: false,
          temperature: 0,
          max_tokens: 256,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      const text = await response.text();
      if (text.length > 100000) throw new Error('RESPONSE_TOO_LARGE');
      const body: unknown = JSON.parse(text);
      recordInference({ model: this.model, latencyMs: performance.now() - started, body });
      return parseCompletion(body);
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener('abort', cancel);
    }
  }
  async *streamText(input: {
    system: string;
    instruction: string;
    signal: AbortSignal;
  }): AsyncGenerator<string> {
    aborted(input.signal);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    input.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.getApiKey?.()
            ? { Authorization: `Bearer ${this.options.getApiKey()}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `${input.system}${this.options.ollamaHints !== false ? ' /no_think' : ''}`,
            },
            { role: 'user', content: input.instruction },
          ],
          stream: true,
          temperature: 0,
          max_tokens: 128,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`MODEL_HTTP_${response.status}`);
      if (response.headers.get('content-type')?.includes('application/json')) {
        const text = await response.text();
        if (text.length > 100000) throw new Error('RESPONSE_TOO_LARGE');
        yield visionContent(JSON.parse(text));
      } else
        for await (const text of chatTextStream(response)) {
          aborted(input.signal);
          yield text;
        }
    } finally {
      controller.abort();
      clearTimeout(timer);
      input.signal.removeEventListener('abort', cancel);
    }
  }
  async vision(input: VisionRequest): Promise<string> {
    aborted(input.signal);
    if (
      !VISION_IMAGE.pattern.test(input.image) ||
      input.image.length > VISION_IMAGE.maxDataUrlLength
    )
      throw new Error('INVALID_IMAGE');
    const started = performance.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    input.signal.addEventListener('abort', cancel, { once: true });
    // Image inference is heavier than routing; give it room but still bound it.
    const timer = setTimeout(cancel, Math.max(this.timeoutMs, 45000));
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.getApiKey?.()
            ? { Authorization: `Bearer ${this.options.getApiKey()}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: input.system },
            {
              role: 'user',
              content: [
                { type: 'text', text: input.instruction },
                { type: 'image_url', image_url: { url: input.image } },
              ],
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'report_vision', strict: true, schema: VISION_SCHEMA },
          },
          stream: false,
          temperature: 0,
          max_tokens: 320,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        // 401 stays as-is so the phone adapter can drop its credentials.
        if (response.status !== 401 && visionUnsupported(await response.text().catch(() => '')))
          throw new Error('VISION_UNAVAILABLE');
        throw new Error(`MODEL_HTTP_${response.status}`);
      }
      const text = await response.text();
      if (text.length > 100000) throw new Error('RESPONSE_TOO_LARGE');
      const body: unknown = JSON.parse(text);
      recordInference({ model: this.model, latencyMs: performance.now() - started, body });
      return visionContent(body);
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
