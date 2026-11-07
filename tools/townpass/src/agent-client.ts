/**
 * 瀏覽器版工具入口：讓 frontend/agent-mvp 的 AgentRunner 直接查示範站資料，不需要另外架 server。
 * 對外只提供 agent 目前放行的 search_books、search_services，格式依它的 ToolClient 契約。
 * 這個檔案和它的 import 不可依賴 Node API。
 */

import { TownPassClient } from "./adapters/client.js";
import { createServices } from "./services/index.js";
import { toPublicError } from "./shared/errors.js";

const DEFAULT_BASE_URL = "https://taipei-pass-service.vercel.app";
/** agent 單次最多接受 20 筆。 */
const MAX_RECORDS = 20;

export interface AgentToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface AgentClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

const queryInput = {
  type: "object",
  properties: { query: { type: "string", maxLength: 100, description: "搜尋關鍵字；空字串代表瀏覽全部" } },
  required: ["query"],
  additionalProperties: false,
};

const TOOLS = [
  { name: "search_books", description: "搜尋台北通圖書館藏（示範資料）。只能查詢，不能預約。", inputSchema: queryInput },
  { name: "search_services", description: "搜尋台北通可申辦的服務（示範資料）。不能代為送件。", inputSchema: queryInput },
];

/** 所有服務都是可申辦項目，這些泛稱不是真的關鍵字；agent 的提示範例會送出「申辦」。 */
const GENERIC_SERVICE_QUERIES = new Set(["申辦", "申請", "服務", "申辦服務"]);

/** 使用者問叫號時改查櫃檯資料；不回傳示範號碼，避免被當成現場實際叫號。 */
const COUNTER_QUERIES = new Set(["叫號", "臨櫃", "臨櫃叫號", "取號", "櫃檯"]);

/** 資料只有中文。en 放原文而非翻譯，agent 的英文介面會顯示中文。 */
const localized = (text: string) => ({ "zh-Hant-TW": text, en: text });

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function createAgentToolClient(options: AgentClientOptions = {}) {
  const services = createServices(
    new TownPassClient({
      baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      timeoutMs: options.timeoutMs ?? 30_000,
      fetchFn: options.fetchFn,
    }),
  );

  async function search(name: string, query: string): Promise<unknown[]> {
    if (name === "search_books") {
      const { results } = await services.library.search(query, MAX_RECORDS);
      return results.map((book) => ({
        id: book.id,
        title: localized(book.book_name),
        author: localized(book.author),
        category: localized(book.subject),
      }));
    }
    if (COUNTER_QUERIES.has(query)) {
      const { results } = await services.civic.counters(undefined, MAX_RECORDS);
      return results.map((office) => ({
        id: office.id,
        title: localized(office.name),
        description: localized(`${office.category}・${office.address}`),
      }));
    }
    const { results } = await services.civic.applications(
      query && !GENERIC_SERVICE_QUERIES.has(query) ? query : undefined,
      MAX_RECORDS,
    );
    return results.map((service) => ({
      id: service.id,
      title: localized(service.title),
      description: localized(service.description),
    }));
  }

  return {
    async listTools({ signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      return { tools: TOOLS };
    },

    async callTool(
      params: { name: string; arguments: Record<string, unknown> },
      { signal }: { signal: AbortSignal },
    ): Promise<AgentToolResult> {
      signal.throwIfAborted();
      const fail = (error: unknown): AgentToolResult => ({
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error }) }],
      });
      if (!TOOLS.some((tool) => tool.name === params.name)) {
        return fail({ code: "TOOL_NOT_FOUND", message: `沒有工具 ${params.name}` });
      }
      const query = params.arguments.query;
      if (typeof query !== "string") return fail({ code: "INVALID_ARGUMENTS", message: "query 必須是字串" });
      try {
        const records = await untilAborted(search(params.name, query.trim()), signal);
        return { content: [{ type: "text", text: JSON.stringify({ source: "demo", records }) }] };
      } catch (err) {
        if (signal.aborted) throw err;
        return fail(toPublicError(err));
      }
    },
  };
}
